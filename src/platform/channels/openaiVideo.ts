import { fingerprintBytes } from '../../domain/shared/hash'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import { videoParamsFor } from '../../domain/canvas/layout/videoParams'
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
 * ## 形态依据（2026-10-01 核官方文档，非照搬别人的实现）
 *
 * 官方文档（`wiki.agnes-ai.com` 的 Agnes Video 2.5 / 2.5 Flash 页）给的是**专属参数**，
 * 与「OpenAI 视频」不是一套：
 *
 * ```
 * { model, prompt, mode: 'ti2vid'|'keyframes'|'multi_reference', seconds, size, aspect_ratio }
 * { mode:'keyframes',       first_frame?, last_frame? }
 * { mode:'multi_reference', images?:[], audios?:[], videos?:[] }
 *
 * ⚠️ `mode` 是**服务端枚举**，不是我们的内部叫法（用户 2026-10-03 手跑时的 400 原文：
 * `Input should be 'ti2vid', 'keyframes' or 'multi_reference'`）。纯文字起片 = `ti2vid`。
 * ```
 *
 * - `seconds` 是 `"4"`–`"12"` 的**字符串**；`size` 是**档位**（`720P`/`1080P`/`1K`/`2K`）
 *   而不是像素；Flash 只支持 `720P`。这与 `width/height/num_frames/frame_rate`
 *   完全是两回事，所以本适配器**优先发官方专属参数**。
 * - 老式部署 / LiteLLM 中转只认 OpenAI 那套，故被 400 拒时**回落一次**再试
 *   （回落是显式兼容，不是静默降级：两条都失败时抛的是第二条的真实错误）。
 *
 * 提交响应（实测）：
 *
 * ```json
 * { "id":"task_…", "task_id":"task_…", "video_id":"video_…",
 *   "object":"video", "model":"agnes-video-2.5", "status":"queued",
 *   "progress":0, "seconds":"4", "size":"720P" }
 * ```
 *
 * 轮询**三种候选依次试**（不同部署认的键不同，实测踩过 `task_not_exist`）：
 * ① 官方推荐的 `GET {root}/agnesapi?video_id=…&model_name=…`；
 * ② `GET {base}/videos/{task_id}`（当前线上实际认它）；
 * ③ `GET {base}/videos/{video_id}`。谁先给出有效载荷用谁。
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
 * 时长 → 官方 `seconds`：`"4"`–`"12"` 的字符串。
 *
 * 面板给的是 3–15 秒，两边都夹一下：3 秒要补到 4（上游最短），15 秒要收到 12。
 */
export function agnesVideoSeconds(durationSec: unknown): number {
  return clampInt(durationSec, 4, 12, 5)
}

/**
 * 尺寸档 → 官方 `size`。
 *
 * 官方只认 `720P`/`1080P`/`1K`/`2K` 四个档位，**不是像素**；面板的 `480p`
 * 上游没有对应档，按 `720P` 发（宁可比要求的清楚，也不要发一个它不认的值）。
 * `auto` 同样落到 `720P`：Flash 只支持这一档，发别的会被 400 拒。
 */
