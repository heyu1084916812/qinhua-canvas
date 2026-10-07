import { createChannel, type Channel, type CreateChannelInput } from './channel'
import { BUILTIN_CATALOG, protocolById, type ProtocolCatalog } from './protocol'

/**
 * **三条内置渠道**（用户第 20 批，口径已确认）。
 *
 * 「参考图三大雄画布的这个固定三个渠道 MODELSCOPE Agnes RuningHub」——
 * 它们是**渠道列表里常驻的三行**：一直在最上面、**不出现在"点击新建"里**、
 * **不能删除**；**名称与协议固定**，**站点地址留口子（可改）**；
 * 令牌 / 启用 / 模型选择照常由用户配（那是"你这台机器上怎么用它"）。
 *
 * ## 为什么 id 写死而不是 `createId`
 *
 * "它已经存在吗"要能**按 id 判**：每次启动都新建一遍的话，用户会攒出一串同名渠道；
 * 而按"名字相同就复用"又会被用户改过的名字骗过。写死的 id 是这两条之外的第三条路。
 * 前缀 `ch_builtin_` 同时就是**判据**（`isBuiltinChannelId`），界面与命令层共用它。
 *
 * ## 排序位取负数
 *
 * 用户的渠道从 0 往后排（`repo.create` 取 max+1）⇒ 负数天然永远在最前，
 * 不需要"每次加载都把三条搬到队首"那种会跟用户拖动打架的操作。
 */
export const BUILTIN_CHANNEL_IDS = [
  'ch_builtin_modelscope',
  'ch_builtin_agnes',
  'ch_builtin_runninghub',
] as const

/** 内置渠道的排序位基准（实际用 `BASE + 序号`，越小越靠前） */
export const BUILTIN_ORDER_BASE = -1000

export interface BuiltinChannelSpec {
  id: string
  /** 固定名称（用户改不了） */
  name: string
  /** 固定协议（用户改不了） */
  protocol: string
}

export const BUILTIN_CHANNELS: readonly BuiltinChannelSpec[] = [
  { id: 'ch_builtin_modelscope', name: 'ModelScope 魔搭', protocol: 'modelscope' },
  { id: 'ch_builtin_agnes', name: 'Agnes', protocol: 'agnes' },
  /** RunningHub 用 **API** 那条（用户：「runninghub它也有api」）；CLI 那条仍留给本机用法 */
  { id: 'ch_builtin_runninghub', name: 'RunningHub', protocol: 'runninghub-api' },
]

/** 这条渠道是不是内置的（界面据此禁用删除 / 锁定名称与协议） */
export function isBuiltinChannelId(id: string): boolean {
  return (BUILTIN_CHANNEL_IDS as readonly string[]).includes(id)
}

export function builtinSpecOf(id: string): BuiltinChannelSpec | undefined {
  return BUILTIN_CHANNELS.find((c) => c.id === id)
}

/**
 * 造一条内置渠道（**用于补齐缺失的那几条**，不覆盖已存在的）。
 *
 * 地址取协议目录的 `defaultBaseUrl`（唯一来源，与界面上"选中即填地址"同一份）；
 * 协议没写默认地址时留空，让用户在界面上自己填（不猜）。
 */
export function createBuiltinChannel(
  spec: BuiltinChannelSpec,
  index: number,
  catalog: ProtocolCatalog = BUILTIN_CATALOG,
): Channel {
  const def = protocolById(spec.protocol, catalog)
  const input: CreateChannelInput = {
    name: spec.name,
    protocol: spec.protocol,
    baseUrl: def?.defaultBaseUrl ?? '',
    order: BUILTIN_ORDER_BASE + index,
  }
  const ch = createChannel(input)
  /** id 写死（`createChannel` 生成的那个丢弃）+ 新建即启用（与 #353 同口径） */
  return { ...ch, id: spec.id, order: BUILTIN_ORDER_BASE + index }
}
