import type { ModelCapability } from '../shared/capability'
import { createId } from '../../shared/id'
import type { ModelMap } from './modelMapping'
import type { RouteStrategy } from './modelRouting'
import {
  BUILTIN_CATALOG,
  protocolById,
  protocolLabel as catalogLabel,
  protocolShort as catalogShort,
  protocolRequiresBaseUrl,
  type ProtocolCatalog,
} from './protocol'

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
   * 模型映射：`逻辑名 → 该站上游 ID`（§7.4.1，M7）。
   *
   * 节点与界面一律只认**逻辑名**，发请求前按此表翻译成该站真实 ID；
   * 空对象 = 恒等映射（逻辑名即上游 ID），老渠道零迁移。
   * 缺失映射必须如实报错，绝不静默换模型（架构 §6.3 不变式）。
   */
  modelMap: ModelMap
  /**
   * 选路优先度（M7）：数值**越大越优先**。
   *
   * 与 new-api 的 `priority DESC` 同向 —— 选路时按它分档，
   * 失败降级是「降到下一档」，所以这个值天然就是一条降级链。
   * 缺省 0：所有渠道同档，退化为按权重随机分摊。
   */
  priority: number
  /**
   * 选路权重（M7）：同档内按 `weight + 10` 加权随机。
   *
   * `+10` 是 new-api 的做法，理由很实在：权重 0 的渠道也必须有机会被选中，
   * 否则「均衡分摊」会退化成只有配过权重的渠道能出图。
   */
  weight: number
  /**
   * 旧版**渠道级**选路策略（M7-2，§7.4.1），仅为老数据兼容保留。
   *
   * 用户 2026-09-29 第 12 轮把策略改成了**全局设置**（见 `channelStore` 的
   * `routeStrategy`）：选路是跨渠道比较，必须只有一把尺子，每条渠道各带一份
   * 策略会出现「用谁的策略」这种说不清的问题。此字段不再在界面出现、也不参与
   * 选路，只在读回旧数据时保留，避免整表重写时丢掉用户此前的设置。
   *
   * 缺省 `priority`（手工排的优先度）—— 它的行为与加此功能前最接近。
   */
  routeStrategy: RouteStrategy
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
 * 设置页协议下拉项（兼容层）。
 *
 * 协议的唯一事实来源已迁到 `domain/project/protocol.ts` 的协议目录（用户 2026-09-28
 * 「一站一协议」）。这里保留 `{ value, label, short }` 这个老形状，是为了让设置页、
 * 老测试与外部引用**零改动**读到与目录一致的数据——而不是再维护第二份协议表。
 */
export const SUPPORTED_PROTOCOLS: { value: string; label: string; short: string }[] =
  BUILTIN_CATALOG.all.map((p) => ({ value: p.id, label: p.name, short: p.short }))

/**
 * 离线协议：不需要真实地址与网络就能 `verify` 成功。
 */
export const OFFLINE_PROTOCOLS: readonly string[] = ['mock']

/**
 * 「验证协议」的候选表（兼容层）：只含进入探测序列的**通用模板**（`probe: true`）。
 *
 * 与改造前不同，候选表不再等于「全部非离线协议」——站点协议是手选的便利入口，
 * 放进来会让探测连打十几个请求、同一个 200 被十几条同时命中。探测要回答的只是
 * 「这个地址是不是 OpenAI 兼容 HTTP」，命中的站点身份另由 `stationProtocolForUrl` 反查。
 */
export const PROBE_PROTOCOLS: { value: string; label: string; short: string }[] =
  BUILTIN_CATALOG.probe.map((p) => ({ value: p.id, label: p.name, short: p.short }))

/**
 * 渠道**实际**能做什么（§7.1）。
 *
 * 判据用**勾选的模型类别**，不是协议声明的能力：协议说「支持视频」不代表这条
 * 渠道真的能出视频 —— 只有勾了视频模型才算数。用户 2026-10-01 要看的就是
 * 「这条渠道能用什么」，答案应当来自它自己配了什么。
 *
 * 一条模型都没勾时回落协议声明：此时渠道还没配完，显示协议承诺的能力比显示
 * 「什么都不能」更有指导意义（用户会照它去勾模型）。
 */
export function channelCapabilities(
  channel: Pick<Channel, 'models'>,
  declared: readonly ModelCapability['category'][] = [],
): Record<ModelCapability['category'], boolean> {
  const fromModels = new Set(channel.models.map((m) => m.category))
  const set = fromModels.size > 0 ? fromModels : new Set<ModelCapability['category']>(declared)
  return { chat: set.has('chat'), image: set.has('image'), video: set.has('video') }
}

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
    // 映射与选路从「缺省」起步：空映射 = 恒等、优先度 0 = 同档、权重 0 = 均摊。
    // `routeStrategy` 只为老数据兼容保留（全局策略见 channelStore），一并给缺省值，
    // 行为与加此功能前**完全一致**（零迁移）。
    modelMap: {},
    priority: 0,
    weight: 0,
    routeStrategy: 'priority',
    order: input.order ?? 0,
    lastTestAt: null,
    lastTestLatency: null,
    createdAt: Date.now(),
  }
}

/** 协议短标签（列表项用）；未知协议回落原串，不吞信息 */
export function protocolShort(proto: string, catalog: ProtocolCatalog = BUILTIN_CATALOG): string {
  return catalogShort(proto, catalog)
}

/** 协议全名（状态行用）；未知协议回落原串 */
export function protocolLabel(proto: string, catalog: ProtocolCatalog = BUILTIN_CATALOG): string {
  return catalogLabel(proto, catalog)
}

/**
 * 该协议是否**必须**有地址才能验证。
 */
export function requiresBaseUrl(protocol: string, catalog: ProtocolCatalog = BUILTIN_CATALOG): boolean {
  return protocolRequiresBaseUrl(protocol, catalog)
}

/** 协议定义（含自建项）；未登记返回 undefined */
export function channelProtocol(
  proto: string,
  catalog: ProtocolCatalog = BUILTIN_CATALOG,
): ReturnType<typeof protocolById> {
  return protocolById(proto, catalog)
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
