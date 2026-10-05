import { describe, expect, it } from 'vitest'
import { flowViewportToStore, storeViewportToFlow } from './viewportBridge'

/**
 * 钉住「轻画 ⇄ React Flow 视口换算」这条不变量。
 *
 * 为什么要有这个单测：两边字段同名不同义，写错不会报错、只会让节点悄悄算错位置
 * （实测症状是「新建的节点落在视野外」）。所以这里既测**往返一致**，
 * 也测**具体数值**——只测往返的话，把公式整体写反（都乘 -1）也照样通过。
 */
describe('视口语义换算', () => {
  it('轻画 → React Flow：世界坐标语义换成屏幕像素语义', () => {
    // 视口左上角对着世界 (408,330)、100% 缩放 ⇒ React Flow 要把世界原点推到屏幕 (-408,-330)
    expect(storeViewportToFlow({ x: 408, y: 330, zoom: 1 })).toEqual({ x: -408, y: -330, zoom: 1 })
  })

  it('缩放参与换算（世界坐标 × zoom = 屏幕像素）', () => {
    expect(storeViewportToFlow({ x: 100, y: 50, zoom: 0.5 })).toEqual({ x: -50, y: -25, zoom: 0.5 })
  })

  it('React Flow → 轻画：屏幕像素语义换回世界坐标语义', () => {
    expect(flowViewportToStore({ x: -408, y: -330, zoom: 1 })).toEqual({ x: 408, y: 330, zoom: 1 })
    expect(flowViewportToStore({ x: -50, y: -25, zoom: 0.5 })).toEqual({ x: 100, y: 50, zoom: 0.5 })
  })

  it('往返一致（两组非平凡数值）', () => {
    for (const vp of [
      { x: 408, y: 330, zoom: 1 },
      { x: -123.5, y: 77, zoom: 2.4 },
      { x: 0, y: 0, zoom: 0.1 },
    ]) {
      const roundTrip = flowViewportToStore(storeViewportToFlow(vp))
      expect(roundTrip.x).toBeCloseTo(vp.x, 6)
      expect(roundTrip.y).toBeCloseTo(vp.y, 6)
      expect(roundTrip.zoom).toBeCloseTo(vp.zoom, 6)
    }
  })

  it('zoom 为 0（异常输入）时不产生 NaN/Infinity', () => {
    const out = flowViewportToStore({ x: 10, y: 20, zoom: 0 })
    expect(Number.isFinite(out.x)).toBe(true)
    expect(Number.isFinite(out.y)).toBe(true)
    expect(out.zoom).toBe(1)
  })
})
