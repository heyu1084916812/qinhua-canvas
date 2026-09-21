/**
 * 提示词正文的 **Markdown 行内格式化**（纯函数，用户 2026-09-21）。
 *
 * 背景：提示词节点正文要支持「标题 / 粗体 / 列表」这类格式，但**底层必须仍是
 * 一段 Markdown 字符串**——原因是对图像模型友好：`##` `**` 这类标记主流模型
 * 见过大量语料，能正确读成语义结构；而 HTML 标签对模型基本是噪音（占 token
 * 却不描述画面）。所以格式化动作一律表达为「对字符串做一次编辑」。
 *
 * 本模块只做**文本变换**，不碰 DOM / 光标。光标的读写由视图层负责（那是
 * 浏览器选区 API 的事，纯函数层不该知道），于是「同一份逻辑」能被节点跟随栏
 * 与全屏编辑灯箱共用，也能在 node 下单测。
 *
 * 坐标口径：一律用 **`selectionStart` / `selectionEnd` 的字符下标**，
 * 返回新的选区位置，让视图层写回，保证「点完按钮光标不乱跳」。
 */

/** 行级格式：作用于「光标所在的每一行」 */
export type LineFormat =
  /** 正文：去掉标题 / 列表前缀 */
  | 'paragraph'
  /** `# ` / `## ` / `### ` */
  | 'h1'
  | 'h2'
  | 'h3'
  /** `- ` */
  | 'bullet'
  /** `1. ` */
  | 'ordered'

/** 行内格式：作用于**选中文字**（无选区时插入一对标记并把光标放中间） */
export type InlineFormat = 'bold' | 'italic'

export interface EditResult {
  text: string
  /** 变换后的选区（视图层据此 setSelectionRange） */
  start: number
  end: number
}

/** 各标题级别对应的前缀（正文无前缀） */
const HEADING_PREFIX: Record<'h1' | 'h2' | 'h3', string> = { h1: '# ', h2: '## ', h3: '### ' }

/** 行内标记 */
const INLINE_MARK: Record<InlineFormat, string> = { bold: '**', italic: '*' }

/**
 * 行首前缀的**统一识别式**：标题（`#{1,6}` + 空格）、无序（`- ` / `* `）、
 * 有序（`1. ` / `12) `）。
 *
 * 认得出才能**替换**而不是叠加——否则点两次 H2 会变成 `## ## 标题`。
 */
