import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import styles from './TokenEditor.module.css'

/**
 * 「变量芯片」编辑器（用户 2026-09-24：「计数变量的个文字也需要做成和大雄画布一样的，
 * 输入框内会自动变成一个按钮一样的东西」）。
 *
 * ## 为什么不能用 `textarea` / `input`
 *
 * 用户要的是**输入框里 `[计数]` 显示成一颗带 × 的按钮**。这是**富文本**：
 * 同一段内容里既有纯文本、又有不可编辑的原子块。
 * `textarea` 只能显示纯文本——做不到；这是 `contenteditable` 的场景。

 * ## 与纯文本的双向转换（核心）
 *
 * 变量的**存储形态永远是纯文本**（`[计数]`），因为生成时把它交给模型、
 * 由 `loopPlan.applyLoopVariables` 做替换 —— 存储层不能是 HTML。
 *
 * 所以在两端各做一次转换：
 *
 * | 方向 | 做法 |
 * | --- | --- |
 * | 纯文本 → 视图 | 按 `[计数]` 切开，命中处渲染成 chip，其余转义成文本节点 |
 * | 视图 → 纯文本 | 遍历 DOM，遇到 chip 取它的 `data-token`，`<br>` 还原成换行 |
 *
 * 「怎么把用户看到的富文本还原成可发送的文本」这件事**只允许有一份实现** ——
 * 两处各写一份，迟早出现「界面看着有变量、发出去却没有」这类假接通。
 *
 * ## 受控组件的处理
 *
 * React 对 `contenteditable` 没有受控写法（改 innerHTML 会打断光标与输入法）。
 * 这里用「**只在外部值与自己不同步时才重建 DOM**」：用户打字时不动 DOM，
 * 只有外部真的改了值（切换节点、别的入口写入）才重绘。
 */

/** 可插入的变量。写回统一用半角写法（全角也认，见 loopPlan） */
export const TOKENS = ['[计数]', '[总数]', '[进度]'] as const

/** 变量 → 显示在 chip 上的短名 */
function chipLabel(token: string): string {
  return token.replace(/[[\]]/g, '')
}

/** 纯文本 → DOM 节点（chip + 文本 + 换行） */
function buildFragment(text: string, doc: Document): DocumentFragment {
  const frag = doc.createDocumentFragment()
  // 三种变量一起切；捕获组保留分隔符本身
  const parts = String(text ?? '').split(/(\[计数\]|\[总数\]|\[进度\]|《计数》|《总数》|《进度》)/g)
  for (const part of parts) {
    if (!part) continue
    const normalized = part.replace(/《(.+?)》/g, '[$1]')
    if ((TOKENS as readonly string[]).includes(normalized)) {
      frag.appendChild(makeChip(doc, normalized))
      continue
    }
    // 普通文本：换行要变成 <br>，否则 contenteditable 里显示不出多行
    const lines = part.split('\n')
    lines.forEach((line, i) => {
      if (i > 0) frag.appendChild(doc.createElement('br'))
      if (line) frag.appendChild(doc.createTextNode(line))
    })
  }
  return frag
}

function makeChip(doc: Document, token: string): HTMLElement {
  const chip = doc.createElement('span')
  chip.className = styles.chip ?? ''
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute('data-token', token)
  const label = doc.createElement('span')
  label.textContent = chipLabel(token)
  const del = doc.createElement('button')
  del.type = 'button'
  del.className = styles.chipDel ?? ''
  del.setAttribute('data-token-delete', token)
  del.setAttribute('aria-label', `删除${chipLabel(token)}变量`)
  del.title = `删除${chipLabel(token)}变量`
  del.textContent = '×'
  chip.append(label, del)
  return chip
}

/** DOM → 纯文本（chip 还原成 `[计数]`、`<br>` 还原成换行） */
export function readEditorText(root: HTMLElement): string {
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return n.nodeValue ?? ''
    if (n.nodeType !== Node.ELEMENT_NODE) return ''
    const el = n as HTMLElement
    if (el.dataset?.token) return el.dataset.token
    if (el.tagName === 'BR') return '\n'
    return [...el.childNodes].map(walk).join('')
  }
  /**
   * 收尾清理，两条都是「浏览器塞进来的东西」：
   * ① 不换行空格 → 普通空格（否则写回的文本里混进 \u00a0）；
   * ② 零宽空格 → 删掉。它是 `MentionEditor` 在引用芯片**后面**放的落点
   *    （紧贴原子块时光标会跑到块前面），只服务光标，不属于内容。
   */
  return [...root.childNodes]
    .map(walk)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
}

export interface TokenEditorHandle {
  /** 在**光标处**插入一颗变量芯片（用户按「计数」按钮时调用） */
  insertToken(token: string): void
}

