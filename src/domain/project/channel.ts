import type { ModelCapability } from '../shared/capability'
import { createId } from '../../shared/id'

/**
 * 渠道领域模型（产品文档 §7 / §8）。
 * 纯数据 + 工厂，不依赖 platform / state / React，可在 node 下单测。
 */
export interface Channel {
  id: string
  name: string
  /** 协议决定走哪个适配器（platform/channels/registry 注册） */
  protocol: string
  baseUrl: string
  /**
   * 凭据引用：明文令牌由凭据层在调用前注入，业务表只存 ref（产品文档 §8）。
   * channels 表的明文令牌永不出现。
   */
  credentialRef: string | null
  /**
   * 已保存令牌的**尾 4 位**，只用于展示「现在存的是哪把钥匙」（§7.3 `sk-••••••••3f2a`）。
   *
   * 为什么在业务表里留这 4 位：要让 UI 显示尾号，只有两条路——把明文拉进界面自己截，
   * 或在保存时（明文唯一一次在手）算好尾号存下来。前者违反「明文只在调用前由凭据层注入」，
   * 后者把 4 位非可用信息留在业务表。取后者；**不提供把已存明文回显到输入框的路径**
   * （「显示」切换的只是本次输入框的可见性）。整串令牌依旧只存在于凭据层密文里。
   */
  tokenTail: string | null
  /** 仅已启用渠道出现在画布创作面板的平台选择中（产品文档 §7.1） */
  enabled: boolean
  /**
   * **用户勾选的模型**（产品文档 §7.4）：画布 / 漫画的模型下拉**只列这一份**。
   * 与 `modelCache` 的分工是这一层的核心：拉取回来的**全部**模型进 `modelCache`（选择面板的数据源），
   * 用户勾过的那几个进 `models`。此前二者合一，导致「拉回来 200 个模型，下拉就列 200 个」，
   * 用户没有任何筛选手段（这正是 §7.4 缺失的那个概念）。
   */
  models: ModelCapability[]
  /** 设置页拉取的**全部**模型缓存；只喂选择面板，不进任何下拉 */
  modelCache: ModelCapability[]
  /**
   * 左侧列表排序位（产品文档 §7.2 拖动排序）。
   * 拖一次写一遍（重排 = 给每行重新编号），读回按它升序、同值回落 `createdAt` 倒序。
   * 老数据没有这一位 → 读回补 `0`，退化为「按创建时间倒序」，与加排序前的行为一致。
   */
  order: number
  /** 上次「验证地址」的时间戳；从未验证过为 null（产品文档 §7.3 展示延迟） */
  lastTestAt: number | null
  /** 上次「验证地址」的往返延迟（ms）；从未验证过为 null */
  lastTestLatency: number | null
  createdAt: number
}

export interface CreateChannelInput {
  name: string
  protocol: string
  baseUrl: string
  /** 新建时的排序位；不给则 0（排在最后，见 list 的排序口径） */
  order?: number
}

/**
 * 设置页协议下拉项；新增协议需同时在 registry 注册对应适配器。
 * `short` 是左侧列表里名称右侧的短标签（产品文档 §7.2 的 OAI / ANT / GEM），
 * 与 `label` 同源维护——分两处写迟早会漂。
 */
export const SUPPORTED_PROTOCOLS: { value: string; label: string; short: string }[] = [
  { value: 'mock', label: 'Mock（离线验证）', short: 'MOCK' },
  { value: 'openai-images', label: 'OpenAI 兼容 · 生图', short: 'OAI' },
  {
    value: 'openai-chat',
    label: 'OpenAI 兼容 · 对话',
    short: 'CHAT',
  },
]

/**
 * 离线协议：不需要真实地址与网络就能 `verify` 成功。
 *
 * 单列出来是因为**候选表必须剔除「永不失败」的协议**——见 `PROBE_PROTOCOLS`。
 */
export const OFFLINE_PROTOCOLS: readonly string[] = ['mock']

/**
 * 「验证协议」的候选表（产品文档 §7.3）：按此顺序逐个试打，第一个 `verify` 通过的即为该地址的协议。
 *
 * 与 `SUPPORTED_PROTOCOLS` 的关系是**派生而非并列**：候选表由下拉表过滤得到，
 * 所以新增一个真实协议时它会自动进入探测序列，不需要在这里再抄一遍（抄一遍迟早会漂）。
 *
 * 为什么剔除 `OFFLINE_PROTOCOLS`：`mock` 的 `verify` 恒成功，一旦入选候选表，
 * 探测在**任何**地址上都会第一个命中 mock，把用户填的真实地址悄悄改写成 mock——
 * 用户看到的「自动选中」其实是探测失效。这是「候选表只放会失败的协议」的具体形态。
 *
 * 已知局限（M6-16）：`openai-images` 与 `openai-chat` 的 `verify` 都打 `GET /v1/models`，
 * 因此**同一个地址两个协议都会通过**，探测只能按本表顺序取第一个（生图）。
 * 一个中转站同时支持生图与对话时，自动探测会选中生图——需要对话协议的用户
 * 得自己在下拉里改。要修就得让 verify 去打各自独有的端点，代价是探测请求翻倍，
 * 本轮不划算；先如实记下，别让人以为「自动探测能区分协议」。
 */
export const PROBE_PROTOCOLS = SUPPORTED_PROTOCOLS.filter(
  (p) => !OFFLINE_PROTOCOLS.includes(p.value),
)

export function createChannel(input: CreateChannelInput): Channel {
  return {
    id: createId('ch'),
    name: input.name.trim() || '新建渠道',
    protocol: input.protocol,
    baseUrl: input.baseUrl.trim(),
    credentialRef: null,
    tokenTail: null,
    enabled: false,
    // 新建渠道一份模型都没有：先拉取（进 modelCache）、再勾选（进 models）。
    // 刻意**不**把 modelCache 抄成 models —— §7.4「拉取到的模型默认全部未勾选，由用户自行勾选」。
    models: [],
    modelCache: [],
    order: input.order ?? 0,
    lastTestAt: null,
    lastTestLatency: null,
    createdAt: Date.now(),
  }
}

/** 协议短标签（列表项用）；未知协议回落原串，不吞信息 */
export function protocolShort(proto: string): string {
  return SUPPORTED_PROTOCOLS.find((p) => p.value === proto)?.short ?? proto
}

/**
 * 该协议是否**必须**有地址才能验证。
 *
 * 为什么值得单列一条：地址为空时请求会退化成**相对当前页**的路径（`/v1/models`），
 * 而 dev server / SPA 对任意路径都回 200 的 index.html —— 于是「验证通过」是纯假象。
 * 离线协议（mock）不发请求，所以不受此限。
 */
export function requiresBaseUrl(protocol: string): boolean {
  return !OFFLINE_PROTOCOLS.includes(protocol)
}

/**
 * 保存令牌时算尾号（§7.3 的 `••••••••3f2a`）。
 * 太短的令牌**不给尾号**：4 位在小半个密钥上就是可见的大头，宁可只显示「已保存」。
 */
export function tokenTailOf(token: string): string | null {
  const t = token.trim()
  return t.length >= 12 ? t.slice(-4) : null
}

/** 尾号 → 展示串；无尾号返回空串（调用方按「已保存 / 未保存」分叉，不显示半个遮罩） */
export function maskTokenTail(tail: string | null): string {
  return tail ? `••••••••${tail}` : ''
}
