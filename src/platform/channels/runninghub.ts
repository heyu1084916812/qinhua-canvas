import { fingerprintBytes } from '../../domain/shared/hash'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import type { ModelCapability } from '../../domain/shared/capability'
import { asAppError, describeError } from '../../shared/result'
import { bytesToBase64 } from './base64'
import type { NetworkResponse, SafeChannelConfig } from '../ports'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type GeneratedAsset,
  type ImageRunRequest,
  type VideoRunRequest,
  type VerifyResult,
} from './types'

/**
 * RunningHub 适配器（用户第 22 批第 3 条：「RunningHub有两个令牌…他的协议也给我做一下」）。
 *
 * ## 接口依据（不是猜的）
 *
 * 全部照 **RunningHub 官方 CLI**（GitHub `HM-RunningHub/RH_CLI`，2026-10-07 的 main）
 * 的源码逐条核对，脚注即源码文件名：
 *
 * | 用途 | 请求 | 来源 |
 * | --- | --- | --- |
 * | 查余额 / 验 Key | `POST {host}/uc/openapi/accountStatus` body `{apikey}` | `http.py` / `account.py` |
 * | 标准模型提交 | `POST {host}/openapi/v2/{endpoint}` + `Authorization: Bearer {key}` | `model/client.py` |
 * | 轮询 | `POST {host}/openapi/v2/query` body `{taskId}` | `poll.py` |
 * | 标准模型上传（>5MB 才用） | `POST {host}/openapi/v2/media/upload/binary` | `media.py` |
 * | AI 应用列表 | `POST {host}/openapi/v2/aiapp/list` | `app/client.py` |
 * | AI 应用节点 | `GET {host}/api/webapp/apiCallDemo?apiKey=&webappId=` | `app/client.py` |
 * | AI 应用提交 | `POST {host}/task/openapi/ai-app/run` | `app/client.py` |
 * | AI 应用上传 | `POST {host}/task/openapi/upload`（multipart + `apiKey`/`fileType=input`） | `media.py` |
 *
 * ## 两条计费路，两把钥匙（与用户口径一一对应）
 *
 * - **标准模型 / 金额**：端点是 `{host}/openapi/v2/{endpoint}`（78 图片 + 198 视频…），
 *   扣**金额**。实测这把"币 Key"打它会返回 `errorCode 812 企业版余额不足` —— 正好印证
 *   "币"和"金额"是两套账。
 * - **AI 应用 / 币**：`aiapp/list` + `ai-app/run`，扣**币**（实测同一把 Key 列表 82 872 个应用 ✓）。
 *
 * 所以模型 id 带前缀把两条路分开（`endpoint:` / `app:`），生成时按前缀分派 —— 不需要
 * 用户去理解"这次扣哪本账"，也不会把请求发到它走不通的那条路上。
 */

const DEFAULT_HOST = 'https://www.runninghub.cn'
const ACCOUNT_PATH = '/uc/openapi/accountStatus'
const STD_PATH = '/openapi/v2'
const QUERY_PATH = `${STD_PATH}/query`
const APP_LIST_PATH = `${STD_PATH}/aiapp/list`
const APP_NODE_PATH = '/api/webapp/apiCallDemo'
const APP_RUN_PATH = '/task/openapi/ai-app/run'
const APP_UPLOAD_PATH = '/task/openapi/upload'
/** 官方 CLI：本地图 < 5MB 直接内联成 data URI，超过才上传（`media.py`） */
const INLINE_LIMIT_BYTES = 5 * 1024 * 1024
const POLL_INTERVAL_MS = 5000
const POLL_MAX_MS = 20 * 60 * 1000
const VERIFY_TIMEOUT_MS = 20000
const SUBMIT_TIMEOUT_MS = 60000

export interface RunningHubEndpoint {
  /** 端点 id（原样发给 RunningHub） */
  id: string
  /** 模型下拉里显示的名字 */
  label: string
  kind: 'image' | 'video'
  /** 提示词参数的键名 */
  promptKey: string
  /** 参考图参数的键名（没有= 这个端点不吃图） */
  imageKey?: string
  imageMultiple?: boolean
  /** 比例 / 分辨率参数的键名（有就给，没有就留服务端默认） */
  ratioKey?: string
  resolutionKey?: string
  /** 该端点**必填**但界面上没有对应档位的参数（原样带上，避免"必填缺失"被拒） */
  required?: Record<string, unknown>
}

