import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { useCanvasStore } from '../storeContext'
import { useAssetMeta } from '../hooks/useAsset'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import { fitViewport, panBy, zoomAt } from '../../../domain/canvas/geometry/transform'
import styles from './LightboxLayer.module.css'

/**
 * 素材灯箱（产品文档 §6.17）。
 *
 * 触发：双击有素材的图片 / 视频节点（§6.8 已 emit `openLightbox`）、
 * 点击日志里的结果缩略图（§6.18「缩略图交互：点击进入灯箱」）。
 * 关闭：`Esc` / 点击空白 / 「关闭」按钮。
 *
 * **复用了画布的视口模型**：把素材当作「世界坐标里 (0,0) 处、尺寸 = 实际像素」的
 * 一张图，舞台当作画布容器，于是滚轮缩放、拖拽平移、初次适配全部直接吃
 * `domain/canvas/geometry/transform` 里的 `zoomAt` / `panBy` / `fitViewport`
 * ——不另写一套缩放数学（第二套实现必然在「锚点是不是鼠标」这类细节上漂移）。
 *
 * 只持有瞬时态：开合状态在 store（与 menu / notice 同口径，不落库不进撤销栈），
 * 缩放 / 平移是组件本地 state——关掉即忘，下次打开重新适配。
 */
const FIT_PADDING = 48
/** 滚轮每格倍率（与画布一致的手感：一格约 12%） */
const WHEEL_STEP = 1.12
/** 超过这个位移就算「拖过」，不再当成「点击空白关闭」 */
const DRAG_SLOP = 3

export function LightboxLayer() {
  const store = useCanvasStore()
  const lightbox = useSyncExternalStore(store.subscribe, store.getLightbox, store.getLightbox)
  const assetHash = lightbox?.assetHash
  const { url, mime } = useAssetMeta(assetHash)
  const isVideo = (mime ?? '').startsWith('video/')

  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const movedRef = useRef(false)
  const [stage, setStage] = useState<Rect | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [vp, setVp] = useState<Viewport | null>(null)

  const close = useCallback(() => store.closeLightbox(), [store])

  // Esc 关闭；打开时焦点落在「关闭」上（键盘可达，无障碍 §4.5）
  useEffect(() => {
    if (!assetHash) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assetHash, close])

  // 换素材 = 重新来过：尺寸未知、落位未定
  useEffect(() => {
    setNatural(null)
    setVp(null)
  }, [assetHash])

  // 舞台尺寸：初次适配要用，resize 时重测
  useEffect(() => {
    if (!assetHash) {
      setStage(null)
      return
    }
    const measure = () => {
      const r = stageRef.current?.getBoundingClientRect()
      if (r) setStage({ x: r.x, y: r.y, w: r.width, h: r.height })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [assetHash])

  // 初次落位：整图适配舞台（与快捷键 Z「重置视图」同一个 fitViewport）
  useEffect(() => {
    if (!natural || !stage || stage.w === 0 || stage.h === 0) return
    setVp((prev) => prev ?? fitViewport([{ x: 0, y: 0, w: natural.w, h: natural.h }], stage, FIT_PADDING))
  }, [natural, stage])

  /** 事件时刻的舞台矩形：不读 state，避免缩放 / 平移后拿到过期值 */
  const rectNow = (): Rect | null => {
    const r = stageRef.current?.getBoundingClientRect()
    return r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null
  }

  const onWheel = (e: ReactWheelEvent) => {
    const rect = rectNow()
    if (!vp || !rect) return
    e.preventDefault()
    const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP
    setVp(zoomAt(vp, { x: e.clientX, y: e.clientY }, rect, vp.zoom * factor))
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (!vp) return
    movedRef.current = false
    const start = { x: e.clientX, y: e.clientY }
    let last = start
    let current = vp
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last.x
      const dy = ev.clientY - last.y
      last = { x: ev.clientX, y: ev.clientY }
      if (Math.abs(ev.clientX - start.x) + Math.abs(ev.clientY - start.y) > DRAG_SLOP) {
        movedRef.current = true
      }
      current = panBy(current, dx, dy)
      setVp(current)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  if (!lightbox) return null

  const placed = natural !== null && vp !== null
  const box = placed
    ? {
        left: -vp.x * vp.zoom,
        top: -vp.y * vp.zoom,
        width: natural.w * vp.zoom,
        height: natural.h * vp.zoom,
      }
    : undefined

  return (
    <div
      className={styles.overlay}
      data-lightbox
      // 当前展示的素材 hash：灯箱按 hash 取图，这里把它暴露出来，
      // 「灯箱显示的到底是不是这个节点的图」才可断言（否则只能比像素，纯色图比不出来）
      data-lightbox-hash={assetHash ?? ''}
      role="dialog"
      aria-modal="true"
      aria-label="素材灯箱"
    >
      <div
        ref={stageRef}
        className={styles.stage}
        data-lightbox-stage
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onClick={() => {
          // 拖动松手也会触发 click：只有没拖过的单击才关闭（与版本预览同口径）
          if (movedRef.current) return
          close()
        }}
      >
        {url &&
          (isVideo ? (
            <video
              className={placed ? styles.media : styles.mediaPlain}
              data-lightbox-media
              src={url}
              controls
              loop
              playsInline
              autoPlay
              style={box}
              onLoadedMetadata={(e) =>
                setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <img
              className={placed ? styles.media : styles.mediaPlain}
              data-lightbox-media
              src={url}
              alt=""
              draggable={false}
              style={box}
              onLoad={(e) =>
                setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
              }
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          ))}
      </div>
      <div className={styles.hud}>
        <span className={styles.chip} data-lightbox-size>
          {natural ? `${natural.w} × ${natural.h}` : '—'}
        </span>
        <span className={styles.chip} data-lightbox-zoom>
          {vp ? `${Math.round(vp.zoom * 100)}%` : '—'}
        </span>
        <span className={styles.spacer} />
        <button
          ref={closeRef}
          type="button"
          className={styles.close}
          data-lightbox-close
          onClick={close}
        >
          关闭 (Esc)
        </button>
      </div>
    </div>
  )
}
