import { describe, it, expect, beforeEach } from 'vitest'
import { reduce } from './reducer'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import { registerSpec, resetSpecs } from '../../domain/canvas/nodeSpecs/registry'
import { promptSpec } from '../../domain/canvas/nodeSpecs/prompt'
import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import { groupSpec } from '../../domain/canvas/nodeSpecs/group'
import { clipboardFromSelection, pasteEdges, pasteNodes } from '../../domain/canvas/clipboard'

function emptyGraph(projectId = 'p1'): GraphSnapshot {
  return { projectId, nodes: [], edges: [], }
}

beforeEach(() => {
  resetSpecs()
  registerSpec(promptSpec)
  registerSpec(generationSpec)
  registerSpec(groupSpec)
})

describe('reduce / node.create', () => {
  it('用 spec 默认数据建节点，尺寸取 spec.min', () => {
    const { result, next } = reduce(
      { kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 10, y: 20 } },
      emptyGraph(),
    )
    expect(next.nodes).toHaveLength(1)
    const n = next.nodes[0]!
    expect(n.type).toBe('prompt')
    expect(n.x).toBe(10)
    expect(n.y).toBe(20)
    expect(n.title).toBe('提示词')
    expect(n.data).toEqual({ text: '', upstreamPromptLinked: false, channelId: '', model: '' })
    expect(result.transaction.mode).toBe('standalone')
    expect(result.persist.tables).toContain('nodes')
  })

  it('未知类型抛错', () => {
    expect(() =>
      reduce({ kind: 'node.create', projectId: 'p1', type: 'ghost' as never, at: { x: 0, y: 0 } }, emptyGraph()),
    ).toThrow(/未知节点类型/)
  })
})

describe('reduce / 图数据变更', () => {
  it('node.move 按 dx/dy 平移，事务为 coalesce', () => {
    const g0 = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    const id = g0.nodes[0]!.id
    const { result, next } = reduce({ kind: 'node.move', ids: [id], dx: 5, dy: -3, phase: 'move' }, g0)
    expect(next.nodes[0]!.x).toBe(5)
    expect(next.nodes[0]!.y).toBe(-3)
    expect(result.transaction).toMatchObject({ mode: 'coalesce' })
  })

  it('node.resize 应用矩形', () => {
    const g0 = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    const id = g0.nodes[0]!.id
    const { next } = reduce({ kind: 'node.resize', id, rect: { x: 1, y: 2, w: 100, h: 80 }, phase: 'end' }, g0)
    expect(next.nodes[0]).toMatchObject({ x: 1, y: 2, w: 100, h: 80 })
  })

  it('node.rename 改标题', () => {
    const g0 = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    const id = g0.nodes[0]!.id
    const { next } = reduce({ kind: 'node.rename', id, title: '主提示词' }, g0)
    expect(next.nodes[0]!.title).toBe('主提示词')
  })

  it('node.updateData 合并数据；transient 走 silent 事务', () => {
    const g0 = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    const id = g0.nodes[0]!.id
    const r = reduce({ kind: 'node.updateData', id, patch: { text: '你好' }, transient: true }, g0)
    expect((r.next.nodes[0]!.data as { text: string }).text).toBe('你好')
    expect(r.result.transaction.mode).toBe('silent')
  })
})

