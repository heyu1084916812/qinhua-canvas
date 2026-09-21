/**
 * 正文格式工具栏（产品文档 §6.7，用户 2026-09-21）。
 *
 * 同一排按钮出现在**两处**：节点跟随栏、文本编辑灯箱的右上角。
 * 抽成一个组件是刻意的——两处若各写一份，迟早会在「按钮顺序 / 选中态 /
 * 禁用条件」上漂移，而用户会同时用到两处。
 *
 * **形态与参数**（用户 2026-09-21 第二版反馈）：
 * - **自己不带边框**。它渲染在跟随栏**内部**，跟随栏已经有 1px 描边 + 圆角；
 *   自带边框会形成「框里有框」（实测确实如此）。灯箱那一处由 `<header>` 的
 *   下边框划线，同样不需要它自带框。
 * - **只有图标，不带文字**（用户 2026-09-21 第三版反馈：「节点上的工具栏我
 *   不需要有文字，只需要图标即可」）。图标走 `toolbar/icons.tsx` 的线性图标集，
 *   不用 `•` `1.` 这类文本符号充数；完整名称放 `title` / `aria-label`。
 *
 *   注：生成节点那条跟随栏仍是「图标 + 中文」——两条栏语义不同（那条是**动作**，
 *   这条是**格式开关**），且格式按钮一眼就能从图标认出，不需要文字占位。
 *
 * 按钮只 emit 语义动作（`onAction`），不自己改文本：文本的变换是
 * `domain/canvas/text/markdownFormat` 的纯函数，光标由宿主读写。
 */
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import type { LineFormat, InlineFormat } from '../../../domain/canvas/text/markdownFormat'
import {
  IconBold,
  IconBulletList,
  IconCopyText,
  IconDivider,
  IconExpand,
  IconH1,
  IconH2,
  IconH3,
  IconItalic,
  IconOrderedList,
  IconParagraph,
} from '../toolbar/icons'
import styles from './FormatToolbar.module.css'

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
  /** 点了不该丢画布焦点（节点栏用；灯箱里不需要） */
  keepFocus?: boolean
}

/**
 * 图标尺寸。
 *
 * 用 18 而不是跟随栏的 16（用户 2026-09-21：「H1/H2/H3 好小啊，好扁啊」）：
 * 这排是**高频点击的格式开关**，按钮本来就只有 28px 宽，16 的图标留白过多、
 * 整体看起来又小又扁。放大到 18 后图标撑得更满，与 30px 的按钮比例更匀。
 */
const ICON = 18

export function FormatToolbar({
  activeLine,
  activeInline,
  onAction,
  onToggleFullscreen,
  fullscreen,
  keepFocus,
}: FormatToolbarProps) {
  const guard = keepFocus ? { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() } : {}

  /** 通用按钮：图标 + 常驻中文（与跟随栏 `FollowButton` 同构） */
  const btn = (
    key: string,
    icon: ReactNode,
    label: string,
    onClick: () => void,
    active?: boolean,
  ) => (
    <button
      type="button"
      className={active ? `${styles.btn} ${styles.btnOn}` : styles.btn}
      data-format-btn={key}
      data-format-active={active ? 'true' : undefined}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      {...guard}
    >
      <span className={styles.icon} aria-hidden="true">
        {icon}
      </span>
    </button>
  )

  return (
    <div className={styles.bar} data-format-toolbar>
      {btn('h1', <IconH1 size={ICON} />, '标题1', () => onAction({ kind: 'line', format: 'h1' }), activeLine === 'h1')}
      {btn('h2', <IconH2 size={ICON} />, '标题2', () => onAction({ kind: 'line', format: 'h2' }), activeLine === 'h2')}
      {btn('h3', <IconH3 size={ICON} />, '标题3', () => onAction({ kind: 'line', format: 'h3' }), activeLine === 'h3')}
      {btn('paragraph', <IconParagraph size={ICON} />, '正文', () => onAction({ kind: 'line', format: 'paragraph' }), activeLine === 'paragraph')}
      <span className={styles.divider} />
      {btn('bold', <IconBold size={ICON} />, '粗体', () => onAction({ kind: 'inline', format: 'bold' }), activeInline.bold)}
      {btn('italic', <IconItalic size={ICON} />, '斜体', () => onAction({ kind: 'inline', format: 'italic' }), activeInline.italic)}
      {btn('bullet', <IconBulletList size={ICON} />, '无序', () => onAction({ kind: 'line', format: 'bullet' }), activeLine === 'bullet')}
      {btn('ordered', <IconOrderedList size={ICON} />, '有序', () => onAction({ kind: 'line', format: 'ordered' }), activeLine === 'ordered')}
      {btn('divider', <IconDivider size={ICON} />, '分隔线', () => onAction({ kind: 'divider' }))}
      <span className={styles.divider} />
      {btn('copy', <IconCopyText size={ICON} />, '复制', () => onAction({ kind: 'copy' }))}
      {onToggleFullscreen &&
        btn(
          'fullscreen',
          <IconExpand size={ICON} />,
          fullscreen ? '退出' : '全屏',
          onToggleFullscreen,
        )}
    </div>
  )
}
