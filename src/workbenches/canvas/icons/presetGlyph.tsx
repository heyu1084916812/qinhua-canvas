import type { ReactNode } from 'react'

/**
 * 「预设」那枚图标 —— **四个圆角方块，右上一个旋转 45°**（用户 2026-10-06 给的参考图）。
 *
 * ## 为什么单独一个文件、还导出两种形态
 *
 * 这枚图形有两处用它的地方，而它们**渲染方式不同**：
 *  1. 创作面板右下角那颗按钮（React，`toolbar/icons.tsx` 的 `IconPreset`）；
 *  2. 正文里那枚预设 chip —— 它是 `MentionEditor` **命令式建的 DOM**（`makeChip`），
 *     只能吃「一段 SVG 源码字符串」，塞不进 React 元素。
 *
 * 之前是**各写一份**（图标集里一份 JSX、编辑器里一份字符串），形状一改就得记得改两处 ——
 * 而这次恰恰就是**形状本身**要改（用户：「图标需要重新画一个，里面四个部件太挤」）。
 * 所以几何只在这里定义一次，两种形态都由它生成：
 *  - `PresetGlyphShapes()` → React 片段；
 *  - `presetGlyphSvg()`    → 完整 `<svg>` 字符串（含外框属性，与 `IconPreset` 同口径）。
 *  有一条单测专门钉「两者逐字一致」（`presetGlyph.test.ts`）。
 *
 * ## 形状口径（对着参考图量的，不是随手画的）
 *
 * 参考图里：四个圆角方块两行两列，**右上那枚旋转 45°**（菱形）且略大、位置更靠上；
 * 描边厚度约为方块边长的 1/6；整体**占满画布**（这正是它显得比上一版大的原因 ——
 * 上一版四个部件挤在 viewBox 的 5.4~18.4 之间，只占中间一半，缩到 18px 就成了一小撮）。
 */
const STROKE_WIDTH = 1.3

interface Shape {
  /** **中心**坐标（不是左上角）：描边以中心线为轴向两侧各摊半个线宽 */
  x: number
  y: number
  side: number
  /** 绕自己中心旋转的度数（只有右上那枚要 45°） */
  rotate?: number
}

/**
 * 四个方块（对着参考图量的，单位 = 24 画布）：
 * 左列两枚一样大、右列两枚略小；右上那枚转 45° 且**更靠右更靠上**
 * （参考图里它的角几乎顶到右边框，这也是整枚图标显得"铺开"的原因）。
 */
const SHAPES: readonly Shape[] = [
  { x: 7.4, y: 7.4, side: 6.7 },
  { x: 17.2, y: 7.7, side: 6.5, rotate: 45 },
  { x: 7.4, y: 17.1, side: 6.7 },
  { x: 16.9, y: 17.5, side: 6.4 },
]

/** 圆角半径（中心线）：参考图的外圆角约 1.7，减去半个描边 ⇒ 1.05 */
const CORNER_RADIUS = 1.05

/** 每个方块的左上角（由中心 + 边长推出来，避免手写四组数字时对不上） */
function box(s: Shape) {
  const half = s.side / 2
  return { x: round(s.x - half), y: round(s.y - half), side: s.side }
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function transformOf(s: Shape): string | undefined {
  return s.rotate ? `rotate(${s.rotate} ${s.x} ${s.y})` : undefined
}

/** React 形态：图标集里那枚 `IconPreset` 用它（外框属性由 `Svg` 统一给） */
export function PresetGlyphShapes(): ReactNode {
  return (
    <>
      {SHAPES.map((s, i) => {
        const b = box(s)
        return (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.side}
            height={b.side}
            rx={CORNER_RADIUS}
            transform={transformOf(s)}
          />
        )
      })}
    </>
  )
}

/**
 * 字符串形态：正文里那枚 chip 用它（`MentionEditor` 是命令式建 DOM）。
 *
 * 外框属性**必须与 `IconPreset` 渲染出来的那套一致**（`fill=none`、`stroke=currentColor`、
 * 同一线宽与圆头圆角）—— 否则同一个图形在按钮上和 chip 上会粗细不一。
 *
 * ⚠️ **不传 `size` 就不写 `width`/`height`**：chip 的图标尺寸由 CSS 给
 *（编辑器里是 `0.95em`，跟着正文字号走），写死属性会在字号小的地方（对话窗 13px）
 * 变成一块巨图 —— 与图标集里其它图标「尺寸交给调用方 / CSS」是同一口径。
 */
export function presetGlyphSvg(size?: number): string {
  const sizeAttrs = size ? ` width="${size}" height="${size}"` : ''
  return (
    `<svg${sizeAttrs} viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
    ` stroke-width="${STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"` +
    ` aria-hidden="true" focusable="false">${presetGlyphMarkup()}</svg>`
  )
}

/** 只有形状本身（不含外框）：单测拿它跟 React 形态逐个属性比对 */
export function presetGlyphMarkup(): string {
  return SHAPES.map((s) => {
    const b = box(s)
    const t = transformOf(s)
    return (
      `<rect x="${b.x}" y="${b.y}" width="${b.side}" height="${b.side}" rx="${CORNER_RADIUS}"` +
      (t ? ` transform="${t}"` : '') +
      '/>'
    )
  }).join('')
}

/** 线宽也导出：单测要拿它比对两种形态 */
export const PRESET_GLYPH_STROKE_WIDTH = STROKE_WIDTH
export const PRESET_GLYPH_SHAPES = SHAPES
