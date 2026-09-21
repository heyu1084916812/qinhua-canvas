/**
 * Markdown 渲染模型的单测（用户 2026-09-21）。
 *
 * 重点是两条**不能错**的性质：
 * 1. **不吞字符**——认不出的语法、写了一半的标记，都必须原样显示出来。
 *    吞字符是这类解析器最难查的 bug（用户重开编辑器发现字少了）。
 * 2. **不执行 HTML**——输出是结构化块而非 HTML 字符串，从根上免疫注入。
 */
import { describe, it, expect } from 'vitest'
import { parseInline, parseMarkdown, toPlainText } from './markdownRender'

describe('parseInline', () => {
  it('粗体拆成带 bold 的片段', () => {
    expect(parseInline('一**只**猫')).toEqual([
      { text: '一' },
      { text: '只', bold: true },
      { text: '猫' },
    ])
  })

  it('斜体拆成带 italic 的片段', () => {
    expect(parseInline('a*b*c')).toEqual([{ text: 'a' }, { text: 'b', italic: true }, { text: 'c' }])
  })

  it('★ 未闭合的标记原样保留（绝不吞掉用户的 `**`）', () => {
    expect(parseInline('**猫')).toEqual([{ text: '**猫' }])
    expect(parseInline('*猫')).toEqual([{ text: '*猫' }])
  })

  it('没有标记时是一整段纯文本', () => {
    expect(parseInline('一只猫')).toEqual([{ text: '一只猫' }])
  })

  it('空字符串得到空数组', () => {
    expect(parseInline('')).toEqual([])
  })
})

describe('parseMarkdown · 块识别', () => {
  it('三个级别的标题', () => {
    expect(parseMarkdown('# 一').map((b) => b.kind)).toEqual(['h1'])
    expect(parseMarkdown('## 一').map((b) => b.kind)).toEqual(['h2'])
    expect(parseMarkdown('### 一').map((b) => b.kind)).toEqual(['h3'])
  })

  it('★ 标题符号被吃掉，正文不含 `#`', () => {
    expect(parseMarkdown('## 一只猫')[0].spans).toEqual([{ text: '一只猫' }])
  })

  it('无序与有序列表', () => {
    expect(parseMarkdown('- 猫')[0]).toMatchObject({ kind: 'bullet' })
    expect(parseMarkdown('1. 猫')[0]).toMatchObject({ kind: 'ordered', order: 1 })
    expect(parseMarkdown('12) 猫')[0]).toMatchObject({ kind: 'ordered', order: 12 })
  })

  it('分隔线', () => {
    expect(parseMarkdown('---')[0]).toEqual({ kind: 'divider', spans: [] })
    expect(parseMarkdown('-----')[0].kind).toBe('divider')
  })

  it('普通行是 paragraph', () => {
    expect(parseMarkdown('一只猫')[0]).toMatchObject({ kind: 'paragraph' })
  })

  it('★ 不吞字符：`#` 后没有空格就不是标题，原样显示', () => {
    const b = parseMarkdown('#一只猫')[0]
    expect(b.kind).toBe('paragraph')
    expect(b.spans).toEqual([{ text: '#一只猫' }])
  })

  it('★ `--`（两个连字符）不是分隔线', () => {
    expect(parseMarkdown('--')[0].kind).toBe('paragraph')
  })

  it('★ 行首优先级：`## - 猫` 按标题处理，不变成列表', () => {
    expect(parseMarkdown('## - 猫')[0].kind).toBe('h2')
  })

  it('多行按顺序产出多个块', () => {
    const blocks = parseMarkdown('# 标题\n正文\n- 项')
    expect(blocks.map((b) => b.kind)).toEqual(['h1', 'paragraph', 'bullet'])
  })

  it('空行产出空 paragraph（保留行结构，不塌缩）', () => {
    expect(parseMarkdown('a\n\nb').map((b) => b.kind)).toEqual(['paragraph', 'paragraph', 'paragraph'])
  })
})

describe('toPlainText', () => {
  it('剥掉所有 Markdown 符号', () => {
    expect(toPlainText('## 一只**猫**')).toBe('一只猫')
  })

  it('分隔线变成空行', () => {
    expect(toPlainText('一\n---\n二')).toBe('一\n\n二')
  })

  it('★ 与原始 text 的区别：符号被剥、文字一个不少', () => {
    const src = '# 主体\n一只**猫**\n- 明亮'
    expect(toPlainText(src)).toBe('主体\n一只猫\n明亮')
  })

  it('未闭合标记也不丢字符', () => {
    expect(toPlainText('**猫')).toBe('**猫')
  })
})
