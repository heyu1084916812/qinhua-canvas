import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createStore } from '../../createStore'
import { createMemoryPlatform } from '../../../platform/memory'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import type { CanvasStore } from './store'
import type { PromptData } from '../../../domain/canvas/model/node'

/**
 * 提示词节点全链路（M0-5 结构验证点）：以 prompt 一个纵向切片穿过
 * domain(spec) → state(命令 / 撤销 / 持久化) → 上层可消费。
 * 纯 node 环境，不渲染 React。
 */
let store: CanvasStore

beforeEach(async () => {
  registerAllSpecs()
  const platform = createMemoryPlatform()
  await platform.storage.open()
  store = createStore({ workbench: 'canvas', platform, projectId: 'p1' }) as CanvasStore
})

afterEach(() => {
  store.dispose()
})

describe('提示词节点全链路', () => {
  it('node.create 用 spec 默认数据建节点，尺寸取 min，标题取 spec.label', () => {
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 100, y: 80 } })
    const nodes = store.getSnapshot().nodes
    expect(nodes).toHaveLength(1)
    const n = nodes[0]!
    expect(n.type).toBe('prompt')
    expect(n.title).toBe('提示词')
    expect(n.x).toBe(100)
    expect(n.y).toBe(80)
    expect(n.w).toBe(240)
    expect(n.h).toBe(160)
    expect((n.data as PromptData).text).toBe('')
    expect(store.canUndo()).toBe(true)
  })

  it('node.move 按增量平移（coalesce）；node.rename / updateData 改属性', () => {
    const nodeId = (
      store.dispatch({
        kind: 'node.create',
        projectId: 'p1',
        type: 'prompt',
        at: { x: 0, y: 0 },
      }).patches[0] as unknown as { row: { id: string } }
    ).row.id

    store.dispatch({ kind: 'node.move', ids: [nodeId], dx: 50, dy: 20, phase: 'end' })
    store.dispatch({ kind: 'node.rename', id: nodeId, title: '主提示词' })
    store.dispatch({ kind: 'node.updateData', id: nodeId, patch: { text: '一只猫' } })

    const n = store.getSnapshot().nodes.find((x) => x.id === nodeId)!
    expect(n.x).toBe(50)
    expect(n.y).toBe(20)
    expect(n.title).toBe('主提示词')
    expect((n.data as PromptData).text).toBe('一只猫')
  })

  it('undo / redo 可逆：回到建节点前的空图', () => {
    store.dispatch({ kind: 'node.create', projectId: 'p1', type: 'prompt', at: { x: 0, y: 0 } })
    expect(store.getSnapshot().nodes).toHaveLength(1)
    store.undo()
    expect(store.getSnapshot().nodes).toHaveLength(0)
    expect(store.canUndo()).toBe(false)
    store.redo()
    expect(store.getSnapshot().nodes).toHaveLength(1)
  })

  it('undo 按事务边界回退：coalesce 的多次 move 合成一步', () => {
    const nodeId = (
      store.dispatch({
        kind: 'node.create',
        projectId: 'p1',
        type: 'prompt',
        at: { x: 0, y: 0 },
      }).patches[0] as unknown as { row: { id: string } }
    ).row.id

    store.dispatch({ kind: 'node.move', ids: [nodeId], dx: 10, dy: 0, phase: 'begin' })
    store.dispatch({ kind: 'node.move', ids: [nodeId], dx: 10, dy: 0, phase: 'move' })
    store.dispatch({ kind: 'node.move', ids: [nodeId], dx: 10, dy: 0, phase: 'end' })
    expect(store.getSnapshot().nodes.find((n) => n.id === nodeId)!.x).toBe(30)

    store.undo()
    // 一次 undo 回退整段拖动
    expect(store.getSnapshot().nodes.find((n) => n.id === nodeId)!.x).toBe(0)
  })
})
