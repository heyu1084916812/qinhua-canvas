import { fingerprintBytes } from '../../domain/shared/hash'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import type { SafeChannelConfig } from '../ports'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type GeneratedAsset,
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

/**
 * OpenAI 兼容族的**视频**分支。
 *
 * ## 为什么此前整条视频维度不可达
 *
 * `GenerationData.mode` 有 `'video'`、面板有视频参数、`runEngine` 也按
 * `request.kind === 'video'` 分派到 `adapter.generateVideo`——但
 * `createOpenAiCompatibleAdapter` 的 `generateVideo` 一律抛 `unsupported`，
 * 且内置协议目录里没有一条声明 `video` 能力。于是「视频」这个类别在真机上
 * **没有任何一条通路**，只能靠 mock 渠道自证。
 *
 * ## 形态依据（2026-10-01 实测，非推测）
 *
 * 提交 `POST {base}/videos`（`{base}` 已含协议声明的版本段），JSON：
 *
 * ```
 * { model, prompt, width, height, num_frames, frame_rate, image?, extra_body?, seed? }
 * ```
 *
 * 提交响应（实测）：
 *
 * ```json
 * { "id":"task_…", "task_id":"task_…", "video_id":"video_…",
 *   "object":"video", "model":"agnes-video-v2.0", "status":"queued",
 *   "progress":0, "seconds":"1.0", "size":"704x512" }
 * ```
 *
 * **轮询必须用 `task_id`**：拿 `video_id` 去查会稳定返回
 * `{"code":"task_not_exist"}`（实测踩到过）。查 `GET {base}/videos/{task_id}`
 * 直到 `status: "completed"`，此时**顶层 `url`** 就是产物地址。
 *
 * 另一套部署（大雄那边）用的是 `GET {root}/agnesapi?video_id=…&model_name=…`
 * 且以 `video_id` 为键，故这里把它作为**第二候选**保留 —— 两种形态都试，
 * 谁先返回有效载荷用谁。`root` = 去掉版本段的基址（`/agnesapi` 不在 `/v1` 下）。
 *
 * ## 参考图：走 data URL，不在浏览器里转存第三方图床
 *
 * 大雄那边是「先传到 litterbox / temp.sh，再把公网地址发上游」。轻画是纯浏览器
 * 应用，把用户的素材上传到无关的第三方图床不是本项目愿意替用户做的决定，
 * 故参考图以 `data:` URL 直接随请求发出。**这条路径是本文档里最未被实证的一段**
 * （无法在不消耗额度的前提下验证上游是否接受 data URL），上游若不接受，
 * 错误会如实抛到界面上，不会静默丢图。
 */

export interface OpenAiVideoConfig extends SafeChannelConfig {
  apiKey: string | null
}

/** 轮询节奏：视频任务动辄数分钟，起步就比图慢一档，省得空转 */
export const VIDEO_POLL_INTERVAL_MS = 4_000
/** 任务总超时：视频生成给足 10 分钟；再久上游自己也会过期 */
export const VIDEO_POLL_TIMEOUT_MS = 600_000

/** 帧率：与大雄实现一致（24fps 是该站的默认档） */
const VIDEO_FPS = 24
/** 单次提交的帧数上限（服务端硬限制 441 = 18s × 24fps + 1） */
const MAX_FRAMES = 441

/**
 * 比例 + 尺寸档 → 请求像素。
 *
 * 与大雄实现同一张表：该站按**像素**收，不接受 `16:9` 这种比例字面量。
 * 未知比例回落 3:2（1152×768，与大雄一致），不静默用 1:1——
 * 用户选了 16:9 却拿到方图，比报错更难发现。
 */
export function agnesVideoDimensions(
  ratio: unknown,
  size: unknown,
): { width: number; height: number } {
  const table: Record<string, [number, number]> = {
    '16:9': [1152, 648],
    '9:16': [648, 1152],
    '4:3': [1024, 768],
    '3:4': [768, 1024],
    '1:1': [768, 768],
    '21:9': [1280, 544],
    '9:21': [544, 1280],
  }
  const [baseW, baseH] = table[typeof ratio === 'string' ? ratio.trim() : ''] ?? [1152, 768]
  const scale =
    { '480p': 0.625, '720p': 1, '780p': 1, '1080p': 1.5 }[
      typeof size === 'string' ? size.trim().toLowerCase() : ''
    ] ?? 1
  // 两边都要是 8 的倍数，且不小于 64（服务端约束）
  const snap = (v: number) => Math.max(64, Math.round((v * scale) / 8) * 8)
  return { width: snap(baseW), height: snap(baseH) }
}

/**
 * 时长（秒）→ `num_frames`。
 *
 * 服务端要求 `num_frames ≡ 1 (mod 8)`，故先算目标帧数再吸附到最近的合法值。
 * 时长按 1–18 秒夹取（与大雄同口径）：面板能选到 15s，18 是上游上限。
 */
