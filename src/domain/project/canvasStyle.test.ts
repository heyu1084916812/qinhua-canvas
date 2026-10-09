import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CANVAS_STYLE,
  canvasBackgroundLabel,
  canvasToneLabel,
  nodeDensityFactor,
  nodeDensityLabel,
  readCanvasStyle,
  withCanvasStyle,
} from './canvasStyle'

/**
 * 画布外观偏好（项目级，对账 #379 的 C 步）。
 *
 * 两条要钉死的口径：
 *  1. **默认 = 今天的观感**（点阵 / 石板 / 14 / 14 / 标准）——
 *     默认一变，所有人升级后打开老项目都会看到另一张画布；
 *  2. **单项坏值只回落它自己** —— 与界面偏好同一条容错口径，
 *     否则用户改一次背景色会连带看到字号跳回默认。
 */
describe('画布外观偏好（domain/project/canvasStyle）', () => {
  it('★ 默认 = 当前产品观感（不是设计稿里那个"细网格"）', () => {
    expect(DEFAULT_CANVAS_STYLE).toEqual({
      background: 'dots',
      tone: 'slate',
      titleSize: 14,
      bodySize: 14,
      density: 'standard',
    })
  })

  it('缺字段 / 脏数据 / 空对象都回全默认', () => {
    expect(readCanvasStyle(undefined)).toEqual(DEFAULT_CANVAS_STYLE)
    expect(readCanvasStyle(null)).toEqual(DEFAULT_CANVAS_STYLE)
    expect(readCanvasStyle('canvasStyle')).toEqual(DEFAULT_CANVAS_STYLE)
    expect(readCanvasStyle({})).toEqual(DEFAULT_CANVAS_STYLE)
    expect(readCanvasStyle({ canvasStyle: 'dots' })).toEqual(DEFAULT_CANVAS_STYLE)
  })

  it('★★ 单项坏值只回落它自己，不牵连其他项', () => {
    const parsed = readCanvasStyle({
      canvasStyle: {
        background: '格子', // 坏值 ⇒ 只这一项回落
        tone: 'violet', // 好值 ⇒ 保留
        titleSize: 99, // 不在白名单 ⇒ 只这一项回落
        bodySize: 18, // 好值 ⇒ 保留
        density: 'roomy', // 好值 ⇒ 保留
      },
    })
    expect(parsed.background).toBe(DEFAULT_CANVAS_STYLE.background)
    expect(parsed.titleSize).toBe(DEFAULT_CANVAS_STYLE.titleSize)
    expect(parsed.tone).toBe('violet')
    expect(parsed.bodySize).toBe(18)
    expect(parsed.density).toBe('roomy')
  })

  it('★ 写入不动原对象，也不吃掉 extra 里的其他键（封面标记）', () => {
    const extra = { cover: { hash: 'h1', at: 100 } }
    const next = withCanvasStyle(extra, { ...DEFAULT_CANVAS_STYLE, tone: 'blue' })
    // 原对象一个键没动
    expect(extra).toEqual({ cover: { hash: 'h1', at: 100 } })
    // 别的键还在
    expect(next.cover).toEqual({ hash: 'h1', at: 100 })
    // 往返一致
    expect(readCanvasStyle(next)).toEqual({ ...DEFAULT_CANVAS_STYLE, tone: 'blue' })
  })

  it('写入的对象与传入的 style 不是同一个引用（防止后续就地改把库里那份带跑）', () => {
    const style = { ...DEFAULT_CANVAS_STYLE, tone: 'amber' as const }
    const next = withCanvasStyle({}, style)
    expect(next.canvasStyle).not.toBe(style)
    expect(next.canvasStyle).toEqual(style)
  })

  it('档位文案与系数一一对应（标准必须是 1）', () => {
    expect(canvasBackgroundLabel('grid')).toBe('细网格')
    expect(canvasBackgroundLabel('dots')).toBe('点阵')
    expect(canvasBackgroundLabel('solid')).toBe('纯色')
    expect(canvasToneLabel('slate')).toBe('石板')
    expect(nodeDensityLabel('compact')).toBe('紧凑')
    expect(nodeDensityLabel('standard')).toBe('标准')
    expect(nodeDensityLabel('roomy')).toBe('宽敞')
    expect(nodeDensityFactor('standard')).toBe(1)
    expect(nodeDensityFactor('compact')).toBeLessThan(1)
    expect(nodeDensityFactor('roomy')).toBeGreaterThan(1)
  })
})
