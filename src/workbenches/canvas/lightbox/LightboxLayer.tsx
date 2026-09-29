import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react'
import { useCanvasStore } from '../storeContext'
import { useAssetMeta } from '../hooks/useAsset'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { fitViewport, panBy, zoomAt } from '../../../domain/canvas/geometry/transform'
import type { FusionRect } from '../../../domain/canvas/model/node'
import {
  FUSION_MIN_EDGE,
  clampRect,
  fitRectToRatio,
  ratioValueOf,
} from '../../../domain/canvas/fusion/fusionPlan'
import { RATIO_CHOICES } from '../../../domain/canvas/layout/ratioChoices'
import { extractSelection } from '../../../features/canvas/extractSelection'
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
  const platform = usePlatform()
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

  /**
   * 提取选区模式（§6.23）：`cropFor` 有值就是它。
   *
   * 选区存**原图像素坐标**（不是屏幕坐标）：缩放 / 平移时选区跟着图走，
   * 不必在每次 setVp 时重算，关掉也不会串味。
   */
  const cropFor = lightbox?.cropFor
  const cropping = !!cropFor
  const [cropRect, setCropRect] = useState<FusionRect | null>(null)
  const [cropRatio, setCropRatio] = useState('')
  const [busy, setBusy] = useState(false)
  const ratioValue = ratioValueOf(cropRatio)

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

  /** 换图 / 换模式 = 选区作废（否则会把上一张图的框带到下一张上） */
  useEffect(() => {
    setCropRect(null)
    setCropRatio('')
  }, [assetHash, cropFor])

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

  /** 屏幕坐标 → **原图像素**坐标（夹在图内）。灯箱把图放在世界 (0,0)，故就是 screenToWorld */
  const imgPointAt = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const r = rectNow()
    if (!r || !vp || !natural) return null
    const p = screenToWorld({ x: clientX, y: clientY }, vp, r)
    return {
      x: Math.max(0, Math.min(natural.w, p.x)),
      y: Math.max(0, Math.min(natural.h, p.y)),
    }
  }

  /** 把框吸附到当前比例档（只缩不放）+ 夹进图内 —— 复用融合节点那套几何，不另写一份 */
  const lockCrop = (rect: FusionRect): FusionRect => {
    if (!natural) return rect
    const locked = ratioValue ? fitRectToRatio(rect, ratioValue) : rect
    return clampRect(locked, { w: natural.w, h: natural.h })
  }

  /** 提取选区模式下的拖拽 = **画框**（不是平移） */
  const startCrop = (e: ReactPointerEvent) => {
    const start = imgPointAt(e.clientX, e.clientY)
    if (!start) return
    e.stopPropagation()
    // 框选期间别被「拖过就当成拖拽、单击才关闭」那套判定认成单击
    movedRef.current = true
    const move = (ev: PointerEvent) => {
      const cur = imgPointAt(ev.clientX, ev.clientY)
      if (!cur) return
      setCropRect(
        lockCrop({
          x: Math.min(start.x, cur.x),
          y: Math.min(start.y, cur.y),
          w: Math.abs(cur.x - start.x),
          h: Math.abs(cur.y - start.y),
        }),
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** 确认提取：裁剪 + 落库 + 在原图右侧建局部图 + 写上下文（都在 features 里） */
  const confirmCrop = async () => {
    if (!cropFor || !cropRect) return
    setBusy(true)
    const out = await extractSelection(
      { platform, store },
      { nodeId: cropFor, rect: cropRect, ratio: cropRatio },
    )
    setBusy(false)
    if (out.ok) {
      close()
      store.notify('已提取选区：局部图已生成在原图右侧，并带上上下文')
    } else {
      store.notify(out.reason)
    }
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
    if (cropping) {
      startCrop(e)
      return
    }
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
  /** 选区框：同一套世界 → 屏幕换算（与媒体框同源，缩放平移时不会漂） */
  const cropBox =
    placed && cropRect
      ? {
          left: -vp.x * vp.zoom + cropRect.x * vp.zoom,
          top: -vp.y * vp.zoom + cropRect.y * vp.zoom,
          width: cropRect.w * vp.zoom,
          height: cropRect.h * vp.zoom,
        }
      : undefined
  const canExtract =
    !!cropFor && !!cropRect && Math.min(cropRect.w, cropRect.h) >= FUSION_MIN_EDGE

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
          // 提取选区模式下**不吃空白单击关闭**：刚框好的框不能被一次误点清掉
          if (cropping) return
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
              // 提取选区模式下把指针让给舞台（否则按在图上画不出框）
              onPointerDown={(e) => {
                if (!cropping) e.stopPropagation()
              }}
              onClick={(e) => {
                if (!cropping) e.stopPropagation()
              }}
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
              onPointerDown={(e) => {
                if (!cropping) e.stopPropagation()
              }}
              onClick={(e) => {
                if (!cropping) e.stopPropagation()
              }}
            />
          ))}
        {cropBox && <div className={styles.cropRect} data-lightbox-crop-rect style={cropBox} />}
      </div>
      <div className={styles.hud}>
        <span className={styles.chip} data-lightbox-size>
          {natural ? `${natural.w} × ${natural.h}` : '—'}
        </span>
        <span className={styles.chip} data-lightbox-zoom>
          {vp ? `${Math.round(vp.zoom * 100)}%` : '—'}
        </span>
        {cropping && (
          <>
            <span className={styles.ratioLabel}>比例</span>
            {RATIO_CHOICES.map((c) => (
              <button
                key={c.value || 'free'}
                type="button"
                className={c.value === cropRatio ? styles.ratioActive : styles.ratio}
                data-lightbox-crop-ratio={c.value || 'free'}
                aria-pressed={c.value === cropRatio}
                onClick={() => {
                  setCropRatio(c.value)
                  const v = ratioValueOf(c.value)
                  // 已经画好的框跟着新比例**就地吸附**（只缩不放），不用重画
                  if (cropRect) setCropRect(lockCrop(v ? fitRectToRatio(cropRect, v) : cropRect))
                }}
              >
                {c.label}
              </button>
            ))}
          </>
        )}
        <span className={styles.spacer} />
        {cropping ? (
          <>
            <button
              type="button"
              className={styles.close}
              data-lightbox-crop-cancel
              onClick={close}
            >
              取消 (Esc)
            </button>
            <button
              type="button"
              className={styles.confirm}
              data-lightbox-crop-apply
              disabled={!canExtract || busy}
              title={
                canExtract
                  ? '按当前框提取局部图，并保留上下文'
                  : `先在图上拖一个框（短边至少 ${FUSION_MIN_EDGE}px）`
              }
              onClick={() => void confirmCrop()}
            >
              {busy ? '提取中…' : '提取选区'}
            </button>
          </>
        ) : (
          <button
            ref={closeRef}
            type="button"
            className={styles.close}
            data-lightbox-close
            onClick={close}
          >
            关闭 (Esc)
          </button>
        )}
      </div>
    </div>
  )
}
