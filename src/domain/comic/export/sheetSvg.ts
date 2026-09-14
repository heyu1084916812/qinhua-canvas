/**
 * 整套导出：**把一张图（页 / 跨页）画成自包含 SVG**（M6-8，纯函数）。
 *
 * 为什么是 SVG 而不是直接画 canvas：
 *   1. **纯**——产出是一个字符串，几何 / 折行 / 顺序都能单测，不必启动浏览器；
 *   2. **自包含**——底图以 `data:` URL 内联，字面量颜色写死，无外部引用，
 *      于是「SVG 字符串 → Image → canvas → PNG」这条链不会污染画布（taint）也能保证
 *      `canvas.toBlob` 可用；
 *   3. **一条渲染口径**——格子几何仍走 `layoutRects`，与编辑器 / 阅读器同源
 *      （「预览里看到的」就是「导出的」）。
 *
 * 与 `PageLayoutEditor` 的差异（有意为之）：
 *   - 不画**序号印章**（导出成品不需要编辑辅助）；
 *   - 对白贴纸**不透明**（编辑器里非选中格是半透明，那是交互态）。
 *
 * **页码（M6-11）**：默认不打——画面留给作品本身（页序本来就写在文件名里）；
 * 勾选后**在每页下方延伸一条页脚带**，页码落在带子里——
 * ① 不压画面（压在格子上会挡住内容，且投稿/印刷时不可接受）；
 * ② 跨页时两页各有一条，被中缝断开，视觉上像书的页脚。
 * 页码文本由调用方传入（`pageNumbers`），本文件不自己算——
 * 算的那头用 `model/pageNumber` 的 `pageBadgeText`，与总览缩略角标同源。
 *
 * 纯函数：无 React / platform / DOM（架构 §2.2）；光栅化在 `workbenches/comic/export`。
 */

import type { BalloonType, ComicBalloon, ComicPage, ReadingDirection } from '../model/comicProject'
import { layoutRects } from '../layout/layoutEdit'
import { spreadSlots } from '../reader/readerNav'

/** 单页画布尺寸（2:3 竖版，与编辑器 `aspect-ratio: 2 / 3` 一致）；1080×1620 是够用的导出分辨率 */
export const SHEET_PAGE_W = 1080
export const SHEET_PAGE_H = 1620
/** 跨页并排时两页之间的中缝 */
export const SHEET_SPREAD_GAP = 24

/**
 * 页脚带高度占页高的比例（打页码时在页下方多出的一条留白）。
 * 45‰ ≈ 页高 1620 时 73px，够放一个不抢戏的页码，也不至于让画面比例失衡。
 */
export const PAGE_NUMBER_BAND_RATIO = 0.045

/** 页脚带高度；至少 1px（防止传入极小页高时算出 0 导致文字被挤没） */
export function pageNumberBand(pageH: number = SHEET_PAGE_H): number {
  return Math.max(1, Math.round(pageH * PAGE_NUMBER_BAND_RATIO))
}

/** 格与格之间的留白（编辑器用固定 2px/300px ≈ 0.7%，这里按导出宽度等比） */
const PANEL_GUTTER = 9
const PANEL_RADIUS = 10

const BALLOON_PAD = 8
const BALLOON_RADIUS = 10
const BALLOON_LINE_HEIGHT = 1.3

/**
 * 导出文档要**自包含**，因此这里写死颜色——不引 CSS 变量（SVG 脱离页面后没有 `:root`）。
 * 取值抄自 `ui/tokens.css`（`--bg-canvas` / `--bg-surface` / `--stroke` / `--text-1` 的近似）。
 */
const COLOR = {
  page: '#fcfcfb',
  panel: '#ffffff',
  stroke: '#deded9',
  balloon: '#ffffff',
  balloonStroke: '#d6d6d1',
  text: '#33332f',
  /** 页码刻意压暗：它是页脚标记，不该与画面 / 对白争夺注意力 */
  pageNumber: '#9a9a94',
} as const

