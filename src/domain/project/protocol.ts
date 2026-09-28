/**
 * 渠道协议目录（用户 2026-09-28「一站一协议」）。
 *
 * ## 为什么要有这一层
 *
 * 改造前协议是三个**互斥的适配器开关**：`mock` / `openai-images` / `openai-chat`。
 * 一个中转站同时有对话模型和生图模型时，就只能建两条渠道——
 * 而两条渠道打的是**同一个 `/v1/models`**，自动探测（`channelStore.detectProtocol`）
 * 永远命中候选表里的第一个，能力落在哪一条全靠顺序猜（即 M6-16）。
 *
 * 「一站一协议」把协议从适配器开关升格为**一份声明**：这条协议属于哪个适配器族
 * （`family`）、这个站有哪些能力（`capabilities`）、版本段长什么样（`versionPath`）。
 * 渠道因此只建一条，模型按 `category` 分流到画布 / 提示词节点的下拉里。
 *
 * ## 三条硬边界（决定了下面哪些条目是 ready、哪些是 pending）
 *
 * 1. **没有官方依据的端点不写死**。宁可标 `pending`（界面上不可选），也不填一个
 *    猜出来的路径——「文档里写了 ≠ 实现里有」，写死一个错的端点只会让用户
 *    在「验证失败」里绕圈。
 * 2. **领域层没有的能力不假装支持**。`ModelCapability.category` 目前只有
 *    `image | chat | video`，没有音频与 3D。协议 `capabilities` 因此也只到这三项；
 *    音频 / 3D 站点先按 pending 记着，等领域层有能力定义再开。
 * 3. **纯 Web 应用跑不了本机 CLI**。CLI 类协议（即梦 / GPT / Gemini）必须接一个
 *    专用网关才有意义，没有网关时它们只能是 pending，不能给个空壳让用户以为配好了。
 *
 * 纯度：纯数据 + 纯函数，不依赖 platform / state / React（架构 §2.2）。
 */

/** 协议能力：与 `ModelCapability.category` 同字面，新增能力必须两处同步 */
export type ProtocolCapability = 'chat' | 'image' | 'video'

/** 能力 → 中文名（界面上的能力标签只有一个来源） */
export const CAPABILITY_LABEL: Record<ProtocolCapability, string> = {
  chat: '对话',
  image: '生图',
  video: '视频',
}

/** 能力展示与存储的稳定顺序，避免勾选顺序影响协议定义 */
export const CAPABILITY_ORDER: ProtocolCapability[] = ['chat', 'image', 'video']

/**
 * 适配器族：决定「这条协议由哪个适配器实现」。
 *
 * - `mock`：离线，不发网络请求。
 * - `openai-compatible`：OpenAI 形态的同步 HTTP（`/models`、`/chat/completions`、
 *   `/images/generations`），绝大多数中转站与官方平台都是这一族，只是版本段不同。
 * - `async-task`：提交任务 + 轮询取结果（APIMART / RunningHub 这一类的形态）。
 * - `cli-gateway`：本机 CLI 或专用网关包装。
 *
 * 后两族目前**只有 pending 条目**：适配器未实现，注册表里故意不注册。
 */
export type ProtocolFamily = 'mock' | 'openai-compatible' | 'async-task' | 'cli-gateway'

/**
 * 协议来源分类，只影响界面分组，不影响行为：
 * - `offline`：离线 / 测试
 * - `legacy`：改造前就存在的三条，**必须保留 id 以免老渠道失效**
 * - `public`：公开可查的标准 / 平台协议
 * - `station`：某个具体中转站（用户 2026-09-28 点名的这几家）
 * - `custom`：用户自建（定义不在这张内置表里，见 customProtocols 表）
 */
export type ProtocolKind = 'offline' | 'legacy' | 'public' | 'station' | 'custom'

/**
 * `ready` = 注册表里有适配器、可以真的发请求；
 * `pending` = 只登记了「有这么回事」，界面上显示为不可选，避免假功能。
 */