export function agnesVideoSizeTier(size: unknown): string {
  return size === '1080p' ? '1080P' : '720P'
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

/**
 * 任务状态取值：`data.status` 优先，其次**Agnes 原生的 `internal_status`**，
 * 再其次顶层 `status`（几种部署都见过）。
 *
 * ⚠️ `internal_status` 这一支是 2026-10-03 补的：Agnes 的 `/agnesapi?video_id=…`
 * 返回的是 `{"internal_status":"inference","internal_progress":30,…}` —— **没有
 * `status` 字段**。原来只读 `status` ⇒ 状态永远读成空串 ⇒ 轮询里那句
 * 「只有真带状态或产物地址的响应才算数」把它当成无效载荷、改去试别的候选路由，
 * 空转到脚本放弃 ⇒ 用户看到「跑了几十秒然后失败、0 个产物」。
 */
export function videoTaskStatus(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return ''
  const obj = raw as Record<string, unknown>
  const data = obj.data && typeof obj.data === 'object' ? (obj.data as Record<string, unknown>) : null
  const value = data?.status ?? obj.internal_status ?? obj.status
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

  /**
   * 参考图 / 首尾帧：官方**明文要求公网可访问的图片 URL**
   * （"All media URLs must be publicly reachable by the Agnes AI service"）。
   *
   * 轻画的素材住在浏览器 IndexedDB 里，没有能被上游抓取的地址；塞 `data:` URL
   * 上游同样取不到。故这里**如实拦住并说清原因**，而不是发出去换回一个
   * 「图片下载失败」这种指不到病根的错误。
   */
  const assertNoLocalReferenceImages = (request: VideoRunRequest): void => {
    if (imageInputsOf(request.inputs).length === 0) return
    throw new ChannelError({
      kind: 'http',
      status: 400,
      body:
        '该视频渠道的参考图 / 首尾帧需要公网可访问的图片地址，浏览器里的本地素材无法直传。' +
        '请改用纯文生视频，或先把图片上传到可公开访问的地址。',
    })
  }

  const poll = async (
    taskId: string,
    videoId: string | null,
    model: string,
    signal: AbortSignal,
  ): Promise<unknown> => {
    /**
     * 候选顺序照官方推荐排：`/agnesapi?video_id=` 在前，再回落两条 REST 路由。
     * 线上这一环实际认的是 `{base}/videos/{task_id}`，而它拿 `video_id` 查会回
     * `task_not_exist` —— 所以是「谁先给出有效载荷用谁」，不写死一条。
     */
    const candidates = [
      videoId
        ? `${root}/agnesapi?video_id=${encodeURIComponent(videoId)}&model_name=${encodeURIComponent(model)}`
        : null,
      `${submitUrl}/${encodeURIComponent(taskId)}`,
      videoId ? `${submitUrl}/${encodeURIComponent(videoId)}` : null,
    ].filter((u): u is string => !!u)
    const startedAt = now()
    /** 本轮是否吃到限流（429）：限流**不是任务失败**，退避后再来 */
    let backoffSteps = 0
    for (;;) {
      let payload: unknown = null
      let lastError: unknown = null
      let rateLimited = false
      for (const url of candidates) {
        try {
          const res = await deps.network.request(
            { url, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
            signal,
          )
          if (res.status < 200 || res.status >= 300) {
            /**
             * 「这条路走不通」有两种形态：这一环没有 `/agnesapi` 时是 **404**，
             * 有它但不认这个键时是 **400 `task_not_exist`**。两种都交给下一个候选；
             * 其余状态（401 / 429 / 5xx）是真失败，原样抛出——继续轮询只会把
             * 「令牌失效」拖成一个 10 分钟的超时。
             */
            const detail = await res.text().catch(() => '')
            if (res.status === 404 || (res.status === 400 && /task_not_exist/i.test(detail))) continue
            /**
             * ⚠️ **429 = 「查询过于频繁」，是限流，不是任务失败**。
             *
             * 用户 2026-10-03 实测（Agnes Video 2.0 手建节点）：任务明明已经
             * `status:"completed"` + `progress:100` + **url 有值**，但我们中间吃到一个
             * `429 {"code":429,"message":"查询过于频繁，请稍后重试"}` 就直接把整条运行
             * 判成失败 —— 画布上于是「什么都没有」，日志写「失败 · 输出 0 个」。
             *
             * 现在：限流只记一笔、退避后再轮询，绝不因此终止任务。
             */
            if (res.status === 429) {
              rateLimited = true
              backoffSteps = Math.min(backoffSteps + 1, 3)
              lastError = new ChannelError(classifyError(null, res.status, detail).error)
              continue
            }
            const { error } = classifyError(null, res.status, detail)
            throw new ChannelError(error)
          }
          const body = await res.json<unknown>().catch(() => null)
          /**
           * 200 不等于「这条路能查」：SPA / 网关对未知路径回 200 空体很常见。
           * 只有真带状态或产物地址的响应才算数，否则继续试下一个候选
           * ——否则会拿一个空对象当「任务还在排队」，一路空转到超时。
           */
          if (body && (videoTaskStatus(body) || collectVideoUrls(body).length > 0)) {
            payload = body
            break
          }
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
        /** 只有「非限流」的错误才终止；限流退避后继续（见上面 429 那段） */
        if (!rateLimited) throw lastError
      }
      if (now() - startedAt >= pollTimeout) {
        throw new ChannelError({ kind: 'network', detail: 'timeout' })
      }
      /** 吃到限流就翻倍等待（4s → 8s → 16s → 24s 封顶），把请求频率压下来 */
      await sleepFn(pollInterval * (rateLimited ? 2 ** backoffSteps : 1), signal)
      if (!rateLimited) backoffSteps = 0
    }
  }

  const submit = (body: Record<string, unknown>, signal: AbortSignal) =>
    deps.network.request(
      {
        url: submitUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
        body,
        timeoutMs: GENERATE_TIMEOUT_MS,
      },
      signal,
    )

  const generateVideo: ChannelAdapter['generateVideo'] = async (request, signal) => {
    assertNoLocalReferenceImages(request)
    /**
     * **发出去之前按模型能力收口**（用户 2026-10-03：「每个视频模型应该有的参数单独做，
     * 因为有些模型他不支持」）。值域来自 `videoParamsFor`（Agnes 官方文档）。
     *
     * 为什么在适配器这一层也拦一道：面板那条路能保证只给支持的档，但 agent 建的节点、
     * 老项目里存下来的节点都可能带着老档位（3 秒、3:2、480p）—— 直接发就是 400，
     * 用户看到的是「选了就报错」。这里换成**模型支持的最接近值**，请求照样能出去。
     */
    const spec = videoParamsFor(request.model)
    const rawRatio = typeof request.params.ratio === 'string' ? request.params.ratio : ''
    const safeRatio = spec && !spec.ratios.includes(rawRatio) ? '16:9' : rawRatio
    const rawSeconds = request.params.durationSec
    const safeSeconds = spec
      ? Math.min(spec.seconds.max, Math.max(spec.seconds.min, Number(rawSeconds) || spec.seconds.default))
      : rawSeconds
    /** 只支持单一尺寸档的模型（如 2.5 Flash 只有 720P）就按它强制 */
    const safeSize = spec && spec.sizes.length === 1 ? spec.sizes[0] : request.params.size
    const { width, height } = agnesVideoDimensions(safeRatio, safeSize)
    const numFrames = agnesVideoFrameCount(safeSeconds)

    /**
     * 官方文档给 Agnes Video 2.5 / 2.5 Flash 的专属参数（`mode` 为必填）。
     *
     * ⚠️ **2.0 不吃这一套**（2026-10-03 用真令牌实测）：这些参数它**收下但不生效** ——
     * `size:"720P" + aspect_ratio:"16:9"` 排队后回填的是默认 `1088x832`；
     * 换成像素形态（`width/height/num_frames/frame_rate`）才按我们给的来
     * （发 `1280x720`，回填 `1280x704`）。所以**先发哪一套由模型的 `dialect` 决定**
     * （见 `domain/canvas/layout/videoParams.ts`），另一套留作 400 时的回落。
     */
    const tierBody: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      /**
       * ⚠️ **`mode` 的值域是服务端定的枚举**：`'ti2vid' | 'keyframes' | 'multi_reference'`。
       *
       * 这里原本写的是我们自己的叫法 `'text'` —— 用户 2026-10-03 手跑 Agnes Video 2.0
       * 时收到 400 原文：
       *   `Input should be 'ti2vid', 'keyframes' or 'multi_reference'`（param: mode）
       * 参数名对上了、值没翻译，服务端只能拒。纯文字起片就是 `'ti2vid'`。
       */
      mode: 'ti2vid',
      seconds: String(agnesVideoSeconds(safeSeconds)),
      size: agnesVideoSizeTier(safeSize),
      ...(safeRatio ? { aspect_ratio: safeRatio } : {}),
    }
    /** 老式部署 / LiteLLM 中转只认「OpenAI 视频」那套（像素 + 帧数）；2.0 也认这套 */
    const pixelBody: Record<string, unknown> = {
      model: request.model,
      prompt: request.prompt,
      width,
      height,
      num_frames: numFrames,
      frame_rate: VIDEO_FPS,
    }

    const pixelFirst = spec?.dialect === 'pixel'
    let res = await submit(pixelFirst ? pixelBody : tierBody, signal)
    if (res.status === 400) {
      // 这一套被拒才换另一套；这不是静默降级——两条都失败时抛的是第二条的真实错误
      res = await submit(pixelFirst ? tierBody : pixelBody, signal)
    }
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
    /**
     * 取产物失败的原因（第一条）：**一条都没取到时必须抛出来**。
     *
     * 用户 2026-10-03 报的现象：日志显示「生成成功」，但画布上什么都不回落，
     * 日志里点「发送到画布」也没反应。查库：那条 runRecord `status=succeeded`
     * 而 `outputHashes: []` —— **任务成功、产物为空**，因为下面这个循环把
     * 「下载失败」静默 `continue` 掉了，`return []` 又被上层当成成功。
     *
     * 「成功但没有东西」是最难查的一种：界面上看不出错，用户只会说「没反应」。
     */
    let firstFailure = ''
    for (const url of urls) {
      try {
        const dl = await deps.network.request({ url, method: 'GET', headers: {} }, signal)
        if (dl.status < 200 || dl.status >= 300) {
          firstFailure ||= `产物地址返回 ${dl.status}`
          continue
        }
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
      } catch (e) {
        /**
         * 单个产物取不到就跳过：其余产物仍然可用。
         * 但**原因要留下来** —— 全部失败时它就是唯一能说明问题的东西。
         */
        firstFailure ||= e instanceof Error ? e.message : String(e)
      }
    }
    if (assets.length === 0) {
      /**
       * ★ **字节下不来时退回「远程 URL 资产」**（用户 2026-10-03 实测）。
       *
       * Agnes 把成片放在 `cos-platform-outputs.agnes-ai.cn`，浏览器 fetch 它会被 CORS
       * 拦成 `net::ERR_FAILED` —— 但 `<video src>` 播放**不受 CORS 限制**。所以这里
       * 不再整条判失败，而是把地址作为产物交出去（`bytes` 空、`url` 有值），
       * 界面照常能播；真要读像素时才会受限，那时再报明确原因。
       */
      if (urls.length > 0) {
        const out: GeneratedAsset[] = []
        for (const url of urls) {
          const hash = await fingerprintBytes(new TextEncoder().encode(url))
          out.push({ hash, mime: 'video/mp4', bytes: new Uint8Array(0), url, requestedWidth: width, requestedHeight: height })
        }
        return out
      }
      throw new ChannelError({
        kind: 'parse',
        raw: `视频任务成功，但产物一个都没取到${firstFailure ? `：${firstFailure}` : ''}（地址 ${urls.length} 个）`,
      })
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
