/**
 * 异步任务族适配器（提交任务 → 轮询结果）。
 *
 * ## 为什么单独一族
 *
 * 同步 OpenAI 兼容是「发一次请求、响应里就有产物」；APIMART / RunningHub 这类是
 * 「提交只回一个 `task_id`，产物要轮询任务端点才拿得到」。把后者塞进前者，
 * 用户会看到「点生成 → 立刻成功 → 一张图都没有」，那是最难查的一类假功能。
 *
 * ## 依据（官方公开文档，不是猜的）
 *
 * APIMART `docs.apimart.ai`：
 *  - 图像：`POST {base}/images/generations`，请求体沿用 OpenAI 字段
 *    （`model` / `prompt` / `n` / `size` / `resolution`），**响应不是产物**，
 *    而是 `{ code, data: { status: 'submitted', task_id } }`；
 *  - 结果：`GET {base}/tasks/{task_id}`，`status` 取
 *    `pending | processing | completed | failed | cancelled`（文档另有 `submitted`），
 *    成功时 `result.images[].url[]` / `result.videos[].url[]` 是产物地址；
 *  - 鉴权与其他 OpenAI 兼容站一致：`Authorization: Bearer <token>`，基址 `https://api.apimart.ai/v1`。
 *
 * 轮询参数**可注入**：单测要能一步一步走完「处理中 → 完成」，
 * 不能靠 `sleep` 赌时长（那是本项目反复踩过的测试台坑）。
 */

import { fingerprintBytes } from '../../domain/shared/hash'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import type { ModelCapability } from '../../domain/shared/capability'
import type { SafeChannelConfig } from '../ports'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type GeneratedAsset,
  type ImageRunRequest,
  type VideoRunRequest,
  type VerifyResult,
} from './types'
import {
  authHeader,
  classifyError,
  isModelListBody,
  openAiBaseUrl,
  toModelCapability,
  GENERATE_TIMEOUT_MS,
  VERIFY_TIMEOUT_MS,
} from './openaiCommon'

export interface AsyncTaskConfig extends SafeChannelConfig {
  apiKey: string | null
}

/** 轮询节奏：先紧后松。任务型站点普遍在 10s 以上，一开始就用 5s 会白等好几轮 */
export const POLL_INTERVAL_MS = 2_000
/** 任务总超时：给足一次视频生成的时间，但绝不等到天荒地老 */
export const POLL_TIMEOUT_MS = 180_000

/** 任务终态判定。`submitted` / `pending` / `processing` 都还要继续等 */
export const TERMINAL_STATUS = {
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
} as const

export type TaskStatus = string

export interface TaskPayload {
  status?: TaskStatus
  result?: {
    images?: { url?: string[] }[]
    videos?: { url?: string[] }[]
  }
  error?: { message?: string; code?: number | string }
}

export function isTerminalStatus(status: TaskStatus | undefined): boolean {
  return (
    status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'canceled'
  )
}

/** 从任务结果里取出产物地址；两类产物（图 / 视频）按顺序展开 */
export function resultUrlsOf(payload: TaskPayload): string[] {
  const urls: string[] = []
  for (const img of payload.result?.images ?? []) {
    for (const u of img.url ?? []) if (u) urls.push(u)
  }
  for (const vid of payload.result?.videos ?? []) {
    for (const u of vid.url ?? []) if (u) urls.push(u)
  }
  return urls
}

/** 下载产物地址 → 素材；单个地址失败不拖垮整批（少一张比一张都没有好） */
async function downloadAssets(
  deps: ChannelDeps,
  urls: string[],
  mime: string,
  signal: AbortSignal,
): Promise<GeneratedAsset[]> {
  const out: GeneratedAsset[] = []
  for (const url of urls) {
    try {
      const res = await deps.network.request({ url, method: 'GET', headers: {} }, signal)
      if (res.status < 200 || res.status >= 300) continue
      const bytes = new Uint8Array(await res.arrayBuffer())
      const hash = await fingerprintBytes(bytes)
      const actual = imageSizeFromHeader(bytes)
      out.push({
        hash,
        mime,
        bytes,
        ...(actual ? { width: actual.width, height: actual.height } : {}),
      })
    } catch {
      /* 单个产物取不到就跳过：其余产物仍然可用 */
    }
  }
  return out
}

export interface AsyncTaskOptions {
  /** 供单测注入：不传则按固定间隔真实等待 */
  pollIntervalMs?: number
  pollTimeoutMs?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t)
        reject(new ChannelError({ kind: 'network', detail: 'aborted' }))
      },
      { once: true },
    )
  })