describe('reduce / 连线与归属', () => {
  function twoNodes(): GraphSnapshot {
    let g = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 200, y: 0 } }, g).next
    return g
  }

  it('edge.connect 合法时建边', () => {
    const g = twoNodes()
    const src = g.nodes.find((n) => n.type === 'prompt')!.id
    const tgt = g.nodes.find((n) => n.type === 'generation')!.id
    const { next } = reduce({ kind: 'edge.connect', source: src, target: tgt }, g)
    expect(next.edges).toHaveLength(1)
  })

  it('edge.connect 生成 → 提示词合法（§6.7 上游可连图片 / 视频节点）', () => {
    const g = twoNodes()
    const src = g.nodes.find((n) => n.type === 'generation')!.id
    const tgt = g.nodes.find((n) => n.type === 'prompt')!.id
    const { next } = reduce({ kind: 'edge.connect', source: src, target: tgt }, g)
    expect(next.edges).toHaveLength(1)
  })

  it('edge.remove 删边', () => {
    const g = twoNodes()
    const src = g.nodes.find((n) => n.type === 'prompt')!.id
    const tgt = g.nodes.find((n) => n.type === 'generation')!.id
    const g1 = reduce({ kind: 'edge.connect', source: src, target: tgt }, g).next
    const eid = g1.edges[0]!.id
    const { next } = reduce({ kind: 'edge.remove', id: eid }, g1)
    expect(next.edges).toHaveLength(0)
  })

  it('node.reparent 跨容器换算坐标并清掉连线', () => {
    let g = twoNodes()
    const pId = g.nodes.find((n) => n.type === 'prompt')!.id
    const gId = g.nodes.find((n) => n.type === 'generation')!.id
    g = reduce({ kind: 'edge.connect', source: pId, target: gId }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 100, y: 100 } }, g).next
    const groupId = g.nodes.find((n) => n.type === 'group')!.id
    const { next } = reduce({ kind: 'node.reparent', id: gId, toParent: groupId }, g)
    const moved = next.nodes.find((n) => n.id === gId)!
    expect(moved.parentId).toBe(groupId)
    expect(moved.x).toBe(100)
    expect(moved.y).toBe(-100)
    expect(next.edges).toHaveLength(0)
    const group = next.nodes.find((n) => n.id === groupId)!
    expect((group.data as { childIds: string[] }).childIds).toEqual([gId])
  })

  it('node.reparent 拖入分组写入 childIds、拖出移除（§6.11）', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 600, y: 0 } }, g).next
    const groupId = g.nodes.find((n) => n.type === 'group')!.id
    const genId = g.nodes.find((n) => n.type === 'generation')!.id

    const inside = reduce({ kind: 'node.reparent', id: genId, toParent: groupId }, g).next
    expect((inside.nodes.find((n) => n.id === groupId)!.data as { childIds: string[] }).childIds).toEqual([genId])

    const outside = reduce({ kind: 'node.reparent', id: genId, toParent: null }, inside).next
    expect((outside.nodes.find((n) => n.id === groupId)!.data as { childIds: string[] }).childIds).toEqual([])
    expect(outside.nodes.find((n) => n.id === genId)!.parentId).toBeNull()
  })

  it('node.reparent 拒绝分组收纳另一个容器', () => {
    let g = emptyGraph()
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, g).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 600, y: 0 } }, g).next
    const [outerId, innerId] = g.nodes.map((n) => n.id)
    expect(() => reduce({ kind: 'node.reparent', id: innerId!, toParent: outerId! }, g)).toThrow()
  })
})

