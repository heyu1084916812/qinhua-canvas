import { describe, it, expect, beforeEach } from 'vitest'
import { createAlignTools } from './useAlignTools'
import { createCanvasStore } from '../../state/workbenches/canvas/store'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { PlatformKit } from '../../platform/ports'
import { resetSpecs, registerSpec } from '../../domain/canvas/nodeSpecs/registry'
import { promptSpec } from '../../domain/canvas/nodeSpecs/prompt'
import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import { indexNodes } from '../../domain/canvas/model/graph'

const platform = {
  storage: { transaction: async () => {}, bulkPut: async () => {}, delete: async () => {} },
} as unknown as PlatformKit

function makeStore(): CanvasStore {
  return createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
}

/** 直接驱动工厂（hook 只是它的 useMemo 包装，逻辑同源） */
function tools(store: CanvasStore) {
  return createAlignTools(store)
}

function addPrompt(store: CanvasStore, x: number, y: number, w = 200, h = 100): string {
  const res = store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x, y } })
  const id = (res.patches[0] as { row: { id: string } }).row.id
  if (w !== 200 || h !== 100) {
    store.dispatch({ kind: 'node.resize', id, rect: { x, y, w, h }, phase: 'end' })
  }
  return id
}

const posOf = (store: CanvasStore, id: string) => {
  const n = indexNodes(store.getSnapshot().nodes).get(id)!
  return { x: n.x, y: n.y }
}

beforeEach(() => {
  resetSpecs()
  registerSpec(promptSpec)
  registerSpec(generationSpec)
})

describe('useAlignTools / align', () => {
  it('少于 2 个选中时拒绝并给出原因', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    store.setSelection([a])
    expect(tools(store).align('left')).toMatchObject({ kind: 'too-few', moved: 0 })
  })

  it('等距分布少于 3 个时拒绝', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    const b = addPrompt(store, 300, 0)
    store.setSelection([a, b])
    expect(tools(store).align('hdistribute')).toMatchObject({ kind: 'too-few' })
  })

  it('左对齐：把选中节点挪到同一 x，未选中节点不动', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    const b = addPrompt(store, 300, 50)
    const bystander = addPrompt(store, 900, 900)
    store.setSelection([a, b])

    const r = tools(store).align('left')
    expect(r.kind).toBe('ok')
    expect(posOf(store, a).x).toBe(0)
    expect(posOf(store, b).x).toBe(0)
    // y 不受影响
    expect(posOf(store, b).y).toBe(50)
    expect(posOf(store, bystander)).toEqual({ x: 900, y: 900 })
  })

  it('顶对齐：把选中节点挪到同一 y', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    const b = addPrompt(store, 300, 400)
    store.setSelection([a, b])
    tools(store).align('top')
    expect(posOf(store, a).y).toBe(0)
    expect(posOf(store, b).y).toBe(0)
  })

  it('整次对齐只占一步撤销', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    const b = addPrompt(store, 300, 50)
    store.setSelection([a, b])
    tools(store).align('left')
    store.undo()
    expect(posOf(store, b).x).toBe(300)
  })

  it('8 种模式都能执行（与工具栏按钮一一对应）', () => {
    const store = makeStore()
    const ids = [addPrompt(store, 0, 0), addPrompt(store, 300, 50), addPrompt(store, 600, 120)]
    store.setSelection(ids)
    const t = tools(store)
    for (const mode of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom', 'hdistribute', 'vdistribute'] as const) {
      expect(t.align(mode).kind, mode).toBe('ok')
    }
  })
})

