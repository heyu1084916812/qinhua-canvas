import {
  Fragment,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { BalloonType, ComicBalloon } from '../../../domain/comic/model/comicProject'
import { BALLOON_TYPE_LABELS } from '../../../domain/comic/model/labels'
import {
  type BalloonRect,
  movedBalloonRect,
  movedTail,
  resizedBalloonRect,
} from '../../../domain/comic/panel/balloonLayout'
import styles from './BalloonLayer.module.css'

/** 类型 → 形态类（显式映射，避免动态取 CSS module 键） */
const TYPE_CLASS: Record<BalloonType, string> = {
  speech: styles.typeSpeech,
  thought: styles.typeThought,
  narration: styles.typeNarration,
  sfx: styles.typeSfx,
}

/**
 * 格内对白贴纸层（M6-4；直接操作补齐 M6-14）。
 *
 * 覆盖在一格之上（`absolute inset:0`），贴纸按**格内 0..1 相对坐标**定位——
 * 与模型一致：格尺寸随版式变，绝对像素会全乱。
 *
 * 四点设计：
 *   1. **层不挡点选**：层本身 `pointer-events:none`，只有可拖的贴纸 / 手柄重新打开指针
 *      （否则贴纸层会吃掉「点格子选中」的点击）；
 *   2. **拖动只存本地态**：拖动过程不逐帧写 store（否则整份聚合对象被反复排落库），
 *      **松手才提交一次**；
 *   3. **非选中格只读**：贴纸半透明、不可拖（保持预览可读、交互不歧义）；
 *   4. **三条直接操作互不重叠**（M6-14）——`move`（拖贴纸本体）/ `resize`（拖右下角
 *      手柄改尺寸）/ `tail`（拖尾巴改指向）。三者共用一套拖拽状态机，且**预览与提交
 *      走同一批 domain 纯函数**（`movedBalloonRect` / `resizedBalloonRect` / `movedTail`）：
 *      手指底下看到的几何，就是松手后落库的几何——不会出现「预览一个样、提交另一个样」。
 *
 * **尾巴的堆叠**：只读时尾巴画在气泡**下面**（半截露出的尖角），可交互时改画在
 * **上面**并放大命中区（13px）——否则尾巴一旦被拖进气泡里就再也抓不到了。
 *
 * 纯渲染 + 抛意图：不碰 store、不动数据。
 */
interface BalloonLayerProps {
  balloons: ComicBalloon[]
  /** 只有**选中格**的贴纸可拖 / 可缩放 / 可拖尾巴；其余格只做展示 */
  interactive: boolean
  onMove: (balloonId: string, x: number, y: number) => void
  onResize: (balloonId: string, w: number, h: number) => void
  onMoveTail: (balloonId: string, x: number, y: number) => void
}

type DragMode = 'move' | 'resize' | 'tail'

interface Drag {
  mode: DragMode
  /** 拖拽起点的贴纸快照——所有增量都相对它算，避免逐帧累加带来的漂移 */
  base: ComicBalloon
  /** 指针相对贴纸左上角的偏移（0..1），仅 `move` 用，保证拖拽时不「跳」 */
  grabDx: number
  grabDy: number
  /** 预览几何（`move` / `resize` 的产物；`tail` 模式下等于起点几何） */
  rect: BalloonRect
  /** 预览尾巴锚点（仅 `tail` 模式非空；其余模式尾巴由 `rect.tail` 给出） */
  tail: { x: number; y: number } | null
}

export function BalloonLayer({
  balloons,
  interactive,
  onMove,
  onResize,
  onMoveTail,
}: BalloonLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<Drag | null>(null)
  const [drag, setDrag] = useState<Drag | null>(null)

  /** 指针位置 → 格内 0..1（以本层矩形为基准，层即格的内容区） */
  function pointAt(e: ReactPointerEvent): { x: number; y: number } | null {
    const layer = layerRef.current
    if (!layer) return null
    const r = layer.getBoundingClientRect()
    if (r.width <= 0 || r.height <= 0) return null
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  function startDrag(
    e: ReactPointerEvent<HTMLElement>,
    b: ComicBalloon,
    mode: DragMode,
  ) {
    if (!interactive) return
    e.stopPropagation() // 不触发「点格子选中」
    const p = pointAt(e)
    if (!p) return
    const rect: BalloonRect = { x: b.x, y: b.y, w: b.w, h: b.h }
    if (b.tail) rect.tail = b.tail
    const next: Drag = {
      mode,
      base: b,
      grabDx: p.x - b.x,
      grabDy: p.y - b.y,
      rect,
      tail: null,
    }
    dragRef.current = next
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag(next)
  }

  function onPointerMove(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current
    if (!d) return
    const p = pointAt(e)
    if (!p) return
    if (d.mode === 'move') {
      d.rect = movedBalloonRect(d.base, p.x - d.grabDx, p.y - d.grabDy)
      d.tail = null
    } else if (d.mode === 'resize') {
      // 左上角是锚点（手柄画在右下角）→ 新尺寸 = 指针 - 左上角
      d.rect = resizedBalloonRect(d.base, p.x - d.base.x, p.y - d.base.y)
      d.tail = null
    } else {
      const t = movedTail(d.base, p.x, p.y)
      if (t) d.tail = t
    }
    setDrag({ ...d })
  }

  function endDrag(e: ReactPointerEvent<HTMLElement>) {
    const d = dragRef.current
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setDrag(null)
    if (!d) return
    if (d.mode === 'move') onMove(d.base.id, d.rect.x, d.rect.y)
    else if (d.mode === 'resize') onResize(d.base.id, d.rect.w, d.rect.h)
    else if (d.tail) onMoveTail(d.base.id, d.tail.x, d.tail.y)
  }

  /** 贴纸预览几何（拖动中取本地态，其余取模型值） */
  function rectOf(b: ComicBalloon): BalloonRect {
    if (!drag || drag.base.id !== b.id) {
      const rect: BalloonRect = { x: b.x, y: b.y, w: b.w, h: b.h }
      if (b.tail) rect.tail = b.tail
      return rect
    }
    if (drag.mode === 'tail') {
      const rect: BalloonRect = { ...drag.rect }
      if (drag.tail) rect.tail = drag.tail
      return rect
    }
    return drag.rect
  }

  return (
    <div className={styles.layer} ref={layerRef} data-comic-balloon-layer>
      {/* 只读：尾巴画在气泡下面（只露尖角）；可交互：改由下方「尾巴手柄」在上层画 */}
      {interactive
        ? null
        : balloons.map((b) => {
            if (!b.tail) return null
            return (
              <span
                key={`tail-${b.id}`}
                className={styles.tailSlot}
                data-comic-balloon-tail
                data-comic-balloon-tail-x={b.tail.x.toFixed(4)}
                data-comic-balloon-tail-y={b.tail.y.toFixed(4)}
                aria-hidden
                style={{ left: `${b.tail.x * 100}%`, top: `${b.tail.y * 100}%` }}
              >
                <span className={styles.tail} />
              </span>
            )
          })}

      {balloons.map((b) => {
        const rect = rectOf(b)
        const dragging = drag?.base.id === b.id && drag.mode === 'move'
        const cls = [
          styles.sticker,
          TYPE_CLASS[b.type],
          interactive ? styles.stickerInteractive : styles.stickerReadonly,
          dragging ? styles.stickerDragging : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={b.id}
            type="button"
            className={cls}
            data-comic-balloon-sticker
            data-comic-balloon-sticker-id={b.id}
            data-comic-balloon-sticker-type={b.type}
            data-comic-balloon-sticker-x={rect.x.toFixed(4)}
            data-comic-balloon-sticker-y={rect.y.toFixed(4)}
            data-comic-balloon-sticker-w={rect.w.toFixed(4)}
            data-comic-balloon-sticker-h={rect.h.toFixed(4)}
            title={`${BALLOON_TYPE_LABELS[b.type]}${b.text ? `：${b.text}` : ''}`}
            tabIndex={interactive ? 0 : -1}
            style={{
              left: `${rect.x * 100}%`,
              top: `${rect.y * 100}%`,
              width: `${rect.w * 100}%`,
              height: `${rect.h * 100}%`,
            }}
            onPointerDown={(e) => startDrag(e, b, 'move')}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            {b.text ? (
              <span className={styles.text}>{b.text}</span>
            ) : (
              <span className={styles.label}>{BALLOON_TYPE_LABELS[b.type]}</span>
            )}
          </button>
        )
      })}

      {/* 可交互：尺寸手柄（右下角）+ 尾巴手柄（画在气泡之上，保证抓得到） */}
      {interactive
        ? balloons.map((b) => {
            const rect = rectOf(b)
            return (
              <Fragment key={`handles-${b.id}`}>
                {rect.tail ? (
                  <span
                    className={styles.tailSlotLive}
                    data-comic-balloon-tail
                    data-comic-balloon-tail-id={b.id}
                    data-comic-balloon-tail-x={rect.tail.x.toFixed(4)}
                    data-comic-balloon-tail-y={rect.tail.y.toFixed(4)}
                    title="拖拽改变尾巴指向"
                    style={{
                      left: `${rect.tail.x * 100}%`,
                      top: `${rect.tail.y * 100}%`,
                    }}
                    onPointerDown={(e) => startDrag(e, b, 'tail')}
                    onPointerMove={onPointerMove}
                    onPointerUp={endDrag}
                    onPointerCancel={endDrag}
                  >
                    <span className={styles.tail} aria-hidden />
                  </span>
                ) : null}
                <span
                  className={styles.resizeHandle}
                  data-comic-balloon-resize
                  data-comic-balloon-resize-id={b.id}
                  title="拖拽调整对白框大小"
                  style={{
                    left: `${(rect.x + rect.w) * 100}%`,
                    top: `${(rect.y + rect.h) * 100}%`,
                  }}
                  onPointerDown={(e) => startDrag(e, b, 'resize')}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              </Fragment>
            )
          })
        : null}
    </div>
  )
}