export type ProtocolStatus = 'ready' | 'pending'

export interface ProtocolDefinition {
  id: string
  /** 下拉 / 状态行里的全名 */
  name: string
  /** 左栏列表项右侧的短标签（产品文档 §7.2） */
  short: string
  family: ProtocolFamily
  kind: ProtocolKind
  status: ProtocolStatus
  capabilities: ProtocolCapability[]
  /**
   * 站点默认基址。站点类协议靠它「选中即填地址」——用户不必再去翻文档抄一遍。
   * 留空表示「这份协议没有专属地址」（如开放的 `openai-compatible` 模板）。
   */
  defaultBaseUrl?: string
  /**
   * OpenAI 兼容族的版本段。官方是 `/v1`；火山引擎 Ark 是 `/api/v3`。
   *
   * 单列出来正是为了修老 `normalizeBaseUrl` 的洞：它无条件剥掉结尾的 `/vN`，
   * 于是 `https://ark.cn-beijing.volces.com/api/v3` 被剥成 `.../api` 再补 `/v1`，
   * 永远 404。现在版本段由协议声明，地址只要**不以它结尾**就补一次。
   */
  versionPath?: string
  /** 官方文档地址：给「为什么这样配」留一个可核对的出处 */
  docUrl?: string
  /** 待实现 / 局限说明，原样展示给用户（不写就表示这条协议没有已知限制） */
  note?: string
  /**
   * 是否进入「验证协议」的探测序列（产品文档 §7.3）。
   *
   * 只有**通用模板**才该被探测：站点类协议是用户手选的便利入口，把它们放进
   * 候选表会让探测连打十几个请求，而且同一个 200 会被十几条协议同时命中。
   */
  probe?: boolean
}

/**
 * 内置协议目录。顺序 = 下拉里的分组顺序。
 *
 * `openai-images` / `openai-chat` 两个 id **刻意原样保留**：老渠道存的就是它们，
 * 改 id 等于让所有已配置渠道在升级后变成「未知协议」。新站点一律用
 * `openai-compatible` 或站点条目。
 */