export function createAsyncTaskAdapter(
  config: AsyncTaskConfig,
  deps: ChannelDeps,
  options: AsyncTaskOptions = {},
): ChannelAdapter {
  const base = openAiBaseUrl(config)
  const modelsUrl = `${base}/models`
  const imagesUrl = `${base}/images/generations`
  const videosUrl = `${base}/videos/generations`
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const pollTimeout = options.pollTimeoutMs ?? POLL_TIMEOUT_MS
  const sleepFn = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())

  const headers = (): Record<string, string> => ({
    'Content-Type': 'application/json',
    ...authHeader(config.apiKey),
  })

  const verify: ChannelAdapter['verify'] = async (_cfg, signal): Promise<VerifyResult> => {
    try {
      const res = await deps.network.request(
        { url: modelsUrl, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
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
          message: '响应不是模型列表，该地址不像 OpenAI 兼容接口',
        }
      }
      return { ok: true, models: body.data.map((m) => toModelCapability(m.id)) }
    } catch (e) {
      const { error, message } = classifyError(e)
      return { ok: false, error, message }
    }
  }

  const listModels: ChannelAdapter['listModels'] = async (_cfg, signal): Promise<ModelCapability[]> => {
    const res = await deps.network.request(
      { url: modelsUrl, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res.json<{ data?: { id: string }[] }>().catch(() => ({ data: [] as { id: string }[] }))
    return (body.data ?? []).map((m) => toModelCapability(m.id))
  }

  /** 提交任务，取回 task_id；拿不到就如实报错（没有 id 后续无从轮询） */
  const submit = async (
    url: string,
    payload: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<string> => {
    const res = await deps.network.request(
      { url, method: 'POST', headers: headers(), body: payload, timeoutMs: GENERATE_TIMEOUT_MS },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res.json<{ data?: { task_id?: string; id?: string } | null; task_id?: string; id?: string }>().catch(
      () => null,
    )
    const taskId = body?.data?.task_id ?? body?.data?.id ?? body?.task_id ?? body?.id
    if (typeof taskId !== 'string' || !taskId) {
      throw new ChannelError({ kind: 'parse', raw: '提交响应里没有 task_id' })
    }
    return taskId
  }

  /** 轮询到终态；失败态把服务端原话带上（用户据此知道是模型没开通还是额度不够） */
  const poll = async (taskId: string, signal: AbortSignal): Promise<TaskPayload> => {
    const startedAt = now()
    const taskUrl = `${base}/tasks/${encodeURIComponent(taskId)}`
    for (;;) {
      const res = await deps.network.request(
        { url: taskUrl, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
        signal,
      )
      if (res.status < 200 || res.status >= 300) {
        const detail = await res.text().catch(() => '')
        const { error } = classifyError(null, res.status, detail)
        throw new ChannelError(error)
      }
      const payload = (await res.json<TaskPayload>().catch(() => ({}))) as TaskPayload
      if (isTerminalStatus(payload.status)) return payload
      if (now() - startedAt >= pollTimeout) {
        throw new ChannelError({ kind: 'network', detail: 'timeout' })
      }
      await sleepFn(pollInterval, signal)
    }
  }

  const runTask = async (
    url: string,
    payload: Record<string, unknown>,
    mime: string,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const taskId = await submit(url, payload, signal)
    const final = await poll(taskId, signal)
    if (final.status !== 'completed') {
      /*
       * 失败态要把服务端原话带上。`channel` 的 detail 是封闭枚举（没有「上游失败」这一项），
       * 故按「拿到了服务端文案」走 `http` + body —— 展示侧会把它拼成可读句子；
       * 连文案都没有才退回 unsupported，绝不把一个空壳错误丢给用户。
       */
      const reason =
        final.error?.message ??
        (final.status === 'cancelled' || final.status === 'canceled' ? '任务已取消' : '任务失败')
      throw new ChannelError({ kind: 'http', status: 502, body: reason })
    }
    const urls = resultUrlsOf(final)
    if (urls.length === 0) {
      throw new ChannelError({ kind: 'parse', raw: '任务已完成，但结果里没有产物地址' })
    }
    return downloadAssets(deps, urls, mime, signal)
  }

  return {
    protocol: config.protocol,
    verify,
    listModels,
    generateImage(request: ImageRunRequest, signal) {
      const count = Math.max(1, typeof request.params.count === 'number' ? request.params.count : 1)
      return runTask(
        imagesUrl,
        {
          model: request.model,
          prompt: request.prompt,
          n: count,
          ...(typeof request.params.ratio === 'string' ? { size: request.params.ratio } : {}),
          ...(typeof request.params.resolution === 'string' ? { resolution: request.params.resolution } : {}),
        },
        'image/png',
        signal,
      )
    },
    generateVideo(request: VideoRunRequest, signal) {
      return runTask(
        videosUrl,
        {
          model: request.model,
          prompt: request.prompt,
          ...(typeof request.params.ratio === 'string' ? { size: request.params.ratio } : {}),
        },
        'video/mp4',
        signal,
      )
    },
    async completeText() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
  }
}
