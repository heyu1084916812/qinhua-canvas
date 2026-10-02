import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { ParamPicker, type ParamOption } from './ParamPicker'

/**
 * 参数选择面板（§3.3 / §6.8）。
 *
 * 它取代原生 `<select>` 的核心理由：原生下拉的展开层由浏览器绘制，既不受浮层规范
 * 约束（无投影 / 1px 描边 / 10px 圆角），也无法被任何自动化断言看见。
 * 所以这里断言的重点就是**「展开层是 DOM 里的一块真元素」**——
 * 有 `data-param-popup`、有选项、有当前值标记，而不是一个浏览器的黑盒。
 */
const ratios: ParamOption[] = [
  { value: '1:1', label: '1:1' },
  { value: '3:2', label: '3:2' },
]

function render(over: Partial<Parameters<typeof ParamPicker>[0]> = {}): string {
  return renderToString(
    createElement(ParamPicker, {
      name: 'ratio',
      ariaLabel: '比例',
      label: '比例',
      options: ratios,
      value: '',
      variant: 'list',
      open: false,
      onToggle: () => {},
      onClose: () => {},
      onSelect: () => {},
      ...over,
    }),
  )
}

describe('ParamPicker · chip 触发器', () => {
  it('未展开时只有 chip，浮层不进 DOM（选项按需挂载）', () => {
    const html = render()
    expect(html).toContain('data-param-chip="ratio"')
    expect(html).toContain('比例')
    expect(html).not.toContain('data-param-popup')
    expect(html).not.toContain('data-param-option')
  })

  it('已设置时 chip 显示当前值，未设置时显示字段名占位', () => {
    expect(render({ value: '3:2', label: '3:2' })).toContain('3:2')
    expect(render({ label: '比例' })).not.toContain('data-param-option')
  })

  it('禁用时 chip 带 disabled', () => {
    expect(render({ disabled: true })).toContain('disabled')
  })
})

describe('ParamPicker · 展开层', () => {
  it('竖版列表：浮层挂出全部选项，当前值带 aria-selected', () => {
    const html = render({ open: true, value: '3:2' })
    expect(html).toContain('data-param-popup="ratio"')
    expect(html).toContain('data-param-variant="list"')
    expect(html).toContain('data-param-option="1:1"')
    expect(html).toContain('data-param-option="3:2"')
    // 当前值那一项被标记（同一时刻只有一个）
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(1)
  })

  it('横排胶囊：同一套数据换 variant 即可（画质 / 质量）', () => {
    const html = render({ open: true, variant: 'pill' })
    expect(html).toContain('data-param-variant="pill"')
    expect(html).toContain('data-param-option="1:1"')
  })

  it('没有候选值：说明原因，而不是挂一个空壳', () => {
    const html = render({ open: true, options: [], emptyHint: '该渠道还没勾选模型' })
    expect(html).toContain('data-param-empty="ratio"')
    expect(html).toContain('该渠道还没勾选模型')
  })

  it('模型明确不支持的档位带 disabled（未声明不算不支持）', () => {
    const html = render({ open: true, options: [...ratios, { value: '2:3', label: '2:3', disabled: true }] })
    expect(html).toContain('data-param-option="2:3"')
    expect(html).toContain('disabled')
  })
})

/**
 * 多组模式（用户 2026-10-02：「具体参数的设置（多个参数集合在一起那种）」）。
 *
 * 对话窗的工具条只留三件事：模型 / 技能 / 参数。其中「参数」是**一个浮层里的
 * 三段**（比例 / 画质 / 质量），而不是三个各自独立的入口 —— 所以这里断言的是
 * 「三段住在同一个 popup 里，且各带自己的锚点」，不是「渲染出三个按钮」。
 */
describe('ParamPicker · 多组模式', () => {
  const sections = [
    {
      name: 'ratio',
      label: '比例',
      variant: 'ratioGrid' as const,
      options: [
        { value: '', label: '自动' },
        { value: '16:9', label: '16:9' },
      ],
      value: '16:9',
      onSelect: () => {},
    },
    {
      name: 'resolution',
      label: '画质',
      variant: 'pill' as const,
      options: [
        { value: 'auto', label: '自动' },
        { value: '2k', label: '2K' },
      ],
      value: '2k',
      onSelect: () => {},
    },
    {
      name: 'quality',
      label: '质量',
      variant: 'pill' as const,
      options: [
        { value: 'auto', label: '自动' },
        { value: 'high', label: '高' },
      ],
      value: 'auto',
      onSelect: () => {},
    },
  ]
  const grouped = () => render({ sections, label: '参数', open: true })

  it('★★ 三段住**同一个**浮层，各带自己的锚点与标题', () => {
    const html = grouped()
    expect(html).toContain('data-param-variant="grouped"')
    for (const s of sections) {
      expect(html).toContain(`data-param-section="${s.name}"`)
      expect(html).toContain(`data-param-in="${s.name}"`)
      expect(html).toContain(s.label)
    }
  })

  /**
   * 画质与质量都有「自动」这一档。没有分段锚点的话，自动化与用户都分不出
   * 「高亮的是画质的自动还是质量的自动」—— 这正是分段要解决的问题。
   */
  it('★★ 同名的档位按**段**区分（画质与质量各有自己的「自动」）', () => {
    const html = grouped()
    expect((html.match(/data-param-option="auto"/g) ?? []).length).toBe(2)
    expect((html.match(/data-param-in="quality"/g) ?? []).length).toBe(2)
    // 三段各有一个当前值（16:9 / 2K / 自动）—— 互不干扰
    expect((html.match(/aria-selected="true"/g) ?? []).length).toBe(3)
  })

  it('★ 「自动」那一格不画比例图（它不是宽高比，画成矩形会和 1:1 撞脸）', () => {
    const html = grouped()
    expect(html).toContain('data-ratio-glyph="16:9"')
    expect(html).not.toContain('data-ratio-glyph=""')
  })

  /**
   * 单组模式是**创作面板**在用的那条路，重构不许把它带坏：
   * 浮层仍按自己的形态渲染，且不该冒出分段锚点。
   */
  it('★ 单组模式不受影响：没有分段锚点，形态还是原来那一档', () => {
    const html = render({ open: true, variant: 'ratioGrid', value: '1:1' })
    expect(html).toContain('data-param-variant="ratioGrid"')
    expect(html).not.toContain('data-param-section')
  })
})
