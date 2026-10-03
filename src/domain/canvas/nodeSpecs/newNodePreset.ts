/**
 * 新建节点时该带的**默认数据**（用户 2026-09-17 提，2026-09-18 扩展）。
 *
 * 规则只有一条：生成类节点（generation / batch）默认带上「这套配方」——
 * 渠道 + 模型 + **生成参数**。配方从哪来由调用方决定
 * （domain/project/generationPreset 定义了取值规则）。
 *
 * 单独成文件而不是塞进页面组件，是因为**新建入口不止一处**
 * （顶栏「＋」、右键菜单「新建并连接」都走这里）——规则写两遍必然漂移。
 *
 * 纯函数：不读库、不读时间，由调用方把已解析好的配方喂进来。
 */
import type { NodeType } from '../model/node'
import { getSpec } from './registry'

/** 会用到「渠道 + 模型」的节点类型 */
const GENERATING: ReadonlySet<NodeType> = new Set<NodeType>(['generation', 'batch'])

/**
 * 配方里只允许这几项进入新节点的 data。
 *
 * 白名单而不是「原样展开」：配方里若混进 `assetHash` / `prompt` 这类字段
 * （比如将来有人往 params 里塞东西），展开就会把**上一张图的内容**带进新节点。
 * 内容不继承是这条规则的硬边界，故用白名单把它钉死。
 */
const PARAM_KEYS = [
  'ratio',
  'resolution',
  'quality',
  'background',
  'count',
  'size',
  'durationSec',
  'refMode',
  'videoMode',
  'generateAudio',
] as const

/**
 * @param recipe 已解析好的默认值；null 表示没有可用配方
 * @returns 该写进 `node.create.data` 的补丁；不需要时返回空对象
 */
export function newGeneratingNodeData(
  type: NodeType,
  recipe: { channelId: string; model: string; params?: Record<string, unknown> } | null,
): Record<string, unknown> {
  if (!GENERATING.has(type)) return {}
  if (!recipe) return {}
  /**
   * **必须基于 spec 的默认数据再叠加**，不能只返回这几个字段。
   *
   * `node.create` 的 reducer 是 `cmd.data ?? spec.createDefaultData()` ——
   * 传了 data 就**整体替换**、不再合并默认值。只给部分字段的话，`mode` / `thumbOrder`
   * 等全都会丢，节点连「是图片还是视频」都不知道（实测：`data.mode` 变 undefined
   * → 请求的 `kind` 也 undefined → 渠道层 switch 不匹配、静默返回 undefined，
   * 表现为「点生成什么都没出」）。
   */
  const spec = getSpec(type)
  const base = (spec?.createDefaultData?.() ?? {}) as Record<string, unknown>
  const params: Record<string, unknown> = {}
  for (const k of PARAM_KEYS) {
    const v = recipe.params?.[k]
    if (v !== undefined && v !== null) params[k] = v
  }
  return { ...base, channelId: recipe.channelId, model: recipe.model, ...params }
}