export const BUILTIN_PROTOCOLS: ProtocolDefinition[] = [
  {
    id: 'mock',
    name: 'Mock（离线验证）',
    short: 'MOCK',
    family: 'mock',
    kind: 'offline',
    status: 'ready',
    capabilities: ['chat', 'image', 'video'],
    note: '离线协议：不发任何网络请求，验证必然通过，用于在没有真实渠道时把链路跑通。',
  },
  {
    id: 'openai-compatible',
    name: 'OpenAI 兼容（对话 + 生图）',
    short: 'OAI+',
    family: 'openai-compatible',
    kind: 'public',
    status: 'ready',
    capabilities: ['chat', 'image'],
    versionPath: '/v1',
    docUrl: 'https://platform.openai.com/docs/api-reference',
    note: '一个站一条渠道：对话模型进提示词节点，生图模型进生成节点，靠模型类别分流。',
    probe: true,
  },
  {
    id: 'openai-images',
    name: 'OpenAI 兼容 · 生图（旧）',
    short: 'OAI',
    family: 'openai-compatible',
    kind: 'legacy',
    status: 'ready',
    capabilities: ['image'],
    versionPath: '/v1',
    note: '改造前的生图协议，保留给已配置的渠道。新渠道请用「OpenAI 兼容（对话 + 生图）」。',
  },
  {
    id: 'openai-chat',
    name: 'OpenAI 兼容 · 对话（旧）',
    short: 'CHAT',
    family: 'openai-compatible',
    kind: 'legacy',
    status: 'ready',
    capabilities: ['chat'],
    versionPath: '/v1',
    note: '改造前的对话协议，保留给已配置的渠道。新渠道请用「OpenAI 兼容（对话 + 生图）」。',
  },
  {
    id: 'modelscope',
    name: 'ModelScope 魔搭',
    short: 'MS',
    family: 'openai-compatible',
    kind: 'public',
    status: 'ready',
    capabilities: ['chat', 'image'],
    defaultBaseUrl: 'https://api-inference.modelscope.cn',
    versionPath: '/v1',
    docUrl: 'https://www.modelscope.cn/docs/model-service/API-Inference/intro',
    note: '匿名可访问 /v1/models；实际调用需要 ModelScope 访问令牌。',
  },
  {
    id: 'volcengine-ark',
    name: '火山引擎 Ark',
    short: 'ARK',
    family: 'openai-compatible',
    kind: 'public',
    status: 'ready',
    capabilities: ['chat', 'image'],
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
    // 注意：Ark 的版本段是 /api/v3，不是 /v1（老 normalizeBaseUrl 正是在这里出错的）
    versionPath: '/api/v3',
    docUrl: 'https://www.volcengine.com/docs/82379/1298454',
    note: '地址是 https://ark.cn-beijing.volces.com/api/v3，模型名要填方舟的接入点 ID 或模型 ID。',
  },
  {
    id: 'yuli',
    name: '玉玉',
    short: 'YULI',
    family: 'openai-compatible',
    kind: 'station',
    status: 'ready',
    capabilities: ['chat', 'image'],
    defaultBaseUrl: 'https://yuli.host',
    versionPath: '/v1',
    note: '中转站，OpenAI 兼容形态（/v1/models 需鉴权）。',
  },
  {
    id: 'apistudio',
    name: '灵境',
    short: 'APIS',
    family: 'openai-compatible',
    kind: 'station',
    status: 'ready',
    capabilities: ['chat', 'image'],
    defaultBaseUrl: 'https://apistudio.vip',
    versionPath: '/v1',
    note: '中转站，OpenAI 兼容形态（/v1/models 需鉴权）。',
  },
  {
    id: 'luminaiai',
    name: 'LuminaiAI',
    short: 'LUMI',
    family: 'openai-compatible',
    kind: 'station',
    status: 'ready',
    capabilities: ['chat', 'image'],
    defaultBaseUrl: 'https://luminaiai.top',
    versionPath: '/v1',
    note: '中转站，OpenAI 兼容形态（/v1/models 需鉴权）。',
  },
  {
    id: 'comfly',
    name: 'Comfly',
    short: 'COMFY',
    family: 'openai-compatible',
    kind: 'station',
    status: 'ready',
    capabilities: ['chat', 'image'],
    defaultBaseUrl: 'https://ai.comfly.org',
    versionPath: '/v1',
    docUrl: 'https://ai.comfly.org/cn',
    note: '中转站，OpenAI 兼容形态（/v1/models 需鉴权）。',
  },
  {
    id: 'agnes',
    name: 'Agnes',
    short: 'AGNES',
    family: 'openai-compatible',
    kind: 'station',
    status: 'ready',
    capabilities: ['chat', 'image'],
    defaultBaseUrl: 'https://apihub.agnes-ai.com',
    versionPath: '/v1',
    docUrl: 'https://agnes-ai.com/zh-Hans/docs/overview',
    note: 'API 基址为 apihub.agnes-ai.com/v1（/v1/models 需鉴权）。',
  },
  {
    id: 'apimart',
    name: 'APIMART（异步任务）',
    short: 'APIM',
    family: 'async-task',
    kind: 'station',
    status: 'pending',
    capabilities: [],
    note: '异步提交 + 轮询协议，尚未核到官方文档，暂不可选。',
  },
  {
    id: 'runninghub',
    name: 'RunningHub（异步任务）',
    short: 'RH',
    family: 'async-task',
    kind: 'station',
    status: 'pending',
    capabilities: [],
    docUrl: 'https://www.runninghub.cn/',
    note: '自有异步协议（openapi/v2，自有鉴权头），适配器尚未实现，暂不可选。',
  },
  {
    id: 'jimeng-cli',
    name: '即梦 CLI',
    short: 'JM',
    family: 'cli-gateway',
    kind: 'station',
    status: 'pending',
    capabilities: [],
    note: '本机 CLI 形态：浏览器里跑不了本机命令，需要先有专用网关。',
  },
  {
    id: 'gpt-cli',
    name: 'GPT CLI',
    short: 'GPT',
    family: 'cli-gateway',
    kind: 'station',
    status: 'pending',
    capabilities: [],
    note: '本机 CLI 形态：浏览器里跑不了本机命令，需要先有专用网关。',
  },
  {
    id: 'gemini-cli',
    name: 'Gemini CLI',
    short: 'GEM',
    family: 'cli-gateway',
    kind: 'station',
    status: 'pending',
    capabilities: [],
    note: '本机 CLI 形态：浏览器里跑不了本机命令，需要先有专用网关。',
  },
]

