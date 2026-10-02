import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import styles from './MentionEditor.module.css'
import { readEditorText } from './TokenEditor'

/**
 * 带「@ 引用芯片」的输入框（用户 2026-10-02：参考产品图三 / 图四 ——
 * 「能艾特画布中的节点或者模型」「艾特的节点和模型他呈现一个矩形作为文本内容的一部分」）。
 *
 * ## 为什么又是 contenteditable
 *
 * 和 `TokenEditor` 同一条理由：用户要的是**同一段内容里既有纯文本、又有原子块**。
 * `textarea` 只能显示纯文本，做不到「一个矩形夹在文字中间」。
 *
 * ## 与 TokenEditor 的分工（各管一种 chip，共用同一条序列化通道）
 *
 * | 组件 | 管什么 chip | 存储形态 |
 * | --- | --- | --- |
 * | `TokenEditor` | 循环 / 批量节点的变量 | `[计数]` |
 * | 本组件 | @ 引用（节点 / 模型 / 技能） | `@[显示名](node:id)` / `@[显示名](model:名字)` / `@[显示名](skill:id)` |
 *
 * 两者的 chip 都把存储形态写进 `data-token`，于是「DOM → 可发送文本」直接复用
 * `readEditorText` **同一份实现**。这条最要紧：各写一份，迟早出现「界面看着有引用、
 * 发出去却没有」这类假接通 —— 而那正是本项目反复踩过的坑。
 *
 * ## 为什么 chip 不带 ×
 *
 * 变量 chip 要能单独删（它是一整个语义单元）；引用是**句子里的一段**，
 * 多一个 × 反而在窄输入框里挤掉名字。**退格 / Delete 由编辑器接管**
 * （见 `chipSiblingOf`）：紧贴 chip 删一次就整块拿走 —— 用户 2026-10-02 报的
 * 「艾特模型后删除不了」说的就是这件事，不能只靠浏览器的默认行为。
 */

/** 引用的存储形态。`kind` 只允许 `node` / `model` / `skill` 三种，别的一律不当引用 */
const SPLIT_RE = /(@\[[^\]]*\]\((?:node|model|skill):[^)]*\))/g

/** chip 里那个小图标：节点 = 一张图，模型 = 立体方块，技能 = 魔杖（与工具栏同义） */
const KIND_ICON: Record<MentionKind, string> = {
  node: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.4"/><path d="m4.5 17 4.5-4.5 3.4 3.4 3-3 4.1 4.1"/></svg>',
  model:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.2 20.2 7.6v8.8L12 20.8 3.8 16.4V7.6z"/><path d="M3.8 7.6 12 12l8.2-4.4"/><path d="M12 12v8.8"/></svg>',
  skill:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 19.8 13 11"/><path d="M16.6 3.2l1 2.6 2.6 1-2.6 1-1 2.6-1-2.6-2.6-1 2.6-1z"/><path d="M11.4 4.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6L9.2 6.8l1.6-.6z"/></svg>',
}

export type MentionKind = 'node' | 'model' | 'skill'

/**
 * 拼一条引用的存储形态。
 *
 * 显示名里的 `[` `]` `(` `)` 会把存储形态**切断**（正则在那些字符上收尾），
 * 于是换成一个空格：宁可显示名略有出入，也不能让引用在往返一次之后变成纯文本。
 */
export function mentionToken(kind: MentionKind, id: string, label: string): string {
  const safe = label.replace(/[[\]()]/g, ' ').replace(/\s+/g, ' ').trim() || id
  return `@[${safe}](${kind}:${id})`
}

/** 存储形态 → chip 上显示的名字 */
export function mentionLabel(token: string): string {
  return /^@\[([^\]]*)\]/.exec(token)?.[1] ?? token
}

/** 存储形态 → 是节点还是模型（读不出来返回 null，不当引用处理） */
export function mentionKindOf(token: string): MentionKind | null {
  const m = /^@\[[^\]]*\]\((node|model|skill):/.exec(token)
  return m?.[1] === 'node' || m?.[1] === 'model' || m?.[1] === 'skill' ? m[1] : null
}

/** 存储形态 → 它指向的那个标识（节点 id / 模型名 / 技能 id）；读不出来返回 null */
export function mentionIdOf(token: string): string | null {
  const m = /^@\[[^\]]*\]\((?:node|model|skill):([^)]*)\)/.exec(token)
  return m?.[1]?.trim() || null
}

export interface MentionRef {
  kind: MentionKind
  /** 节点 id / 模型显示名（`(node:xxx)` 冒号后面那一段） */
  id: string
  /** chip 上显示的名字 */
  label: string
}

