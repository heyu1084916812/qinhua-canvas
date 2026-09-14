import { describe, it, expect } from 'vitest'
import type { ComicPage, LayoutNode } from '../model/comicProject'
import {
  SHEET_PAGE_H,
  SHEET_PAGE_W,
  SHEET_SPREAD_GAP,
  pageNumberAnchor,
  pageNumberBand,
  renderSheetSvg,
  sheetDimensions,
  wrapText,
  xmlEscape,
} from './sheetSvg'

function leaf(panelId: string): LayoutNode {
  return { kind: 'panel', panelId }
}

/** 单格满版页；`balloonText` 有值时给这一格挂一条 speech 对白 */
function page(id: string, balloonText?: string): ComicPage {
  const panelId = `${id}-p1`
  return {
    id,
    index: 0,
    title: '',
    layout: [leaf(panelId)],
    panels: [
      {
        id: panelId,
        scene: '',
        shot: { framing: 'medium', angle: 'eye-level' },
        characterIds: [],
        balloons: balloonText
          ? [
              {
                id: `${id}-b1`,
                type: 'speech',
                text: balloonText,
                x: 0.1,
                y: 0.1,
                w: 0.5,
                h: 0.2,
              },
            ]
          : [],
        runs: [],
      },
    ],
  }
}

describe('wrapText', () => {
  it('CJK 按一字宽折行', () => {
    // 每字 10px，可用 30px → 每行 3 字
    expect(wrapText('一二三四五六七', 30, 10)).toEqual(['一二三', '四五六', '七'])
  })

  it('拉丁字符按约半字宽，一行装得下更多', () => {
    const lines = wrapText('abcdefghij', 30, 10)
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('')).toBe('abcdefghij')
  })

  it('显式换行优先，空行保留', () => {
    expect(wrapText('ab\n\ncd', 100, 10)).toEqual(['ab', '', 'cd'])
  })

  it('宽度非法时返回空数组（不做无限循环）', () => {
    expect(wrapText('abc', 0, 10)).toEqual([])
    expect(wrapText('abc', 10, 0)).toEqual([])
  })
})

describe('xmlEscape', () => {
  it('转义 & < > "', () => {
    expect(xmlEscape(`A & B < C > D " E`)).toBe('A &amp; B &lt; C &gt; D &quot; E')
  })
})

describe('sheetDimensions', () => {
  it('单页：一列', () => {
    expect(sheetDimensions(1)).toEqual({ width: SHEET_PAGE_W, height: SHEET_PAGE_H })
  })

  it('跨页：两列 + 中缝', () => {
    expect(sheetDimensions(2)).toEqual({
      width: SHEET_PAGE_W * 2 + SHEET_SPREAD_GAP,
      height: SHEET_PAGE_H,
    })
  })

  it('可覆写尺寸', () => {
    expect(sheetDimensions(2, { pageW: 100, pageH: 150, gap: 10 })).toEqual({
      width: 210,
      height: 150,
    })
  })

  it('打页码时页下多一条页脚带（跨页也一样，两条被中缝断开）', () => {
    const band = pageNumberBand(SHEET_PAGE_H)
    expect(sheetDimensions(1, { pageNumbers: true })).toEqual({
      width: SHEET_PAGE_W,
      height: SHEET_PAGE_H + band,
    })
    expect(sheetDimensions(2, { pageNumbers: true })).toEqual({
      width: SHEET_PAGE_W * 2 + SHEET_SPREAD_GAP,
      height: SHEET_PAGE_H + band,
    })
  })
})

describe('pageNumberAnchor / 页码帖外侧', () => {
  it('跨页：按**槽位**定左右（与页序无关）', () => {
    expect(pageNumberAnchor(0, 2, 'ltr')).toBe('left')
    expect(pageNumberAnchor(1, 2, 'ltr')).toBe('right')
    expect(pageNumberAnchor(0, 2, 'rtl')).toBe('left')
    expect(pageNumberAnchor(1, 2, 'rtl')).toBe('right')
  })

  it('单页：没有中缝可参照 → 退化为阅读终点侧', () => {
    expect(pageNumberAnchor(0, 1, 'ltr')).toBe('right')
    expect(pageNumberAnchor(0, 1, 'rtl')).toBe('left')
  })
})