/**
 * 协议目录：内置项 + 用户自建项的合并视图。
 *
 * 为什么要有这一层而不是到处 `BUILTIN_PROTOCOLS.find(...)`：用户自建协议住在
 * IndexedDB 里（`customProtocols` 表），它必须和内置项**长成同一个形状**，
 * 否则「未知协议」这条分支会在界面上、注册表里、探测逻辑里各写一遍。
 * 统一成目录后，所有查询都只认 `ProtocolDefinition`，自建与内置再无分别。
 */
export interface ProtocolCatalog {
  /** 全部协议（内置在前，自建按存储顺序在后）；含 pending，界面分组要用 */
  readonly all: ProtocolDefinition[]
  /** 已能用（`status === 'ready'`）：下拉里可选的那些 */
  readonly ready: ProtocolDefinition[]
  /** 进入「验证协议」探测提示的通用模板（见 ProtocolDefinition.probe） */
  readonly probe: ProtocolDefinition[]
}

/** 合并内置与自建，产出目录。自建 id 与内置冲突时以**内置**为准（校验环节已拦，这里是兜底） */
export function buildProtocolCatalog(custom: ProtocolDefinition[] = []): ProtocolCatalog {
  const seen = new Set(BUILTIN_PROTOCOLS.map((p) => p.id))
  const extras = custom.filter((p) => !seen.has(p.id))
  const all = [...BUILTIN_PROTOCOLS, ...extras]
  return {
    all,
    ready: all.filter((p) => p.status === 'ready'),
    probe: all.filter((p) => p.probe),
  }
}

/** 只有内置的目录，供不需要自定义协议的纯函数 / 单测使用 */
export const BUILTIN_CATALOG: ProtocolCatalog = buildProtocolCatalog()

/** id → 定义；未登记的返回 undefined，调用方按「未知协议」处理 */
export function protocolById(
  id: string,
  catalog: ProtocolCatalog = BUILTIN_CATALOG,
): ProtocolDefinition | undefined {
  return catalog.all.find((p) => p.id === id)
}

/** 该协议的能力集合；未知协议给空集（不猜） */
export function protocolCapabilities(
  id: string,
  catalog: ProtocolCatalog = BUILTIN_CATALOG,
): ProtocolCapability[] {
  return protocolById(id, catalog)?.capabilities ?? []
}

/** 该协议是否声明了某项能力 */
export function protocolSupports(
  id: string,
  capability: ProtocolCapability,
  catalog: ProtocolCatalog = BUILTIN_CATALOG,
): boolean {
  return protocolCapabilities(id, catalog).includes(capability)
}

/** 协议是否已经能用（注册表里有适配器）。未知协议一律 false */
export function protocolIsReady(id: string, catalog: ProtocolCatalog = BUILTIN_CATALOG): boolean {
  return protocolById(id, catalog)?.status === 'ready'
}

/**
 * 该协议是否**必须**有地址才能验证。
 *
 * 为什么值得单列一条：地址为空时请求会退化成**相对当前页**的路径（`/v1/models`），
 * 而 dev server / SPA 对任意路径都回 200 的 index.html —— 于是「验证通过」是纯假象。
 * 离线协议（mock）不发请求，所以不受此限。
 */