const LINE_PREFIX_RE = /^(#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/

/**
 * 把一段文本按光标选区切成「行」。
 *
 * 选区可能跨行；行级格式要作用于**所有触及的行**（与常见编辑器一致：
 * 选中三行点 H2，三行一起变标题）。
 */
function lineRangeAt(text: string, start: number, end: number): { from: number; to: number } {
  const from = text.lastIndexOf('\n', start - 1) + 1
  const toIdx = text.indexOf('\n', end)
  return { from, to: toIdx === -1 ? text.length : toIdx }
}

/**
 * 应用**行级格式**（标题 / 列表 / 正文）。
 *
 * 语义：
 * - 先摘掉每一行已有的行首前缀，再按目标格式重新加——于是「H2 → H3」是替换，
 *   不是叠加；「H2 → 正文」是纯摘除。
 * - **幂等回归**：对已经是该格式的行再点一次，结果不变（前缀摘下再加同一个）。
 */
export function applyLineFormat(
  text: string,
  start: number,
  end: number,
  format: LineFormat,
): EditResult {
  const { from, to } = lineRangeAt(text, start, end)
  const block = text.slice(from, to)
  const lines = block.split('\n')

  const prefix = format === 'paragraph' ? '' : format === 'bullet' ? '- ' : format === 'ordered' ? '1. ' : HEADING_PREFIX[format]

  const next = lines
    .map((line) => `${prefix}${line.replace(LINE_PREFIX_RE, '')}`)
    .join('\n')

  /*
   * 前缀长度可能变（`### ` → `- `、`## ` → 无），所以选区不能整体平移，
   * 而要按「首行前缀变化量」修正光标、按「整块长度变化量」修正选区尾：
   * 光标在首行时它跟着前缀走，否则会被推到行首之前。
   */
  const text2 = text.slice(0, from) + next + text.slice(to)
  const firstOld = lines[0].match(LINE_PREFIX_RE)?.[0].length ?? 0
  const firstDelta = prefix.length - firstOld
  const blockDelta = next.length - block.length
  // 光标落在首行 → 跟首行前缀走；落在后面几行 → 跟整块长度走
  const startDelta = start - from <= lines[0].length ? Math.max(firstDelta, -start + from) : blockDelta
  return {
    text: text2,
    start: Math.max(from, Math.min(text2.length, start + startDelta)),
    end: Math.max(from, Math.min(text2.length, end + blockDelta)),
  }
}

/**
 * 应用**行内格式**（粗体 / 斜体）。
 *
 * 两种情形：
 * 1. **有选中文字**：`猫` → `**猫**`；若选中的文字**已经被这对标记包住**则取消
 *    （与 Word 的「粗体再点一次取消」一致）。
 * 2. **无选中**：插入一对空标记并把光标放到**中间**，用户接着打字就是加粗的
 *    （不这么做的话，点按钮会「什么都没发生」，用户以为坏了）。
 */
export function applyInlineFormat(
  text: string,
  start: number,
  end: number,
  format: InlineFormat,
): EditResult {
  const mark = INLINE_MARK[format]
  const selected = text.slice(start, end)

  // 情形 1：有选中
  if (selected.length > 0) {
    const before = text.slice(0, start)
    const after = text.slice(end)
    /*
     * 先判「**选中的文字自身就带着这对标记**」（用户把 `**只**` 整个选上）：
     * 必须排在「两侧标记」之前——否则 `一**只**猫` 里选中 `**只**` 时，
     * `before` 以 `**` 结尾、`after` 以 `**` 开头，会被误判成「已包住」，
     * 于是把外面那层当内层摘掉，结果变成 `一****只****猫`。
     */
    if (selected.startsWith(mark) && selected.endsWith(mark) && selected.length > mark.length * 2) {
      const inner = selected.slice(mark.length, selected.length - mark.length)
      const text2 = before + inner + after
      return { text: text2, start, end: start + inner.length }
    }
    // 已包住 → 取消（把两侧标记摘掉）
    const alreadyWrapped = before.endsWith(mark) && after.startsWith(mark)
    if (alreadyWrapped) {
      const text2 = before.slice(0, -mark.length) + selected + after.slice(mark.length)
      return { text: text2, start: start - mark.length, end: end - mark.length }
    }
    const text2 = before + mark + selected + mark + after
    return { text: text2, start: start + mark.length, end: end + mark.length }
  }

  // 情形 2：无选中 —— 插入成对标记，光标落在中间
  const text2 = text.slice(0, start) + mark + mark + text.slice(end)
  return { text: text2, start: start + mark.length, end: start + mark.length }
}

/**
 * 插入**分隔线**：在光标处另起一行放 `---`。
 *
 * 语义按「块级插入」处理：若光标不在行首，先在行首断开——否则会出现
 * `文字---` 这种既不是标题也不是分隔线的中间态。
 */
export function insertDivider(text: string, start: number, end: number): EditResult {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const atLineStart = start === lineStart
  const insert = atLineStart ? '---\n' : '\n---\n'
  const text2 = text.slice(0, start) + insert + text.slice(end)
  const caret = start + insert.length
  return { text: text2, start: caret, end: caret }
}

/**
 * 行首前缀 → 该行当前是什么块类型（供视图层把工具栏按钮标成「选中态」）。
 *
 * 视图层需要它来回答「光标这行现在是不是 H2」，从而把对应按钮点亮。
 */
export function linePrefixOf(text: string, start: number): LineFormat {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1
  const lineEnd = text.indexOf('\n', start)
  const line = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd)
  const m = line.match(LINE_PREFIX_RE)
  if (!m) return 'paragraph'
  const p = m[0]
  if (p.startsWith('### ')) return 'h3'
  if (p.startsWith('## ')) return 'h2'
  if (p.startsWith('# ')) return 'h1'
  if (/^\d/.test(p)) return 'ordered'
  return 'bullet'
}
