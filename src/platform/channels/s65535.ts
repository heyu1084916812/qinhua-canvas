/**
 * 65535 原生异步任务适配器。
 *
 * 站点文档：`https://my.65535.space/docs/async-native-api`
 *
 * 65535 的任务入口与普通 OpenAI 兼容生图不是同一条链路：
 *
 * - 提交：`POST {base}/tasks`，请求体是 `{ kind, model, input }`；
 * - 查询：`GET {base}/tasks/{id}`，状态为 `pending / running / done / failed`；
 * - 产物：成功时读 `result_urls`（也兼容 `result.data[].b64_json`）。
 *
 * 为什么不复用 APIMART 兼容适配器：两者只是同底层的不同协议壳。65535 的
 * APIMart 兼容响应把任务放在 `data` 下，而原生接口直接返回任务对象；这里按
 * 官方推荐的原生接口实现，少一层字段翻译，也避免把「任务成功」误判成失败。
 *
 * 请求地址有国际 / 大陆两套：协议目录只提供默认值，用户可改渠道地址；
 * 适配器只认 `config.baseUrl`，不猜线路。
 */

import { base64ToBytes } from '../../domain/shared/base64'
import { fingerprintBytes } from '../../domain/shared/hash'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import type { SafeChannelConfig } from '../ports'
import { bytesToBase64 } from './base64'
import { prepareModelImageInput } from './chatImageInput'
import {
  authHeader,
  classifyError,
  fileExtensionOf,
  IMAGE_ASSET_DOWNLOAD_TIMEOUT_MS,
  isModelListBody,
  openAiBaseUrl,
  toModelCapability,
  VERIFY_TIMEOUT_MS,
} from './openaiCommon'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type GeneratedAsset,
  type ImageRunRequest,
  type VerifyResult,
} from './types'

export interface S65535TaskConfig extends SafeChannelConfig {
  apiKey: string | null
}

export interface S65535TaskPayload {
  id?: string
  task_id?: string
  status?: string
  progress?: number
  result_urls?: string[]
  video_url?: string
  result?: {
    data?: { b64_json?: string; url?: string | string[] }[]
    images?: { url?: string[] }[]
    videos?: { url?: string[] }[]
  }
  error_code?: string
  error_message?: string
  error?: { message?: string; code?: number | string }
}

/** 任务总等待上限。65535 文档给出多图任务可能 400–500 秒。 */
export const S65535_POLL_TIMEOUT_MS = 8 * 60_000
export const S65535_POLL_INTERVAL_MS = 2_000

const TERMINAL_FAILURE = new Set(['failed', 'cancelled', 'canceled', 'error'])

export function s65535TaskIdOf(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const record = body as Record<string, unknown>
  const nested =
    record.data && typeof record.data === 'object'
      ? (record.data as Record<string, unknown>)
      : null
  const candidate = record.id ?? record.task_id ?? nested?.task_id ?? nested?.id
  return typeof candidate === 'string' && candidate.trim() ? candidate : null
}

function listOfStrings(value: unknown): string[] {
  if (typeof value === 'string') return value ? [value] : []
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/** 从原生任务响应里取产物地址；保留服务端给出的顺序并去重。 */
export function s65535ResultUrlsOf(payload: S65535TaskPayload): string[] {
  const out: string[] = []
  const push = (urls: unknown): void => {
    for (const url of listOfStrings(urls)) {
      if (!out.includes(url)) out.push(url)
    }
  }

  push(payload.result_urls)
  push(payload.video_url)
  for (const item of payload.result?.data ?? []) push(item.url)
  for (const item of payload.result?.images ?? []) push(item.url)
  for (const item of payload.result?.videos ?? []) push(item.url)
  return out
}

/** 兼容 `response_format: b64_json` 的内联产物。 */
export function s65535InlineImagesOf(payload: S65535TaskPayload): string[] {
  return (payload.result?.data ?? [])
    .map((item) => item.b64_json?.trim())
    .filter((item): item is string => !!item)
}

function failureReasonOf(payload: S65535TaskPayload): string {
  return (
    payload.error_message?.trim() ||
    payload.error?.message?.trim() ||
    (payload.status === 'cancelled' || payload.status === 'canceled'
      ? '任务已取消'
      : '任务失败')
  )
}

export interface S65535TaskOptions {
  pollIntervalMs?: number
  pollTimeoutMs?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
      },
      { once: true },
    )
  })

