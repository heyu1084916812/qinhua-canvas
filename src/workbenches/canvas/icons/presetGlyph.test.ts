import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IconPreset } from '../toolbar/icons'
import {
  PRESET_GLYPH_SHAPES,
  PRESET_GLYPH_STROKE_WIDTH,
  presetGlyphMarkup,
  presetGlyphSvg,
} from './presetGlyph'

/**
 * 「预设」图标（用户 2026-10-06 给的参考图：四个圆角方块、右上一个转 45°）。
 *
 * 这枚图形有**两种渲染形态**：面板按钮走 React（`IconPreset`），
 * 正文里的 chip 走 SVG 字符串（编辑器是命令式建 DOM）。两者必须逐字一致，
 * 否则同一个图形在按钮上与 chip 上会粗细不一 —— 而"改一处忘另一处"正是
 * 上一版的做法（各写一份路径）留下的隐患，所以这里把它钉住。
 */
describe('预设图标 · 单一来源', () => {
  /** 只取形状本身：React 的 SSR 会把自闭合标签写成 `<rect …></rect>`，逐字比字符串会假红 */
  const rectsOf = (markup: string): string[] =>
    [...markup.matchAll(/<rect([^>]*)>/g)].map((m) =>
      m[1].replace(/\s+/g, ' ').replace(/\s*\/$/, '').trim(),
    )

  it('★★ React 形态与 chip 字符串形态**逐个属性一致**（改一处忘另一处会被这条拦下）', () => {
    const react = renderToStaticMarkup(createElement(IconPreset, { size: 24 }))
    const chip = presetGlyphSvg()
    expect(rectsOf(react)).toEqual(rectsOf(chip))
    expect(rectsOf(react)).toHaveLength(4)
  })

  it('★★ 图形**铺满画布**：整枚图icon 的外接盒 ≥ 画布的 77%（上一版只占 61%，缩到 18px 就成了一小撮）', () => {
    const half = (s: (typeof PRESET_GLYPH_SHAPES)[number]) => s.side / 2 + PRESET_GLYPH_STROKE_WIDTH / 2
    const grow = (s: (typeof PRESET_GLYPH_SHAPES)[number]) => (s.rotate ? Math.SQRT2 : 1)
    const xs = PRESET_GLYPH_SHAPES.flatMap((s) => {
      const h = half(s) * grow(s)
      return [s.x - h, s.x + h]
    })
    const ys = PRESET_GLYPH_SHAPES.flatMap((s) => {
      const h = half(s) * grow(s)
      return [s.y - h, s.y + h]
    })
    const width = Math.max(...xs) - Math.min(...xs)
    const height = Math.max(...ys) - Math.min(...ys)
    expect(width / 24).toBeGreaterThan(0.77)
    expect(height / 24).toBeGreaterThan(0.77)
    // 上下左右都留一点边（贴边会被裁角）
    expect(Math.min(...xs)).toBeGreaterThan(1)
    expect(Math.max(...xs)).toBeLessThan(23)
    expect(Math.min(...ys)).toBeGreaterThan(1)
    expect(Math.max(...ys)).toBeLessThan(23)
  })

  it('★ 只有右上那枚转 45°（其余三枚都是正的）', () => {
    const markup = presetGlyphMarkup()
    expect((markup.match(/rotate\(45 /g) ?? []).length).toBe(1)
    const rotated = PRESET_GLYPH_SHAPES.filter((s) => s.rotate === 45)
    expect(rotated).toHaveLength(1)
    expect(rotated[0]!.x).toBeGreaterThan(12)
    expect(rotated[0]!.y).toBeLessThan(12)
  })

  it('★ 线宽两处同口径（都是 1.3：方块边长的约 1/5，与参考图一致）', () => {
    expect(presetGlyphSvg()).toContain(`stroke-width="${PRESET_GLYPH_STROKE_WIDTH}"`)
    expect(PRESET_GLYPH_STROKE_WIDTH).toBeCloseTo(1.3, 5)
  })

  it('★ chip 字符串**不写死宽高**（尺寸交给 CSS：字号小的地方别被撑成巨图）', () => {
    expect(presetGlyphSvg()).not.toContain('width="24"')
    expect(presetGlyphSvg(24)).toContain('width="24"')
  })
})
