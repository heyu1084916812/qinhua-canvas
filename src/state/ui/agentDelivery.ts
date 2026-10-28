import {
  DEFAULT_AGENT_DELIVERY_MODE,
  isAgentDeliveryMode,
  type AgentDeliveryMode,
} from '../../domain/agent/delivery'

let current: AgentDeliveryMode = DEFAULT_AGENT_DELIVERY_MODE
const listeners = new Set<() => void>()

export function getAgentDeliveryMode(): AgentDeliveryMode {
  return current
}

export function setAgentDeliveryMode(value: unknown): void {
  const next = isAgentDeliveryMode(value) ? value : DEFAULT_AGENT_DELIVERY_MODE
  if (next === current) return
  current = next
  for (const listener of listeners) listener()
}

export function subscribeAgentDeliveryMode(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function __resetAgentDeliveryModeForTest(): void {
  current = DEFAULT_AGENT_DELIVERY_MODE
  for (const listener of listeners) listener()
}