/**
 * 把一段文本里所有引用解析出来（去重、保序）。
 *
 * 为什么要单独抽一个纯函数：引用**必须真的送到模型那里**才有意义，而
 * 「界面上插进去了、发出去却只是普通文字」正是这类功能最容易出的假接通。
 * 抽出来就能用断言钉住「插了引用 → 系统提示词里真的报了那个节点 id」。
 */
export function parseMentions(text: string): MentionRef[] {
  const out: MentionRef[] = []
  const seen = new Set<string>()
  for (const m of String(text ?? '').matchAll(/@\[([^\]]*)\]\((node|model|skill):([^)]*)\)/g)) {
    const kind = m[2] as MentionKind
    const id = (m[3] ?? '').trim()
    if (!id) continue
    const key = `${kind}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ kind, id, label: (m[1] ?? '').trim() || id })
  }
  return out
}

/**
 * 发给模型的消息正文里**不留存储形态**：`@[小猫钓鱼](node:node_x)` 换成 `@小猫钓鱼`。
 *
 * 为什么不原样发：那是一串给机器看的括号，读起来像噪音；而引用指向的东西
 * 由系统提示词里那段「用户 @ 引用了什么」负责讲清楚（含 id）。两边各司其职，
 * 免得模型在同一句话里读到两遍同一个 id。
 */
export function stripMentionMarkup(text: string): string {
  return String(text ?? '')
    /** 节点 / 模型：还原成 `@名字`（读起来就是「引用了谁」） */
    .replace(/@\[([^\]]*)\]\((?:node|model):[^)]*\)/g, '@$1')
    /** 技能：它就是「这次用哪条技能」，前面挂个 @ 反而像在引用一个对象，故直接去掉形态 */
    .replace(/@\[([^\]]*)\]\(skill:[^)]*\)/g, '$1')
}

function makeChip(doc: Document, token: string): HTMLElement {
  const kind = mentionKindOf(token)
  const chip = doc.createElement('span')
  chip.className = styles.chip ?? ''
  chip.setAttribute('contenteditable', 'false')
  chip.setAttribute('data-token', token)
  if (kind) chip.setAttribute('data-mention-kind', kind)
  const icon = doc.createElement('span')
  icon.className = styles.chipIcon ?? ''
  if (kind) icon.innerHTML = KIND_ICON[kind]
  /**
   * 缩略图槽：**节点**引用留给宿主往里填图（用户 2026-10-03：「艾特图片的时候需要
   * 和图 6 一样有图片的缩略图，当前只有一个图标和名称」）。
   *
   * 编辑器**不自己去取图**：它是命令式建的 DOM，拿不到 `useAsset` 那类 hook；
   * 宿主把「按节点 id 拿 objectURL」的能力从 `thumbOf` 传进来，再用同一份
   * `thumbVersion` 触发 `fillThumbs` **就地**把图填进这个槽（不重建 DOM，不动光标）。
   */
  const label = doc.createElement('span')
  label.className = styles.chipLabel ?? ''
  label.textContent = mentionLabel(token)
  const slot = doc.createElement('span')
  slot.className = styles.chipThumb ?? ''
  slot.setAttribute('data-mention-thumb-slot', mentionIdOf(token) ?? '')
  chip.append(slot, icon, label)
  return chip
}

/** 纯文本 → DOM（命中引用的切出来做成 chip，其余转成文本节点、换行转 `<br>`） */
function buildFragment(text: string, doc: Document): DocumentFragment {
  const frag = doc.createDocumentFragment()
  for (const part of String(text ?? '').split(SPLIT_RE)) {
    if (!part) continue
    if (part.startsWith('@[') && mentionKindOf(part)) {
      frag.appendChild(makeChip(doc, part))
      continue
    }
    const lines = part.split('\n')
    lines.forEach((line, i) => {
      if (i > 0) frag.appendChild(doc.createElement('br'))
      if (line) frag.appendChild(doc.createTextNode(line))
    })
  }
  return frag
}

export interface MentionEditorHandle {
  /** 在**光标处**插入一个引用芯片（宿主在 @ 菜单里选完之后调它） */
  insertMention(token: string): void
}

export const MentionEditor = forwardRef<
  MentionEditorHandle,
  {
    value: string
    onChange: (next: string) => void
    /** 用户刚打出 `@`（或点了工具条上的 @）→ 宿主据此打开引用菜单 */
    onMentionTrigger?: () => void
    placeholder?: string
    className?: string
    /** 回车（不带 Shift）= 发送；带 Shift = 换行 */
    onEnter?: () => void
    /** 语义锚点（测试用），由调用方给 */
    anchorAttr?: Record<string, string>
    /**
     * 按**节点 id** 取缩略图的 objectURL（拿不到返回 null）。
     *
     * 编辑器自己不取图（它是命令式 DOM，拿不到 hook）；宿主负责加载并把结果
     * 通过 `thumbVersion` 的递增通知这里。
     */
    thumbOf?: (nodeId: string) => string | null
    /** 缩略图缓存版本号：变了就把已有的槽位**就地**补一遍图 */
    thumbVersion?: number
  }
>(function MentionEditor(
  {
    value,
    onChange,
    onMentionTrigger,
    placeholder,
    className,
    onEnter,
    anchorAttr,
    thumbOf,
    thumbVersion,
  },
  handleRef,
) {
  const ref = useRef<HTMLDivElement | null>(null)
  /** 编辑器里当前的纯文本：与外部 `value` 一致就**不重绘 DOM**（保住光标与输入法） */
  const currentRef = useRef(value)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (currentRef.current === value) return
    el.replaceChildren(buildFragment(value, document))
    currentRef.current = value
  }, [value])

  useEffect(() => {
    const el = ref.current
    if (!el || el.childNodes.length > 0) return
    el.replaceChildren(buildFragment(value, document))
    currentRef.current = value
    // 仅在挂载时执行：后续同步由上面那个 effect 负责（与 TokenEditor 同一写法）
  }, [])

  /**
   * 把缩略图槽**就地**填上（不重建 DOM）。
   *
   * 为什么是「就地」而不是 `replaceChildren`：重建会**重置光标与输入法** ——
   * 用户正打字时图刚好加载完、光标一跳，那是灾难（`TokenEditor` 里记过这条）。
   * 这里只往槽里 append 一个 `<img>`，正文与光标一个字节都不动。
   */
  useEffect(() => {
    const el = ref.current
    if (!el || !thumbOf) return
    for (const slot of el.querySelectorAll<HTMLElement>('[data-mention-thumb-slot]')) {
      if (slot.firstChild) continue
      const id = slot.dataset.mentionThumbSlot ?? ''
      const url = id ? thumbOf(id) : null
      if (!url) continue
      const img = document.createElement('img')
      img.src = url
      img.alt = ''
      img.className = styles.chipThumbImg ?? ''
      slot.append(img)
      /** 有图就把那枚矢量图标收起来 —— 图 6 里就是「缩略图 + 名字」 */
      slot.parentElement?.setAttribute('data-has-thumb', 'true')
    }
    // `value` 也要进依赖：新插进来的 chip 可能带着还没填的槽
  }, [thumbVersion, thumbOf, value])

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

  const emit = () => {
    const el = ref.current
    if (!el) return
    const next = readEditorText(el)
    currentRef.current = next
    onChange(next)
  }

  /**
   * 光标**紧贴**着的那个 chip（`side` 决定往前还是往后看）；没有就返回 null。
   *
   * 只在「光标与 chip 之间除了零宽字符什么都没有」时才算紧贴 —— 否则退格该删的是
   * 普通文字，别把引用顺手吃掉。
   */
  const chipSiblingOf = (range: Range, side: 'before' | 'after'): HTMLElement | null => {
    const root = ref.current
    if (!root) return null
    const isChip = (n: Node | null | undefined): n is HTMLElement =>
      !!n && n.nodeType === Node.ELEMENT_NODE && Boolean((n as HTMLElement).dataset?.token)
    /** 空白 = 没有，或只有零宽字符（插入 chip 时垫的那个落点） */
    const blank = (n: Node | null | undefined) =>
      !n || (n.nodeType === Node.TEXT_NODE && !(n.nodeValue ?? '').replace(/\u200b/g, ''))
    const step = side === 'before' ? 'previousSibling' : 'nextSibling'

    const { startContainer, startOffset } = range
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer.nodeValue ?? ''
      const rest = side === 'before' ? text.slice(0, startOffset) : text.slice(startOffset)
      if (rest.replace(/\u200b/g, '') !== '') return null
      let node: Node | null = startContainer
      while (node && node !== root) {
        let sib: Node | null = node[step]
        while (sib && blank(sib)) sib = sib[step]
        if (isChip(sib)) return sib
        if (sib) return null
        node = node.parentNode
      }
      return null
    }
    if (startContainer.nodeType === Node.ELEMENT_NODE) {
      const kids = (startContainer as HTMLElement).childNodes
      let i = side === 'before' ? startOffset - 1 : startOffset
      while (i >= 0 && i < kids.length && blank(kids[i])) i += side === 'before' ? -1 : 1
      const hit = kids[i]
      return isChip(hit) ? hit : null
    }
    return null
  }

  /**
   * 退格 / Delete 紧贴 chip → **整块拿走**，光标留在它原来的位置。
   *
   * 用户 2026-10-02：「艾特模型后删除不了」。不接管的话，浏览器对
   * `contenteditable=false` 内联块的处理各版本不一致（有的先吃掉旁边的零宽字符、
   * 有的干脆不动），用户看到的就是「删不掉」。
   */
  const removeAdjacentChip = (side: 'before' | 'after'): boolean => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
    const chip = chipSiblingOf(sel.getRangeAt(0), side)
    const parent = chip?.parentNode
    if (!chip || !parent) return false
    const idx = [...parent.childNodes].indexOf(chip)
    chip.remove()
    const r = document.createRange()
    r.setStart(parent, Math.min(Math.max(idx, 0), parent.childNodes.length))
    r.collapse(true)
    sel.removeAllRanges()
    sel.addRange(r)
    emit()
    return true
  }

  useImperativeHandle(handleRef, () => ({
    insertMention(token: string) {
      const el = ref.current
      if (!el) return
      /**
       * 空编辑器里浏览器常垫一个**占位 `<br>`**（`contenteditable` 的默认行为）。
       * 不清理的话 chip 会插在它后面 —— 读回来就是「先一个空行、再一个引用」，
       * 用户看到的是「艾特之后上方多出一块空白」（2026-10-02 报的正是这个）。
       *
       * 只在「整段内容就是这个 `<br>`」时清：用户自己敲出来的空行一个都不动。
       */
      if (el.childNodes.length === 1 && (el.firstChild as HTMLElement)?.tagName === 'BR') {
        el.replaceChildren()
      }
      const sel = window.getSelection()
      const inside = sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)
      const chip = makeChip(document, token)
      if (inside && sel) {
        const range = sel.getRangeAt(0)
        range.deleteContents()
        /**
         * 光标前若是一个刚打下的 `@`（它就是这次引用的触发符），先吃掉它 ——
         * 留着的话文本会变成 `@@[名字](node:x)`，看着像手滑。
         */
        const node = range.startContainer
        if (node.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
          const text = node.nodeValue ?? ''
          if (text[range.startOffset - 1] === '@') {
            ;(node as Text).deleteData(range.startOffset - 1, 1)
            range.setStart(node, range.startOffset - 1)
            range.collapse(true)
          }
        }
        range.insertNode(chip)
        /**
         * chip 后放一个零宽字符并**把光标落进去**：紧贴着不可编辑的原子块，
         * 浏览器会把插入点放到块**前面**，用户接着打字就会打到引用左边。
         */
        const tail = document.createTextNode('\u200b')
        chip.after(tail)
        range.setStart(tail, 1)
        range.collapse(true)
        sel.removeAllRanges()
        sel.addRange(range)
      } else {
        el.append(chip, document.createTextNode('\u200b'))
        focusEnd()
      }
      emit()
      el.focus()
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
      aria-label="给助手的消息"
      data-agent-input
      data-placeholder={placeholder}
      {...anchorAttr}
      onInput={() => {
        const el = ref.current
        const sel = window.getSelection()
        /**
         * 刚打出 `@` 就开菜单（参考产品的交互）。判据取**光标前那个字符**，
         * 而不是「整段文本以 @ 结尾」—— 后者在句子中间打字时会误触发。
         */
        if (el && sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
          const r = sel.getRangeAt(0)
          const n = r.startContainer
          if (n.nodeType === Node.TEXT_NODE && (n.nodeValue ?? '')[r.startOffset - 1] === '@') {
            onMentionTrigger?.()
          }
        }
        emit()
      }}
      onKeyDown={(e) => {
        /** 紧贴 chip 的退格 / Delete = 删掉整块引用（见 `removeAdjacentChip`） */
        if (e.key === 'Backspace' || e.key === 'Delete') {
          if (removeAdjacentChip(e.key === 'Backspace' ? 'before' : 'after')) {
            e.preventDefault()
            return
          }
        }
        if (e.key !== 'Enter') return
        if (e.shiftKey) {
          /** Shift+Enter = 换行：插 `<br>`（readEditorText 认它），别让浏览器插 `<div>` */
          e.preventDefault()
          document.execCommand('insertLineBreak')
          emit()
          return
        }
        e.preventDefault()
        onEnter?.()
      }}
    />
  )
})