describe('renderSheetSvg / 页码（M6-11）', () => {
  const band = pageNumberBand(SHEET_PAGE_H)

  it('默认不打页码：无页脚带、高度不变', () => {
    const svg = renderSheetSvg({ pages: [page('a')], direction: 'ltr', images: noImages })
    expect(svg).toContain(`height="${SHEET_PAGE_H}"`)
    expect(svg).not.toContain('data-pagenum')
  })

  it('单页 LTR：页码落在页下方的右端', () => {
    const svg = renderSheetSvg({
      pages: [page('a')],
      direction: 'ltr',
      images: noImages,
      pageNumbers: ['7'],
    })
    expect(svg).toContain(`height="${SHEET_PAGE_H + band}"`)
    expect(svg).toContain('data-pagenum="7"')
    expect(svg).toContain(`translate(0 ${SHEET_PAGE_H})`)
    expect(svg).toContain('text-anchor="end"')
  })

  it('单页 RTL：页码改落左端', () => {
    const svg = renderSheetSvg({
      pages: [page('a')],
      direction: 'rtl',
      images: noImages,
      pageNumbers: ['7'],
    })
    expect(svg).toContain('text-anchor="start"')
  })

  it('跨页：两页各一个页码，分别帖左右外侧', () => {
    const svg = renderSheetSvg({
      pages: [page('A'), page('B')],
      direction: 'ltr',
      images: noImages,
      pageNumbers: ['1', '2'],
    })
    expect(svg).toContain('data-pagenum="1"')
    expect(svg).toContain('data-pagenum="2"')
    // 两个页脚带各就各位（第二条被中缝推开）
    expect(svg).toContain(`translate(0 ${SHEET_PAGE_H})`)
    expect(svg).toContain(`translate(${SHEET_PAGE_W + SHEET_SPREAD_GAP} ${SHEET_PAGE_H})`)
    // 槽 0 靠左（start）、槽 1 靠右（end）
    expect(svg.indexOf('text-anchor="start"')).toBeLessThan(svg.indexOf('text-anchor="end"'))
  })

  it('跨页 RTL：页码按**位置**帖外侧，不随页序镜像（槽 0 仍靠左，但那是第 2 页）', () => {
    const svg = renderSheetSvg({
      pages: [page('A'), page('B')],
      direction: 'rtl',
      images: noImages,
      pageNumbers: ['1', '2'],
    })
    expect(svg.indexOf('data-pagenum="2"')).toBeLessThan(svg.indexOf('data-pagenum="1"'))
    expect(svg.indexOf('text-anchor="start"')).toBeLessThan(svg.indexOf('text-anchor="end"'))
  })

  it('页码数组长度不匹配 → **整体不打**（宁可缺号，也不打到错的页上）', () => {
    const svg = renderSheetSvg({
      pages: [page('A'), page('B')],
      direction: 'ltr',
      images: noImages,
      pageNumbers: ['1'],
    })
    expect(svg).not.toContain('data-pagenum')
    expect(svg).toContain(`height="${SHEET_PAGE_H}"`)
  })

  it('未排版页也打页码（页存在就有号，与总览角标同口径）', () => {
    const empty: ComicPage = { id: 'e', index: 0, title: '', layout: [], panels: [] }
    const svg = renderSheetSvg({
      pages: [empty],
      direction: 'ltr',
      images: noImages,
      pageNumbers: ['3'],
    })
    expect(svg).toContain('data-pagenum="3"')
  })

  it('页码文本被转义（调用方传什么都安全）', () => {
    const svg = renderSheetSvg({
      pages: [page('a')],
      direction: 'ltr',
      images: noImages,
      pageNumbers: ['<1>'],
    })
    expect(svg).toContain('data-pagenum="&lt;1&gt;"')
    expect(svg).not.toContain('data-pagenum="<1>"')
  })
})

