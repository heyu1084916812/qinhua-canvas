/**
 * 新建节点时该带的**默认数据**（用户 2026-09-17）。
 *
 * 目前只有一条规则：生成类节点（generation / batch）默认带上「上次用过的渠道与模型」。
 * 单独成文件而不是塞进页面组件，是因为**新建入口不止一处**
 * （顶栏「＋」、右键菜单「新建并连接」都走这里）——规则写两遍必然漂移。
 *
 * 纯函数：不读库、不读时间，由调用方把已解析好的预设喂进来。
 */
import type { NodeType } from '../model/node'
import { getSpec } from './registry'

/** 会用到「渠道 + 模型」的节点类型 */
const GENERATING: ReadonlySet<NodeType> = new Set<NodeType>(['generation', 'batch'])

/**
 * @param preset 已解析好的默认值（渠道仍在、模型可用）；null 表示没有可用预设
 * @returns 该写进 `node.create.data` 的补丁；不需要预设时返回空对象
 */
export function newGeneratingNodeData(
  type: NodeType,
  preset: { channelId: string; model: string } | null,
): Record<string, unknown> {
  if (!GENERATING.has(type)) return {}
  if (!preset) return {}
  /**
   * **必须基于 spec 的默认数据再叠加**，不能只返回 `{ channelId, model }`。
   *
   * `node.create` 的 reducer 是 `cmd.data ?? spec.createDefaultData()` ——
   * 传了 data 就**整体替换**、不再合并默认值。只给两个字段的话，`mode` / `count` /
   * `thumbOrder` 等全都会丢，节点连「是图片还是视频」都不知道
   * （实测：N=2 时 `data.mode` 变 undefined → 请求的 `kind` 也 undefined →
   * 渠道层 switch 不匹配、静默返回 undefined，表现为「点生成什么都没出」）。
   */
  const spec = getSpec(type)
  const base = (spec?.createDefaultData?.() ?? {}) as Record<string, unknown>
  return { ...base, channelId: preset.channelId, model: preset.model }
}
