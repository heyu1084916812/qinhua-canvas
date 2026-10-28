import {
  channelIdForLogical,
  toLogicalName,
  type CatalogChannelLike,
} from '../../../domain/project/modelCatalog'

export interface TextRoute {
  channelId: string
  /**
   * 前端逻辑名。调用侧还应交给渠道映射翻译成上游 ID；这里不提前翻译，
   * 因为同一个逻辑名在不同渠道可能对应不同上游 ID。
   */
  model: string
}

/**
 * 文本工具的真实选路。
 *
 * 创作面板和提示词节点都只把模型当作“用户的选择”，节点上的 `channelId`
 * 可能是旧版本留下的内部值。这里始终先归一成逻辑名，再从**当前启用渠道**
 * 中找能提供它的那一条；首选渠道只在确实支持该模型时保留。
 *
 * 找不到时必须返回 `null`，不能回退到旧渠道再让上游以 400 拒绝。那样既
 * 浪费一次请求，也会把“本该在本地解释的配置问题”伪装成渠道故障。
 */
export function resolveTextRoute(
  channels: readonly CatalogChannelLike[],
  preferredChannelId: string | undefined,
  model: string | undefined,
): TextRoute | null {
  const requested = (model ?? '').trim()
  if (!requested) return null
  const logical = toLogicalName(channels, requested)
  const channelId = channelIdForLogical(
    channels.filter((channel) => channel.enabled),
    logical,
    preferredChannelId,
  )
  return channelId ? { channelId, model: logical } : null
}
