import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { useCanvasStore } from '../storeContext'
import { useAssetMeta } from '../hooks/useAsset'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import type { Viewport } from '../../../domain/canvas/geometry/coords'
import { screenToWorld } from '../../../domain/canvas/geometry/coords'
import { fitViewport, panBy, zoomAt } from '../../../domain/canvas/geometry/transform'
import type { FusionRect } from '../../../domain/canvas/model/node'
import {
  CROP_HANDLES,
  FUSION_MIN_EDGE,
  clampRect,
  fitRectToRatio,
  movedCropRect,
  ratioValueOf,
  resizedCropRect,
  type CropHandle,
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

/**
 * 八个手柄在框内的位置（百分比 → 跟着框缩放）+ 各自的鼠标指针形状。
 * 用内联几何而不是八个 CSS 类：位置与手柄 id 的一致性一眼可见，改起来只有一处。
 */
const HANDLE_POS: Record<CropHandle, CSSProperties> = {
  nw: { left: 0, top: 0, cursor: 'nwse-resize' },
  n: { left: '50%', top: 0, cursor: 'ns-resize' },
  ne: { left: '100%', top: 0, cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: 0, top: '100%', cursor: 'nesw-resize' },
  w: { left: 0, top: '50%', cursor: 'ew-resize' },
}

/** 「对比原图」的三档（用户 2026-09-30：融合结果在灯箱里要能跟原图对着看） */
const COMPARE_VIEWS = [
  { id: 'result', label: '结果' },
  { id: 'split', label: '对比' },
  { id: 'original', label: '原图' },
] as const
type CompareView = (typeof COMPARE_VIEWS)[number]['id']

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

  /**
   * 「对比原图」的配对从**产物节点自己**读（`GenerationData.compareWith`）。
   *
   * 不靠连线反推：连线是活状态（上游换图 / 删线都会变），而「这张结果是从哪张
   * 原图融出来的」在产出那一刻就定了。读不到配对（老节点 / 素材被删）时对比入口
   * 自动不出现 —— 不猜，也不给一个点不通的开关。
   */
  const compareHash = (() => {
    if (!assetHash) return null
    for (const n of store.getSnapshot().nodes) {
      const d = n.data as { assetHash?: string; compareWith?: string }
      if (d.assetHash === assetHash && d.compareWith) return d.compareWith
    }
    return null
  })()
  const compareAsset = useAssetMeta(compareHash ?? undefined)
  const compareUrl = compareAsset.url
  const compareIsVideo = (compareAsset.mime ?? '').startsWith('video/')
  const [compareView, setCompareView] = useState<CompareView>('result')
  const [splitRatio, setSplitRatio] = useState(0.5)

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

  /** 换素材 = 对比回到「结果」那一档、分割线回中线（别把上一张的视角带过来） */
  useEffect(() => {
    setCompareView('result')
    setSplitRatio(0.5)
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

  /**
   * 拖**框本身**（框内按下）。
   *
   * 用户 2026-09-30：「在选取内拖动每次都会新建一个选取」—— 首版把「按在图上」
   * 一律当成画新框，于是框好之后想挪个位置就必须重画。现在框内按下 = 搬框
   * （尺寸不变），只有按在框**外**才是画新框；这层由 `[data-lightbox-crop-move]`
   * 覆盖在选框上接管指针，顺带把光标变成 `move` 给出提示。
   */
  const startMove = (e: ReactPointerEvent) => {
    if (!cropRect || !natural) return
    e.stopPropagation()
    e.preventDefault()
    movedRef.current = true
    const base = cropRect
    const bounds = { w: natural.w, h: natural.h }
    const from = imgPointAt(e.clientX, e.clientY)
    if (!from) return
    const move = (ev: PointerEvent) => {
      const cur = imgPointAt(ev.clientX, ev.clientY)
      if (!cur) return
      setCropRect(movedCropRect(base, cur.x - from.x, cur.y - from.y, bounds))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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

  /**
   * 拖手柄**改**已经画好的框（用户 2026-09-30：「灯箱框选要能二次修改」）。
   *
   * 基准取按下那一刻的 `cropRect`（不是每次 setState 的最新值）：整段拖拽都以
   * 起点为参照，指针回到原位框就回到原样。若用「上一帧的框」当基准，误差会一帧
   * 一帧累加，拖一会框就飘走了。
   */
  const startResize = (handle: CropHandle, e: ReactPointerEvent) => {
    if (!cropRect || !natural) return
    // 手柄在舞台里面：不拦这一下就会被当成「在空白处重新画框」，一拖就把原框擦掉
    e.stopPropagation()
    e.preventDefault()
    movedRef.current = true
    const base = cropRect
    const bounds = { w: natural.w, h: natural.h }
    const move = (ev: PointerEvent) => {
      const cur = imgPointAt(ev.clientX, ev.clientY)
      if (!cur) return
      setCropRect(
        resizedCropRect({
          base,
          handle,
          pointer: cur,
          bounds,
          ratio: ratioValue,
          minEdge: FUSION_MIN_EDGE,
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

  /** 三档对比：只在「有配对 + 两边都是图 + 不在框选模式」时给入口 */
  const compareAvailable = !!compareHash && !!compareUrl && !isVideo && !compareIsVideo && !cropping
  const view: CompareView = compareAvailable ? compareView : 'result'
  const splitActive = view === 'split'
  const showOriginalOnly = view === 'original'
  /** 主图：切到「原图」那一档时换成原图（整块几何仍按结果那张算） */
  const primaryUrl = showOriginalOnly ? (compareUrl ?? url) : url
  const primaryIsVideo = showOriginalOnly ? false : isVideo
  /** 分割线位置：只改本地瞬时值，不进撤销栈（与对比节点同一口径） */
  const splitAt = (clientX: number, stageRect: Rect): number => {
    if (!box || box.width <= 0) return splitRatio
    const rel = clientX - stageRect.x - box.left
    return Math.min(0.95, Math.max(0.05, rel / box.width))
  }
  const startSplitDrag = (e: ReactPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const r = rectNow()
    if (!r) return
    const move = (ev: PointerEvent) => setSplitRatio(splitAt(ev.clientX, r))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div
      className={styles.overlay}
      data-lightbox
      // 当前展示的素材 hash：灯箱按 hash 取图，这里把它暴露出来，
      // 「灯箱显示的到底是不是这个节点的图」才可断言（否则只能比像素，纯色图比不出来）
      data-lightbox-hash={assetHash ?? ''}
      // 对比原图：配对上时暴露当前档位与实际展示的 hash，供断言（§6.23）
      data-lightbox-compare={compareAvailable ? view : undefined}
      data-lightbox-shown-hash={showOriginalOnly ? (compareHash ?? '') : (assetHash ?? '')}
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
        {primaryUrl &&
          (primaryIsVideo ? (
            <video
              className={placed ? styles.media : styles.mediaPlain}
              data-lightbox-media
              src={primaryUrl}
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
              src={primaryUrl}
              alt=""
              draggable={false}
              style={box}
              onLoad={(e) => {
                /**
                 * 切到「原图」那一档时**不改** `natural`：box / 选区 / 分割线全部按
                 * **结果**那张的尺寸算，两张尺寸万一不同也不会让整块视图跳一下。
                 */
                if (!showOriginalOnly) {
                  setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
              }}
              onPointerDown={(e) => {
                if (!cropping) e.stopPropagation()
              }}
              onClick={(e) => {
                if (!cropping) e.stopPropagation()
              }}
            />
          ))}
        {/*
          * 对比档：原图叠在结果上、按分割线裁出左半边（左边原图 / 右边结果）。
          * 与对比节点（§6.10）同一种呈现，只是舞台换成了灯箱的大画面。
          */}
        {placed && splitActive && compareUrl && box && (
          <>
            <img
              className={styles.media}
              data-lightbox-compare-media
              src={compareUrl}
              alt=""
              draggable={false}
              style={{ ...box, clipPath: `inset(0 ${(1 - splitRatio) * 100}% 0 0)` }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
            <div className={styles.compareTags} style={box} data-lightbox-compare-tags>
              <span className={styles.compareTag}>原图</span>
              <span className={styles.compareTag}>结果</span>
            </div>
            <div
              className={styles.compareDivider}
              data-lightbox-compare-divider
              data-lightbox-compare-ratio={splitRatio.toFixed(3)}
              style={{ left: box.left + box.width * splitRatio, top: box.top, height: box.height }}
              onPointerDown={startSplitDrag}
            >
              <span className={styles.compareKnob} />
            </div>
          </>
        )}
        {/*
          * 手柄与选框**分成两层**：选框那层带 `opacity` 做半透明（主题守卫不许写
          * `rgba`，半透明只能靠 opacity），子元素会连 opacity 一起继承 ——
          * 手柄放进去就淡成 28%，等于看不见。所以手柄另起一层，几何同源。
          */}
        {cropBox && <div className={styles.cropRect} data-lightbox-crop-rect style={cropBox} />}
        {cropBox && (
          <div className={styles.cropHandles} data-lightbox-crop-handles style={cropBox}>
            {/* 框内按下 = 搬框（先铺一层「移动层」，8 个手柄在它上面，压角时手柄优先） */}
            <div
              className={styles.cropMove}
              data-lightbox-crop-move
              onPointerDown={startMove}
            />
            {CROP_HANDLES.map((h) => (
              <span
                key={h}
                className={styles.cropHandle}
                data-lightbox-crop-handle={h}
                style={HANDLE_POS[h]}
                onPointerDown={(e) => startResize(h, e)}
              />
            ))}
          </div>
        )}
      </div>
      <div className={styles.hud}>
        <span className={styles.chip} data-lightbox-size>
          {natural ? `${natural.w} × ${natural.h}` : '—'}
        </span>
        <span className={styles.chip} data-lightbox-zoom>
          {vp ? `${Math.round(vp.zoom * 100)}%` : '—'}
        </span>
        <span className={styles.spacer} />
        {/*
          * 「对比原图」三档（用户 2026-09-30）：融合结果双击进来时，
          * 结果 / 对比（可拖分割线）/ 原图 三档并排 —— 与参数 chip 同一套控件口径。
          */}
        {compareAvailable && (
          <div className={styles.compareGroup} data-lightbox-compare-group>
            {COMPARE_VIEWS.map((v) => (
              <button
                key={v.id}
                type="button"
                className={v.id === view ? styles.compareOn : styles.compareOff}
                data-lightbox-compare={v.id}
                aria-pressed={v.id === view}
                onClick={() => setCompareView(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
        {cropping ? (
          /**
           * 比例档与两个按钮**放在同一组里**（用户 2026-09-30：「提取选区按钮与比例档
           * 要放在一起」，首版被中间的 spacer 拆到左右两头，眼睛要来回跳）。
           */
          <div className={styles.cropBar} data-lightbox-crop-bar>
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
            <span className={styles.barDivider} />
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
          </div>
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
