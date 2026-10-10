/**
 * 从模型的回复里**挖出 JSON**（对账 #417 抽出来的共享件）。
 *
 * 拆镜（#414）与拆集（#417）都要做这件事，而且都要容忍同一批现实：代码块包裹、
 * 前后夹一段"好的，我拆好了"、以及裸数组。抽成一个模块而不是各写一份 ——
 * 这类"容错"最容易在两处慢慢分叉：一边补了代码块、另一边没补，用户看到的
 * 就是"拆镜能跑、拆集总报错"。
 *
 * **不做**的改写：把中文标点替换成英文、给缺引号的键补引号。
 * 那会把"模型没按契约来"藏起来，而这条链路失败**必须让用户看见**。
 */

/** 从第一个 `open` 起按**字符串感知**的括号计数切出完整片段（别把字符串里的 `}` 当结尾） */
function firstBalanced(text: string, open: string, close: string): string | null {
  const start = text.indexOf(open)
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]!
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export function extractJsonBlock(raw: string): unknown | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  const candidates: string[] = []
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  if (fenced?.[1]) candidates.push(fenced[1].trim())
  candidates.push(text)
  for (const candidate of candidates) {
    /**
     * 先按**内容的第一个括号**决定试哪种切片：固定"先 `{}` 再 `[]`"会踩到一个真错 ——
     * 裸数组 `[{"scene":"一镜"}]` 里第一个 `{` 也能配平，于是返回**内层对象**，
     * 解析器再报"没有目标字段"（模型明明给的就是一份能用的数组）。
     */
    const head = candidate.trimStart()[0]
    const order: readonly (readonly [string, string])[] =
      head === '[' ? [['[', ']'], ['{', '}']] : [['{', '}'], ['[', ']']]
    for (const [open, close] of order) {
      const slice = firstBalanced(candidate, open, close)
      if (!slice) continue
      try {
        return JSON.parse(slice) as unknown
      } catch {
        /* 这个候选切出来不是合法 JSON：试下一种 */
      }
    }
  }
  return null
}
