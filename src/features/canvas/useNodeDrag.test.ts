import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createNodeDragController } from './useNodeDrag'
import { createCanvasStore } from '../../state/workbenches/canvas/store'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { PlatformKit } from '../../platform/ports'
import { resetSpecs, registerSpec } from '../../domain/canvas/nodeSpecs/registry'
import { promptSpec } from '../../domain/canvas/nodeSpecs/prompt'
import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import { groupSpec } from '../../domain/canvas/nodeSpecs/group'

/** 内存平台：拖动控制器只用到 storage 的调度接口，这里给最小实现 */
const platform = {
  storage: { transaction: async () => {}, bulkPut: async () => {}, delete: async () => {} },
} as unknown as PlatformKit

function makeStore(): CanvasStore {
  return createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
}

/** prompt(a) → generation(b) */
function seedChain(store: CanvasStore) {
  const a = store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
  const b = store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 300, y: 0 } })
  const aId = (a.patches[0] as { row: { id: string } }).row.id
  const bId = (b.patches[0] as { row: { id: string } }).row.id
  store.dispatch({ kind: 'edge.connect', source: aId, target: bId })
  return { aId, bId }
}

/**
 * 最小 window 事件桩：项目测试环境是 node（无 jsdom），
 * 而拖动控制器通过 window 监听 pointermove / pointerup。
 * 只为驱动事件，不做 DOM 模拟 —— 不因此引入 jsdom 依赖。
 */
interface Listener {
  (ev: { type: string; clientX: number; clientY: number }): void
}
class MiniWindow {
  private map = new Map<string, Set<Listener>>()
  addEventListener(type: string, fn: Listener) {
    const set = this.map.get(type) ?? new Set<Listener>()
    set.add(fn)
    this.map.set(type, set)
  }
  removeEventListener(type: string, fn: Listener) {
    this.map.get(type)?.delete(fn)
  }
  dispatchEvent(ev: { type: string; clientX: number; clientY: number }) {
    for (const fn of this.map.get(ev.type) ?? []) fn(ev)
    return true
  }
  clear() {
    this.map.clear()
  }
}
const miniWindow = new MiniWindow()
// node 环境无 window，这里挂一个最小实现供控制器注册监听（测试结束即摘除）
const globalWindow = globalThis as unknown as { window?: MiniWindow }
beforeEach(() => {
  globalWindow.window = miniWindow
})
afterEach(() => {
  miniWindow.clear()
  delete globalWindow.window
})

/** 派发一次指针事件（node 环境没有 MouseEvent 构造器） */
function pointer(type: 'pointermove' | 'pointerup', x: number, y: number) {
  miniWindow.dispatchEvent({ type, clientX: x, clientY: y })
}

/** 驱动一次完整拖拽：按下 → 移动 → 松手 */
function dragBy(
  drag: ReturnType<typeof createNodeDragController>,
  from: number,
  to: number,
  nodeId: string,
  alt = false,
) {
  drag.begin({ clientX: 0, clientY: 0, altKey: alt, stopPropagation: () => {} }, nodeId)
  pointer('pointermove', from, to)
  pointer('pointerup', from, to)
}

beforeEach(() => {
  resetSpecs()
  registerSpec(promptSpec)
  registerSpec(generationSpec)
  registerSpec(groupSpec)
})

