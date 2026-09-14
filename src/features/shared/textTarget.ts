/**
 * 文本输入元素判定（产品文档 §6.3「指针位于节点或面板文本框内时，滚轮归文本框」）。
 *
 * 纯函数、不依赖 DOM：只读取调用方传进来的最小元素形状，
 * 因此可在 node 环境下单测，也便于画布 / 面板复用同一口径。
 */
export interface TextEntryLike {
  tagName?: string
  isContentEditable?: boolean
  type?: string
}

export function isTextEntryElement(el: TextEntryLike | null | undefined): boolean {
  if (!el) return false
  if (el.isContentEditable) return true
  const tag = (el.tagName ?? '').toUpperCase()
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    const t = (el.type ?? '').toLowerCase()
    // 仅真正「可键入文字」的输入框需要保留浏览器原生撤销 / 滚轮归位；
    // color / range / number / checkbox 等不应吞掉画布快捷键（如 Ctrl+Z 撤销）。
    return (
      t === '' ||
      t === 'text' ||
      t === 'search' ||
      t === 'url' ||
      t === 'email' ||
      t === 'password' ||
      t === 'tel'
    )
  }
  return false
}

/**
 * 空格 / 回车会「激活」的控件（按钮、链接、下拉、折叠摘要）。
 * 焦点在其上时，键盘激活优先于画布快捷键（无障碍 §4.5：键盘可完成核心工作流），
 * 否则空格平移会吞掉按钮的键盘激活。
 */
export function isActivationTarget(el: TextEntryLike | null | undefined): boolean {
  if (!el) return false
  const tag = (el.tagName ?? '').toUpperCase()
  return tag === 'BUTTON' || tag === 'A' || tag === 'SELECT' || tag === 'SUMMARY'
}
