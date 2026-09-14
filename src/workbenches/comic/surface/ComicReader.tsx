import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import type { ComicEpisode, ReadingDirection } from '../../../domain/comic/model/comicProject'
import {
  clampPageIndex,
  nextSide,
  pageNeighbor,
  pageStepForKey,
  spreadNeighbor,
  spreadOfPage,
  spreadSlots,
} from '../../../domain/comic/reader/readerNav'
import { dragTurnOffset, dragTurnVerdict } from '../../../domain/comic/reader/dragNav'
import { PageLayoutEditor } from './PageLayoutEditor'
import styles from './ComicReader.module.css'

/**
 * 翻页预览（M6-6）：以浮层把一话当作成品来读。
 *
 * 四点设计：
 *   1. **只读渲染**——复用 `PageLayoutEditor mode="read"`（同一套几何与底图/贴纸渲染），
 *      但去掉工具条、序号印章与选中态。这样「预览里看到的」就是「编辑器里看到的」。
 *   2. **翻页手感随阅读方向**——`←`/`→` 的语义由 `pageStepForKey` 换算：
 *      `ltr` 下右=下一页、`rtl` 下左=下一页（日漫手感）；按钮箭头朝向同源。
 *   3. **页序 = 叙事序**，不随方向翻转；到边界按钮禁用而非假成功。
 *   4. **双页跨页（M6-7）**——一次翻动从「一页」变成「一组页」：第 1 页按封面惯例单独成页，
 *      其后两页一组、末尾落单也单独成页；`ltr` 较早页在左、`rtl` 在右（镜像）。
 *      翻页步进随之变为**跨页步进**（不是按页 ±1），边界判定同源。
 *   5. **可直接拖拽翻页（M6-10）**——按住页往旁边拖，页**跟手**；拖过阈值松手就翻、
 *      没拖够就回弹；已到边界的方向只给一个明显更小的阻尼（手感上「拖不动」）。
 *      判定全是纯函数（`readerNav` 的同源口径：屏幕方向 → 叙事位移 ±1，越界 = 无动作），
 *      且**只接管横向手势**（纵向留给滚动）。按钮与键盘**保持可用**——拖拽是增强，不是替代。
 *
 * 纯渲染 + 抛意图：页序与阅读版式都是本地 UI 态，不进 store（翻页与版式不是数据变更）；
 * `onClose` 由外抛。
 */
interface ComicReaderProps {
  episode: ComicEpisode
  direction: ReadingDirection
  /** 打开时定位到的页序（0 起）；会被夹回合法范围 */
  initialIndex: number
  onClose: () => void
}

/** 阅读版式：单页 / 双页跨页 */
type ReaderMode = 'single' | 'spread'
/** 最近一次翻动方向，仅用于翻页动效的进场方向 */
type NavDir = 'none' | 'next' | 'prev'

/** 封面惯例：双页模式下第 1 页单独成页（见 `readerNav.spreadGroups`） */
const LONE_FIRST = true

