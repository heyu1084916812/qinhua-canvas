import { describe, it, expect, beforeEach } from 'vitest'
import { createCanvasStore } from './store'
import { createMemoryPlatform } from '../../../platform/memory'
import { registerAllSpecs, resetSpecs } from '../../../domain/canvas/nodeSpecs'
import type { PlatformKit } from '../../../platform/ports'

let platform: PlatformKit

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
  platform = createMemoryPlatform()
})

describe('canvas store / 基本变更', () => {
  it('dispatch node.create 后快照含节点，且能落库', async () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    const r = store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
    expect(store.getSnapshot().nodes).toHaveLength(1)
    expect(r.persist.tables).toContain('nodes')

    await store.flush()
    const rows = await platform.storage.query('nodes', {})
    expect(rows).toHaveLength(1)
  })
})

describe('canvas store / 撤销与重做', () => {
  it('move 后 undo 回到原位，redo 再前进', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
    const id = store.getSnapshot().nodes[0]!.id
    store.dispatch({ kind: 'node.move', ids: [id], dx: 10, dy: 0, phase: 'move' })
    expect(store.getSnapshot().nodes[0]!.x).toBe(10)

    store.undo()
    expect(store.getSnapshot().nodes[0]!.x).toBe(0)
    expect(store.canRedo()).toBe(true)

    store.redo()
    expect(store.getSnapshot().nodes[0]!.x).toBe(10)
    expect(store.canUndo()).toBe(true)
  })
})

describe('canvas store / 撤销条（§6.12）', () => {
  it('showUndoBar 设置、getUndoBar 读取、clearUndoBar 清空', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    expect(store.getUndoBar()).toBeNull()

    store.showUndoBar('已删除节点')
    const bar = store.getUndoBar()
    expect(bar).not.toBeNull()
    expect(bar!.text).toBe('已删除节点')

    // clearUndoBar 带过期 id 不误关当前条
    store.clearUndoBar('other-id')
    expect(store.getUndoBar()).not.toBeNull()

    store.clearUndoBar(bar!.id)
    expect(store.getUndoBar()).toBeNull()
  })

  it('撤销条不进撤销栈、不落库', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
    const before = store.canUndo()
    store.showUndoBar('已删除节点')
    expect(store.canUndo()).toBe(before)
  })

  it('连续 move（同节点）合并为一个撤销步骤', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
    const id = store.getSnapshot().nodes[0]!.id
    store.dispatch({ kind: 'node.move', ids: [id], dx: 5, dy: 0, phase: 'move' })
    store.dispatch({ kind: 'node.move', ids: [id], dx: 5, dy: 0, phase: 'move' })
    expect(store.getSnapshot().nodes[0]!.x).toBe(10)
    expect(store.canUndo()).toBe(true)

    // 一次 undo 撤销整段合并后的移动（两步都在一个撤销条目里）
    store.undo()
    expect(store.getSnapshot().nodes[0]!.x).toBe(0)
    // 再 undo 才撤销 node.create 本身
    store.undo()
    expect(store.getSnapshot().nodes).toHaveLength(0)
    expect(store.canUndo()).toBe(false)
  })

  it('不同命令各自成撤销步骤', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
    const id = store.getSnapshot().nodes[0]!.id
    store.dispatch({ kind: 'node.move', ids: [id], dx: 10, dy: 0, phase: 'move' })
    store.dispatch({ kind: 'node.rename', id, title: '改名' })

    store.undo()
    expect(store.getSnapshot().nodes[0]!.title).toBe('提示词') // 撤销改名
    store.undo()
    expect(store.getSnapshot().nodes[0]!.x).toBe(0) // 撤销移动
    store.undo()
    expect(store.getSnapshot().nodes).toHaveLength(0) // 撤销创建
  })
})

/**
 * 陈旧标记已下线（用户 2026-09-17），原先「stale.mark 不进撤销栈」那组随之删除。
 *
 * 保留下来的、仍然要守的那条是：**产物写回不进撤销栈**——
 * Ctrl+Z 不该把已生成的图从节点上抹掉。它由 `node.updateData` 的 `transient: true`
 * 表达（见 execution.test 的对应用例），这里不再重复。
 */