describe('reduce / node.duplicate（§4.2 Alt+拖动复制）', () => {
  /** prompt(a) → generation(b)：最常用的「提示词 → 生成」连线 */
  function chain(): GraphSnapshot {
    let g = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 300, y: 0 } }, g).next
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const b = g.nodes.find((n) => n.type === 'generation')!.id
    g = reduce({ kind: 'edge.connect', source: a, target: b }, g).next
    return g
  }

  it('复制出独立节点（新 id、按 dx/dy 落位）', () => {
    const g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const { next } = reduce({ kind: 'node.duplicate', ids: [a], newIds: ['a2'], dx: 20, dy: 30 }, g)
    expect(next.nodes).toHaveLength(3)
    const copy = next.nodes.find((n) => n.id === 'a2')!
    expect(copy.type).toBe('prompt')
    expect(copy.x).toBe(20)
    expect(copy.y).toBe(30)
  })

  it('副本数据深拷贝（改副本不污染原节点）', () => {
    let g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    g = reduce(
      { kind: 'node.updateData', id: a, patch: { text: '原文' } },
      g,
    ).next
    const { next } = reduce({ kind: 'node.duplicate', ids: [a], newIds: ['a2'] }, g)
    const copy = next.nodes.find((n) => n.id === 'a2')!
    expect((copy.data as { text: string }).text).toBe('原文')
    // 改副本
    const next2 = reduce({ kind: 'node.updateData', id: 'a2', patch: { text: '副本改了' } }, next).next
    expect((next2.nodes.find((n) => n.id === a)!.data as { text: string }).text).toBe('原文')
    expect((next2.nodes.find((n) => n.id === 'a2')!.data as { text: string }).text).toBe('副本改了')
  })

  it('rewire：副本接上原节点的上下游（§4.2「保留上下游连线」）', () => {
    const g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const b = g.nodes.find((n) => n.type === 'generation')!.id
    // 复制中间的提示词 a：原边 a→b 应复制出 a2→b
    const { next } = reduce({ kind: 'node.duplicate', ids: [a], newIds: ['a2'], rewire: true }, g)
    expect(next.edges).toHaveLength(2)
    expect(next.edges.some((e) => e.source === 'a2' && e.target === b)).toBe(true)
    // 原边仍在
    expect(next.edges.some((e) => e.source === a && e.target === b)).toBe(true)
  })

  it('rewire 复制下游节点时接上它的上游', () => {
    const g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const b = g.nodes.find((n) => n.type === 'generation')!.id
    const { next } = reduce({ kind: 'node.duplicate', ids: [b], newIds: ['b2'], rewire: true }, g)
    expect(next.edges.some((e) => e.source === a && e.target === 'b2')).toBe(true)
  })

  it('不 rewire 时不产生任何连线', () => {
    const g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const { next } = reduce({ kind: 'node.duplicate', ids: [a], newIds: ['a2'] }, g)
    expect(next.edges).toHaveLength(1)
  })

  it('多选复制：集合内部连线一并复制', () => {
    const g = chain()
    const ids = g.nodes.map((n) => n.id)
    const { next } = reduce(
      { kind: 'node.duplicate', ids, newIds: ['c1', 'c2'], rewire: true },
      g,
    )
    expect(next.nodes).toHaveLength(4)
    expect(next.edges.some((e) => e.source === 'c1' && e.target === 'c2')).toBe(true)
  })

  it('非法连线静默跳过（不因一条边失败中断复制）', () => {
    // 复制一个 generation 两次会造成重复边 → canConnect 拒绝，节点仍应复制成功
    const g = chain()
    const b = g.nodes.find((n) => n.type === 'generation')!.id
    const first = reduce({ kind: 'node.duplicate', ids: [b], newIds: ['b2'], rewire: true }, g).next
    const second = reduce({ kind: 'node.duplicate', ids: [b], newIds: ['b3'], rewire: true }, first).next
    expect(second.nodes).toHaveLength(4)
    expect(second.edges.filter((e) => e.target === 'b3')).toHaveLength(1)
  })

  it('ids 与 newIds 长度不一致立即报错（早失败好过静默错位）', () => {
    const g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    expect(() => reduce({ kind: 'node.duplicate', ids: [a], newIds: [] }, g)).toThrow(/长度不一致/)
  })

  it('复制不存在的节点报错', () => {
    expect(() =>
      reduce({ kind: 'node.duplicate', ids: ['ghost'], newIds: ['g2'] }, emptyGraph()),
    ).toThrow(/节点不存在/)
  })

  it('事务为 standalone（一次复制一步撤销）', () => {
    const g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const { result } = reduce({ kind: 'node.duplicate', ids: [a], newIds: ['a2'] }, g)
    expect(result.transaction).toMatchObject({ mode: 'standalone' })
  })
})