/** 字体栈用**单引号**：整串要放进双引号包裹的 SVG 属性里 */
const BODY_FONT =
  "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif"

const BALLOON_RADIUS_BY_TYPE: Record<BalloonType, number | 'pill'> = {
  speech: BALLOON_RADIUS,
  thought: 'pill',
  narration: 3,
  sfx: BALLOON_RADIUS,
}

/** 紧凑数字：整数不写小数，其余保留两位（减小 SVG 体积） */
function n(v: number): string {
  return Number.isInteger(v) ? String(v) : v.toFixed(2)
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

/** XML 文本转义（属性值里还会用到 `"`，交给调用方用单引号包裹） */
export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * 单字宽度估算（无 canvas 度量时的**近似**折行）。
 * CJK 与全角标点按一字宽，拉丁字母 / 数字按半字宽——够用且确定，便于单测。
 */
function charWidth(ch: string, fontSize: number): number {
  const code = ch.codePointAt(0) ?? 0
  if (code >= 0x2e80) return fontSize
  if (code === 0x20) return fontSize * 0.28
  if (ch >= 'A' && ch <= 'Z') return fontSize * 0.62
  return fontSize * 0.52
}

/**
 * 按可用宽度折行。显式换行（`\n`）优先；空行保留为空行。
 * 宽度不足一行时不做强制切字（宁可溢出也不把单个字符单独成行）。
 */
export function wrapText(text: string, maxWidth: number, fontSize: number): string[] {
  const lines: string[] = []
  if (maxWidth <= 0 || fontSize <= 0) return lines
  for (const paragraph of text.split('\n')) {
    if (paragraph.length === 0) {
      lines.push('')
      continue
    }
    let line = ''
    let width = 0
    for (const ch of paragraph) {
      const w = charWidth(ch, fontSize)
      if (width + w > maxWidth && line.length > 0) {
        lines.push(line)
        line = ''
        width = 0
      }
      line += ch
      width += w
    }
    if (line.length > 0) lines.push(line)
  }
  return lines
}

/** 超出可容纳行数时截断并在末行加省略号 */
function clipLines(lines: string[], maxLines: number): string[] {
  if (maxLines <= 0) return []
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  const lastIndex = kept.length - 1
  const last = kept[lastIndex] ?? ''
  kept[lastIndex] = last.length > 1 ? `${last.slice(0, -1)}…` : '…'
  return kept
}

/** 对白贴纸：尾巴（若有）→ 气泡本体 → 文本 */
function renderBalloon(b: ComicBalloon, ox: number, oy: number, pw: number, ph: number): string {
  const x = ox + b.x * pw
  const y = oy + b.y * ph
  const w = b.w * pw
  const h = b.h * ph
  if (w <= 2 || h <= 2) return ''

  const parts: string[] = []

  if (b.tail) {
    const tx = ox + b.tail.x * pw
    const ty = oy + b.tail.y * ph
    const s = 12
    parts.push(
      `<rect x="${n(tx - s / 2)}" y="${n(ty - s / 2)}" width="${s}" height="${s}" transform="rotate(45 ${n(tx)} ${n(ty)})" fill="${COLOR.balloon}" stroke="${COLOR.balloonStroke}" stroke-width="1"/>`,
    )
  }

  const radius = BALLOON_RADIUS_BY_TYPE[b.type] === 'pill' ? h / 2 : (BALLOON_RADIUS_BY_TYPE[b.type] as number)
  parts.push(
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(radius)}" fill="${COLOR.balloon}" stroke="${COLOR.balloonStroke}" stroke-width="1"/>`,
  )

  const fontSize = clamp(Math.round(h * 0.2), 10, 32)
  const lineHeight = fontSize * BALLOON_LINE_HEIGHT
  const maxWidth = w - BALLOON_PAD * 2
  const maxLines = Math.max(1, Math.floor((h - BALLOON_PAD * 2) / lineHeight))
  const text = b.text.trim()
  if (text && maxWidth > 0) {
    const lines = clipLines(wrapText(text, maxWidth, fontSize), maxLines)
    const tspans = lines
      .map(
        (line, i) =>
          `<tspan x="${n(x + BALLOON_PAD)}" y="${n(y + BALLOON_PAD + fontSize + i * lineHeight)}">${xmlEscape(line)}</tspan>`,
      )
      .join('')
    parts.push(
      `<text font-family="${BODY_FONT}" font-size="${fontSize}" fill="${COLOR.text}">${tspans}</text>`,
    )
  }

  return parts.join('')
}

