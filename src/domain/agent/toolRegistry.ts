export type AgentToolCategory = 'agent-internal' | 'canvas' | 'host-service'
export type AgentToolAccess = 'read' | 'write' | 'confirm'
export type AgentToolName =
  | 'readGraph'
  | 'readAsset'
  | 'applyPlan'
  | 'updateNode'
  | 'proposeTaskPlan'
  | 'updateTaskStep'
  | 'requestTaskConfirmation'
  | 'runNode'
  | 'runFrom'
  | 'readResult'
  | 'visualReview'
  | 'rememberMemory'
  | 'moveNodes'
  | 'resizeNodes'
  | 'deleteNodes'
  | 'arrangeNodes'
  | 'deleteEdges'
  | 'compareNodes'
  | 'sliceImage'
  | 'splitGrid'

export interface AgentToolDefinition {
  name: AgentToolName
  category: AgentToolCategory
  access: AgentToolAccess
  /** 说明该工具的副作用归属；用于设置页和未来的权限诊断。 */
  sideEffect: 'none' | 'canvas' | 'paid' | 'memory'
  /** 视觉验收后同一轮不得继续写画布或重新付费。 */
  terminalAfter?: boolean
}

export const AGENT_TOOL_GROUP_LABELS: Record<AgentToolCategory, string> = {
  'agent-internal': 'Agent 内部',
  canvas: '画布',
  'host-service': '宿主服务',
}

export const AGENT_TOOL_DEFINITIONS: readonly AgentToolDefinition[] = [
  { name: 'readGraph', category: 'canvas', access: 'read', sideEffect: 'none' },
  { name: 'readAsset', category: 'canvas', access: 'read', sideEffect: 'none' },
  { name: 'readResult', category: 'canvas', access: 'read', sideEffect: 'none' },
  {
    name: 'visualReview',
    category: 'canvas',
    access: 'read',
    sideEffect: 'none',
    terminalAfter: true,
  },
  { name: 'applyPlan', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'updateNode', category: 'canvas', access: 'confirm', sideEffect: 'canvas' },
  { name: 'moveNodes', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'resizeNodes', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'deleteNodes', category: 'canvas', access: 'confirm', sideEffect: 'canvas' },
  { name: 'arrangeNodes', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'deleteEdges', category: 'canvas', access: 'confirm', sideEffect: 'canvas' },
  { name: 'compareNodes', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'sliceImage', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'splitGrid', category: 'canvas', access: 'write', sideEffect: 'canvas' },
  { name: 'runNode', category: 'canvas', access: 'confirm', sideEffect: 'paid' },
  { name: 'runFrom', category: 'canvas', access: 'confirm', sideEffect: 'paid' },
  {
    name: 'proposeTaskPlan',
    category: 'agent-internal',
    access: 'confirm',
    sideEffect: 'none',
  },
  {
    name: 'updateTaskStep',
    category: 'agent-internal',
    access: 'write',
    sideEffect: 'none',
  },
  {
    name: 'requestTaskConfirmation',
    category: 'agent-internal',
    access: 'confirm',
    sideEffect: 'none',
  },
  {
    name: 'rememberMemory',
    category: 'host-service',
    access: 'confirm',
    sideEffect: 'memory',
  },
]

const BY_NAME = new Map(AGENT_TOOL_DEFINITIONS.map((tool) => [tool.name, tool]))

export const AGENT_READ_TOOL_NAMES = AGENT_TOOL_DEFINITIONS.filter(
  (tool) => tool.access === 'read',
).map((tool) => tool.name)

export const AGENT_WRITE_TOOL_NAMES = AGENT_TOOL_DEFINITIONS.filter(
  (tool) => tool.access === 'write',
).map((tool) => tool.name)

export const AGENT_CONFIRM_TOOL_NAMES = AGENT_TOOL_DEFINITIONS.filter(
  (tool) => tool.access === 'confirm',
).map((tool) => tool.name)

export function agentToolDefinitionOf(name: string): AgentToolDefinition | null {
  return BY_NAME.get(name as AgentToolName) ?? null
}

export function isAgentToolName(name: string): name is AgentToolName {
  return BY_NAME.has(name as AgentToolName)
}

export function agentToolsInCategory(category: AgentToolCategory): readonly AgentToolName[] {
  return AGENT_TOOL_DEFINITIONS.filter((tool) => tool.category === category).map(
    (tool) => tool.name,
  )
}

export function agentToolIdempotencyKey(input: {
  jobId: string
  stepId: string
  toolCallId: string
}): string {
  return `agent:${input.jobId}:${input.stepId}:${input.toolCallId}`
}
