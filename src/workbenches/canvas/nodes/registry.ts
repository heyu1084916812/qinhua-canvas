import type { ComponentType, ReactNode } from 'react'
import type { NodeType, NodeData, NodeSnapshot } from '../../../domain/canvas/model/node'
import type { NodeSpec } from '../../../domain/canvas/nodeSpecs/types'
import type { RunMode } from '../../../domain/canvas/model/runRecord'
import type { NodeInput } from '../../../domain/shared/execution/types'
import { getSpec, registeredTypes } from '../../../domain/canvas/nodeSpecs/registry'

/**
 * 渲染绑定层（与 domain 侧 NodeSpec 配对，架构 §4.5）。
 *
 * 重要：依赖治理规则 no-node-cross-talk 只允许节点实现目录（nodes/<type>/）
 * 反向引用本文件（nodes/registry），不能引用 nodes/<otherType>/ 或 nodes/types。
 * 因此所有共享的「节点视图类型」都定义在这里，而非独立 types.ts。
 */

export interface NodeViewProps<TData extends NodeData = NodeData> {
  node: NodeSnapshot<TData>
  /** 节点内容区尺寸（已扣除标题栏 / 端口） */
  size: Size
  /** 当前视口缩放，矢量内容可按需放大保持清晰 */
  scale: number
  selected: boolean
  running: boolean
  /**
   * 全局工作流运行中（本节点自身未在运行）。
   *
   * **只给生成按钮用**（产品文档 §6.8：按钮变旋转 `LoaderCircle` 并禁用），
   * 节点本体**不得**据此渲染状态覆盖层——本体只表达自己的 running / error（§6.19.5）。
   * 早先生成节点本体也用它画了「全局工作流运行中」的居中转圈，于是跑任意一个节点时，
   * 画布上所有未参与的生成节点都跟着转圈（用户实测报「我没让它生成，它却在生成」）。
   */
  globalRunning?: boolean
  /** 上游输出变了、本节点 fingerprint 对不上（见 §4.1 / §6.19.5） */
  runMode: RunMode
  error: string | null
  /** 唯一变更出口：节点视图只能 emit，由页面装配层翻译成 command */
  emit: (event: NodeViewEvent) => void
  /**
   * 直接上游节点已产出的素材 hash，按上游顺序排列（§6.10 对比节点取前 2 张）。
   * 由 NodeLayer（持有 graph）算好注入，视图层不直接读图（架构 §4.7）。
   */
  upstreamAssetHashes?: string[]
  /**
   * 直接上游里**提示词节点**的数量，由 NodeLayer（持有 graph）算好注入（§6.7）。
   * 提示词节点据此在文本区上方显示胶囊「上游已链接提示词节点」——
   * 视图层不直接读图（架构 §4.7）。
   */
  upstreamPromptCount?: number
  /**
   * 直接上游的**图像素材项**（含 `nodeId` / `assetHash` / `mime`），由 NodeLayer 注入。
   *
   * 用途是提示词节点的「反推」（§6.7）：把上游那张图**当素材送进 LLM**，
   * 而不只是画一条线、显示一张缩略图。取的是 `promptSpec.collectInputs` 的结果，
   * 因此「界面看得到图」与「请求真的带图」出自同一处——视图若另算一套，
   * 两边迟早各说各话。视图层不直接读图（架构 §4.7）。
   */
  upstreamImageInputs?: NodeInput[]
  /**
   * 容器类节点（分组 / 批量）自己的子节点快照，由 NodeLayer 注入（视图层不读图）。
   * 非容器类型为空数组。
   */
  childNodes?: NodeSnapshot[]
  /**
   * 把子节点渲染成带外框的完整节点（含标题 / 选中态 / 拖动接线），
   * 由容器视图在自己的坐标系里调用；非容器类型不提供。
   * opts.preserveCoords=true 时保留子节点真实 local 坐标（画板用），
   * 否则坐标归零交由容器网格定位（分组 / 批量用）。
   */
  renderChild?: (child: NodeSnapshot, opts?: { preserveCoords?: boolean }) => ReactNode
  children?: ReactNode
}

export interface NodePanelProps<TData extends NodeData = NodeData> {
  node: NodeSnapshot<TData>
  emit: (event: NodeViewEvent) => void
}