/** 一页的绘制内容（原点在左上角，坐标即页内绝对像素） */
export function renderPageBody(
  page: ComicPage,
  images: Map<string, string>,
  idPrefix: string,
  pageW: number = SHEET_PAGE_W,
  pageH: number = SHEET_PAGE_H,
): string {
  const parts: string[] = [`<rect width="${n(pageW)}" height="${n(pageH)}" fill="${COLOR.page}"/>`]
  const panelById = new Map(page.panels.map((p) => [p.id, p]))

  layoutRects(page.layout).forEach((r, i) => {
    const x = r.x * pageW + PANEL_GUTTER
    const y = r.y * pageH + PANEL_GUTTER
    const w = r.w * pageW - PANEL_GUTTER * 2
    const h = r.h * pageH - PANEL_GUTTER * 2
    if (w <= 0 || h <= 0) return

    const clipId = `${idPrefix}-p${i}`
    parts.push(
      `<clipPath id="${clipId}"><rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${PANEL_RADIUS}"/></clipPath>`,
      // 1) 白底（未生成底图时格内保持纯白） 2) 底图（裁进圆角） 3) 描边压在最上层
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${PANEL_RADIUS}" fill="${COLOR.panel}"/>`,
    )
    const href = images.get(r.panelId)
    if (href) {
      parts.push(
        `<image href="${href}" x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`,
      )
    }
    parts.push(
      `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${PANEL_RADIUS}" fill="none" stroke="${COLOR.stroke}" stroke-width="1"/>`,
    )

    const panel = panelById.get(r.panelId)
    if (panel) {
      for (const b of panel.balloons) parts.push(renderBalloon(b, x, y, w, h))
    }
  })

  return parts.join('')
}

/**
 * 页码落在页脚带的哪一侧（M6-11，纯函数）。
 *
 * 规则取自单行本惯例——**页码帖外侧（切口侧）**：
 *   - 跨页（两页并排）：左槽靠左、右槽靠右，中缝两侧各一个，像摊开的书；
 *   - 单页：没有「中缝」可参照，退化为**阅读终点侧**——`ltr` 靠右、`rtl` 靠左。
 *
 * 注意 `slot` 是**视觉槽位**（0 = 最左），不是页序：`rtl` 下槽 0 放的是较晚的页，
 * 但它的页码仍在左——因为「外侧」由位置决定，与页序无关。
 */
export function pageNumberAnchor(
  slot: number,
  pageCount: number,
  direction: ReadingDirection,
): 'left' | 'right' {
  if (pageCount >= 2) return slot === 0 ? 'left' : 'right'
  return direction === 'rtl' ? 'left' : 'right'
}

/** 页脚带里的页码；坐标原点在带子左上角（调用方负责 translate 到页下方） */
function renderPageNumber(
  text: string,
  band: number,
  anchor: 'left' | 'right',
  pageW: number,
): string {
  const fontSize = Math.max(6, Math.round(band * 0.52))
  const pad = Math.round(band * 0.7)
  const baseline = band / 2 + fontSize * 0.35
  const x = anchor === 'right' ? pageW - pad : pad
  const label = xmlEscape(text)
  return [
    `<g data-pagenum="${label}">`,
    `<text x="${n(x)}" y="${n(baseline)}" text-anchor="${anchor === 'right' ? 'end' : 'start'}" font-family="${BODY_FONT}" font-size="${fontSize}" fill="${COLOR.pageNumber}">${label}</text>`,
    `</g>`,
  ].join('')
}