describe('canvas store / 瞬态状态', () => {
  it('选中与视口走独立 API，不进 dispatch / undo / 持久化', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    store.setSelection(['a', 'b'])
    expect(store.getSelection()).toEqual(['a', 'b'])
    store.setViewport({ zoom: 2 })
    expect(store.getViewport().zoom).toBe(2)
    expect(store.canUndo()).toBe(false)

    let fired = 0
    const unsub = store.subscribe(() => {
      fired += 1
    })
    store.setSelection(['c'])
    expect(fired).toBe(1)
    unsub()
  })

  it('节点选择与连线选择互斥（§6.14 / §6.15）', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    store.setEdgeSelection(['e1'])
    expect(store.getEdgeSelection()).toEqual(['e1'])
    expect(store.getSelection()).toEqual([])

    // 选节点清空连线选择
    store.setSelection(['n1'])
    expect(store.getSelection()).toEqual(['n1'])
    expect(store.getEdgeSelection()).toEqual([])

    // 选连线清空节点选择
    store.setEdgeSelection(['e2'])
    expect(store.getEdgeSelection()).toEqual(['e2'])
    expect(store.getSelection()).toEqual([])

    // 清空
    store.setSelection([])
    expect(store.getSelection()).toEqual([])
    expect(store.getEdgeSelection()).toEqual([])
  })

  it('连线选择不进撤销栈', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    store.setEdgeSelection(['e1'])
    expect(store.canUndo()).toBe(false)
  })
})

describe('canvas store / 素材灯箱（§6.17）', () => {
  it('开合是瞬时态：不进撤销栈、不落库', async () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    expect(store.getLightbox()).toBeNull()

    store.openLightbox('hash-1')
    expect(store.getLightbox()).toEqual({ assetHash: 'hash-1' })
    // 看图不是「改图」：不该在撤销栈里占一步
    expect(store.canUndo()).toBe(false)

    await store.flush()
    expect(await platform.storage.query('nodes', {})).toHaveLength(0)

    store.closeLightbox()
    expect(store.getLightbox()).toBeNull()
  })

  it('打开灯箱顺手关掉右键菜单（两个浮层不并存）', () => {
    const store = createCanvasStore({ platform, projectId: 'p1' })
    store.setMenu(10, 20, { kind: 'canvas' })
    store.openLightbox('hash-1')
    expect(store.getMenu()).toBeNull()
    expect(store.getLightbox()).toEqual({ assetHash: 'hash-1' })
  })
})

describe('canvas store / 素材插队落库（上传即显）', () => {
  /**
   * 反回归：素材若跟着 800ms 防抖走，节点拿到 hash 后 UI 会有固定空窗
   * （上传完先看到空白节点；连传时还会被主线程阻塞推得更久）。
   * 这里断言「dispatch 返回后不用等 flush、也不用等 800ms 就能查到字节」。
   */
  it('asset.put 立即落库：不调 flush、不等待防抖也能查到', async () => {
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 800 })
    store.dispatch({
      kind: 'asset.put',
      asset: { hash: 'h-fast', mime: 'image/png', bytes: Uint8Array.from([1, 2, 3]) },
    })
    // 不调 flush，只让宏任务跑一轮（10ms ≪ 800ms 防抖窗口）：
    // 若素材没插队，此时 assets 表还是空的
    await new Promise((r) => setTimeout(r, 10))
    const rows = await platform.storage.query('assets', { id: 'h-fast' })
    expect(rows).toHaveLength(1)
    expect((rows[0] as unknown as { hash: string }).hash).toBe('h-fast')
  })

  it('对比：node.create 仍然走防抖（不插队），避免每次指针移动都落库', async () => {
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 50 })
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
    // 同步查：还没到防抖窗口，应当查不到
    expect(await platform.storage.query('nodes', {})).toHaveLength(0)
    await store.flush()
    expect(await platform.storage.query('nodes', {})).toHaveLength(1)
  })

  it('素材插队会顺带把此前 pending 的改动一起带走（不丢写）', async () => {
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 800 })
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
    store.dispatch({
      kind: 'asset.put',
      asset: { hash: 'h-mix', mime: 'image/png', bytes: Uint8Array.from([9]) },
    })
    await store.flush()
    // 节点是被素材「顺路」带走的：若插队只写 assets，这里会是 0
    expect(await platform.storage.query('nodes', {})).toHaveLength(1)
    expect(await platform.storage.query('assets', {})).toHaveLength(1)
  })

  it('连续多次素材写入串行落库，最终状态完整', async () => {
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 800 })
    for (const h of ['h1', 'h2', 'h3']) {
      store.dispatch({ kind: 'asset.put', asset: { hash: h, mime: 'image/png', bytes: Uint8Array.from([1]) } })
    }
    await store.flush()
    const rows = await platform.storage.query('assets', {})
    expect(rows).toHaveLength(3)
  })
})
