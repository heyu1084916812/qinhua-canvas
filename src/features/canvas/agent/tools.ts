import type { ToolCall } from './scopeGuard'
import type { Command } from '../../../state/commands'

/**
 * 画布专有 Agent 工具（架构 §5.9 ④）。
 *
 * M0 仅占位：工具集与「ToolCall → Command 序列」的映射在 Agent 运行时落地时实现。
 * 硬约束：Agent 改图只走命令总线（agent-only-through-commands 规则），因此 tools
 * 产出的 Command 必须交给 store.dispatch，不得直接改切片。
 */
export interface CanvasAgentTool {
  name: ToolCall['name']
  description: string
  /** 把一次工具调用展开成命令序列；M0 返回空序列占位 */
  toCommands(call: ToolCall): Command[]
}

/** 画布专有工具集（M0 空占位，Agent 落地时填充 createNode/connectNodes/... 的实现） */
export const canvasAgentTools: CanvasAgentTool[] = []

/** 工具名 → 工具定义；M0 返回 undefined（未实现） */
export function getCanvasAgentTool(name: ToolCall['name']): CanvasAgentTool | undefined {
  return canvasAgentTools.find((t) => t.name === name)
}

/**
 * 把一次工具调用映射为命令序列（M0 占位：直接返回空数组，
 * 真实实现会按 call.name 分发到对应工具并产出 Command[]）。
 */
export function mapToolToCommands(call: ToolCall): Command[] {
  return getCanvasAgentTool(call.name)?.toCommands(call) ?? []
}
