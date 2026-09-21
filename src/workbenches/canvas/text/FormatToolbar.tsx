/**
 * 正文格式工具栏（产品文档 §6.7，用户 2026-09-21）。
 *
 * 同一排按钮出现在**两处**：节点跟随栏、文本编辑灯箱的右上角。
 * 抽成一个组件是刻意的——两处若各写一份，迟早会在「按钮顺序 / 禁用条件 /
 * 选中态」上漂移，而用户会同时用到两处。
 *
 * 按钮只 emit 语义动作（`onFormat`），不自己改文本：文本的变换是
 * `domain/canvas/text/markdownFormat` 的纯函数，光标由宿主读写。
 * 于是这个组件对「文本怎么变」零认知，纯粹是按钮排。
 */
import type { LineFormat, InlineFormat } from '../../../domain/canvas/text/markdownFormat'
import styles from './FormatToolbar.module.css'
import type { MouseEvent as ReactMouseEvent } from 'react'

export type FormatAction =
  | { kind: 'line'; format: LineFormat }
  | { kind: 'inline'; format: InlineFormat }
  | { kind: 'divider' }
  | { kind: 'copy' }

export interface FormatToolbarProps {
  /** 光标所在行的块类型（决定 H1/H2/H3/正文/列表 哪个按钮点亮） */
  activeLine: LineFormat
  /** 当前是否有文字被选中（决定粗体 / 斜体是否点亮） */
  activeInline: { bold: boolean; italic: boolean }
  onAction: (action: FormatAction) => void
  /** 灯箱右上角那个「切换」按钮；节点栏上不传则不渲染 */
  onToggleFullscreen?: () => void
  /** 全屏态时按钮显示为「退出」 */
  fullscreen?: boolean
  /** 点了不该丢画布焦点（沿用跟随栏那套） */
  keepFocus?: boolean
}

export function FormatToolbar({
  activeLine,
  activeInline,
  onAction,
  onToggleFullscreen,
  fullscreen,
  keepFocus,
}: FormatToolbarProps) {
  /** 按钮统一入口：顺手阻止默认聚焦，避免按空格时被按钮吃掉（§6.3） */
  const guard = keepFocus ? { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() } : {}

  const lineBtn = (format: LineFormat, label: string, action: FormatAction) => (
    <button
      type="button"
      className={activeLine === format ? styles.btnOn : styles.btn}
      data-format-btn={format}
      data-format-active={activeLine === format ? 'true' : undefined}
      title={label}
      aria-label={label}
      aria-pressed={activeLine === format}
      onClick={() => onAction(action)}
      {...guard}
    >
      {label}
    </button>
  )

  /** 图形符按钮（列表用）：与 lineBtn 同一套选中态，只是内容是符号而非文字 */
  const iconBtn = (
    key: string,
    glyph: string,
    label: string,
    active: boolean,
    action: FormatAction,
  ) => (
    <button
      type="button"
      className={active ? styles.btnOn : styles.btn}
      data-format-btn={key}
      data-format-active={active ? 'true' : undefined}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={() => onAction(action)}
      {...guard}
    >
      {glyph}
    </button>
  )

  return (
    <div className={styles.bar} data-format-toolbar>
      {lineBtn('h1', 'H1', { kind: 'line', format: 'h1' })}
      {lineBtn('h2', 'H2', { kind: 'line', format: 'h2' })}
      {lineBtn('h3', 'H3', { kind: 'line', format: 'h3' })}
      {lineBtn('paragraph', '正文', { kind: 'line', format: 'paragraph' })}
      <span className={styles.divider} />
      <button
        type="button"
        className={activeInline.bold ? styles.btnOn : styles.btn}
        data-format-btn="bold"
        data-format-active={activeInline.bold ? 'true' : undefined}
        title="粗体"
        aria-label="粗体"
        aria-pressed={activeInline.bold}
        onClick={() => onAction({ kind: 'inline', format: 'bold' })}
        {...guard}
      >
        <span className={styles.boldGlyph}>B</span>
      </button>
      <button
        type="button"
        className={activeInline.italic ? styles.btnOn : styles.btn}
        data-format-btn="italic"
        data-format-active={activeInline.italic ? 'true' : undefined}
        title="斜体"
        aria-label="斜体"
        aria-pressed={activeInline.italic}
        onClick={() => onAction({ kind: 'inline', format: 'italic' })}
        {...guard}
      >
        <span className={styles.italicGlyph}>I</span>
      </button>
      {/*
        列表 / 分隔线用**图形符**而不是中文（用户参考图就是图标）。
        中文标签会让这一排宽度失控（「无序列表」四个字 vs「H1」两个字符），
        整条栏被撑得很长；完整名称放 `title` / `aria-label`，悬停可见。
      */}
      {iconBtn('bullet', '•', '无序列表', activeLine === 'bullet', { kind: 'line', format: 'bullet' })}
      {iconBtn('ordered', '1.', '有序列表', activeLine === 'ordered', { kind: 'line', format: 'ordered' })}
      <button
        type="button"
        className={styles.btn}
        data-format-btn="divider"
        title="分隔线"
        aria-label="分隔线"
        onClick={() => onAction({ kind: 'divider' })}
        {...guard}
      >
        ―
      </button>
      <span className={styles.divider} />
      <button
        type="button"
        className={styles.btn}
        data-format-btn="copy"
        title="复制正文"
        aria-label="复制正文"
        onClick={() => onAction({ kind: 'copy' })}
        {...guard}
      >
        ⧉
      </button>
      {onToggleFullscreen && (
        <button
          type="button"
          className={styles.btn}
          data-format-btn="fullscreen"
          title={fullscreen ? '退出全屏编辑' : '全屏编辑'}
          aria-label={fullscreen ? '退出全屏编辑' : '全屏编辑'}
          aria-pressed={fullscreen}
          onClick={onToggleFullscreen}
          {...guard}
        >
          {fullscreen ? '⤡' : '⤢'}
        </button>
      )}
    </div>
  )
}