export function protocolRequiresBaseUrl(
  id: string,
  catalog: ProtocolCatalog = BUILTIN_CATALOG,
): boolean {
  return protocolById(id, catalog)?.family !== 'mock'
}

/** 协议短标签（列表项用）；未知协议回落原串，不吞信息 */
export function protocolShort(id: string, catalog: ProtocolCatalog = BUILTIN_CATALOG): string {
  return protocolById(id, catalog)?.short ?? id
}

/** 协议全名（下拉 / 状态行用）；未知协议回落原串 */
export function protocolLabel(id: string, catalog: ProtocolCatalog = BUILTIN_CATALOG): string {
  return protocolById(id, catalog)?.name ?? id
}

/**
 * 按地址反查站点协议：`https://yuli.host/v1` → `yuli`。
 *
 * 探测只认「OpenAI 兼容」这个族（事实层面它能回答的也就这么多），但用户是带着
 * 站点心智来的——填了玉玉的地址却看到协议变成「OpenAI 兼容」，会以为选错了。
 * 这里按 host 把站点身份找回来，让探测结果与用户的认知一致。
 *
 * 只比 host：路径、版本段、结尾斜杠都不影响身份（同一站的 `/v1` 与 `/api/v3` 都是它）。
 */
export function stationProtocolForUrl(
  baseUrl: string,
  catalog: ProtocolCatalog = BUILTIN_CATALOG,
): ProtocolDefinition | undefined {
  const host = hostOf(baseUrl)
  if (!host) return undefined
  return catalog.all.find(
    (p) => p.status === 'ready' && p.defaultBaseUrl && hostOf(p.defaultBaseUrl) === host,
  )
}

/**
 * 「验证协议」探测要试的通用模板所支持的版本段（产品文档 §7.3）。
 *
 * 改造前是「逐条协议打一遍、第一个通过即命中」——`openai-images` 与 `openai-chat`
 * 都打 `/v1/models`，同一个中继必然被两条同时命中，协议落在哪条全看候选表顺序，
 * 于是有了 M6-16。现在只留**一条**通用模板（`openai-compatible`），探测问的
 * 就只剩「这个地址是不是 OpenAI 兼容 HTTP」，不再冒充「能力归属」。
 */
export const PROBE_VERSION_PATHS: readonly string[] = ['/v1', '/api/v3']

/**
 * 用户自建协议的输入（声明式；不允许注入代码或私有字段）。
 *
 * 只开放 `openai-compatible` 一族的声明：端点结构由适配器写死，用户能改的
 * 只有「叫什么 / 有哪些能力 / 版本段长什么样 / 默认地址」。私有形态（CLI 包装、
 * 异步提交轮询、站点私有字段）必须内置，用户只能选用——这是「能自建」与
 * 「别让用户拼出一个跑不通的协议」之间的界。
 */
export interface CustomProtocolInput {
  id: string
  name: string
  short: string
  capabilities: ProtocolCapability[]
  baseUrl?: string
  versionPath?: string
  docUrl?: string
}

export type CustomProtocolValidation =
  | { ok: true; value: ProtocolDefinition }
  | { ok: false; field: 'id' | 'name' | 'short' | 'capabilities' | 'versionPath' | 'baseUrl'; reason: string }

/** 自建协议 id 的合法形态：小写字母数字开头，可含 `-` / `_`，2–31 位 */
const CUSTOM_ID_RE = /^[a-z0-9][a-z0-9_-]{1,31}$/
/** 版本段：以 `/` 开头，随后是 URL 路径安全字符（不做「必须是 /vN」的限制，Ark 就是 /api/v3） */
const VERSION_PATH_RE = /^\/[A-Za-z0-9._~/-]*$/

