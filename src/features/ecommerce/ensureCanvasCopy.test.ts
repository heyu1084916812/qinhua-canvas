import { describe, expect, it, vi } from 'vitest'
import { ensureEcommerceCanvasCopy } from './ensureCanvasCopy'
import type { EcommerceResultRecord } from '../../domain/ecommerce/tasks'

const result = (over: Partial<EcommerceResultRecord> = {}): EcommerceResultRecord => ({
  id: 'er1',
  taskId: 'et1',
  projectId: 'p1',
  nodeId: 'internal',
  position: 0,
  createdAt: 1,
  updatedAt: 1,
  status: 'done',
  assetHash: 'h1',
  width: 1024,
  height: 1536,
  prompt: '产品主图',
  model: 'gpt-image',
  ...over,
})

function fakeStore(nodes: Record<string, unknown>[]) {
  const dispatch = vi.fn()
  const beginPlan = vi.fn()
  const endPlan = vi.fn()
  const setSelection = vi.fn()
  return {
    dispatch,
    beginPlan,
    endPlan,
    setSelection,
    store: {
      getSnapshot: () => ({ nodes, edges: [] }),
      dispatch,
      beginPlan,
      endPlan,
      setSelection,
    } as never,
  }
}

describe('电商结果复制到画布', () => {
  it('已有副本且节点还在 ⇒ 直接复用，不再复制', () => {
    const f = fakeStore([{ id: 'copy', x: 0, y: 0, w: 200, h: 200 }])
    const out = ensureEcommerceCanvasCopy({
      store: f.store,
      projectId: 'p1',
      result: result({ canvasCopyNodeId: 'copy' }),
      title: '电商副本',
    })
    expect(out).toEqual({ nodeId: 'copy', created: false })
    expect(f.dispatch).not.toHaveBeenCalled()
  })

  it('内部执行节点还在 ⇒ 复制它、改名并清掉电商批次标记', () => {
    const source = { id: 'internal', x: 10, y: 20, w: 200, h: 200, data: { assetHash: 'h1' } }
    const f = fakeStore([source])
    const out = ensureEcommerceCanvasCopy({
      store: f.store,
      projectId: 'p1',
      result: result(),
      title: '电商副本',
    })
    expect(out.created).toBe(true)
    expect(f.beginPlan).toHaveBeenCalledWith('ecommerce:canvas-copy', '复制电商结果到画布')
    expect(f.dispatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        kind: 'node.duplicate',
        ids: ['internal'],
        newIds: [out.nodeId],
      }),
    )
    expect(f.dispatch).toHaveBeenNthCalledWith(2, {
      kind: 'node.rename',
      id: out.nodeId,
      title: '电商副本',
    })
    expect(f.dispatch).toHaveBeenNthCalledWith(3, {
      kind: 'node.updateData',
      id: out.nodeId,
      patch: {
        ecommerceBatch: null,
        naturalSize: { width: 1024, height: 1536 },
      },
      size: { w: 240, h: 360 },
    })
    expect(f.setSelection).toHaveBeenCalledWith([out.nodeId])
    expect(f.endPlan).toHaveBeenCalled()
  })

  it('内部节点已被删 ⇒ 从结果行重建一个可编辑生成节点', () => {
    const f = fakeStore([{ id: 'other', x: 0, y: 0, w: 300, h: 200 }])
    const out = ensureEcommerceCanvasCopy({
      store: f.store,
      projectId: 'p1',
      result: result(),
      title: '电商副本',
    })
    expect(f.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'node.create',
        projectId: 'p1',
        type: 'generation',
        id: out.nodeId,
        title: '电商副本',
        data: expect.objectContaining({
          mode: 'image',
          assetHash: 'h1',
          prompt: '产品主图',
          model: 'gpt-image',
          naturalSize: { width: 1024, height: 1536 },
        }),
      }),
    )
  })
})