describe('拖动目标集合判定', () => {
  it('单选时只拖自己', () => {
    const store = makeStore()
    const { aId, bId } = seedChain(store)
    store.setSelection([aId])
    const drag = createNodeDragController(store)
    expect(drag.resolveDragIds(aId)).toEqual([aId])
    expect(drag.resolveDragIds(bId)).toEqual([bId])
  })

  it('多选内已选中的节点 → 整组一起拖', () => {
    const store = makeStore()
    const { aId, bId } = seedChain(store)
    store.setSelection([aId, bId])
    const drag = createNodeDragController(store)
    expect(drag.resolveDragIds(aId)).toEqual([aId, bId])
    expect(drag.resolveDragIds(bId)).toEqual([aId, bId])
  })

  it('单选集合（长度 1）里包含自己也只拖自己', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.setSelection([aId])
    expect(createNodeDragController(store).resolveDragIds(aId)).toEqual([aId])
  })

  /**
   * 原用例测的是**结果组**子节点（组已下线）。
   *
   * 那条规则的判据其实是「父级 id 不在 nodes 表里」——结果组正是这种悬空父级。
   * 组删掉后，parentId 只剩**真节点**一种，于是行为也随之改变，用例必须跟着改，
   * 否则就是在断言一个已不存在的语义（实测会红）。
   */
  it('容器子节点：父级是真节点 → 随多选一起拖（不是被剔除）', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'group', at: { x: 0, y: 0 }, id: 'g1' })
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 0, y: 0 }, id: 'c1', parentId: 'g1' })
    store.setSelection([aId, 'c1'])
    const drag = createNodeDragController(store)
    expect(drag.resolveDragIds(aId)).toEqual([aId, 'c1'])
  })

  /**
   * 「父级悬空」仍要剔除：那是数据损坏（父级被删而子节点还在）时的兜底——
   * 带着一个找不到父级的节点一起拖，落点换算会拿 undefined 当原点。
   */
  it('父级悬空的节点：整体拖动时被剔除（落点换算没有原点可用）', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    // 手写一个 parentId 指向不存在节点的子节点（模拟损坏数据）
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'generation', at: { x: 0, y: 0 }, id: 'c1' })
    const g = store.getSnapshot()
    store.hydrate({
      projectId: 'p1',
      nodes: g.nodes.map((n) => (n.id === 'c1' ? { ...n, parentId: 'ghost' } : n)),
      edges: g.edges,
    })
    store.setSelection([aId, 'c1'])
    const drag = createNodeDragController(store)
    expect(drag.resolveDragIds(aId)).toEqual([aId])
    // 按下它自己时也不带别人（悬空父级 = 只拖它）
    expect(drag.resolveDragIds('c1')).toEqual(['c1'])
  })
})

describe('拖动后面板保持隐藏（§6.15：拖过 → 藏到下一次显式选中）', () => {
  it('有位移的拖动：松手后 panelDismissed=true，重新选中后复位', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.setSelection([aId])
    const drag = createNodeDragController(store)
    expect(store.isPanelDismissed()).toBe(false)
    dragBy(drag, 40, 0, aId)
    expect(store.isDragging()).toBe(false)
    expect(store.isPanelDismissed()).toBe(true)
    // 下一次显式选中（哪怕还是同一个节点）= 用户重新指向，面板恢复可显示
    store.setSelection([aId])
    expect(store.isPanelDismissed()).toBe(false)
  })

  it('原地点击（无位移）：不算拖动，面板不收起', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.setSelection([aId])
    const drag = createNodeDragController(store)
    dragBy(drag, 0, 0, aId)
    expect(store.isDragging()).toBe(false)
    expect(store.isPanelDismissed()).toBe(false)
  })
})

describe('Alt 复制（§4.2「原地复制出新节点，保留上下游连线」）', () => {
  it('在原地生成副本并把选中切到副本', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.setSelection([aId])
    const copies = createNodeDragController(store).duplicateForDrag([aId])

    expect(copies).toHaveLength(1)
    expect(copies[0]).not.toBe(aId)
    expect(store.getSelection()).toEqual(copies)
    const copy = store.getSnapshot().nodes.find((n) => n.id === copies[0])!
    const origin = store.getSnapshot().nodes.find((n) => n.id === aId)!
    expect(copy.x).toBe(origin.x)
    expect(copy.y).toBe(origin.y)
    expect(copy.w).toBe(origin.w)
    expect(copy.type).toBe(origin.type)
  })

  it('副本接上原节点的上下游（rewire）', () => {
    const store = makeStore()
    const { aId, bId } = seedChain(store)
    const [copyId] = createNodeDragController(store).duplicateForDrag([aId])
    const edges = store.getSnapshot().edges
    expect(edges.some((e) => e.source === copyId && e.target === bId)).toBe(true)
    expect(edges.some((e) => e.source === aId && e.target === bId)).toBe(true)
  })

  it('副本数据独立（改副本不污染原节点）', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.dispatch({ kind: 'node.updateData', id: aId, patch: { text: '原文' } })
    const [copyId] = createNodeDragController(store).duplicateForDrag([aId])
    store.dispatch({ kind: 'node.updateData', id: copyId, patch: { text: '副本改了' } })
    const g = store.getSnapshot()
    expect((g.nodes.find((n) => n.id === aId)!.data as { text: string }).text).toBe('原文')
    expect((g.nodes.find((n) => n.id === copyId)!.data as { text: string }).text).toBe('副本改了')
  })

  it('多选 Alt 复制：整组复制且组内连线保留', () => {
    const store = makeStore()
    const { aId, bId } = seedChain(store)
    const copies = createNodeDragController(store).duplicateForDrag([aId, bId])
    const g = store.getSnapshot()
    expect(g.nodes).toHaveLength(4)
    expect(g.edges.some((e) => e.source === copies[0] && e.target === copies[1])).toBe(true)
  })

  it('复制不存在的节点时退化为原集合（不打断拖动）', () => {
    const store = makeStore()
    expect(createNodeDragController(store).duplicateForDrag(['ghost'])).toEqual(['ghost'])
  })

  it('Alt 拖动后移动的是副本，原节点留在原地', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.setSelection([aId])
    const drag = createNodeDragController(store)
    dragBy(drag, 40, 30, aId, true)
    const g = store.getSnapshot()
    const origin = g.nodes.find((n) => n.id === aId)!
    expect(origin.x).toBe(0)
    expect(origin.y).toBe(0)
    const copy = g.nodes.find((n) => n.id === store.getSelection()[0])!
    expect(copy.x).toBe(40)
    expect(copy.y).toBe(30)
  })
})