describe('reduce / node.paste（§4.2 Ctrl+C/V 粘贴）', () => {
  /** prompt(a) → generation(b) 一条链，供复制粘贴 */
  function chain(): GraphSnapshot {
    let g = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 300, y: 0 } }, g).next
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const b = g.nodes.find((n) => n.type === 'generation')!.id
    return reduce({ kind: 'edge.connect', source: a, target: b }, g).next
  }

  /** 复制 → 粘贴：走的是与 UI 完全相同的两个 domain 纯函数 */
  function copyPaste(g: GraphSnapshot, ids: string[], newIds: string[], at = { x: 0, y: 0 }) {
    const payload = clipboardFromSelection(g, ids)!
    return reduce(
      { kind: 'node.paste', nodes: pasteNodes(payload, at, newIds), edges: pasteEdges(payload, newIds) },
      g,
    )
  }

  it('整链粘贴：节点与集合内连线都落库，事务为 standalone（一步撤销）', () => {
    const g = chain()
    const [a, b] = [g.nodes[0]!.id, g.nodes[1]!.id]
    const { result, next } = copyPaste(g, [a, b], ['a2', 'b2'])
    expect(next.nodes).toHaveLength(4)
    expect(next.edges).toHaveLength(2)
    expect(next.edges.some((e) => e.source === 'a2' && e.target === 'b2')).toBe(true)
    expect(result.transaction).toMatchObject({ mode: 'standalone' })
    expect(result.persist.tables).toContain('nodes')
  })

  it('projectId 盖成当前项目 → 剪贴板可跨项目粘贴', () => {
    const g = chain()
    const other = { ...g, projectId: 'p2' }
    const { next } = copyPaste(other, [g.nodes[0]!.id], ['a2'])
    expect(next.nodes.find((n) => n.id === 'a2')!.projectId).toBe('p2')
  })

  it('id 与现有节点冲突时抛错（upsert 会静默覆盖，宁可早失败）', () => {
    const g = chain()
    const payload = clipboardFromSelection(g, [g.nodes[0]!.id])!
    expect(() =>
      reduce({ kind: 'node.paste', nodes: pasteNodes(payload, { x: 0, y: 0 }, [g.nodes[0]!.id]), edges: [] }, g),
    ).toThrow(/冲突/)
  })

  it('父指针悬空时抛错（不造出孤儿节点）', () => {
    const g = chain()
    const orphan = { ...g.nodes[0]!, id: 'x', parentId: '不存在的父' }
    expect(() => reduce({ kind: 'node.paste', nodes: [orphan], edges: [] }, g)).toThrow(/父节点不存在/)
  })

  it('端点不在本批内的连线丢弃；与现有重复的边不再插一条', () => {
    const g = chain()
    const dangling = { nodes: [], edges: [{ source: 'a2', target: '幽灵' }], size: { w: 1, h: 1 } }
    const { next } = reduce(
      {
        kind: 'node.paste',
        nodes: [{ ...g.nodes[0]!, id: 'a2' }, { ...g.nodes[1]!, id: 'b2' }],
        edges: [...dangling.edges, { source: 'a2', target: 'b2' }, { source: 'a2', target: 'b2' }],
      },
      g,
    )
    // 只有一条合法边（重复的那条被挡掉，悬空的那条被丢弃）
    expect(next.edges.filter((e) => e.source === 'a2')).toHaveLength(1)
  })

  it('空剪贴板抛错', () => {
    expect(() => reduce({ kind: 'node.paste', nodes: [], edges: [] }, chain())).toThrow(/剪贴板为空/)
  })
})

