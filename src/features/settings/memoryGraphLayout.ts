import type { ContextMemory, ContextMemoryKind } from '../../domain/shared/context'

export const MEMORY_GRAPH_WIDTH = 640
export const MEMORY_GRAPH_HEIGHT = 320
export const MEMORY_GRAPH_LIMIT = 24

const HUB_POSITIONS: Record<ContextMemoryKind, { x: number; y: number }> = {
  preference: { x: 184, y: 90 },
  fact: { x: 456, y: 90 },
  constraint: { x: 184, y: 230 },
  decision: { x: 456, y: 230 },
}

const HUB_ANGLES: Record<ContextMemoryKind, number> = {
  preference: -2.5,
  fact: -0.64,
  constraint: 2.5,
  decision: 0.64,
}

export interface MemoryGraphNode {
  memory: ContextMemory
  x: number
  y: number
}

export interface MemoryGraphHub {
  kind: ContextMemoryKind
  x: number
  y: number
  count: number
}

export interface MemoryGraphLayout {
  center: { x: number; y: number }
  hubs: MemoryGraphHub[]
  nodes: MemoryGraphNode[]
  hiddenCount: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function layoutMemoryGraph(memories: readonly ContextMemory[]): MemoryGraphLayout {
  const sorted = [...memories].sort(
    (left, right) =>
      Number(right.enabled) - Number(left.enabled) ||
      right.updatedAt - left.updatedAt,
  )
  const visible = sorted.slice(0, MEMORY_GRAPH_LIMIT)
  const counts = new Map<ContextMemoryKind, number>()
  const indexes = new Map<ContextMemoryKind, number>()
  const nodes: MemoryGraphNode[] = []

  for (const memory of visible) {
    const hub = HUB_POSITIONS[memory.kind]
    const index = indexes.get(memory.kind) ?? 0
    indexes.set(memory.kind, index + 1)
    counts.set(memory.kind, (counts.get(memory.kind) ?? 0) + 1)
    const angle = HUB_ANGLES[memory.kind] + (index % 6) * (Math.PI / 3)
    const radius = 86 + Math.floor(index / 6) * 38
    nodes.push({
      memory,
      x: clamp(hub.x + Math.cos(angle) * radius, 28, MEMORY_GRAPH_WIDTH - 28),
      y: clamp(hub.y + Math.sin(angle) * radius, 25, MEMORY_GRAPH_HEIGHT - 25),
    })
  }

  return {
    center: { x: MEMORY_GRAPH_WIDTH / 2, y: MEMORY_GRAPH_HEIGHT / 2 },
    hubs: (Object.keys(HUB_POSITIONS) as ContextMemoryKind[])
      .filter((kind) => (counts.get(kind) ?? 0) > 0)
      .map((kind) => ({
        kind,
        ...HUB_POSITIONS[kind],
        count: counts.get(kind) ?? 0,
      })),
    nodes,
    hiddenCount: Math.max(0, memories.length - visible.length),
  }
}
