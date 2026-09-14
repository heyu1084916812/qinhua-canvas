import type { Size } from '../geometry/rect'
import type { NodeType, NodeData, NodeSnapshot } from '../model/node'
import type { GraphSnapshot } from '../model/graph'
// 请求与输入词表已上移共享执行 domain（M6-5 路径 B）。这里只做转出，
// 使既有 `from '.../nodeSpecs/types'` 的引用路径保持可用；本文件只留画布专有的节点规格。
import type { NodeInput, RunRequest } from '../../shared/execution/types'

export type { NodeInput, RunRequest }

export interface InputContext<TData extends NodeData = NodeData> {
  node: NodeSnapshot<TData>
  graph: GraphSnapshot
}

export interface RunContext<TData extends NodeData = NodeData> {
  node: NodeSnapshot<TData>
  inputs: NodeInput[]
  params: TData
  graph: GraphSnapshot
}

export type GenerateContext<TData extends NodeData = NodeData> = RunContext<TData>

export type Placement = 'self' | 'downstream-slots' | 'board-internal'

export interface GenerationPlan {
  /** 要发起的 API 调用序列，长度 = 调用次数 */
  calls: RunRequest[]
  placement: Placement
  /** 需要准备的空槽位数；placement = 'downstream-slots' 时通常等于 calls.length */
  slotCount: number
}

/**
 * 节点行为规格（架构 §4.5 修订）：
 * 放在 domain 层，供 state 命令层（createDefaultData / accepts）、
 * features 执行层（collectInputs / generate）与 domain 规则层（canConnect）使用。
 * 渲染绑定（View / Panel）在 workbenches 侧，两者以 NodeType 为唯一契约。
 */
export interface NodeSpec<TData extends NodeData = NodeData> {
  type: NodeType
  label: string
  sizing: {
    min: Size
    lockAspect?: boolean
    freeScaleWhenEmpty?: boolean
  }
  ports: { input: boolean; output: boolean }
  accepts: {
    upstream: NodeType[]
    children?: NodeType[]
    parent?: NodeType[]
  }
  createDefaultData(): TData
  collectInputs(ctx: InputContext<TData>): NodeInput[]
  /** 生成行为主入口；返回 null 表示该类型不可生成 */
  generate?(ctx: GenerateContext<TData>): GenerationPlan | null
  /** 单次请求构造：未提供 generate 时，执行引擎用它构造单次计划 */
  toRunRequest?(ctx: RunContext<TData>): RunRequest | null
}
