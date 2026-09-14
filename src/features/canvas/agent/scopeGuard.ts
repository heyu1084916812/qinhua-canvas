import type { NodeType } from '../../../domain/canvas/model/node'

/**
 * Agent 作用域与权限（架构 §5.9 ②）。
 * M0 只落地接口与判定；Agent 运行时在后续里程碑实现。
 */
export type ToolName =
  | 'createNode'
  | 'connectNodes'
  | 'updateParams'
  | 'runGeneration'
  | 'deleteNode'
  | 'renameNode'

export interface AgentScope {
  projectId: string
  /** Agent 可修改的节点范围；'all' 表示不限 */
  editableNodeIds: string[] | 'all'
  allowedTools: ToolName[]
  /** 单次会话最大步数 */
  maxSteps: number
  /** 需要用户确认后才执行的工具（删除节点、发起付费生成） */
  requireConfirm: ToolName[]
}

export interface ToolCall {
  id: string
  name: ToolName
  args: Record<string, unknown>
}

/** 工具调用涉及的目标节点；由各工作台的 tools 层填好后交给守卫校验 */
export function targetNodeIdsOf(call: ToolCall): string[] {
  const raw = call.args.nodeIds
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string')
  const single = call.args.nodeId
  return typeof single === 'string' ? [single] : []
}

export function isToolAllowed(scope: AgentScope, name: ToolName): boolean {
  return scope.allowedTools.includes(name)
}

export function requiresConfirm(scope: AgentScope, name: ToolName): boolean {
  return scope.requireConfirm.includes(name)
}

export function isNodeEditable(scope: AgentScope, nodeId: string): boolean {
  return scope.editableNodeIds === 'all' || scope.editableNodeIds.includes(nodeId)
}

/** 越权即抛错：Agent 的每一步都要过这道闸，而不是靠调用方自觉 */
export function assertAllowed(scope: AgentScope, call: ToolCall): void {
  if (!isToolAllowed(scope, call.name)) {
    throw new Error(`[agentScope] 工具未被允许：${call.name}`)
  }
  for (const id of targetNodeIdsOf(call)) {
    if (!isNodeEditable(scope, id)) {
      throw new Error(`[agentScope] 节点不在可编辑范围内：${id}`)
    }
  }
}

export function assertWithinSteps(scope: AgentScope, steps: number): void {
  if (steps >= scope.maxSteps) {
    throw new Error(`[agentScope] 超出单次会话最大步数：${scope.maxSteps}`)
  }
}

/** 建节点时也要按类型收敛：避免 Agent 建出产品形态未定的节点 */
export function assertNodeTypeAllowed(scope: AgentScope, type: NodeType): boolean {
  void scope
  return type !== 'board'
}