/**
 * 标准模型端点精选表（**金额**路，用户第 22 批 #358）。
 *
 * 来源：官方 CLI 仓库里的 `catalog/data/capabilities.json`（2026-10-08 取，共 356 个端点），
 * 这里只留**我核过参数**的几条常用项（热度 99 的低价渠道版 + 官方稳定版）。
 * 为什么不用运行时拉目录：那是一份 625KB 的静态表，为"选几条模型"每次去 GitHub 取不划算；
 * 需要更多端点时往这张表里加一行即可（`endpoint:` 前缀的模型 id 自动生效）。
 */
export const RUNNINGHUB_ENDPOINTS: readonly RunningHubEndpoint[] = [
  {
    id: 'rhart-image-g-2/text-to-image',
    label: '全能图片 G-2.0 文生图（低价）',
    kind: 'image',
    promptKey: 'prompt',
    ratioKey: 'aspectRatio',
    resolutionKey: 'resolution',
  },
  {
    id: 'alibaba/qwen-image-2.0/text-to-image',
    label: '千问 2.0 文生图',
    kind: 'image',
    promptKey: 'prompt',
  },
  {
    id: 'bytedance/jimeng-4.6/text-to-image',
    label: '即梦图片 4.6 文生图',
    kind: 'image',
    promptKey: 'prompt',
  },
  {
    id: 'rhart-image-g-3/image-to-image',
    label: '全能图片 X-3 图生图',
    kind: 'image',
    promptKey: 'prompt',
    imageKey: 'imageUrls',
    imageMultiple: true,
  },
  {
    id: 'rhart-image-n-pro-official/edit',
    label: '全能图片 PRO 图生图（官方稳定版）',
    kind: 'image',
    promptKey: 'prompt',
    imageKey: 'imageUrls',
    imageMultiple: true,
    ratioKey: 'aspectRatio',
    resolutionKey: 'resolution',
  },
]

/** 把 RunningHub 的比例档换成它的字面量（它自己就认 `1:1` 这种，故只做校验） */
function ratioLiteral(value: unknown, allowed: readonly string[]): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.replace(/\s+/g, '')
  return allowed.includes(normalized) ? normalized : null
}

const IMAGE_RATIOS = ['3:2', '1:1', '2:3', '5:4', '4:5', '16:9', '9:16', '21:9', '3:4', '4:3']
const IMAGE_RESOLUTIONS = ['1k', '2k', '4k']

/** 端点 → 轻画的模型能力（比例 / 分辨率档位照抄目录里的 `options`） */
function endpointCapability(e: RunningHubEndpoint): ModelCapability {
  return {
    id: `endpoint:${e.id}`,
    category: e.kind,
    inputTypes: e.imageKey ? ['text', 'image'] : ['text'],
    ...(e.kind === 'image' && e.ratioKey ? { aspectRatios: IMAGE_RATIOS } : {}),
    ...(e.kind === 'image' && e.resolutionKey ? { resolutions: IMAGE_RESOLUTIONS } : {}),
    maxCount: 1,
  }
}

/** AI 应用（**币**路）的模型 id 前缀 */
const APP_PREFIX = 'app:'

interface RhResponse {
  code?: number
  msg?: string
  message?: string
  status?: string
  taskId?: string
  errorCode?: string
  errorMessage?: string
  data?: {
    taskId?: string
    files?: unknown[]
    nodeInfoList?: RhNode[]
    records?: { invokeExample?: string; title?: string; description?: string }[]
    download_url?: string
    fileName?: string
    [k: string]: unknown
  }
  results?: { url?: string; outputUrl?: string; outputType?: string; text?: string }[] | null
  usage?: { consumeMoney?: string | number; thirdPartyConsumeMoney?: string | number } | null
}

interface RhNode {
  nodeId: number | string
  fieldName: string
  fieldType?: string
  fieldValue?: unknown
}

/**
 * 上游失败 → 报错。
 *
 * `channel` 的 detail 是**封闭枚举**（只有 missingKey / missingModel / unsupported），
 * 装不下 RunningHub 自己给的文案；`http` + body 是仓库既定的做法（见 `asyncTask.ts`
 * 的任务失败分支）：展示侧会拼成「服务端返回错误（HTTP xxx）：<它自己的话>」，
 * 用户据此就能分清"余额不够"和"Key 不对"。
 */
function upstreamError(status: number | null, message: string): ChannelError {
  const code = status !== null && status >= 400 ? status : 502
  return new ChannelError({ kind: 'http', status: code, body: message })
}

