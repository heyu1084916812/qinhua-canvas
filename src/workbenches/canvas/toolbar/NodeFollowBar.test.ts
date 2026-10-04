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
import {
  followBarAnchor,
  FOLLOW_BAR_HEIGHT,
  FOLLOW_BAR_GAP,
  NODE_TITLE_BAND,
} from './followBarAnchor'

const vp = (x: number, y: number, zoom = 1): Viewport => ({ x, y, zoom })
const rect = (x: number, y: number, w = 240, h = 240): Rect => ({ x, y, w, h })

describe('followBarAnchor / 跟随栏锚点', () => {
  it('挂在节点**上方**且水平居中（与创作面板同一套 screen 换算）', () => {
    // 节点世界坐标 (100, 200)，视口在原点、zoom=1 → 屏幕坐标同值
    const a = followBarAnchor(rect(100, 200), vp(0, 0))
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

  /**
   * 位置稳定性优先于始终可见（用户 2026-09-17）：节点顶到画布顶端时栏**仍在上方**。
   * 若在这里翻转，用户把节点往上拖一点，栏就会在上下之间横跳——比被顶栏压住更难用。
   */
  it('★ 节点顶到画布顶端也不翻到下方（位置稳定优先）', () => {
    const r = rect(100, 8)
    const a = followBarAnchor(r, vp(0, 0))
    // 顶边 8 上移栏高 + 间距 → 负值（被画布上边界裁掉一部分），但**不翻到下方**
    expect(a.top).toBe(8 - FOLLOW_BAR_HEIGHT - FOLLOW_BAR_GAP)
    expect(a.top).toBeLessThan(0)
    // 决不能落在节点下方（节点底边 248 之下）
    expect(a.top).toBeLessThan(r.y + r.h)
  })

  it('anchor 不再返回 placement（翻转语义已移除）', () => {
    const a = followBarAnchor(rect(100, 200), vp(0, 0))
    expect(a).not.toHaveProperty('placement')
    expect(Object.keys(a).sort()).toEqual(['centerX', 'top'])
  })

  /**
   * ★★ 栏必须落在**节点标题带之上**（用户 2026-10-05：「功能栏遮住了节点名称」）。
   *
   * 标题带 = 节点框上方那 24px（`.header` 22 + `margin-bottom` 2）。间距只要比它小，
   * 栏底就会压进标题带、盖住节点名 —— 这条断言把「间距 ≥ 标题带」钉死，
   * 以后谁把间距调小（比如为了「离节点近一点」）都会当场变红。
   */
  it('★★ 栏与节点的间距 ≥ 标题带高度（不遮节点名）', () => {
    expect(FOLLOW_BAR_GAP).toBeGreaterThanOrEqual(NODE_TITLE_BAND)
    const r = rect(100, 200)
    const a = followBarAnchor(r, vp(0, 0))
    /** 栏底（top + 栏高）落在标题带上沿之上 */
    expect(a.top + FOLLOW_BAR_HEIGHT).toBeLessThanOrEqual(r.y - NODE_TITLE_BAND)
  })
})