export type NodeViewEvent =
  | { type: 'rename'; title: string }
  /**
   * 数据补丁。transient=true（默认）不进撤销栈但仍落库，用于连续输入（文本编辑、滑块拖动）；
   * 离散提交（如画板落一笔、放一段文字、改一次背景）应传 transient:false 以进入撤销栈。
   */
  | { type: 'updateData'; patch: Partial<NodeData>; transient?: boolean }
  | { type: 'requestPanel' }
  | { type: 'requestRun'; mode: Exclude<RunMode, 'idle'> }
  | { type: 'requestRunCancel' }
  | { type: 'requestRunBoard' }
  | { type: 'createChild'; nodeType: NodeType }
  | { type: 'openLightbox'; assetHash: string }
  /**
   * 下载节点自身的素材（用户 2026-09-18：加在节点跟随栏里）。
   *
   * 视图只上报「要下载这个节点的内容」；**取字节与落盘都在宿主**——
   * 节点视图拿不到 AssetPort / FilePort，也不该拿（架构 §4.7）。
   */
  | { type: 'downloadOwnAsset' }
  | { type: 'toggleUpstream'; upstreamId: string }
  | { type: 'removeOwnAsset' }
  | { type: 'reorderThumbs'; order: string[] }
  /**
   * 上传素材（§6.8 状态 A「点击 `+` 或拖入文件可上传」）。
   *
   * 节点是**纯视图**：既拿不到 `FilePort` 也无法计算内容哈希 / 派发命令（架构 §4.7），
   * 所以只上报「要上传」。`file` 缺省 = 请宿主打开文件选择器；
   * 拖拽落文件时带上 `file`，走同一条宿主路径（选文件与拖文件最终做的是同一件事）。
   */
  | { type: 'requestUpload'; file?: File }
  /**
   * 去后台设置配渠道（节点发现「没有可用平台」时的出口）。
   * 与 requestPanel 一样是**宿主级**语义事件：节点只上报，导航由页面容器做。
   */
  | { type: 'openSettings' }

export interface NodeViewBinding<TData extends NodeData = NodeData> {
  View: ComponentType<NodeViewProps<TData>>
  Panel?: ComponentType<NodePanelProps<TData>>
}

/** 节点定义 = 行为规格（domain） + 渲染绑定（本层），只在渲染装配处组合 */
export interface NodeDefinition<TData extends NodeData = NodeData>
  extends NodeSpec<TData>,
    NodeViewBinding<TData> {}

interface Size {
  w: number
  h: number
}

const views = new Map<NodeType, NodeViewBinding<NodeData>>()

export function registerView(type: NodeType, binding: NodeViewBinding<NodeData>): void {
  if (views.has(type)) throw new Error(`[viewRegistry] 重复注册视图：${type}`)
  views.set(type, binding)
}

export function getViewBinding(type: NodeType): NodeViewBinding<NodeData> | null {
  return views.get(type) ?? null
}

export function allViewBindings(): NodeViewBinding<NodeData>[] {
  return [...views.values()]
}

export function registeredViewTypes(): NodeType[] {
  return [...views.keys()]
}

export function resetViews(): void {
  views.clear()
}

/**
 * 组合成完整节点定义（行为 + 渲染）。spec 或 view 缺一则视为未完整注册。
 */
export function getNodeDefinition(type: NodeType): NodeDefinition {
  const spec = getSpec(type)
  const view = getViewBinding(type)
  if (!spec || !view) {
    throw new Error(`[viewRegistry] 节点类型未完整注册：${type}（spec=${!!spec} view=${!!view}）`)
  }
  return { ...spec, ...view } as unknown as NodeDefinition
}

/**
 * 启动一致性校验：注册的「视图类型集合」必须与「规格类型集合」完全一致
 * （架构 §4.5：数量不一致直接抛错，避免「能渲染但不能生成」的半成品类型上线）。
 * 调用方需先 registerAllSpecs() 再 registerAllViews()。
 */
export function assertRegistryConsistent(): void {
  const specTypes = [...registeredTypes()].sort()
  const viewTypes = [...registeredViewTypes()].sort()
  const specKey = specTypes.join(',')
  const viewKey = viewTypes.join(',')
  if (specKey !== viewKey) {
    throw new Error(
      `[viewRegistry] 规格与视图注册不一致：spec=[${specKey}] view=[${viewKey}]`,
    )
  }
}