export const TokenEditor = forwardRef<TokenEditorHandle, {
  value: string
  onChange: (next: string) => void
  className?: string
  placeholder?: string
  dataKey?: string
  /** 获得焦点时通知宿主：宿主据此记住「该往哪一条插变量」 */
  onFocus?: () => void
  /**
   * 传给宿主的**语义锚点**（如 `data-loop-prompt="0"`）。
   *
   * 由调用方给，而不是在这里硬编码 —— 同一个编辑器会被循环节点、以后可能的
   * 其它面板复用，锚点属于「谁用它」而不是「它是什么」。
   */
  anchorAttr?: Record<string, string>
}>(function TokenEditor(
  { value, onChange, className, placeholder, dataKey, onFocus, anchorAttr },
  handleRef,
) {
  const ref = useRef<HTMLDivElement | null>(null)
  /**
   * 记录「编辑器里当前的纯文本」。
   *
   * 用它判断「外部值变了没有」：若与 `value` 一致就**不重绘 DOM** ——
   * 这是保住光标与输入法的关键。用户打字 → 回调写 store → 父组件重渲染
   * 传回同一个值 → 这里比对一致 → 什么都不做。
   */
  const currentRef = useRef(value)
  /** 归一化定时器：输入停下后再把 `[计数]` 这类文字变成 chip（见 onInput） */
  const normalizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /**
   * 把「手打的变量文字」也变成 chip —— 用户要的是「输入框内自动变成按钮」，
   * 不能只在按按钮时才变。
   *
   * ⚠️ 不能在 `onInput` 里**立刻**替换 DOM：那会在用户每敲一个字符后重建节点，
   * 光标与输入法（中文候选）当场被重置，打字变成灾难。
   * 这里延迟到**输入停顿 400ms** 后再做，那时用户多半已经打完这个变量。
   *
   * 光标处理：替换后把光标放回**该变量之后**，用户接着打字不受影响。
   */
  const scheduleNormalize = () => {
    if (normalizeTimer.current) clearTimeout(normalizeTimer.current)
    normalizeTimer.current = setTimeout(() => {
      const el = ref.current
      if (!el) return
      const text = readEditorText(el)
      // 没有变量文字（或已经全是 chip）就什么都不做
      if (!/\[(计数|总数|进度)\]|《(计数|总数|进度)》/.test(text)) return
      el.replaceChildren(buildFragment(text, document))
      currentRef.current = text
      focusEnd()
    }, 400)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (currentRef.current === value) return
    // 外部值确实变了（切节点 / 撤销 / 别的入口写入）→ 重建内容
    el.replaceChildren(buildFragment(value, document))
    currentRef.current = value
  }, [value])

  // 首次挂载建一次
  useEffect(() => {
    const el = ref.current
    if (!el || el.childNodes.length > 0) return
    el.replaceChildren(buildFragment(value, document))
    currentRef.current = value
    // 仅在挂载时执行：后续同步由上面那个 effect 负责
    // eslint 不在依赖里校验 value（进了依赖会变成受控重绘，打断输入）
  }, [])

  // 卸载时清掉待执行的归一化定时器（否则会在组件消失后去操作已卸载的 DOM）
  useEffect(() => {
    return () => {
      if (normalizeTimer.current) clearTimeout(normalizeTimer.current)
    }
  }, [])

  /** 把光标放到末尾（点击 chip 的 × 删除后需要重新定位，否则光标丢失） */
  const focusEnd = () => {
    const el = ref.current
    if (!el) return
    const range = document.createRange()
    range.selectNodeContents(el)
    range.collapse(false)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  /**
   * 在**光标处**插入一颗变量芯片。
   *
   * 为什么插光标处而不是末尾：用户常见写法是「第[计数]组」——
   * 先打「第」、再点按钮、再打「组」。插到末尾就得手动拖回去，
   * 而这个编辑器的存在意义正是省掉手打符号。
   *
   * 光标不在编辑器内时（例如刚点完工具栏按钮）退化为追加到末尾。
   */
  useImperativeHandle(handleRef, () => ({
    insertToken(token: string) {
      const el = ref.current
      if (!el) return
      const sel = window.getSelection()
      const inside = sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)
      if (inside && sel) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        const chip = makeChip(document, token)
        range.insertNode(chip)
        // 光标移到 chip 之后，用户可以接着打字
        range.setStartAfter(chip)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        el.appendChild(makeChip(document, token))
        focusEnd()
      }
      const next = readEditorText(el)
      currentRef.current = next
      onChange(next)
    },
  }))

  return (
    <div
      ref={ref}
      className={[styles.editor, className].filter(Boolean).join(' ')}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      data-loop-token-editor={dataKey}
      data-placeholder={placeholder}
      {...anchorAttr}
      onFocus={onFocus}
      onInput={() => {
        const el = ref.current
        if (!el) return
        const next = readEditorText(el)
        currentRef.current = next
        onChange(next)
        // 输入停顿后把变量文字归一化成 chip（见 scheduleNormalize 的说明）
        scheduleNormalize()
      }}
      onPointerDown={(e) => {
        /**
         * chip 上的 × 走这里：`contenteditable` 内的 `<button>` 在部分浏览器里
         * 点击不会触发 click（被编辑器接管），故在 pointerdown 阶段处理。
         */
        const target = e.target as HTMLElement
        if (!target.hasAttribute('data-token-delete')) return
        e.preventDefault()
        e.stopPropagation()
        const chip = target.closest('[data-token]')
        chip?.remove()
        const el = ref.current
        if (!el) return
        const next = readEditorText(el)
        currentRef.current = next
        onChange(next)
        focusEnd()
      }}
    />
  )
})