export function ComicReader({ episode, direction, initialIndex, onClose }: ComicReaderProps) {
  const count = episode.pages.length
  const [index, setIndex] = useState(() => clampPageIndex(initialIndex, count) ?? 0)
  const [mode, setMode] = useState<ReaderMode>('single')
  const [anim, setAnim] = useState<NavDir>('none')
  /** 拖拽翻页（M6-10）：`null` = 没在拖；否则是相对按下点的位移（只用于渲染，判定在纯函数里） */
  const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null)
  const dragRef = useRef<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null)

  const current = clampPageIndex(index, count)
  const page = current === null ? null : episode.pages[current] ?? null

  /** 当前页所在的跨页组（双页模式用；单页模式只借它算区间文案） */
  const spread = current === null ? null : spreadOfPage(current, count, LONE_FIRST)
  /** 跨页的视觉槽位（左→右，定长 2；`null` 为留空） */
  const slots = spreadSlots(spread?.pages ?? [], direction)

  /** 相对当前页的位移目标（按模式取「页步进」或「跨页步进」）；越界为 `null` */
  const step = (delta: -1 | 1): number | null =>
    mode === 'spread'
      ? spreadNeighbor(index, count, LONE_FIRST, delta)
      : pageNeighbor(index, count, delta)

  const hasPrev = current !== null && step(-1) !== null
  const hasNext = current !== null && step(1) !== null

  /** 「下一页」的视觉朝向：ltr 为右、rtl 为左（`prev` 恒为其反向） */
  const side = nextSide(direction)
  const prevGlyph = side === 'right' ? '←' : '→'
  const nextGlyph = side === 'right' ? '→' : '←'

  /** 页码文案：双页且成组时显示区间（如「第 2-3 / 6 页」） */
  let counterText = '—'
  if (current !== null) {
    counterText =
      mode === 'spread' && spread !== null && spread.pages.length === 2
        ? `第 ${spread.start + 1}-${spread.start + 2} / ${count} 页`
        : `第 ${current + 1} / ${count} 页`
  }

  const go = (delta: -1 | 1) => {
    const target = step(delta)
    if (target === null) return
    setAnim(delta === 1 ? 'next' : 'prev')
    setIndex(target)
  }

  /** 切版式：进双页时把索引吸附到所在跨页组的组首（组内页 → 同一组） */
  const switchMode = (next: ReaderMode) => {
    if (next === mode) return
    setAnim('none')
    if (next === 'spread' && current !== null) {
      const found = spreadOfPage(current, count, LONE_FIRST)
      if (found !== null) setIndex(found.start)
    }
    setMode(next)
  }

  /* ── 拖拽翻页（M6-10）──
   * 位移只负责「跟手渲染」，**翻不翻由纯函数说了算**（`dragTurnVerdict`），
   * 于是这条手势与按钮 / 键盘走的是同一套叙事位移口径，不会拖出第二种翻法。 */
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ dx: 0, dy: 0 })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragRef.current
    if (st === null || st.id !== e.pointerId) return
    st.dx = e.clientX - st.x
    st.dy = e.clientY - st.y
    setDrag({ dx: st.dx, dy: st.dy })
  }

  /** 松手 / 取消：翻页或回弹（回弹 = 把位移清掉，由 CSS 过渡把页送回原位） */
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const st = dragRef.current
    if (st === null || st.id !== e.pointerId) return
    dragRef.current = null
    setDrag(null)
    const delta = dragTurnVerdict({
      dx: st.dx,
      dy: st.dy,
      width: e.currentTarget.clientWidth,
      direction,
      hasPrev,
      hasNext,
    })
    if (delta !== null) go(delta)
  }

  /** 跟手位移（px）：纵向手势为 0、越界方向阻尼更小、统一夹在 ±72 */
  const dragOffset =
    drag === null
      ? 0
      : dragTurnOffset({ dx: drag.dx, dy: drag.dy, width: 1, direction, hasPrev, hasNext })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      const delta = pageStepForKey(e.key === 'ArrowLeft' ? 'left' : 'right', direction)
      const target =
        mode === 'spread'
          ? spreadNeighbor(index, count, LONE_FIRST, delta)
          : pageNeighbor(index, count, delta)
      if (target === null) return
      setAnim(delta === 1 ? 'next' : 'prev')
      setIndex(target)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, count, direction, mode, onClose])

  /** 翻页动效的进场方向：沿「下一页」的视觉朝向进场，反向翻动则反号 */
  const enterX =
    anim === 'none' ? 0 : (anim === 'next' ? 1 : -1) * (side === 'right' ? 1 : -1) * 18

  /** 只读编辑器的共用 props（同一套渲染，仅交互关闭） */
  const readProps = {
    direction,
    mode: 'read' as const,
    selectedPanelId: null,
    onSelectPanel: () => {},
    onInstantiate: () => {},
    onSplit: () => {},
    onRemoveLeaf: () => {},
    onMoveBalloon: () => {},
    onResizeBalloon: () => {},
    onMoveBalloonTail: () => {},
    onReset: () => {},
  }

  /** 按钮文案：双页模式下「一次翻动 = 一组页」，用「跨页」措辞避免误导 */
  const unit = mode === 'spread' ? '跨页' : '页'

  return (
    <div className={styles.overlay} data-comic-reader onClick={onClose}>
      {/* 面板内点击不冒泡到遮罩（点内容不应关闭） */}
      <div className={styles.panel} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <span className={styles.title} data-comic-reader-title>
            {episode.title}
          </span>
          <span className={styles.counter} data-comic-reader-counter>
            {counterText}
          </span>
          <div className={styles.segmented} role="group" aria-label="阅读版式">
            <button
              type="button"
              className={mode === 'single' ? `${styles.segBtn} ${styles.segBtnActive}` : styles.segBtn}
              data-comic-reader-mode-single
              aria-pressed={mode === 'single'}
              onClick={() => switchMode('single')}
            >
              单页
            </button>
            <button
              type="button"
              className={mode === 'spread' ? `${styles.segBtn} ${styles.segBtnActive}` : styles.segBtn}
              data-comic-reader-mode-spread
              aria-pressed={mode === 'spread'}
              onClick={() => switchMode('spread')}
            >
              双页
            </button>
          </div>
          <button
            type="button"
            className={styles.closeBtn}
            data-comic-reader-close
            onClick={onClose}
          >
            关闭
          </button>
        </div>

        {page ? (
          <div
            key={`${mode}:${current}`}
            className={styles.stage}
            data-comic-reader-stage
            data-comic-reader-index={current}
            data-comic-reader-mode={mode}
            {...(anim === 'none' ? {} : { 'data-comic-reader-anim': anim })}
            {...(drag === null ? {} : { 'data-comic-reader-dragging': '' })}
            data-comic-reader-drag-offset={Math.round(dragOffset)}
            style={
              {
                '--read-enter-x': `${enterX}px`,
                '--read-drag-x': `${dragOffset}px`,
              } as CSSProperties
            }
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {mode === 'spread' ? (
              <div className={styles.spread} data-comic-reader-spread>
                {slots.map((slot, i) => {
                  const slotPage = slot === null ? null : episode.pages[slot]
                  return slotPage ? (
                    <PageLayoutEditor key={`spread-${slot}`} page={slotPage} {...readProps} />
                  ) : (
                    <div key={`gap-${i}`} className={styles.gap} data-comic-reader-gap />
                  )
                })}
              </div>
            ) : (
              <PageLayoutEditor page={page} {...readProps} />
            )}
          </div>
        ) : (
          <p className={styles.empty} data-comic-reader-empty>
            本话还没有页。先加页并排版，再回来翻页预览。
          </p>
        )}

        <div className={styles.nav}>
          <button
            type="button"
            className={styles.navBtn}
            data-comic-reader-prev
            disabled={!hasPrev}
            onClick={() => go(-1)}
          >
            {prevGlyph} 上一{unit}
          </button>
          <button
            type="button"
            className={styles.navBtn}
            data-comic-reader-next
            disabled={!hasNext}
            onClick={() => go(1)}
          >
            下一{unit} {nextGlyph}
          </button>
          <span className={styles.dragHint} data-comic-reader-drag-hint>
            也可左右拖拽翻页
          </span>
        </div>
      </div>
    </div>
  )
}
