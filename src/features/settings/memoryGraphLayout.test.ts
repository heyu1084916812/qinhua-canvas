import { describe, expect, it } from 'vitest'
import type { ContextMemory } from '../../domain/shared/context'
import {
  layoutMemoryGraph,
  MEMORY_GRAPH_HEIGHT,
  MEMORY_GRAPH_LIMIT,
  MEMORY_GRAPH_WIDTH,
} from './memoryGraphLayout'

const memory = (id: string, patch: Partial<ContextMemory> = {}): ContextMemory => ({
  id,
  kind: 'preference',
  text: `记忆 ${id}`,
  enabled: true,
  currentRevision: 1,
  createdAt: 1,
  updatedAt: 1,
  ...patch,
})

describe('memoryGraphLayout', () => {
  it('按类型建立关系节点，所有坐标都在画布内', () => {
    const layout = layoutMemoryGraph([
      memory('a'),
      memory('b', { kind: 'fact' }),
      memory('c', { kind: 'constraint' }),
      memory('d', { kind: 'decision' }),
    ])
    expect(layout.hubs).toHaveLength(4)
    expect(layout.nodes).toHaveLength(4)
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.x).toBeLessThanOrEqual(MEMORY_GRAPH_WIDTH)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeLessThanOrEqual(MEMORY_GRAPH_HEIGHT)
    }
  })

  it('启用的记忆优先进入图谱，超过上限时如实报告隐藏数量', () => {
    const memories = Array.from({ length: MEMORY_GRAPH_LIMIT + 3 }, (_, index) =>
      memory(`m-${index}`, {
        enabled: index !== 0,
        updatedAt: index,
      }),
    )
    const layout = layoutMemoryGraph(memories)
    expect(layout.nodes).toHaveLength(MEMORY_GRAPH_LIMIT)
    expect(layout.nodes.some((node) => node.memory.id === 'm-0')).toBe(false)
    expect(layout.hiddenCount).toBe(3)
  })

  it('输入顺序变化不会改变同一批节点的布局', () => {
    const first = [memory('a', { updatedAt: 2 }), memory('b', { updatedAt: 1 })]
    expect(layoutMemoryGraph(first)).toEqual(layoutMemoryGraph([...first].reverse()))
  })
})