export interface SheetSvgInput {
  /** 本张图包含的页（**叙事序**；方向只决定并排时的左右） */
  pages: ComicPage[]
  direction: ReadingDirection
  /** `panelId → 图片 dataURL`；缺失的格只画白底 + 描边 */
  images: Map<string, string>
  /**
   * 与 `pages` **一一对应**的页码文案；`undefined` = 不打页码（默认）。
   *
   * 刻意让调用方传**文案而非下标**：页码的定义收口在 `model/pageNumber`，
   * 这里只负责画，于是「总览角标」与「导出页脚」不可能算出两个不同的号。
   * **长度不匹配则整体不画**——宁可少个页码，也不要把号打到错的页上。
   */
  pageNumbers?: string[]
}

export interface SheetSvgOptions {
  pageW?: number
  pageH?: number
  gap?: number
  /** 是否带页脚带（与 `SheetSvgInput.pageNumbers` 是否给出**必须一致**，否则图会被裁） */
  pageNumbers?: boolean
}

/** 一张图的像素尺寸（供光栅化按同尺寸建 canvas）——跨页为两列 + 中缝；打页码时页下多一条页脚带 */
export function sheetDimensions(
  pageCount: number,
  opts: SheetSvgOptions = {},
): { width: number; height: number } {
  const pageW = opts.pageW ?? SHEET_PAGE_W
  const pageH = opts.pageH ?? SHEET_PAGE_H
  const gap = opts.gap ?? SHEET_SPREAD_GAP
  const columns = pageCount >= 2 ? 2 : 1
  const band = opts.pageNumbers ? pageNumberBand(pageH) : 0
  return { width: columns * pageW + (columns - 1) * gap, height: pageH + band }
}

/**
 * 渲染一张图的完整 `<svg>` 字符串。
 *
 * 单页出图不带空白半幅（一页就是一张），跨页才并排两列——
 * 并排顺序复用 M6-7 的 `spreadSlots`：`ltr` 较早页在左、`rtl` 在右。
 */
export function renderSheetSvg(input: SheetSvgInput, opts: SheetSvgOptions = {}): string {
  const pageW = opts.pageW ?? SHEET_PAGE_W
  const pageH = opts.pageH ?? SHEET_PAGE_H
  const gap = opts.gap ?? SHEET_SPREAD_GAP
  const { pages, direction, images, pageNumbers } = input
  // 长度不匹配即整体不打——宁可缺页码，也不把号打到错的页上
  const hasNumbers = pageNumbers !== undefined && pageNumbers.length === pages.length
  const band = hasNumbers ? pageNumberBand(pageH) : 0
  const { width, height } = sheetDimensions(pages.length, {
    pageW,
    pageH,
    gap,
    pageNumbers: hasNumbers,
  })

  const order: (number | null)[] = pages.length >= 2 ? spreadSlots([0, 1], direction) : [0]

  const body = order
    .map((pageIndex, slot) => {
      const page = pages[pageIndex ?? 0]
      if (!page) return ''
      const x = slot * (pageW + gap)
      const parts = [
        `<g transform="translate(${n(x)} 0)">${renderPageBody(page, images, `s${slot}`, pageW, pageH)}</g>`,
      ]
      const label = hasNumbers ? pageNumbers?.[pageIndex ?? 0] : undefined
      if (label !== undefined && band > 0) {
        const anchor = pageNumberAnchor(slot, pages.length, direction)
        parts.push(
          `<g transform="translate(${n(x)} ${n(pageH)})">${renderPageNumber(label, band, anchor, pageW)}</g>`,
        )
      }
      return parts.join('')
    })
    .filter((s) => s.length > 0)
    .join('')

  // 页脚带与页同底色（`COLOR.page`）——看起来就是页下方多出的一条页边，不需要另画分隔线
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${n(width)}" height="${n(height)}" viewBox="0 0 ${n(width)} ${n(height)}">`,
    `<rect width="${n(width)}" height="${n(height)}" fill="${COLOR.page}"/>`,
    body,
    `</svg>`,
  ].join('')
}
