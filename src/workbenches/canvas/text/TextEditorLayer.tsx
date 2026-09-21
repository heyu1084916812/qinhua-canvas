/**
 * 文本编辑灯箱（产品文档 §6.7，用户 2026-09-21）。
 *
 * 用户的原话是「就是把文本框变成大一点的编辑框，就像灯箱一样」——所以它有
 * **和素材灯箱一样的观感**（居中大面板、四周留白能看见画布、**不能移动**），
 * 但内容是一个大文本框，没有缩放平移。
 *
 * 两条关键设计：
 *
 * 1. **底层是 Markdown 字符串**（见 `domain/canvas/text/`）。格式化按钮改的是
 *    字符串，不是富文本结构——图像模型能读懂 `##` `**` 这类标记，而 HTML 对它是噪音。
 *
 * 2. **显示时隐藏符号**：编辑框里看到的是「大标题」「加粗」，看不到 `#` `**`。
 *    实现方式是「textarea 输入 + 上层渲染层叠加」——textarea 保持真实光标与
 *    输入法行为，渲染层负责把格式画出来。见下方 `Backdrop` 的说明。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useCanvasStore, useGraph } from '../storeContext'
import type { PromptData } from '../../../domain/canvas/model/node'
import {
  applyInlineFormat,
  applyLineFormat,
  insertDivider,
  linePrefixOf,
  type LineFormat,
} from '../../../domain/canvas/text/markdownFormat'
import { parseMarkdown, toPlainText } from '../../../domain/canvas/text/markdownRender'
import { FormatToolbar, type FormatAction } from './FormatToolbar'
import styles from './TextEditorLayer.module.css'

export function TextEditorLayer() {
  const store = useCanvasStore()
  const graph = useGraph()
  const editor = useSyncExternalStore(store.subscribe, store.getTextEditor, store.getTextEditor)
  const taRef = useRef<HTMLTextAreaElement>(null)

  /** 光标所在行的块类型 + 行内是否加粗 / 斜体：供工具栏点亮按钮 */
  const [activeLine, setActiveLine] = useState<LineFormat>('paragraph')
  const [activeInline, setActiveInline] = useState({ bold: false, italic: false })

  const nodeId = editor?.nodeId
  const node = nodeId ? graph.nodes.find((n) => n.id === nodeId) : null
  const text = node ? ((node.data as PromptData).text ?? '') : ''

  const close = useCallback(() => store.closeTextEditor(), [store])

  /** 光标位置：进编辑时全选（用户从节点进来时通常是想重写），之后由用户决定 */
  useLayoutEffect(() => {
    if (!nodeId) return
    const ta = taRef.current
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(ta.value.length, ta.value.length)
  }, [nodeId])

  // Esc 关闭；打开时焦点落在文本框（键盘可达）
  useEffect(() => {
    if (!nodeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodeId, close])

  /** 读光标 → 更新工具栏点亮状态。选区变化 / 输入都要重算 */
  const syncToolbar = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    setActiveLine(linePrefixOf(ta.value, ta.selectionStart))
    const { selectionStart: s, selectionEnd: e } = ta
    if (e > s) {
      const sel = ta.value.slice(s, e)
      setActiveInline({
        bold: sel.startsWith('**') && sel.endsWith('**') && sel.length > 4,
        italic: sel.startsWith('*') && sel.endsWith('*') && !sel.startsWith('**'),
      })
    } else {
      setActiveInline({ bold: false, italic: false })
    }
  }, [])

  /** 应用一次文本变换：写回命令 + 恢复光标 */
  const applyEdit = useCallback(
    (next: { text: string; start: number; end: number }) => {
      if (!nodeId) return
      store.dispatch({
        kind: 'node.updateData',
        id: nodeId,
        patch: { text: next.text },
        transient: false,
      })
      // 命令是同步的，但 React 要下一帧才把 value 更新到 DOM，故用 rAF 恢复光标
      requestAnimationFrame(() => {
        const ta = taRef.current
        if (!ta) return
        ta.focus()
        ta.setSelectionRange(next.start, next.end)
        syncToolbar()
      })
    },
    [nodeId, store, syncToolbar],
  )

  const doAction = useCallback(
    (action: FormatAction) => {
      const ta = taRef.current
      if (!ta) return
      const { selectionStart: s, selectionEnd: e } = ta
      if (action.kind === 'line') {
        applyEdit(applyLineFormat(ta.value, s, e, action.format))
      } else if (action.kind === 'inline') {
        applyEdit(applyInlineFormat(ta.value, s, e, action.format))
      } else if (action.kind === 'divider') {
        applyEdit(insertDivider(ta.value, s, e))
      } else if (action.kind === 'copy') {
        // 复制**纯文本**（剥掉 Markdown 符号）：用户要的是能直接贴进聊天框的内容
        void navigator.clipboard?.writeText(toPlainText(ta.value))
      }
    },
    [applyEdit],
  )

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation() // 编辑中不把按键透传给画布快捷键
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  if (!editor || !node) return null

  const blocks = parseMarkdown(text)

  return (
    <div className={styles.overlay} data-text-editor onClick={close} role="dialog" aria-modal="true" aria-label="文本节点全屏编辑">
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <span className={styles.title}>文本节点全屏编辑</span>
          <FormatToolbar
            activeLine={activeLine}
            activeInline={activeInline}
            onAction={doAction}
            onToggleFullscreen={close}
            fullscreen
          />
        </header>
        {/*
          左编辑 / 右预览（**不是**透明 textarea 叠渲染层）。

          先说清为什么不叠层：叠层要求「看到的字」和「光标在的字」逐像素对齐，
          但 Markdown 源码里 `## ` `**` 这些符号在渲染层是**不占宽度**的，
          而 textarea 里它们占宽度 ⇒ 只要有一行折行，两层就错位，
          表现为「点在这儿、光标在那儿」。折行在中文提示词里是常态
          （一个长句就折了），所以叠层在这个场景**不可靠**，不做。

          改成左右分栏：左边是**带符号的真实文本**（光标、输入法、撤销全是原生行为），
          右边是**隐藏符号后的效果预览**。用户要的「不看井号」由预览满足，
          而编辑区保持诚实——所见即所得在中文长文本上需要完整富文本实现，
          那是另一个量级的事（已记入清单，待后续）。
        */}
        <div className={styles.body}>
          <textarea
            ref={taRef}
            className={styles.input}
            data-text-input
            value={text}
            spellCheck={false}
            placeholder="输入提示词…（支持 # 标题、** 粗体、* 斜体、- 列表、--- 分隔线）"
            onChange={(e) =>
              store.dispatch({
                kind: 'node.updateData',
                id: node.id,
                patch: { text: e.target.value },
                transient: false,
              })
            }
            onKeyUp={syncToolbar}
            onClick={syncToolbar}
            onSelect={syncToolbar}
            onKeyDown={onKeyDown}
          />
          <div className={styles.preview} data-text-preview>
            <div className={styles.previewTitle}>预览</div>
            <div className={styles.previewBody}>
              {blocks.length === 0 ? <span className={styles.previewEmpty}>（空）</span> : null}
              {blocks.map((b, i) => (
                <BlockLine key={i} kind={b.kind} order={b.order} spans={b.spans} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** 按块类型渲染一行（符号已剥掉，只画格式效果） */
function BlockLine({
  kind,
  order,
  spans,
}: {
  kind: string
  order?: number
  spans: { text: string; bold?: true; italic?: true }[]
}) {
  const cls =
    kind === 'h1'
      ? styles.h1
      : kind === 'h2'
        ? styles.h2
        : kind === 'h3'
          ? styles.h3
          : kind === 'divider'
            ? styles.dividerLine
            : styles.paragraph

  if (kind === 'divider') return <div className={styles.dividerRow} data-md-block="divider" />

  return (
    <div className={cls} data-md-block={kind}>
      {(kind === 'bullet' || kind === 'ordered') && (
        <span className={styles.marker}>{kind === 'bullet' ? '•' : `${order ?? 1}.`}</span>
      )}
      <span>
        {spans.length === 0 ? (
          <br />
        ) : (
          spans.map((s, i) => (
            <span key={i} className={[s.bold ? styles.bold : '', s.italic ? styles.italic : ''].filter(Boolean).join(' ')}>
              {s.text}
            </span>
          ))
        )}
      </span>
    </div>
  )
}