export function agnesVideoFrameCount(durationSec: unknown, fps = VIDEO_FPS): number {
  const seconds = clampInt(durationSec, 1, 18, 5)
  const frameRate = clampInt(fps, 1, 60, VIDEO_FPS)
  const target = Math.min(MAX_FRAMES, Math.max(9, seconds * frameRate))
  const steps = Math.max(1, Math.round((target - 1) / 8))
  return Math.min(MAX_FRAMES, Math.max(9, 8 * steps + 1))
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/**
 * 从任务响应里取产物地址。
 *
 * 该站的响应形态在不同部署/版本间不统一（`data.video_url`、`videos[]`、
 * `content.url`、裸 `url` 都见过），故按已知键名逐层扫描而不是写死一条路径；
 * 只收 `http(s)` 开头的字符串，避免把状态字段当成地址。
 */
export function collectVideoUrls(raw: unknown): string[] {
  const found: string[] = []
  const push = (v: unknown) => {
    if (typeof v === 'string' && /^https?:\/\//i.test(v.trim())) found.push(v.trim())
  }
  const visit = (node: unknown, depth: number) => {
    if (depth > 5 || node == null) return
    // 数组元素是字符串时要能落地：早先只在「键值直接是字符串」那一支 push，
    // 于是 `videos: ["https://…"]` 这种最常见的形态一个都取不到
    if (typeof node === 'string') {
      push(node)
      return
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1)
      return
    }
    if (typeof node !== 'object') return
    const obj = node as Record<string, unknown>
    for (const key of ['video_url', 'videoUrl', 'url', 'output', 'videos', 'video']) {
      const v = obj[key]
      if (typeof v === 'string') push(v)
      else if (v && typeof v === 'object') visit(v, depth + 1)
    }
    for (const key of ['data', 'detail', 'content', 'result', 'results']) {
      if (key in obj) visit(obj[key], depth + 1)
    }
  }
  visit(raw, 0)
  return [...new Set(found)]
}

const SUCCESS_STATUS = new Set([
  'SUCCESS',
  'SUCCEED',
  'SUCCEEDED',
  'COMPLETED',
  'COMPLETE',
  'DONE',
  'FINISHED',
  'FINISH',
  'OK',
  'READY',
])
const FAILURE_STATUS = new Set([
  'FAILURE',
  'FAILED',
  'FAIL',
  'ERROR',
  'ERRORED',
  'CANCELED',
  'CANCELLED',
  'TIMEOUT',
  'TIMEDOUT',
  'REJECTED',
  'EXPIRED',
])

/** 任务状态取值：`data.status` 优先，其次顶层 `status`（两种部署都见过） */
export function videoTaskStatus(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const obj = raw as Record<string, unknown>
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null
  const value = data?.status ?? obj.status
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

/** 失败原因：尽量把服务端原话带出来，只报「失败」等于没说 */
function failureReasonOf(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const obj = raw as Record<string, unknown>
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null
  const asMessage = (v: unknown): string =>
    typeof v === 'string'
      ? v.trim()
      : v && typeof v === 'object' && typeof (v as Record<string, unknown>).message === 'string'
        ? String((v as Record<string, unknown>).message).trim()
        : ''
  // `error` 既可能是字符串（直给原因），也可能是 `{ message }` 对象——两种都要认
  for (const v of [data?.message, data?.error, obj.error, obj.message]) {
    const text = asMessage(v)
    if (text) return text
  }
  return ''
}

export interface OpenAiVideoOptions {
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

export function createOpenAiVideoAdapter(
  config: OpenAiVideoConfig,
  deps: ChannelDeps,
  options: OpenAiVideoOptions = {},
): ChannelAdapter {
  const base = openAiBaseUrl(config)
  /** `/agnesapi` 挂在站点根上，不在版本段下——由基址剥出站点根 */
  const root = base.replace(/\/v\d+$/i, '')
  const modelsUrl = `${base}/models`
  const submitUrl = `${base}/videos`

  const pollInterval = options.pollIntervalMs ?? VIDEO_POLL_INTERVAL_MS
  const pollTimeout = options.pollTimeoutMs ?? VIDEO_POLL_TIMEOUT_MS
  const sleepFn = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())

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

  const listModels: ChannelAdapter['listModels'] = async (_cfg, signal) => {
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

  /** 素材字节 → `data:` URL。读不到就跳过（参考图是增强项，不该拖垮整次生成） */
  const referenceImages = async (request: VideoRunRequest): Promise<string[]> => {
    const wanted = imageInputsOf(request.inputs)
    if (wanted.length === 0) return []
    const out: string[] = []
    for (const item of wanted) {
      const payload = await deps.assets.read(item.assetHash)
      if (!payload) continue
      out.push(`data:${payload.mime};base64,${bytesToBase64(payload.bytes)}`)
    }
    return out
  }

  const poll = async (
    taskId: string,
    videoId: string | null,
    model: string,
    signal: AbortSignal,
  ): Promise<unknown> => {
    /**
     * 顺序有讲究：先用**实测可用**的 `task_id` 路由，再回落到另一套部署的
     * `/agnesapi?video_id=`。反过来会让本站在每次轮询里白撞一次 400。
     */
    const taskUrl = `${submitUrl}/${encodeURIComponent(taskId)}`
    const legacyUrl = videoId
      ? `${root}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(model)}`
      : null
    const startedAt = now()
    for (;;) {
      let payload: unknown = null
      let lastError: unknown = null
      for (const url of legacyUrl ? [taskUrl, legacyUrl] : [taskUrl]) {
        try {
          const res = await deps.network.request(
            { url, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
            signal,
          )
          if (res.status < 200 || res.status >= 300) {
            /**
             * 400 `task_not_exist` 是「这条路走不通」，交给下一个候选；
             * 其余状态（401 / 429 / 5xx）是真失败，原样抛出——继续轮询只会
             * 把「令牌失效」拖成一个 10 分钟的超时。
             */
            const detail = await res.text().catch(() => '')
            if (res.status === 400 && /task_not_exist/i.test(detail)) continue
            const { error } = classifyError(null, res.status, detail)
            throw new ChannelError(error)
          }
          payload = await res.json<unknown>().catch(() => null)
          if (payload) break
        } catch (e) {
          if (e instanceof ChannelError) throw e
          lastError = e
        }
      }
      if (payload) {
        const urls = collectVideoUrls(payload)
        const status = videoTaskStatus(payload)
        if (SUCCESS_STATUS.has(status) || urls.length > 0) return payload
        if (FAILURE_STATUS.has(status)) {
          // 带上服务端原话：`channel` 的 detail 是封闭枚举，故走 http + body
          throw new ChannelError({
            kind: 'http',
            status: 502,
            body: failureReasonOf(payload) || '视频任务失败',
          })
        }
      } else if (lastError) {
        throw lastError
      }
      if (now() - startedAt >= pollTimeout) {
        throw new ChannelError({ kind: 'network', detail: 'timeout' })
      }
      await sleepFn(pollInterval, signal)
    }
  }

  const generateVideo: ChannelAdapter['generateVideo'] = async (request, signal) => {
    const { width, height } = agnesVideoDimensions(request.params.ratio, request.params.size)
    const numFrames = agnesVideoFrameCount(request.params.durationSec)
    const images = await referenceImages(request)

    const body: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      width,
      height,
      num_frames: numFrames,
      frame_rate: VIDEO_FPS,
    }
    if (images.length === 1) body.image = images[0]
    else if (images.length > 1) {
      body.extra_body = { image: images }
      // 首尾帧语义由面板的 refMode 决定；多参考图默认按关键帧送
      if (request.params.refMode !== 'all-purpose') {
        ;(body.extra_body as Record<string, unknown>).mode = 'keyframes'
      }
    }

    const res = await deps.network.request(
      {
        url: submitUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
        body,
        timeoutMs: GENERATE_TIMEOUT_MS,
      },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const submitted = await res.json<Record<string, unknown>>().catch(() => null)
    const direct = collectVideoUrls(submitted)
    const final = direct.length > 0 ? submitted : await (async () => {
      // 轮询键是 task_id（次选 id）；video_id 只给另一套部署的 /agnesapi 用
      const taskId = submitted?.task_id ?? submitted?.id
      if (typeof taskId !== 'string' || !taskId) {
        throw new ChannelError({ kind: 'parse', raw: '提交响应里没有 task_id' })
      }
      const videoId = typeof submitted?.video_id === 'string' ? submitted.video_id : null
      return poll(taskId, videoId, request.model, signal)
    })()

    const urls = collectVideoUrls(final)
    if (urls.length === 0) {
      throw new ChannelError({ kind: 'parse', raw: '视频任务已完成，但结果里没有产物地址' })
    }
    const assets: GeneratedAsset[] = []
    for (const url of urls) {
      try {
        const dl = await deps.network.request({ url, method: 'GET', headers: {} }, signal)
        if (dl.status < 200 || dl.status >= 300) continue
        const bytes = new Uint8Array(await dl.arrayBuffer())
        const hash = await fingerprintBytes(bytes)
        const actual = imageSizeFromHeader(bytes)
        assets.push({
          hash,
          mime: 'video/mp4',
          bytes,
          ...(actual ? { width: actual.width, height: actual.height } : {}),
          requestedWidth: width,
          requestedHeight: height,
        })
      } catch {
        /* 单个产物取不到就跳过：其余产物仍然可用 */
      }
    }
    return assets
  }

  return {
    protocol: config.protocol,
    verify,
    listModels,
    async generateImage() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
    generateVideo,
    async completeText() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
  }
}

/** 分块转 base64：`String.fromCharCode(...bytes)` 在几 MB 的图上会爆栈 */
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
