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
import {
  RUNNINGHUB_ENDPOINT_SPECS,
  RUNNINGHUB_MODELS,
  type RunningHubDrivenParam,
  type RunningHubModel,
  type RunningHubEndpointSpec,
} from './runninghubEndpoints'

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
 *
 * ## 模型 / 端点两层（2026-10-08 补）
 *
 * 下拉里的一行是**一个模型**（全能图片PRO / 可灵 v3.0 Pro…），请求却要打到**具体端点**上。
 * 同一个模型有文生 / 图生两个端点，选哪个只看这次带不带参考图 —— 与官方 CLI 的
 * `endpoint_for_choice(choice, has_input_image=…)` 同一口径。
 *
 * 端点的参数规格（必填、默认值、档位可选项、媒体键名与是否多值）**由官方目录生成**：
 * `node scripts/gen-runninghub-models.mjs <RH_CLI>/src/rh_cli/catalog/data/capabilities.json`
 * → `runninghubEndpoints.ts`。建请求体的规则照官方 `model/payload.py` 逐条对齐（见 `buildPayload`）。
 *
 * ## 真机实测（2026-10-08，本机 Key：金额 0 / 币 473）
 *
 * 五条请求打到真实接口，回的都是**服务端自己的话**：
 *  - 文生图 n-pro / 文生视频 v3.1-fast / 可灵（补了必填 `sound`+`duration`）→ `812 企业版余额不足`
 *    ⇒ 端点 id、鉴权、请求体形状都被接受，只差钱；
 *  - 图生图 n-pro/edit（`imageUrls` **数组**）、g-3（**单值**）、g-2（数组）→ 同样 `812`
 *    ⇒ 这次修掉的「单值 / 多值」两种形状**都对**（早先写死发数组，g-3 那条是错的）；
 *  - 图生视频 v3.1-fast → `1007 参数校验`（提示词只有 3 个字，服务端要求 ≥5）——
 *    图片与档位都过了，这条错误由 `describeRhError` 翻成人话。
 *
 * 没有一条是网络 / 鉴权 / 端点不存在 —— 这是当前余额下能拿到的最强验证；
 * **真正出图**要等「金额」充值（或走 `app:` 那条币路）。
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

export { RUNNINGHUB_ENDPOINT_SPECS, RUNNINGHUB_MODELS }

const specById = new Map(RUNNINGHUB_ENDPOINT_SPECS.map((s) => [s.id, s]))
const modelById = new Map(RUNNINGHUB_MODELS.map((m) => [m.id, m]))

/** 标准模型端点 id 的前缀（`app:` 那条走 AI 应用，见 `APP_PREFIX`） */
const ENDPOINT_PREFIX = 'endpoint:'

/**
 * 模型 id → 这次该打哪个端点。
 *
 * **有参考图 + 该模型有图生档 ⇒ 走图生档**，否则走文生档 —— 与官方 CLI 同一口径
 * （`menus.py` 的 `endpoint_for_choice(choice, has_input_image=…)`）。
 * 模型表里没有的 id 再按「裸端点 id」兜一层（排查 / 兼容老节点用），仍然找不到才报 missingModel。
 */
export function resolveRunningHubEndpoint(
  modelId: string,
  hasReferenceImage: boolean,
): RunningHubEndpointSpec | null {
  const model = modelById.get(modelId)
  if (model) {
    const id = hasReferenceImage && model.imageEndpoint ? model.imageEndpoint : model.textEndpoint
    return specById.get(id) ?? null
  }
  const raw = modelId.startsWith(ENDPOINT_PREFIX) ? modelId.slice(ENDPOINT_PREFIX.length) : modelId
  return specById.get(raw) ?? null
}

/**
 * 模型 → 轻画的模型能力表。
 *
 * 档位照**文生档**报（那是没有参考图时的默认路径）；图生档少某一档时，
 * 适配器**不会**把那个档位发出去（见 `buildPayload` 第 ③ 条）—— 发一个端点不认的值
 * 只会换来一句看不懂的服务端报错。
 *
 * `inputTypes` 里带 image 的两种情况：模型有图生档，或者它的端点**本身就必填参考图**
 * （「只吃参考图」的那两个模型）—— 后者如果报成 text-only，用户会在画布上选中它、
 * 连图都懒得连，然后收到一句“必须带参考图”。
 */