const noImages = new Map<string, string>()

describe('renderSheetSvg / 单页', () => {
  it('宽度为单列、只含一个分组', () => {
    const svg = renderSheetSvg({ pages: [page('a', '你好')], direction: 'ltr', images: noImages })
    expect(svg).toContain(`width="${SHEET_PAGE_W}"`)
    expect(svg).toContain('translate(0 0)')
    expect(svg).not.toContain(`translate(${SHEET_PAGE_W + SHEET_SPREAD_GAP} 0)`)
  })

  it('内联底图（data: URL）并裁剪进圆角', () => {
    const images = new Map([['a-p1', 'data:image/png;base64,AAAA']])
    const svg = renderSheetSvg({ pages: [page('a')], direction: 'ltr', images })
    expect(svg).toContain('href="data:image/png;base64,AAAA"')
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"')
    expect(svg).toContain('clip-path="url(#s0-p0)"')
  })

  it('无底图时不产出 <image>，仍是白底 + 描边', () => {
    const svg = renderSheetSvg({ pages: [page('a')], direction: 'ltr', images: noImages })
    expect(svg).not.toContain('<image')
    expect(svg).toContain('stroke-width="1"')
  })

  it('对白文本被写入并转义', () => {
    const svg = renderSheetSvg({
      pages: [page('a', 'A & B')],
      direction: 'ltr',
      images: noImages,
    })
    expect(svg).toContain('A &amp; B')
  })
})

describe('renderSheetSvg / 跨页', () => {
  const first = page('A', 'AAA')
  const second = page('B', 'BBB')

  it('宽度为两列 + 中缝，两个分组各就各位', () => {
    const svg = renderSheetSvg({ pages: [first, second], direction: 'ltr', images: noImages })
    expect(svg).toContain(`width="${SHEET_PAGE_W * 2 + SHEET_SPREAD_GAP}"`)
    expect(svg).toContain('translate(0 0)')
    expect(svg).toContain(`translate(${SHEET_PAGE_W + SHEET_SPREAD_GAP} 0)`)
  })

  it('LTR：较早页在左', () => {
    const svg = renderSheetSvg({ pages: [first, second], direction: 'ltr', images: noImages })
    expect(svg.indexOf('AAA')).toBeGreaterThan(0)
    expect(svg.indexOf('AAA')).toBeLessThan(svg.indexOf('BBB'))
  })

  it('RTL：较早页在右（整体镜像）', () => {
    const svg = renderSheetSvg({ pages: [first, second], direction: 'rtl', images: noImages })
    expect(svg.indexOf('BBB')).toBeLessThan(svg.indexOf('AAA'))
  })

  it('两页的裁剪 id 互不冲突', () => {
    const svg = renderSheetSvg({ pages: [first, second], direction: 'ltr', images: noImages })
    expect(svg).toContain('id="s0-p0"')
    expect(svg).toContain('id="s1-p0"')
  })
})

describe('renderSheetSvg / 未排版页', () => {
  it('空版式仍产出页面底色（不崩、不产出格子）', () => {
    const empty: ComicPage = { id: 'e', index: 0, title: '', layout: [], panels: [] }
    const svg = renderSheetSvg({ pages: [empty], direction: 'ltr', images: noImages })
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('<clipPath')
    expect(svg).toContain(`fill="#fcfcfb"`)
  })

  it('无页时产出空画布（调用方本应拦截）', () => {
    const svg = renderSheetSvg({ pages: [], direction: 'ltr', images: noImages })
    expect(svg).toContain('<svg')
    expect(svg).not.toContain('<clipPath')
  })
})
