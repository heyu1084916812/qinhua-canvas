import type { AgentScope, ToolName } from './scopeGuard'
import type { Command } from '../../../state/commands'

/**
 * Agent 会话状态机（架构 §5.9 ③）。
 * M0 仅落地类型；运行时循环（agentRuntime）与各工作台 tools 在后续里程碑实现。
 *
 * 与工作流执行的区别：features/execution 跑一次性 DAG，features/agent 跑
 * 「思考 → 调工具 → 观察」循环。两者共用命令总线与渠道适配层，互不干涉。
 */
export type AgentSessionState =
  | 'idle'
  | 'thinking'
  | 'streaming'
  | 'tool_calling'
  | 'awaiting_confirm'
  | 'paused'
  | 'succeeded'
  | 'failed'
  | 'canceled'

export interface AgentMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  content: string
  createdAt: number
}

export interface AgentStep {
  id: string
  tool: ToolName
  /** 本步产生的 Command 序列（整体映射到一个事务，供用户整体撤销） */
  commands: Command[]
  transactionId: string
  status: 'pending' | 'confirmed' | 'applied' | 'failed' | 'canceled'
}

export interface AgentSession {
  id: string
  nodeId: string
  state: AgentSessionState
  messages: AgentMessage[]
  steps: AgentStep[]
  /** 作用域与权限（见 scopeGuard） */
  scope: AgentScope
}