describe('拖动生命周期（§6.15）', () => {
  it('begin 置 dragging 为 true，松手复位（面板据此隐藏/恢复）', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.setSelection([aId])
    const drag = createNodeDragController(store)
    expect(store.isDragging()).toBe(false)

    drag.begin({ clientX: 0, clientY: 0, stopPropagation: () => {} }, aId)
    expect(store.isDragging()).toBe(true)

    pointer('pointermove', 10, 20)
    pointer('pointerup', 10, 20)
    expect(store.isDragging()).toBe(false)
  })

  it('位移按 zoom 折算回世界单位', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.setSelection([aId])
    store.setViewport({ zoom: 2 })
    dragBy(createNodeDragController(store), 20, 40, aId)
    const moved = store.getSnapshot().nodes.find((n) => n.id === aId)!
    expect(moved.x).toBe(10)
    expect(moved.y).toBe(20)
  })

  it('整组拖动：选区内所有节点一起位移，且选区不被打散', () => {
    const store = makeStore()
    const { aId, bId } = seedChain(store)
    store.setSelection([aId, bId])
    const before = new Map(store.getSnapshot().nodes.map((n) => [n.id, { x: n.x, y: n.y }]))

    dragBy(createNodeDragController(store), 30, 10, aId)

    for (const id of [aId, bId]) {
      const now = store.getSnapshot().nodes.find((n) => n.id === id)!
      expect(now.x).toBe(before.get(id)!.x + 30)
      expect(now.y).toBe(before.get(id)!.y + 10)
    }
    expect(store.getSelection()).toEqual([aId, bId])
  })

  it('一次拖动只占一步撤销（coalesce 合并成单个撤销单元）', () => {
    const store = makeStore()
    const { aId, bId } = seedChain(store)
    store.setSelection([aId, bId])

    const before = new Map(store.getSnapshot().nodes.map((n) => [n.id, { x: n.x, y: n.y }]))
    const drag = createNodeDragController(store)
    drag.begin({ clientX: 0, clientY: 0, stopPropagation: () => {} }, aId)
    pointer('pointermove', 5, 5)
    pointer('pointermove', 10, 10)
    pointer('pointerup', 10, 10)
    expect(store.getSnapshot().nodes.find((n) => n.id === aId)!.x).toBe(before.get(aId)!.x + 10)

    // 一次撤销即整段回退 → 证明 begin/move/end 被合并进同一个撤销单元
    store.undo()
    for (const id of [aId, bId]) {
      const back = store.getSnapshot().nodes.find((n) => n.id === id)!
      expect(back.x).toBe(before.get(id)!.x)
      expect(back.y).toBe(before.get(id)!.y)
    }
  })

  it('松手后清空 dragging，即使没有发生移动', () => {
    const store = makeStore()
    const { aId } = seedChain(store)
    store.setSelection([aId])
    const drag = createNodeDragController(store)
    drag.begin({ clientX: 0, clientY: 0, stopPropagation: () => {} }, aId)
    pointer('pointerup', 0, 0)
    expect(store.isDragging()).toBe(false)
  })
})