describe('reduce / node.delete（§6.20 Delete / §4.1 右键删除）', () => {
  /** prompt(a) → generation(b) */
  function chain(): GraphSnapshot {
    let g = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 300, y: 0 } }, g).next
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const b = g.nodes.find((n) => n.type === 'generation')!.id
    g = reduce({ kind: 'edge.connect', source: a, target: b }, g).next
    return g
  }

  it('删除节点本身', () => {
    const g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const { next } = reduce({ kind: 'node.delete', ids: [a] }, g)
    expect(next.nodes.find((n) => n.id === a)).toBeUndefined()
    expect(next.nodes).toHaveLength(1)
  })

  it('级联删除相连连线（不留悬空边）', () => {
    const g = chain()
    const a = g.nodes.find((n) => n.type === 'prompt')!.id
    const { next } = reduce({ kind: 'node.delete', ids: [a] }, g)
    expect(next.edges).toHaveLength(0)
  })

  it('递归删除后代（容器子节点不留下悬空 parentId）', () => {
    let g = reduce({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 } }, emptyGraph()).next
    const groupId = g.nodes[0]!.id
    g = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 }, parentId: groupId }, g).next
    const childId = g.nodes.find((n) => n.type === 'prompt')!.id
    expect(g.nodes).toHaveLength(2)

    const { next } = reduce({ kind: 'node.delete', ids: [groupId] }, g)
    expect(next.nodes).toHaveLength(0)
    expect(next.nodes.find((n) => n.id === childId)).toBeUndefined()
  })

  it('一次删除多个节点（standalone 事务，一步撤销整组恢复）', () => {
    const g = chain()
    const ids = g.nodes.map((n) => n.id)
    const { result, next } = reduce({ kind: 'node.delete', ids }, g)
    expect(next.nodes).toHaveLength(0)
    expect(next.edges).toHaveLength(0)
    expect(result.transaction.mode).toBe('standalone')
  })

  it('节点不存在时抛错（早失败，不静默跳过）', () => {
    expect(() => reduce({ kind: 'node.delete', ids: ['ghost'] }, emptyGraph())).toThrow(/节点不存在/)
  })
})

describe('reduce / 执行与版本历史命令（M0-11）', () => {
  it('runPlan.execute 落 tasks 表，事务 silent（不进撤销栈）', () => {
    const { result } = reduce(
      { kind: 'runPlan.execute', planId: 'plan1', scope: 'node', mode: 'single', originNodeId: 'n1', createdAt: 1000 },
      emptyGraph(),
    )
    expect(result.transaction.mode).toBe('silent')
    const task = result.persist.upserts.find((u) => u.table === 'tasks')
    expect(task?.rows[0]).toMatchObject({ id: 'plan1', scope: 'node', mode: 'single', state: 'running' })
  })

  it('runPlan.cancel 把计划标记为 canceled', () => {
    const { result } = reduce({ kind: 'runPlan.cancel', runPlanId: 'plan1', at: 2000 }, emptyGraph())
    const task = result.persist.upserts.find((u) => u.table === 'tasks')
    expect(task?.rows[0]).toMatchObject({ id: 'plan1', state: 'canceled', canceledAt: 2000 })
  })

  it('node.runRecord.append 只落 runRecords 表，图快照不变', () => {
    const g0 = reduce({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } }, emptyGraph()).next
    const nodeId = g0.nodes[0]!.id
    const record = {
      id: 'r1',
      nodeId,
      projectId: 'p1',
      version: 1,
      createdAt: 1000,
      status: 'succeeded' as const,
      inputs: [],
      params: { text: 'a', upstreamPromptLinked: false },
      outputHashes: ['h1'],
      fingerprint: 'fp1',
      taskId: 't1',
      durationMs: 12,
    }
    const { result, next } = reduce({ kind: 'node.runRecord.append', nodeId, record }, g0)
    expect(next.nodes).toEqual(g0.nodes) // 图不变
    expect(result.transaction.mode).toBe('silent') // 版本历史不进撤销栈
    expect(result.persist.upserts.find((u) => u.table === 'runRecords')?.rows[0]).toMatchObject({ id: 'r1' })
  })

})