export function runningHubCapability(model: RunningHubModel): ModelCapability {
  const spec = specById.get(model.textEndpoint)
  const needsImage = model.imageEndpoint !== undefined || spec?.media?.required === true
  const durations = spec?.duration?.options
    ?.map((v) => Number(v))
    .filter((v) => Number.isFinite(v))
  return {
    id: model.id,
    category: model.kind,
    inputTypes: needsImage ? ['text', 'image'] : ['text'],
    ...(spec?.ratio?.options ? { aspectRatios: [...spec.ratio.options] } : {}),
    ...(spec?.resolution?.options ? { resolutions: [...spec.resolution.options] } : {}),
    ...(durations && durations.length > 0
      ? { durations: [Math.min(...durations), Math.max(...durations)] as [number, number] }
      : {}),
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
  /**
   * `1007` = **输入没过服务端的参数校验**（2026-10-08 实测两次：坏掉的 base64 图
   * →「Failed to upload Base64 image」、提示词只有 3 个字 →「field 'prompt' length 3
   * is less than the minimum length 5」）。这句原话是英文且看不出该改哪儿，
   * 所以前面补一句中文：**问题出在这次请求的参数上，不是网络也不是 Key**。
   *
   * 注意：这类约束（比如提示词最短 5 字）**官方目录里一个字都没写**，
   * 是服务端自己判的 —— 所以这里只做"翻译"，**不自己编一个字数门槛**。
   */
  if (code === '1007') {
    return `这次请求的参数没通过服务端校验：${message}`
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
   * 参考图 → 端点认的值。两条规则照搬官方 CLI 的 `media.py`：
   *  ① **视频档一律上传**（它是 `force_upload=True`：视频端点不吃 data URI）；
   *  ② 其余 < 5MB 内联成 data URI，超过才先上传换 `download_url`。
   *
   * 素材本体要经 `deps.assets.read(hash)` 读——渠道层只拿得到 hash（M6-12）。
   * 读不到的**静默跳过**（与 `openaiImages.readImageFiles` 同一口径）：参考图是增强项，
   * 少一张还能出图，为此让整次生成失败得不偿失。
   */
  const resolveImages = async (
    spec: RunningHubEndpointSpec,
    request: ImageRunRequest | VideoRunRequest,
    signal: AbortSignal,
  ): Promise<string[]> => {
    const values: string[] = []
    for (const ref of imageInputsOf(request.inputs)) {
      const payload = await deps.assets.read(ref.assetHash).catch(() => null)
      if (!payload || payload.bytes.length === 0) continue
      const bytes = new Uint8Array(payload.bytes)
      const mime = payload.mime || ref.mime
      if (spec.kind !== 'video' && bytes.byteLength < INLINE_LIMIT_BYTES) {
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

  /**
   * 建请求体：四条规则逐条对齐官方 CLI 的 `model/payload.py`。
   *
   *  ① 提示词写进端点的 prompt 键；
   *  ② 参考图写进端点的媒体键，**多值 / 单值由目录的 `multiple` 决定** —— 这里以前写死
   *     「`imageUrls` 且多值」，而 `rhart-image-g-3/image-to-image` 收的是**单值**；
   *  ③ 界面能驱动的档位（比例 / 清晰度 / 时长）**只在该端点真的声明了那一档、
   *     且取值在它的可选项里**时才发：发一个端点不认的值，换来的只有一句看不懂的服务端报错；
   *  ④ 最后：**必填 + 有默认值**而还没填的，一律补官方目录给的默认值 ——
   *     少了这一步，`rhart-image-n-pro-official/edit` 这种「resolution 必填」的端点必然被拒。
   */
  const buildPayload = (
    spec: RunningHubEndpointSpec,
    request: ImageRunRequest | VideoRunRequest,
    images: string[],
  ): Record<string, unknown> => {
    const payload: Record<string, unknown> = {}
    payload[spec.promptKey ?? 'prompt'] = request.prompt

    const media = spec.media
    if (media && media.type === 'IMAGE') {
      if (images.length === 0) {
        /** 必填的参考图缺了：当场说清「这个模型必须连一张图」，别让服务端回一句看不懂的 4xx */
        if (media.required) {
          throw new ChannelError({
            kind: 'validation',
            field: '参考图',
            reason: '这个模型必须带一张参考图（把图片 / 生成节点连到它左边）',
          })
        }
      } else {
        payload[media.key] = media.multiple ? images : images[0]
      }
    }

    const put = (declared: RunningHubDrivenParam | undefined, raw: unknown) => {
      if (!declared) return
      const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : ''
      if (value === '') return
      if (declared.options && !declared.options.includes(value)) return
      payload[declared.key] = value
    }
    put(spec.ratio, request.params?.ratio)
    put(spec.resolution, request.params?.resolution)
    put(spec.duration, request.params?.duration)

    for (const [k, v] of Object.entries(spec.requiredDefaults ?? {})) {
      if (!(k in payload)) payload[k] = v
    }
    return payload
  }

  /** 标准模型端点：建请求体 → 提交 → 轮询 → 下载（两条计费路里的**金额**那条） */
  const runSpec = async (
    spec: RunningHubEndpointSpec,
    request: ImageRunRequest | VideoRunRequest,
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const images = await resolveImages(spec, request, signal)
    const payload = buildPayload(spec, request, images)
    const submitted = await readJson(
      await json(`${host}${STD_PATH}/${spec.id}`, payload, signal, SUBMIT_TIMEOUT_MS),
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
    /**
     * AI 应用的**节点字段名**各家不同（都是应用作者起的），所以这边不设白名单：
     * 非空就写进去，认不认识由应用自己判定 —— 写死了反而会把某些应用能改的档位挡在外面。
     */
    const putField = (fieldName: string, raw: unknown) => {
      const value = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : ''
      if (value !== '') setField(fieldName, value)
    }
    putField('aspectRatio', request.params?.ratio)
    putField('resolution', request.params?.resolution)
    putField('duration', request.params?.duration)

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
    /**
     * **有参考图就走图生档**（模型表里成对），没有就走文生档 —— 这一步是
     * 「用户不用理解 t2i / i2i」的关键，与官方 CLI 同一口径
     * （`menus.py` 的 `endpoint_for_choice(choice, has_input_image=…)`）。
     */
    const hasImage = imageInputsOf(request.inputs).length > 0
    const spec = resolveRunningHubEndpoint(request.model, hasImage)
    if (!spec) {
      throw new ChannelError({ kind: 'channel', detail: 'missingModel' })
    }
    return runSpec(spec, request, signal)
  }

  /**
   * 模型清单 = **标准模型**（金额路，来自官方目录）+ **推荐 AI 应用**（币路）。
   *
   * 应用那一拉是 best-effort：拉不到就只给模型，不让整次验证失败 ——
   * 用户手里若是「金额 Key」，`aiapp/list` 本来就是空的，那不该被当成「渠道没配好」。
   */
  const listModels = async (signal: AbortSignal): Promise<ModelCapability[]> => {
    const models: ModelCapability[] = RUNNINGHUB_MODELS.map(runningHubCapability)
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
