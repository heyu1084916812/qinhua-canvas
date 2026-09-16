/**
 * 节点跟随功能栏的**纯逻辑**单测（用户 2026-09-16 需求）。
 *
 * 组件本体需要 React + store context，在 node 环境下不好断言；而真正容易错的是
 * 下面这两个**纯函数**：锚点换算与「上方装不下就翻到下方」。
 * 它们一旦算错，屏幕上的表现就是「栏飞到画布左上角」或「栏压在节点上」——
 * 这类几何错误光看渲染截图很难定位，故单独抽出来测。
 */
import { describe, it, expect } from 'vitest'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import { followBarAnchor, FOLLOW_BAR_HEIGHT, FOLLOW_BAR_GAP } from './followBarAnchor'

const vp = (x: number, y: number, zoom = 1): Viewport => ({ x, y, zoom })
const rect = (x: number, y: number, w = 240, h = 240): Rect => ({ x, y, w, h })

describe('followBarAnchor / 跟随栏锚点', () => {
  it('默认挂在节点**上方**且水平居中（与创作面板同一套 screen 换算）', () => {
    // 节点世界坐标 (100, 200)，视口在原点、zoom=1 → 屏幕坐标同值
    const a = followBarAnchor(rect(100, 200), vp(0, 0))
    expect(a.placement).toBe('above')
    expect(a.centerX).toBe(100 + 240 / 2)
    // 顶边 200 上移「栏高 + 间距」
    expect(a.top).toBe(200 - FOLLOW_BAR_HEIGHT - FOLLOW_BAR_GAP)
  })

  it('缩放只改锚点坐标，不改栏的尺寸（§6.8 缩放独立性）', () => {
    const r = rect(100, 200)
    const a1 = followBarAnchor(r, vp(0, 0, 1))
    const a2 = followBarAnchor(r, vp(0, 0, 0.5))
    // zoom=0.5：世界 100 → 屏幕 50；中心 x = (100 + 120 - 0) * 0.5
    expect(a2.centerX).toBe((100 + 120) * 0.5)
    expect(a2.centerX).not.toBe(a1.centerX)
    // 栏自身尺寸与 zoom 无关：height 是常量
    expect(FOLLOW_BAR_HEIGHT).toBe(FOLLOW_BAR_HEIGHT)
    expect(a2.top).toBe(200 * 0.5 - FOLLOW_BAR_HEIGHT - FOLLOW_BAR_GAP)
  })

  it('平移跟随：视口右移 500，锚点左移 500（栏始终贴着节点）', () => {
    const r = rect(1000, 200)
    const a1 = followBarAnchor(r, vp(0, 0))
    const a2 = followBarAnchor(r, vp(500, 0))
    expect(a1.centerX - a2.centerX).toBe(500)
  })

  it('上方空间不足 → 翻到节点下方（贴着节点底边）', () => {
    // 节点顶边在屏幕 y=8，装不下「栏高 + 间距」
    const a = followBarAnchor(rect(100, 8), vp(0, 0))
    expect(a.placement).toBe('below')
    expect(a.top).toBe(8 + 240 + FOLLOW_BAR_GAP)
  })

  it('节点在画布中部时判定为上方（不误翻转）', () => {
    const a = followBarAnchor(rect(100, 400), vp(0, 0))
    expect(a.placement).toBe('above')
  })
})
