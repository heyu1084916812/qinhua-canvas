export type AgentDeliveryMode = 'queue' | 'steer'

export const DEFAULT_AGENT_DELIVERY_MODE: AgentDeliveryMode = 'steer'

export function isAgentDeliveryMode(value: unknown): value is AgentDeliveryMode {
  return value === 'queue' || value === 'steer'
}