/**
 * 校验用户自建协议并归一成 `ProtocolDefinition`。
 *
 * 校验写在这里而不是界面里：界面、导入、单测是三条入口，规则只该有一份。
 * `existing` 传入当前目录的全部 id，避免自建 id 与内置 / 已有自建撞名——
 * 撞名的后果是老渠道被悄悄改指到另一份定义，属于「看起来通了」的静默错误。
 */
export function validateCustomProtocol(
  input: CustomProtocolInput,
  existing: readonly ProtocolDefinition[] = BUILTIN_PROTOCOLS,
): CustomProtocolValidation {
  const id = input.id.trim().toLowerCase()
  if (!CUSTOM_ID_RE.test(id)) {
    return { ok: false, field: 'id', reason: '协议标识只能用小写字母、数字、- 和 _，且以字母或数字开头（2–32 位）' }
  }
  if (existing.some((p) => p.id === id)) {
    return { ok: false, field: 'id', reason: `协议标识「${id}」已被占用` }
  }
  const name = input.name.trim()
  if (!name) return { ok: false, field: 'name', reason: '协议名称不能为空' }
  const short = input.short.trim()
  if (!short) return { ok: false, field: 'short', reason: '短标签不能为空' }
  if (short.length > 8) return { ok: false, field: 'short', reason: '短标签最多 8 个字符' }
  // 只开放 OpenAI 兼容族真正有适配器的两项：对话与生图。
  // 视频 / 音频 / 3D 没有对应适配器，允许勾选等于让用户配一条跑不通的渠道。
  const capabilities = CAPABILITY_ORDER.filter(
    (c) => c !== 'video' && input.capabilities.includes(c),
  )
  if (capabilities.length === 0) {
    return { ok: false, field: 'capabilities', reason: '至少选择一种能力（对话 / 生图）' }
  }
  const versionPath = input.versionPath?.trim()
  if (versionPath && !VERSION_PATH_RE.test(versionPath)) {
    return { ok: false, field: 'versionPath', reason: '版本段必须以 / 开头，且只能包含 URL 路径字符' }
  }
  const baseUrl = input.baseUrl?.trim()
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
    return { ok: false, field: 'baseUrl', reason: '地址需以 http:// 或 https:// 开头' }
  }
  return {
    ok: true,
    value: {
      id,
      name,
      short,
      family: 'openai-compatible',
      kind: 'custom',
      status: 'ready',
      capabilities,
      ...(baseUrl ? { defaultBaseUrl: baseUrl } : {}),
      ...(versionPath ? { versionPath } : {}),
      ...(input.docUrl?.trim() ? { docUrl: input.docUrl.trim() } : {}),
    },
  }
}

/** 取 URL 的 host（小写、去 www）；不是合法绝对地址时返回空串 */
function hostOf(url: string): string {
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i.exec(url.trim())
  if (!m) return ''
  return m[1]!.toLowerCase().replace(/^www\./, '')
}

/**
 * 把用户填的地址归一成「协议基址 + 版本段」。
 *
 * 中继对「地址含不含版本段」没有统一约定：有的给 `https://api.openai.com`，
 * 有的直接给 `https://xxx/v1`。老实现无条件拼 `/v1/...`，于是「地址已含 /v1」
 * 时会变成 `/v1/v1/models`（一律 404）；后来改成无条件剥掉结尾的 `/vN`，
 * 又把火山 Ark 的 `/api/v3` 剥坏。
 *
 * 正确口径只能由协议给出：**已经以本协议的版本段结尾就原样用，否则先剥掉
 * 结尾的版本段再补一次**。这样 `/v1`、`/api/v3`、裸 host 三种写法都对。
 */
export function resolveProtocolBaseUrl(rawBaseUrl: string, versionPath: string): string {
  const trimmed = rawBaseUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return ''
  const path = versionPath.replace(/\/+$/, '')
  if (!path) return trimmed
  if (trimmed.toLowerCase().endsWith(path.toLowerCase())) return trimmed
  return trimmed.replace(/\/v\d+$/i, '') + path
}