async function assetFromBytes(bytes: Uint8Array, mime: string): Promise<GeneratedAsset> {
  const hash = await fingerprintBytes(bytes)
  const actual = imageSizeFromHeader(bytes)
  return {
    hash,
    mime,
    bytes,
    ...(actual ? { width: actual.width, height: actual.height } : {}),
  }
}

export function createS65535TaskAdapter(
  config: S65535TaskConfig,
  deps: ChannelDeps,
  options: S65535TaskOptions = {},
): ChannelAdapter {
  const base = openAiBaseUrl(config)
  const modelsUrl = `${base}/models`
  const tasksUrl = `${base}/tasks`
  const pollInterval = options.pollIntervalMs ?? S65535_POLL_INTERVAL_MS
  const pollTimeout = options.pollTimeoutMs ?? S65535_POLL_TIMEOUT_MS
  const sleepFn = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...authHeader(config.apiKey),
  })

  const verify: ChannelAdapter['verify'] = async (_cfg, signal): Promise<VerifyResult> => {
    try {
      const res = await deps.network.request(
        {
          url: modelsUrl,
          method: 'GET',
          headers: authHeader(config.apiKey),
          timeoutMs: VERIFY_TIMEOUT_MS,
        },
        signal,
      )
      if (res.status < 200 || res.status >= 300) {
        const detail = await res.text().catch(() => '')
        const { error, message } = classifyError(null, res.status, detail)
        return { ok: false, error, message }
      }
      const body = await res.json<{ data?: { id: string }[] }>().catch(() => null)
      if (!isModelListBody(body)) {
        return {
          ok: false,
          error: { kind: 'channel', detail: 'unsupported' },
          message: '响应不是模型列表，该地址不像 65535 任务接口',
        }
      }
      return { ok: true, models: body.data.map((m) => toModelCapability(m.id)) }
    } catch (e) {
      const { error, message } = classifyError(e)
      return { ok: false, error, message }
    }
  }

  const listModels: ChannelAdapter['listModels'] = async (_cfg, signal) => {
    const res = await deps.network.request(
      {
        url: modelsUrl,
        method: 'GET',
        headers: authHeader(config.apiKey),
        timeoutMs: VERIFY_TIMEOUT_MS,
      },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res
      .json<{ data?: { id: string }[] }>()
      .catch(() => ({ data: [] as { id: string }[] }))
    return (body.data ?? []).map((m) => toModelCapability(m.id))
  }

  const submit = async (
    kind: 'image' | 'video',
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> => {
    const res = await deps.network.request(
      {
        url: tasksUrl,
        method: 'POST',
        headers: headers(),
        body: { kind, ...payload },
      },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res.json<unknown>().catch(() => null)
    const taskId = s65535TaskIdOf(body)
    if (!taskId) {
      throw new ChannelError({ kind: 'parse', raw: '提交响应里没有任务 id' })
    }
    return taskId
  }

  const poll = async (taskId: string, signal: AbortSignal): Promise<S65535TaskPayload> => {
    const startedAt = now()
    const taskUrl = `${tasksUrl}/${encodeURIComponent(taskId)}`
    for (;;) {
      const res = await deps.network.request(
        {
          url: taskUrl,
          method: 'GET',
          headers: authHeader(config.apiKey),
          timeoutMs: VERIFY_TIMEOUT_MS,
        },
        signal,
      )
      if (res.status < 200 || res.status >= 300) {
        const detail = await res.text().catch(() => '')
        const { error } = classifyError(null, res.status, detail)
        throw new ChannelError(error)
      }
      const payload = (await res.json<S65535TaskPayload>().catch(() => ({}))) as S65535TaskPayload
      if (payload.status === 'done') return payload
      if (payload.status && TERMINAL_FAILURE.has(payload.status)) {
        throw new ChannelError({ kind: 'http', status: 502, body: failureReasonOf(payload) })
      }
      if (now() - startedAt >= pollTimeout) {
        throw new ChannelError({ kind: 'network', detail: 'timeout' })
      }
      await sleepFn(pollInterval, signal)
    }
  }

  const download = async (
    urls: string[],
    inline: string[],
    mime: string,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const assets: GeneratedAsset[] = []
    for (const urlsOfItem of inline) {
      try {
        assets.push(await assetFromBytes(base64ToBytes(urlsOfItem), mime))
      } catch {
        /* 单张内联产物解不开就跳过，剩余产物仍可用 */
      }
    }
    for (const url of urls) {
      try {
        const res = await deps.network.request(
          { url, method: 'GET', headers: {}, timeoutMs: IMAGE_ASSET_DOWNLOAD_TIMEOUT_MS },
          signal,
        )
        if (res.status < 200 || res.status >= 300) continue
        assets.push(await assetFromBytes(new Uint8Array(await res.arrayBuffer()), mime))
      } catch {
        /* 单个产物取不到就跳过：其余产物仍然可用 */
      }
    }
    if (assets.length === 0) {
      throw new ChannelError({
        kind: 'parse',
        raw: '任务已完成，但结果里没有可读取的产物（URL 下载与 Base64 均失败）',
      })
    }
    return assets
  }

  const referenceUrls = async (request: ImageRunRequest): Promise<string[]> => {
    const refs: string[] = []
    for (const input of imageInputsOf(request.inputs)) {
      const payload = await deps.assets.read(input.assetHash).catch(() => null)
      if (!payload || payload.bytes.length === 0) {
        throw new ChannelError({
          kind: 'http',
          status: 400,
          body: `参考素材（${input.assetHash.slice(0, 8)}…）的字节不在本地素材库里，无法随生图任务发出。`,
        })
      }
      const prepared = await prepareModelImageInput({
        bytes: payload.bytes,
        mime: payload.mime || input.mime,
      })
      const hosted = await deps.hosting
        ?.upload({
          blob: new Blob([prepared.bytes as unknown as BlobPart], { type: prepared.mime }),
          name: `${input.assetHash.slice(0, 12)}.${fileExtensionOf(prepared.mime)}`,
        })
        .catch(() => null)
      refs.push(
        hosted?.url ?? `data:${prepared.mime};base64,${bytesToBase64(prepared.bytes)}`,
      )
    }
    return refs
  }

  const generateImage: ChannelAdapter['generateImage'] = async (request, signal) => {
    const refs = await referenceUrls(request)
    const count = Math.max(1, Math.floor(Number(request.params.count) || 1))
    const ratio =
      typeof request.params.ratio === 'string' && request.params.ratio !== 'auto'
        ? request.params.ratio
        : null
    const resolution =
      typeof request.params.resolution === 'string' && request.params.resolution !== 'auto'
        ? request.params.resolution.toLowerCase()
        : null
    const quality =
      typeof request.params.quality === 'string' && request.params.quality !== 'auto'
        ? request.params.quality
        : null

    const input: Record<string, unknown> = {
      prompt: request.prompt,
      n: count,
      ...(ratio ? { size: ratio } : {}),
      ...(resolution ? { resolution } : {}),
      ...(quality ? { quality } : {}),
      ...(refs.length === 1
        ? { image: refs[0] }
        : refs.length > 1
          ? { image_urls: refs }
          : {}),
    }
    const taskId = await submit(
      'image',
      { model: request.model, input },
      signal,
    )
    const final = await poll(taskId, signal)
    return download(s65535ResultUrlsOf(final), s65535InlineImagesOf(final), 'image/png', signal)
  }

  return {
    protocol: config.protocol,
    verify,
    listModels,
    generateImage,
    async generateVideo() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
    async completeText() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
  }
}
