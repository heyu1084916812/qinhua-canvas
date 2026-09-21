/**
 * Markdown 的**只读渲染模型**（纯函数，用户 2026-09-21）。
 *
 * 目的：让提示词正文「**看得到格式、看不到符号**」——H2 那行显示成大标题、
 * 粗体那两个字显示成粗体，而 `##`、`**` 这些标记不出现。
 *
 * 为什么只做**子集**：提示词不是文档排版，用户要的是「这行是标题」「这个词要
 * 强调」。支持标题 / 列表 / 分隔线 / 粗体 / 斜体就够了；表格、链接、代码块之类
 * 既用不上，又会把渲染层撑成一堆边界情况。**认不出的语法一律原样显示**，
 * 绝不吞字符——用户写了什么就必须能看见什么（吞字符是最难查的一类 bug）。
 *
 * 输出是**结构化块**（不是 HTML 字符串）：视图层据此渲染 React 元素，
 * 于是天然免疫 XSS（不经过 `dangerouslySetInnerHTML`），也能在 node 下单测。
 */

/** 行内片段：纯文本 / 加粗 / 斜体 */
export interface InlineSpan {
  text: string
  bold?: true
  italic?: true
}

/** 块类型 */
export type BlockKind = 'h1' | 'h2' | 'h3' | 'bullet' | 'ordered' | 'divider' | 'paragraph'

export interface Block {
  kind: BlockKind
  /** 有序列表的序号（`kind === 'ordered'` 时才有） */
  order?: number
  /** 行内片段；`divider` 为空数组 */
  spans: InlineSpan[]
}

/** 行首前缀识别（与 markdownFormat.ts 的口径一致，但这里要知道**具体是哪一种**） */
const HEADING_RE = /^(#{1,3})\s+/
const BULLET_RE = /^[-*]\s+/
const ORDERED_RE = /^(\d+)[.)]\s+/

/**
 * 行内解析：把 `**粗**` / `*斜*` 拆成片段。
 *
 * 实现用**一次线性扫描**而不是正则替换：正则处理嵌套（`**粗*斜*体**`）时会
 * 反复回溯且容易错，扫描一遍的规则反而清楚——遇到标记就切换状态，
 * 没闭合的标记**当普通字符保留**（用户打了一半的 `**` 不该消失）。
 */
export function parseInline(text: string): InlineSpan[] {
  const spans: InlineSpan[] = []
  let buf = ''
  let bold = false
  let italic = false
  let i = 0

  const flush = () => {
    if (buf) {
      spans.push({ text: buf, ...(bold ? { bold: true as const } : {}), ...(italic ? { italic: true as const } : {}) })
      buf = ''
    }
  }

  while (i < text.length) {
    // 先看是不是 `**`（必须比 `*` 优先，否则永远走不到粗体）
    if (text.startsWith('**', i)) {
      flush()
      bold = !bold
      i += 2
      continue
    }
    if (text[i] === '*') {
      flush()
      italic = !italic
      i += 1
      continue
    }
    buf += text[i]
    i += 1
  }

  /*
   * 收尾时若还有**未闭合**的标记：把标记字符还原成文本。
   * 例如用户只打了个 `**猫`（还没写右标记），显示时不该把「猫」当粗体、
   * 更不该把 `**` 吞掉——否则用户重开编辑器会发现字符少了。
   */
  if (bold || italic) {
    const leftover = (bold ? '**' : '') + (italic ? '*' : '')
    if (buf) buf = leftover + buf
    else buf = leftover
    spans.push({ text: buf })
    return spans.map((s) => ({ text: s.text }))
  }

  flush()
  return spans
}

/**
 * 把 Markdown 源码解析成块序列。
 *
 * 认得的语法才产生对应块；**一行里出现多个语法时按「行首优先级」取一个**：
 * 标题 > 列表 > 分隔线 > 正文。这与用户的直觉一致——行首写了 `##` 就是标题，
 * 后面再有 `-` 也不该把整行变成列表项。
 */
export function parseMarkdown(source: string): Block[] {
  const lines = source.split('\n')
  const blocks: Block[] = []

  for (const line of lines) {
    // 分隔线：整行只有三个及以上 `-`（允许前后空白）
    if (/^\s*-{3,}\s*$/.test(line)) {
      blocks.push({ kind: 'divider', spans: [] })
      continue
    }

    const heading = line.match(HEADING_RE)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3
      blocks.push({ kind: `h${level}` as BlockKind, spans: parseInline(line.slice(heading[0].length)) })
      continue
    }

    const bullet = line.match(BULLET_RE)
    if (bullet) {
      blocks.push({ kind: 'bullet', spans: parseInline(line.slice(bullet[0].length)) })
      continue
    }

    const ordered = line.match(ORDERED_RE)
    if (ordered) {
      blocks.push({
        kind: 'ordered',
        order: Number(ordered[1]),
        spans: parseInline(line.slice(ordered[0].length)),
      })
      continue
    }

    blocks.push({ kind: 'paragraph', spans: parseInline(line) })
  }

  return blocks
}

/**
 * 显示层用的**纯文本**（把 Markdown 符号剥掉）。
 *
 * 两个用途：
 * 1. 节点本体在**非编辑态**下显示正文——此时要隐藏符号；
 * 2. 「复制」按钮复制的内容（给用户的是干净文字，不是带 `**` 的源码）。
 *
 * 注意与 `text` 的区别：发给模型的仍是**原始 `text`**（带 Markdown），
 * 因为那些标记对图像模型是有意义的语义信息。
 */
export function toPlainText(source: string): string {
  return parseMarkdown(source)
    .map((b) => {
      if (b.kind === 'divider') return ''
      return b.spans.map((s) => s.text).join('')
    })
    .join('\n')
}