describe('useAlignTools / arrange', () => {
  it('少于 2 个选中时拒绝', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    store.setSelection([a])
    expect(tools(store).arrange()).toMatchObject({ kind: 'too-few' })
  })

  it('按上下游分层重排：上游在左、下游在右', () => {
    const store = makeStore()
    // prompt(上游，初始位置靠右) → generation(下游，初始位置靠左)
    const up = addPrompt(store, 500, 500)
    const gen = store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 100, y: 100 },
    })
    const down = (gen.patches[0] as { row: { id: string } }).row.id
    store.dispatch({ kind: 'edge.connect', source: up, target: down })
    store.setSelection([up, down])

    const r = tools(store).arrange()
    expect(r.kind).toBe('ok')
    expect(posOf(store, up).x).toBeLessThan(posOf(store, down).x)
  })

  it('无连线的多个节点排成同一层（纵向排列）', () => {
    const store = makeStore()
    const ids = [addPrompt(store, 0, 0), addPrompt(store, 400, 300), addPrompt(store, 800, 600)]
    store.setSelection(ids)
    tools(store).arrange()
    const xs = ids.map((id) => posOf(store, id).x)
    // 同一层 → x 相同（层内居中对齐，宽度一致时 x 完全一致）
    expect(new Set(xs).size).toBe(1)
  })

  it('有环时返回 cycle 与文档文案，且不移动任何节点', () => {
    const store = makeStore()
    // generation 接受 generation 上游，两个互连的 generation 即可造环
    const g1 = store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 0, y: 0 } })
    const g2 = store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 300, y: 0 } })
    const g1Id = (g1.patches[0] as { row: { id: string } }).row.id
    const g2Id = (g2.patches[0] as { row: { id: string } }).row.id
    store.dispatch({ kind: 'edge.connect', source: g1Id, target: g2Id })
    // 反向连线在真实 UI 里被 canConnect 拦截，这里直接注入图数据模拟既有环
    const withCycle = {
      ...store.getSnapshot(),
      edges: [
        ...store.getSnapshot().edges,
        { id: 'e-cycle', projectId: 'p1', source: g2Id, target: g1Id },
      ],
    }
    store.hydrate(withCycle)
    store.setSelection([g1Id, g2Id])
    const before = [posOf(store, g1Id), posOf(store, g2Id)]

    const r = tools(store).arrange()
    expect(r.kind).toBe('cycle')
    expect(r.reason).toBe('存在循环依赖，无法整理')
    expect([posOf(store, g1Id), posOf(store, g2Id)]).toEqual(before)
  })

  it('整理结果幂等：第二次整理不再移动', () => {
    const store = makeStore()
    const ids = [addPrompt(store, 0, 0), addPrompt(store, 400, 300), addPrompt(store, 800, 600)]
    store.setSelection(ids)
    const t = tools(store)
    t.arrange()
    const after = ids.map((id) => posOf(store, id))
    expect(t.arrange().moved).toBe(0)
    expect(ids.map((id) => posOf(store, id))).toEqual(after)
  })

  it('未选中节点不参与、也不被移动', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    const b = addPrompt(store, 400, 300)
    const bystander = addPrompt(store, 2000, 2000)
    store.setSelection([a, b])
    tools(store).arrange()
    expect(posOf(store, bystander)).toEqual({ x: 2000, y: 2000 })
  })
})

describe('useAlignTools / arrangeMode（§6.5 ④）', () => {
  it('少于 2 个选中时拒绝并给出原因', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    store.setSelection([a])
    expect(tools(store).arrangeMode('grid')).toMatchObject({ kind: 'too-few', moved: 0 })
  })

  it('水平排列：全部落到同一 y', () => {
    const store = makeStore()
    const ids = [addPrompt(store, 0, 0), addPrompt(store, 500, 200), addPrompt(store, 100, 400)]
    store.setSelection(ids)
    tools(store).arrangeMode('row')
    const ys = ids.map((id) => posOf(store, id).y)
    expect(new Set(ys).size).toBe(1)
  })

  it('垂直排列：全部落到同一 x', () => {
    const store = makeStore()
    const ids = [addPrompt(store, 0, 0), addPrompt(store, 500, 200), addPrompt(store, 100, 400)]
    store.setSelection(ids)
    tools(store).arrangeMode('column')
    const xs = ids.map((id) => posOf(store, id).x)
    expect(new Set(xs).size).toBe(1)
  })

  it('未选中节点不参与排列', () => {
    const store = makeStore()
    const a = addPrompt(store, 0, 0)
    const b = addPrompt(store, 500, 200)
    const bystander = addPrompt(store, 3000, 3000)
    store.setSelection([a, b])
    tools(store).arrangeMode('row')
    expect(posOf(store, bystander)).toEqual({ x: 3000, y: 3000 })
  })

  /**
   * ★ 回归：一次排列必须能**一次撤销**完整退回。
   *
   * 各节点位移量不同，曾被按位移量拆成多次 `node.move` 下发；而每条命令自带的事务
   * key 由 id 集合派生（不同 ⇒ 各自开一个撤销单元），于是「按一次撤销只退回一部分」。
   * 修法是让本次操作的所有位移共用同一个 multi-step planId。
   */
  it('★ 一次撤销完整退回（不能被拆成多步撤销）', () => {
    const store = makeStore()
    const ids = [
      addPrompt(store, 0, 0),
      addPrompt(store, 400, 0),
      addPrompt(store, 0, 400),
      addPrompt(store, 400, 400),
    ]
    store.setSelection(ids)
    const before = ids.map((id) => posOf(store, id))

    tools(store).arrangeMode('grid')
    expect(ids.map((id) => posOf(store, id))).not.toEqual(before)

    store.undo()
    expect(ids.map((id) => posOf(store, id))).toEqual(before)
  })

  it('★ 对齐也是一次撤销退回（同一事务边界修复覆盖对齐）', () => {
    const store = makeStore()
    const ids = [addPrompt(store, 0, 0), addPrompt(store, 400, 250), addPrompt(store, 800, 600)]
    store.setSelection(ids)
    const before = ids.map((id) => posOf(store, id))
    tools(store).align('left')
    expect(ids.map((id) => posOf(store, id))).not.toEqual(before)
    store.undo()
    expect(ids.map((id) => posOf(store, id))).toEqual(before)
  })
})