/** 429 / 5xx 之外的服务端错误码 → 给用户看得懂的话（含充值 / 取 Key 的去处） */
function describeRhError(res: RhResponse, fallback: string): string {
  const message = res.errorMessage || res.msg || res.message || fallback
  const code = String(res.errorCode ?? res.code ?? '')
  if (code === '812' || /余额|balance|insufficient/i.test(message)) {
    return `${message}（标准模型 API 扣的是「金额」，去 runninghub.cn 充值；用「RH 币」请改选 app: 开头的应用模型）`
  }
  if (/auth|token|key|401|403/i.test(`${code} ${message}`)) {
    return `${message}（检查这一行的 Key；金额 Key 与币 Key 是两把，别混用）`
  }
  return message
}

export interface RunningHubOptions {
  /** 供单测注入：不传则按 5s 真实间隔轮询 */
  pollIntervalMs?: number
  pollTimeoutMs?: number
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  now?: () => number
}

/** 轮询等待；取消时立刻退出，不把 20 分钟干等完 */
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

export function createRunningHubAdapter(
  config: SafeChannelConfig & { apiKey: string | null },
  deps: ChannelDeps,
  options: RunningHubOptions = {},
): ChannelAdapter {
  const host = (config.baseUrl || DEFAULT_HOST).replace(/\/+$/, '')
  const key = config.apiKey ?? ''
  const pollInterval = options.pollIntervalMs ?? POLL_INTERVAL_MS
  const pollTimeout = options.pollTimeoutMs ?? POLL_MAX_MS
  const sleepFn = options.sleep ?? defaultSleep
  const now = options.now ?? (() => Date.now())

  const json = (url: string, body: unknown, signal: AbortSignal, timeout: number) =>
    deps.network.request(
      {
        url,
        method: 'POST',
        headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body,
        timeoutMs: timeout,
      },
      signal,
    )

  const readJson = async (res: NetworkResponse): Promise<RhResponse> => {
    const text = await res.text()
    try {
      return JSON.parse(text) as RhResponse
    } catch {
      throw new ChannelError({ kind: 'parse', raw: `RunningHub 返回了非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}` })
    }
  }

  /** 提交 + 轮询到出结果（两条路共用：`query` 是同一个） */
  const waitForTask = async (taskId: string, signal: AbortSignal): Promise<RhResponse> => {
    const started = now()
    for (;;) {
      if (signal.aborted) throw new ChannelError({ kind: 'network', detail: 'aborted' })
      const res = await readJson(await json(`${host}${QUERY_PATH}`, { taskId }, signal, VERIFY_TIMEOUT_MS))
      if (res.status === 'SUCCESS') return res
      if (res.status === 'FAILED') {
        throw upstreamError(null, describeRhError(res, '任务失败'))
      }
      if (now() - started + pollInterval >= pollTimeout) {
        throw new ChannelError({ kind: 'network', detail: 'timeout' })
      }
      await sleepFn(pollInterval, signal)
    }
  }

  /** 结果 URL → 字节（桌面壳里 fetch 不受 CORS 限制；浏览器里若被拦，报可读的错） */
  const download = async (url: string, signal: AbortSignal): Promise<{ bytes: Uint8Array; mime: string }> => {
    let res: NetworkResponse
    try {
      res = await deps.network.request({ url, method: 'GET', timeoutMs: 120000 }, signal)
    } catch (err) {
      throw new ChannelError({
        kind: 'parse',
        raw: `产物下载失败（浏览器里可能是 CORS 限制，桌面版不受影响）：${String(err).slice(0, 120)}`,
      })
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { bytes, mime: res.headers['content-type'] ?? 'image/png' }
  }

  const assetsFrom = async (res: RhResponse, signal: AbortSignal): Promise<GeneratedAsset[]> => {
    const items = res.results ?? []
    const urls = items
      .map((i) => i.url ?? i.outputUrl)
      .filter((u): u is string => typeof u === 'string' && u.length > 0)
    if (urls.length === 0) {
      const text = items.map((i) => i.text).filter(Boolean).join('\n')
      throw new ChannelError({
        kind: 'parse',
        raw: text ? `任务没有产物文件，只回了文本：${text.slice(0, 200)}` : '任务成功但没有返回产物',
      })
    }
    const out: GeneratedAsset[] = []
    for (const url of urls) {
      const { bytes, mime } = await download(url, signal)
      out.push({ hash: await fingerprintBytes(bytes), mime, bytes, url })
    }
    return out
  }

  /**
   * 参考图 → 端点认的值（<5MB 内联 data URI；否则上传换 `download_url`）。
   *
   * 素材本体要经 `deps.assets.read(hash)` 读——渠道层只拿得到 hash（M6-12）。
   * 读不到的**静默跳过**（与 `openaiImages.readImageFiles` 同一口径）：参考图是增强项，
   * 少一张还能出图，为此让整次生成失败得不偿失。
   */
  const resolveImage = async (
    request: ImageRunRequest | VideoRunRequest,
    signal: AbortSignal,
  ): Promise<string[]> => {
    const refs = imageInputsOf(request.inputs)
    const values: string[] = []
    for (const ref of refs) {
      const payload = await deps.assets.read(ref.assetHash).catch(() => null)
      if (!payload || payload.bytes.length === 0) continue
      const bytes = new Uint8Array(payload.bytes)
      const mime = payload.mime || ref.mime
      if (bytes.byteLength < INLINE_LIMIT_BYTES) {
        values.push(`data:${mime};base64,${bytesToBase64(bytes)}`)
        continue
      }
      const form = new FormData()
      form.append('file', new Blob([bytes as BlobPart], { type: mime }), 'ref.png')
      const res = await readJson(
        await deps.network.request(
          {
            url: `${host}${STD_PATH}/media/upload/binary`,
            method: 'POST',
            headers: key ? { Authorization: `Bearer ${key}` } : {},
            body: form,
            timeoutMs: 120000,
          },
          signal,
        ),
      )
      if (res.code !== 0 || !res.data?.download_url) {
        throw upstreamError(null, describeRhError(res, '参考图上传失败'))
      }
      values.push(res.data.download_url)
    }
    return values
  }

  const runEndpoint = async (
    endpoint: RunningHubEndpoint,
    request: ImageRunRequest | VideoRunRequest,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const payload: Record<string, unknown> = { [endpoint.promptKey]: request.prompt }
    const ratio = ratioLiteral(request.params?.ratio, IMAGE_RATIOS)
    if (ratio && endpoint.ratioKey) payload[endpoint.ratioKey] = ratio
    if (endpoint.resolutionKey) {
      const res = typeof request.params?.resolution === 'string' ? request.params.resolution.toLowerCase() : ''
      if (IMAGE_RESOLUTIONS.includes(res)) payload[endpoint.resolutionKey] = res
    }
    if (endpoint.imageKey) {
      const images = await resolveImage(request, signal)
      if (images.length > 0) payload[endpoint.imageKey] = endpoint.imageMultiple ? images : images[0]
    }
    if (endpoint.required) Object.assign(payload, endpoint.required)

    const submitted = await readJson(
      await json(`${host}${STD_PATH}/${endpoint.id}`, payload, signal, SUBMIT_TIMEOUT_MS),
    )
    if (submitted.code !== 0) {
      throw upstreamError(null, describeRhError(submitted, '提交失败'))
    }
    const taskId = submitted.taskId || submitted.data?.taskId
    if (!taskId) {
      throw upstreamError(null, describeRhError(submitted, '提交成功但没有 taskId'))
    }
    return assetsFrom(await waitForTask(String(taskId), signal), signal)
  }

  /** AI 应用（**币**）：拉节点 → 填提示词 / 图 → 跑 → 轮询 */
  const runApp = async (
    webappId: string,
    request: ImageRunRequest | VideoRunRequest,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const info = await readJson(
      await deps.network.request(
        {
          url: `${host}${APP_NODE_PATH}?apiKey=${encodeURIComponent(key)}&webappId=${encodeURIComponent(webappId)}`,
          method: 'GET',
          timeoutMs: VERIFY_TIMEOUT_MS,
        },
        signal,
      ),
    )
    const nodes: RhNode[] = info.data?.nodeInfoList ?? []
    if (info.code !== 0 || nodes.length === 0) {
      throw upstreamError(null, describeRhError(info, '这个 AI 应用没有可修改节点（先在网页端成功跑一次）'))
    }
    /** 按**字段名**找节点，不写死 nodeId（不同应用的 id 不一样） */
    const nodes2 = nodes.map((n) => ({ ...n }))
    const setField = (fieldName: string, value: unknown, index = 0) => {
      const hits = nodes2.filter((n) => n.fieldType === fieldName || n.fieldName === fieldName)
      const target = hits[index] ?? hits[0]
      if (target) target.fieldValue = value
    }
    setField('prompt', request.prompt)
    const ratio = ratioLiteral(request.params?.ratio, IMAGE_RATIOS)
    if (ratio) setField('aspectRatio', ratio)
    const res = typeof request.params?.resolution === 'string' ? request.params.resolution.toLowerCase() : ''
    if (IMAGE_RESOLUTIONS.includes(res)) setField('resolution', res)

    /** 参考图：应用要吃**上传后的文件名**（与端点路的内联不同，见 `media.py`） */
    const refs = imageInputsOf(request.inputs)
    for (const [i, ref] of refs.entries()) {
      const payload = await deps.assets.read(ref.assetHash).catch(() => null)
      if (!payload || payload.bytes.length === 0) continue
      const bytes = new Uint8Array(payload.bytes)
      const form = new FormData()
      form.append('file', new Blob([bytes as BlobPart], { type: payload.mime || ref.mime }), 'ref.png')
      form.append('apiKey', key)
      form.append('fileType', 'input')
      const up = await readJson(
        await deps.network.request(
          { url: `${host}${APP_UPLOAD_PATH}`, method: 'POST', body: form, timeoutMs: 120000 },
          signal,
        ),
      )
      const fileName = up.data?.fileName
      if (up.code !== 0 || !fileName) {
        throw upstreamError(null, describeRhError(up, '参考图上传失败'))
      }
      const imageNodes = nodes2.filter((n) => n.fieldType === 'IMAGE')
      const target = imageNodes[i] ?? imageNodes[0]
      if (target) target.fieldValue = fileName
    }

    const submitted = await readJson(
      await json(
        `${host}${APP_RUN_PATH}`,
        { apiKey: key, webappId: Number(webappId), nodeInfoList: nodes2 },
        signal,
        SUBMIT_TIMEOUT_MS,
      ),
    )
    const taskId = submitted.code === 0 ? submitted.data?.taskId : null
    if (!taskId) {
      throw upstreamError(null, describeRhError(submitted, '提交 AI 应用失败'))
    }
    return assetsFrom(await waitForTask(String(taskId), signal), signal)
  }

  const generate = async (
    request: ImageRunRequest | VideoRunRequest,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    if (!key) {
      throw new ChannelError({ kind: 'channel', detail: 'missingKey' })
    }
    if (request.model.startsWith(APP_PREFIX)) {
      return runApp(request.model.slice(APP_PREFIX.length), request, signal)
    }
    const endpointId = request.model.startsWith('endpoint:')
      ? request.model.slice('endpoint:'.length)
      : request.model
    const endpoint = RUNNINGHUB_ENDPOINTS.find((e) => e.id === endpointId)
    if (!endpoint) {
      throw new ChannelError({ kind: 'channel', detail: 'missingModel' })
    }
    return runEndpoint(endpoint, request, signal)
  }

  /**
   * 模型清单 = **标准模型端点**（金额）+ **推荐 AI 应用**（币）。
   *
   * 应用那一拉是 best-effort：拉不到就只给端点，不让整次验证失败 ——
   * 用户手里若是"金额 Key"，`aiapp/list` 本来就是空的，那不该被当成"渠道没配好"。
   */
  const listModels = async (signal: AbortSignal): Promise<ModelCapability[]> => {
    const models: ModelCapability[] = RUNNINGHUB_ENDPOINTS.map(endpointCapability)
    try {
      const res = await readJson(
        await json(`${host}${APP_LIST_PATH}`, { current: 1, size: 30, sort: 'RECOMMEND' }, signal, VERIFY_TIMEOUT_MS),
      )
      for (const record of res.data?.records ?? []) {
        const idMatch = /\/run\/ai-app\/(\d+)/.exec(record.invokeExample ?? '')
        if (!idMatch) continue
        const title = record.title ?? `AI 应用 ${idMatch[1]}`
        /** 应用不分类型，按标题关键字猜一个：猜错只影响下拉分组，不影响能否出图 */
        const video = /视频|video/i.test(title)
        models.push({
          id: `${APP_PREFIX}${idMatch[1]}`,
          category: video ? 'video' : 'image',
          inputTypes: ['text', 'image'],
        })
      }
    } catch {
      /* 应用列表拿不到不影响端点那条路 */
    }
    return models
  }

  return {
    protocol: config.protocol,
    async verify(_cfg, signal): Promise<VerifyResult> {
      if (!key) {
        return { ok: false, error: { kind: 'channel', detail: 'missingKey' } }
      }
      try {
        const res = await readJson(await json(`${host}${ACCOUNT_PATH}`, { apikey: key }, signal, VERIFY_TIMEOUT_MS))
        if (res.code !== 0) {
          const message = describeRhError(res, 'Key 验证失败')
          return { ok: false, error: { kind: 'http', status: 401, body: message }, message }
        }
      } catch (e) {
        const appError = asAppError(e)
        if (!appError) throw e
        return { ok: false, error: appError, message: describeError(appError) }
      }
      return { ok: true, models: await listModels(signal) }
    },
    listModels: (_cfg, signal) => listModels(signal),
    generateImage: (request, signal) => generate(request, signal),
    generateVideo: (request, signal) => generate(request, signal),
    async completeText(): Promise<never> {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
  }
}
