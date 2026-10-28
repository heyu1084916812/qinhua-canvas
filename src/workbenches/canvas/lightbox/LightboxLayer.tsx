import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from 'react'
import { useCanvasStore } from '../storeContext'
import { useAssetMeta } from '../../../features/shared/assets/index'
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
import { cropAsset, extractSelection } from '../../../features/canvas/extractSelection'
import { faceBoxFromRect } from '../../../features/canvas/emotionEdit'
import { downloadAsset } from '../../../features/shared/assets/downloadAsset'
import { createId } from '../../../shared/id'
import {
  ANNOTATE_COLORS,
  clampAnnotateTextSize,
  drawAnnotateOp,
  moveAnnotateText,
  resizeAnnotateText,
  type AnnotateOp,
  type AnnotateTextItem,
  type AnnotateTool,
} from '../annotate/annotateOps'
import { saveAnnotatedAsset } from '../annotate/bakeAnnotate'
import { saveRotatedAsset } from '../rotate/bakeRotate'
import {
  IconAnnotate,
  IconCheck,
  IconChevronLeft,
  IconChevronRight,
  IconClose,
  IconCompare,
  IconCrop,
  IconDelete,
  IconImage,
  IconMirrorH,
  IconMirrorV,
  IconRect,
  IconRedo,
  IconRotate,
  IconScan,
  IconText,
  IconUndo,
} from '../toolbar/icons'
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
/** 顶部现在有两排浮条（模式 + 当前工具），初次适配给它们留出不被压住的余量。 */
const FIT_PADDING = 112
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

/** 对比灯箱三档：first = assetHash，second = compareWith；文案由 compareKind 决定 */
type CompareView = 'first' | 'split' | 'second'

/** 灯箱底部的模式切换：查看 / 提取选区 / 裁剪 / 框脸 / 标注 / 旋转 / 对比 */
const EDITOR_MODES = [
  { id: 'view', label: '查看', icon: <IconImage size={16} /> },
  { id: 'extract', label: '提取选区', icon: <IconScan size={16} /> },
  { id: 'crop', label: '裁剪', icon: <IconCrop size={16} /> },
  { id: 'face', label: '框脸', icon: <IconScan size={16} /> },
  { id: 'annotate', label: '标注', icon: <IconAnnotate size={16} /> },
  { id: 'rotate', label: '旋转', icon: <IconRotate size={16} /> },
  { id: 'compare', label: '对比', icon: <IconCompare size={16} /> },
] as const
type EditorMode = (typeof EDITOR_MODES)[number]['id']

/** 标注模式的三件工具（用户 2026-10-05 第 10 条：画笔 / 矩形 / 文字） */
const ANNOTATE_TOOLS = [
  { id: 'brush', label: '画笔', icon: <IconAnnotate size={16} /> },
  { id: 'rect', label: '矩形', icon: <IconRect size={16} /> },
  { id: 'text', label: '文字', icon: <IconText size={16} /> },
] as const

function GalleryThumb({
  item,
  index,
  active,
  onSelect,
}: {
  item: { assetHash: string; nodeId: string; title: string }
  index: number
  active: boolean
  onSelect: (index: number) => void
}) {
  const { url, mime } = useAssetMeta(item.assetHash)
  const video = (mime ?? '').startsWith('video/')
  return (
    <button
      type="button"
      className={active ? styles.galleryThumbOn : styles.galleryThumb}
      data-lightbox-thumbnail={index}
      data-lightbox-thumbnail-active={active ? 'true' : undefined}
      aria-label={`查看第 ${index + 1} 张：${item.title}`}
      aria-current={active ? 'true' : undefined}
      title={item.title}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onSelect(index)
      }}
    >
      {url ? (
        video ? (
          <video src={url} muted playsInline preload="metadata" />
        ) : (
          <img src={url} alt="" draggable={false} />
        )
      ) : (
        <IconImage size={16} />
      )}
    </button>
  )
}

export function LightboxLayer() {
  const store = useCanvasStore()
  const platform = usePlatform()
  const lightbox = useSyncExternalStore(store.subscribe, store.getLightbox, store.getLightbox)
  const assetHash = lightbox?.assetHash
  const gallery = lightbox?.gallery ?? []
  const galleryIndex = lightbox?.galleryIndex ?? 0
  const galleryItem = gallery[galleryIndex]
  const hasGalleryNavigation = gallery.length > 1
  const { url, mime } = useAssetMeta(assetHash)
  const isVideo = (mime ?? '').startsWith('video/')

  const stageRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const movedRef = useRef(false)
  const [stage, setStage] = useState<Rect | null>(null)
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null)
  const [vp, setVp] = useState<Viewport | null>(null)
  const [mode, setMode] = useState<EditorMode>('view')

  /**
   * 两种「框选模式」（见 store 里 `lightbox` 的注释）：
   *
   * - `cropFor` = 提取选区（§6.23）：确认后建一张带上下文的局部图；
   * - `faceFor` = 给情绪调节框脸（2026-10-06）：确认后**只写 `data.faceBox`**。
   *
   * 两者共用同一套框选交互，只有「确认之后干什么」不同。
   *
   * 选区存**原图像素坐标**（不是屏幕坐标）：缩放 / 平移时选区跟着图走，
   * 不必在每次 setVp 时重算，关掉也不会串味。
   */
  const cropFor = lightbox?.cropFor
  const faceFor = lightbox?.faceFor
  /**
   * 「裁剪」而不是「提取选区」（用户 2026-10-17，对账 #553）：同一个框选交互，
   * 但产出**不带选区上下文** —— 按框原样切一块，融不回原图。
   */
  const cropPlain = lightbox?.cropPlain === true
  const [cropRect, setCropRect] = useState<FusionRect | null>(null)
  const [cropRatio, setCropRatio] = useState('')
  const [busy, setBusy] = useState(false)
  const ratioValue = ratioValueOf(cropRatio)

  /**
   * 双击打开时不再要求调用方预先把某个编辑模式塞进 store：从当前素材反查它属于哪个节点，
   * 于是「查看 → 选区 / 标注 / 旋转」可以全在灯箱里切换。
   * 同一 hash 被多个节点引用时取第一个；这是编辑目标，不会用来改画布结构。
   */
  const ownerNode = (() => {
    if (!assetHash) return undefined
    return store.getSnapshot().nodes.find((n) => {
      const data = n.data as { assetHash?: unknown }
      return data.assetHash === assetHash
    })
  })()
  const ownerNodeId = ownerNode?.id ?? ''
  const cropNodeId = cropFor ?? faceFor ?? ownerNodeId
  const rotateNodeId = lightbox?.rotateFor ?? ownerNodeId
  const annotateNodeId = lightbox?.annotateFor ?? ownerNodeId
  const canCrop = !isVideo && !!cropNodeId
  const canAnnotate = !isVideo && !!annotateNodeId
  const canRotate = !isVideo && !!rotateNodeId
  const cropping = (mode === 'extract' || mode === 'crop' || mode === 'face') && canCrop
  const plainCrop = mode === 'crop'
  const rotating = mode === 'rotate' && canRotate
  const annotating = mode === 'annotate' && canAnnotate

  /**
   * 打开素材时先尊重调用方的显式意图（节点工具栏点「旋转 / 标注 / 提取选区」），
   * 普通双击 / 日志缩略图进来则落在「查看」。之后用户在顶部模式条里切换，
   * 不再被 store 里的旧意图扳回去。
   */
  useEffect(() => {
    if (!assetHash) {
      setMode('view')
      return
    }
    /**
     * 融合结果的原图配对写在**节点数据**里（`data.compareWith`），不在 `lightbox` 上；
     * 双击它进来同样应该直接出现「对比」这一档，不能只看调用方显式传的 compareWith。
     */
    const nodeHasComparePair = store.getSnapshot().nodes.some((n) => {
      const data = n.data as { assetHash?: unknown; compareWith?: unknown }
      return data.assetHash === assetHash && typeof data.compareWith === 'string'
    })
    setMode(
      faceFor
        ? 'face'
        : cropFor
          ? cropPlain
            ? 'crop'
            : 'extract'
        : lightbox?.rotateFor
          ? 'rotate'
          : lightbox?.annotateFor
            ? 'annotate'
            : lightbox?.compareWith || nodeHasComparePair
              ? 'compare'
              : 'view',
    )
  }, [
    assetHash,
    store,
    cropFor,
    cropPlain,
    faceFor,
    lightbox?.rotateFor,
    lightbox?.annotateFor,
    lightbox?.compareWith,
  ])

  /**
   * 「对比原图」的配对从**产物节点自己**读（`GenerationData.compareWith`）。
   *
   * 不靠连线反推：连线是活状态（上游换图 / 删线都会变），而「这张结果是从哪张
   * 原图融出来的」在产出那一刻就定了。读不到配对（老节点 / 素材被删）时对比入口
   * 自动不出现 —— 不猜，也不给一个点不通的开关。
   */
  const compareHash = (() => {
    if (!assetHash) return null
    /**
     * **调用方显式给了配对就用它**（对比节点双击进来：那两张图来自两个不同的上游节点，
     * 节点上根本没有 `compareWith` 可读 —— 见 store 的 `openLightbox` 说明）。
     */
    if (lightbox?.compareWith) return lightbox.compareWith
    for (const n of store.getSnapshot().nodes) {
      const d = n.data as { assetHash?: string; compareWith?: string }
      if (d.assetHash === assetHash && d.compareWith) return d.compareWith
    }
    return null
  })()
  const compareAsset = useAssetMeta(compareHash ?? undefined)
  const compareUrl = compareAsset.url
  const compareIsVideo = (compareAsset.mime ?? '').startsWith('video/')
  const compareKind = lightbox?.compareKind === 'pair' ? 'pair' : 'result'
  const [compareView, setCompareView] = useState<CompareView>('first')
  const [splitRatio, setSplitRatio] = useState(0.5)
  /**
   * **旋转与镜像**（2026-10-16 搬进灯箱，见 store 的 `openRotateEditor`）。
   *
   * 三件状态与老那一层完全一样（角度 / 步长 / 两个镜像），只有落点变了：
   * 预览直接挂在灯箱自己那张 `<img>` 的 `transform` 上，于是**按住拖动平移、
   * 滚轮缩放**这些灯箱能力天然继续可用 —— 这正是用户要的「交互不变」。
   */
  const [angle, setAngle] = useState(0)
  const [rotateStep, setRotateStep] = useState(90)
  const [mirrorH, setMirrorH] = useState(false)
  const [mirrorV, setMirrorV] = useState(false)
  const [rotating2, setRotating2] = useState(false)
  /** 进旋转模式就归零：上一次的角度留着会让用户看到一张莫名其妙已经转过的图 */
  useEffect(() => {
    if (!lightbox?.rotateFor) return
    setAngle(0)
    setMirrorH(false)
    setMirrorV(false)
    setRotating2(false)
  }, [lightbox?.rotateFor])

  /**
   * **标注模式**（2026-10-16 从独立的全屏层 `AnnotateLayer` 搬进灯箱，见 store 的
   * `openAnnotateEditor`）。
   *
   * 落点与旋转那条**恰好相反**：旋转是把变换叠在灯箱那张 `<img>` 上；标注则是在图上
   * 再盖一层 `<canvas>`——因为标注要**累积像素动作**（一笔一笔画），不能靠 CSS 表达。
   *
   * 那一层画布与灯箱那张图**同一块矩形**（都用 `box`，连 1px 描边都一样）：于是
   * 「屏幕坐标 → 图片像素」只需要按这一块的比例换算一次，缩放 / 平移时标注自然跟图走，
   * 而且画布尺寸本身就是**原图像素**，保存时一个换算都不用做。
   *
   * 手势分工（用户 2026-10-16 定的口径）：**左键在画布上画**、**中键拖动画布**、
   * **滚轮缩放**（滚轮事件不拦，照旧冒到舞台）。左键被画占用这件事只发生在画布这一层，
   * 所以画布只 `stopPropagation` 左键，其余按键一律放行给舞台那条通用平移。
   */
  const [annTool, setAnnTool] = useState<AnnotateTool>('brush')
  const [annColor, setAnnColor] = useState<string>(ANNOTATE_COLORS[0])
  const [annSize, setAnnSize] = useState(6)
  const [annOps, setAnnOps] = useState<AnnotateOp[]>([])
  const [annTextItems, setAnnTextItems] = useState<AnnotateTextItem[]>([])
  const [selectedTextId, setSelectedTextId] = useState<string | null>(null)
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const [annUndone, setAnnUndone] = useState<AnnotateOp[]>([])
  const [annSaving, setAnnSaving] = useState(false)
  const annCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const annDrawingRef = useRef<AnnotateOp | null>(null)

  /** 每次进标注模式从空白开始（上一次的标注留着会直接盖在新图上） */
  useEffect(() => {
    if (!assetHash) return
    setAnnOps([])
    setAnnTextItems([])
    setSelectedTextId(null)
    setEditingTextId(null)
    setAnnUndone([])
    setAnnTool('brush')
  }, [assetHash, lightbox?.annotateFor])

  /**
   * 重画那层画布：**底图不画进来**（灯箱那张 `<img>` 就在它下面），只画标注操作。
   * 正在画的那一笔（`annDrawingRef`）也一起重放，所以拖动时是所见即所得。
   */
  const redrawAnn = useCallback(() => {
    const canvas = annCanvasRef.current
    if (!canvas || !canvas.width) return
    const g2 = canvas.getContext('2d')
    if (!g2) return
    g2.clearRect(0, 0, canvas.width, canvas.height)
    const all = annDrawingRef.current ? [...annOps, annDrawingRef.current] : annOps
    for (const op of all) drawAnnotateOp(g2, op)
  }, [annOps])

  useEffect(() => {
    void redrawAnn()
  }, [redrawAnn, natural, annotating])

  /**
   * 下载原图（用户 2026-10-14：画布灯箱「可以加下载原图的按钮」）。
   *
   * 与素材页那枚走**同一个入口**（`downloadAsset`）：能取到字节就落盘，取不到
   * （远端视频那类只有 URL 的素材）就交给浏览器开新标签 —— 回落逻辑在那个函数里，
   * 这里不重写一份。点完短暂显示「已下载」，与复制按钮同一套反馈口径。
   */
  const [downloaded, setDownloaded] = useState(false)
  const download = useCallback(async () => {
    if (!assetHash) return
    const r = await downloadAsset(
      { assets: platform.assets, files: platform.files },
      assetHash,
      ownerNode?.title,
    )
    if (!r.ok) return
    setDownloaded(true)
    window.setTimeout(() => setDownloaded(false), 1500)
  }, [assetHash, ownerNode?.title, platform])

  const close = useCallback(() => store.closeLightbox(), [store])
  const navigateGallery = useCallback(
    (delta: number) => store.navigateLightbox(delta),
    [store],
  )

  // Esc 关闭；多选灯箱支持左右键切换。打开时焦点落在「关闭」上。
  useEffect(() => {
    if (!assetHash) return
    closeRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      const editingText =
        e.target instanceof HTMLElement &&
        (e.target.isContentEditable ||
          e.target.tagName === 'INPUT' ||
          e.target.tagName === 'TEXTAREA')
      if (e.key === 'Escape' && !editingText) {
        e.preventDefault()
        close()
        return
      }
      if (
        mode === 'view' &&
        hasGalleryNavigation &&
        !editingText &&
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        e.preventDefault()
        navigateGallery(e.key === 'ArrowLeft' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [assetHash, close, hasGalleryNavigation, mode, navigateGallery])

  // 换素材 = 重新来过：尺寸未知、落位未定
  useEffect(() => {
    setNatural(null)
    setVp(null)
  }, [assetHash])

  /** 换图 / 换模式 = 选区作废（否则会把上一张图的框带到下一张上） */
  useEffect(() => {
    setCropRect(null)
    setCropRatio('')
  }, [assetHash, cropFor, faceFor])

  /**
   * 换素材 = 对比回到「结果」那一档、分割线回中线（别把上一张的视角带过来）。
   *
   * ⚠️ **例外：调用方显式给了对比配对时要直接进「对比」档**
   * （对比节点双击进来的入口，见 store 的 `openLightbox`）。
   * 这条复位效果会在**打开灯箱那一刻**跑（`assetHash` 从空变成那张图），
   * 一律复位成「结果」的话，那个入口等于白做 —— 用户看到的只是一张单图灯箱，
   * 还得自己再去点一下「对比」（用户 2026-10-16：「双击对比节点灯箱那个还没有做好」）。
   */
  useEffect(() => {
    setCompareView(lightbox?.compareWith ? 'split' : 'first')
    setSplitRatio(0.5)
  }, [assetHash, lightbox?.compareWith, compareKind])

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
    /**
     * **只有左键搬框**（用户 2026-10-16 定的手势分工：左键画框 / 改框、中键平移）。
     *
     * 不写这一句的后果很隐蔽：选框经常占掉大半张图，用户在中键平移时手正好落在框里，
     * 那一下就会变成「搬框」而视图纹丝不动 —— 而他以为自己按的是平移。
     * 非左键**直接放行**（不 `stopPropagation`），让它照旧冒到舞台那条通用平移去。
     */
    if (e.button !== 0) return
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
    /** 同 `startMove`：手柄也只有左键能拖，中键一律让给「平移视图」 */
    if (e.button !== 0) return
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

  /**
   * 确认框选。两种模式**确认之后干的事完全不同**：
   *
   * - **框脸**（`faceFor`）：把框换算成归一化值写进节点的 `data.faceBox`，**不建任何节点**。
   *   情绪调节的整条链路只有一次生成（用户 2026-10-06 定的口径），这里只是把
   *   「脸在哪」补上，接着由用户点「生成」。
   * - **提取选区**（`cropFor`）：裁剪 + 落库 + 在原图右侧建局部图 + 写上下文（都在 features 里）。
   */
  const confirmCrop = async () => {
    if (!cropRect) return
    if (faceFor) {
      if (!natural) return
      const box = faceBoxFromRect(cropRect, natural)
      if (!box) {
        store.notify('这个框太小了，重新拖一个大一点的', 'error')
        return
      }
      store.dispatch({ kind: 'node.updateData', id: faceFor, patch: { faceBox: box } })
      close()
      store.notify('已框好脸部：点「生成」开始')
      return
    }
    /**
     * 普通双击灯箱没有 `cropFor`：用从当前素材反查到的节点 id 作为提取目标；
     * 只有既没有显式目标、也没有归属节点时才无从下手。
     */
    const targetNodeId = cropFor ?? ownerNodeId
    if (!targetNodeId) return
    setBusy(true)
    /**
     * 两个用途走同一段实现、只有"切哪个矩形 + 写不写上下文"不同（见 `createPiece`）：
     * 裁剪按原框、不写上下文；提取选区外扩一圈、写上下文。
     */
    const out = plainCrop
      ? await cropAsset(
          { platform, store },
          { nodeId: targetNodeId, rect: cropRect, ratio: cropRatio },
        )
      : await extractSelection(
          { platform, store },
          { nodeId: targetNodeId, rect: cropRect, ratio: cropRatio },
        )
    setBusy(false)
    if (out.ok) {
      close()
      store.notify(
        plainCrop
          ? '已裁剪：新图已生成在原图右侧（不带选区上下文）'
          : '已提取选区：局部图已生成在原图右侧，并带上上下文',
      )
    } else {
      store.notify(out.reason, 'error')
    }
  }

  /** 事件坐标 → **图片像素**坐标（画布按 CSS 缩放过，必须按比例换算回去） */
  const annPointOf = (e: ReactPointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = e.currentTarget
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    }
  }

  /**
   * 标注画布上的按下：
   *
   * - **只接管左键**。中键要留给舞台那条通用平移（`onPointerDown` 里的 button 1 分支）——
   *   这里一旦无差别 `stopPropagation()`，用户在标注模式下就再也拖不动视图了。
   * - `stopPropagation` 不是可选项：不拦的话舞台会同时起手平移，画一笔 = 图跑一下。
   */
  const onAnnDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    e.stopPropagation()
    const p = annPointOf(e)
    if (annTool === 'text') {
      const item: AnnotateTextItem = {
        id: createId('text'),
        x: p.x,
        y: p.y,
        text: '',
        color: annColor,
        fontSize: clampAnnotateTextSize(Math.max(14, annSize * 5)),
      }
      setAnnTextItems((prev) => [...prev, item])
      setSelectedTextId(item.id)
      /**
       * 等这次 pointerdown / pointerup / click 序列走完再挂编辑框。
       * 立刻挂会被随后的 click 抢走焦点，textarea 一 mount 就 blur，用户看不到光标。
       */
      window.setTimeout(() => setEditingTextId(item.id), 0)
      return
    }
    e.currentTarget.setPointerCapture(e.pointerId)
    annDrawingRef.current = { tool: annTool, color: annColor, size: annSize, points: [p] }
    redrawAnn()
  }

  const onAnnMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const draw = annDrawingRef.current
    if (!draw) return
    const p = annPointOf(e)
    if (draw.tool === 'brush') draw.points.push(p)
    else draw.points[1] = p
    redrawAnn()
  }

  const onAnnUp = () => {
    const draw = annDrawingRef.current
    annDrawingRef.current = null
    if (!draw) return
    const a = draw.points[0]
    const b = draw.points[1]
    /** 矩形太小的算误触（与老那一层同一条判据：短边不足 3px 的白点没有意义） */
    const tooSmall =
      draw.tool === 'rect' && (!a || !b || (Math.abs(b.x - a.x) < 3 && Math.abs(b.y - a.y) < 3))
    if (tooSmall) {
      redrawAnn()
      return
    }
    setAnnOps((prev) => [...prev, draw])
    setAnnUndone([])
  }

  const patchTextItem = (id: string, patch: Partial<AnnotateTextItem>) => {
    setAnnTextItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }

  const deleteTextItem = (id: string) => {
    setAnnTextItems((prev) => prev.filter((item) => item.id !== id))
    setSelectedTextId((current) => (current === id ? null : current))
    setEditingTextId((current) => (current === id ? null : current))
  }

  /** 选中的文字提到数组末尾 —— DOM 顺序就是图层顺序，保存时也按同一顺序画。 */
  const selectTextItem = (id: string) => {
    setSelectedTextId(id)
    setAnnTextItems((prev) => {
      const item = prev.find((x) => x.id === id)
      if (!item || prev[prev.length - 1]?.id === id) return prev
      return [...prev.filter((x) => x.id !== id), item]
    })
  }

  const startTextMove = (e: ReactPointerEvent, item: AnnotateTextItem) => {
    if (e.button !== 0 || !vp) return
    e.stopPropagation()
    e.preventDefault()
    selectTextItem(item.id)
    setEditingTextId(null)
    const start = { x: e.clientX, y: e.clientY }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / vp.zoom
      const dy = (ev.clientY - start.y) / vp.zoom
      setAnnTextItems((prev) =>
        prev.map((current) =>
          current.id === item.id
            ? moveAnnotateText(item, dx, dy, natural ? { w: natural.w, h: natural.h } : undefined)
            : current,
        ),
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const startTextResize = (e: ReactPointerEvent, item: AnnotateTextItem) => {
    if (e.button !== 0 || !vp) return
    e.stopPropagation()
    e.preventDefault()
    selectTextItem(item.id)
    setEditingTextId(null)
    const startX = e.clientX
    const move = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX) / vp.zoom
      setAnnTextItems((prev) =>
        prev.map((current) =>
          current.id === item.id
            ? resizeAnnotateText(item, item.fontSize + delta)
            : current,
        ),
      )
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Delete / Backspace 删掉当前文字图层；正在编辑文字时不抢键。 */
  useEffect(() => {
    if (!annotating || !selectedTextId || editingTextId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      e.preventDefault()
      deleteTextItem(selectedTextId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [annotating, selectedTextId, editingTextId])

  /** 撤销 / 重做 = 把操作列表切一刀（重放即得画面，不需要存快照） */
  const undoAnn = () => {
    setAnnOps((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]!
      setAnnUndone((u) => [last, ...u])
      return prev.slice(0, -1)
    })
  }

  const redoAnn = () => {
    setAnnUndone((prev) => {
      if (prev.length === 0) return prev
      const [first, ...rest] = prev
      setAnnOps((o) => [...o, first!])
      return rest
    })
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
    /**
     * **提取选区/框脸模式：左键画框、中键（滚轮键）平移**（用户 2026-10-16 定的口径）。
     *
     * 灯箱本来就有两条平移入口（左键拖、中键拖），框选模式下左键被框占用，
     * 所以这里只把**左键**让给画框；中键照旧落到下面那条通用平移分支 ——
     * 于是「一边画框一边平移视图」这件事不用再额外做模式切换。
     *
     * 中键还要 `preventDefault()`：不拦的话浏览器会同时启动自己的「中键自动滚动」。
     */
    if (cropping && e.button === 0) {
      startCrop(e)
      return
    }
    if (e.button === 1) e.preventDefault()
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
  /**
   * 旋转模式：预览直接挂在灯箱这张图上（用户 2026-10-16：「交互不变，可以拖动，缩放」）——
   * `box` 管的是它在舞台里的矩形，`transform` 只叠在自己身上，两者不冲突。
   */
  const normalizedAngle = ((angle % 360) + 360) % 360
  const mediaStyle =
    rotating && box
      ? {
          ...box,
          transformOrigin: '50% 50%',
          transform: `rotate(${angle}deg) scaleX(${mirrorH ? -1 : 1}) scaleY(${mirrorV ? -1 : 1})`,
        }
      : box
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
  /**
   * 「确认」可用：两种框选模式共用同一套判据（拖了一个够大的框）。
   * 短边下限仍是 `FUSION_MIN_EDGE` —— 它管的是「这个框是认真拖的，不是误触」，
   * 与框完之后是建局部图还是写人脸框无关。
   */
  const canConfirm =
    cropping && !!cropRect && Math.min(cropRect.w, cropRect.h) >= FUSION_MIN_EDGE

  /**
   * 保存旋转结果：把变换**真画进像素**并写回节点。
   *
   * 这段逻辑（算尺寸 → canvas 烘焙 → 落新素材 → 写回节点 → 节点框跟着新比例走）
   * 与 UI 无关，已抽到 `rotate/bakeRotate`，与老那一层**共用同一份实现** ——
   * 不共用就会两套逻辑漂移，而这个仓库已经为此踩过好几次。
   */
  const saveRotation = async () => {
    const nodeId = rotateNodeId
    if (!nodeId || rotating2 || !primaryUrl) return
    const graph = store.getSnapshot()
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    setRotating2(true)
    try {
      await saveRotatedAsset({ store, graph, node, url: primaryUrl, angle, mirrorH, mirrorV })
      close()
    } finally {
      setRotating2(false)
    }
  }

  /**
   * 保存标注：把「底图 + 全部标注」合成一张新图，落到**原图右侧的新节点**上。
   * 合成那一段与 UI 无关，在 `annotate/bakeAnnotate` 里（与老那一层同一份实现）。
   */
  const saveAnnotation = async () => {
    const nodeId = annotateNodeId
    if (!nodeId || annSaving || !url) return
    const graph = store.getSnapshot()
    const node = graph.nodes.find((n) => n.id === nodeId)
    if (!node) return
    setAnnSaving(true)
    try {
      const id = await saveAnnotatedAsset({
        store,
        graph,
        node,
        url,
        ops: annOps,
        textItems: annTextItems,
      })
      /** 落地就选中它（与老那一层同一手感：保存完眼睛已经在那张新图上） */
      if (id) store.setSelection([id])
      close()
    } finally {
      setAnnSaving(false)
    }
  }

  /** 有真实配对、两边都是图才给「对比」入口；是否处于该模式由 `mode` 决定。 */
  const compareAvailable = !!compareHash && !!compareUrl && !isVideo && !compareIsVideo
  const view: CompareView = mode === 'compare' && compareAvailable ? compareView : 'first'
  const splitActive = view === 'split'
  const showSecondOnly = view === 'second'
  const compareViews =
    compareKind === 'pair'
      ? [
          { id: 'first' as const, label: 'A · 左' },
          { id: 'split' as const, label: '对比' },
          { id: 'second' as const, label: 'B · 右' },
        ]
      : [
          { id: 'first' as const, label: '结果' },
          { id: 'split' as const, label: '对比' },
          { id: 'second' as const, label: '原图' },
        ]
  const compareLeftHash = compareKind === 'pair' ? assetHash : compareHash
  const compareRightHash = compareKind === 'pair' ? compareHash : assetHash
  /** 主图：切到第二张时换成 compareWith（整块几何仍按 assetHash 那张算） */
  const primaryUrl = showSecondOnly ? (compareUrl ?? url) : url
  const primaryIsVideo = showSecondOnly ? compareIsVideo : isVideo
  const compareClipPath =
    compareKind === 'pair'
      ? `inset(0 0 0 ${(splitRatio * 100).toFixed(3)}%)`
      : `inset(0 ${((1 - splitRatio) * 100).toFixed(3)}% 0 0)`
  /** 分割线位置：只改本地瞬时值，不进撤销栈（与对比节点同一口径） */
  const splitAt = (clientX: number, stageRect: Rect): number => {
    if (!box || box.width <= 0) return splitRatio
    const rel = clientX - stageRect.x - box.left
    return Math.min(0.95, Math.max(0.05, rel / box.width))
  }
  const startSplitDrag = (e: ReactPointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    /**
     * ⚠️ **拖分割线不算「一次单击」**（用户 2026-10-16：「拖动对比线之后会把灯箱状态取消」）。
     *
     * 舞台的 `onClick` 是「没拖过的单击就关灯箱」，判据是 `movedRef`。而拖分割线走的是
     * 自己这一套 window 监听，从不碰 `movedRef` —— 于是松手时那个 click 冒到舞台上，
     * 被判成「没拖过」，**灯箱当场被关掉**。这里补一句即可（下面那个 `onClick` 再拦一道）。
     */
    movedRef.current = true
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

  const selectedTextItem = annTextItems.find((item) => item.id === selectedTextId) ?? null
  const availableModes = EDITOR_MODES.filter((m) => {
    if (m.id === 'view') return true
    if (m.id === 'extract') return canCrop && !faceFor
    if (m.id === 'crop') return canCrop && !faceFor
    if (m.id === 'face') return canCrop && !!faceFor
    if (m.id === 'annotate') return canAnnotate
    if (m.id === 'rotate') return canRotate
    return compareAvailable
  })

  return (
    <div
      className={styles.overlay}
      data-lightbox
      // 当前展示的素材 hash：灯箱按 hash 取图，这里把它暴露出来，
      // 「灯箱显示的到底是不是这个节点的图」才可断言（否则只能比像素，纯色图比不出来）
      data-lightbox-hash={assetHash ?? ''}
      data-lightbox-gallery={hasGalleryNavigation ? 'true' : undefined}
      data-lightbox-gallery-index={hasGalleryNavigation ? galleryIndex : undefined}
      data-lightbox-gallery-title={galleryItem?.title}
      data-lightbox-mode={mode}
      // 对比原图：配对上时暴露当前档位与实际展示的 hash，供断言（§6.23）
      data-lightbox-compare={mode === 'compare' && compareAvailable ? view : undefined}
      data-lightbox-shown-hash={showSecondOnly ? (compareHash ?? '') : (assetHash ?? '')}
      data-lightbox-compare-kind={mode === 'compare' && compareAvailable ? compareKind : undefined}
      data-lightbox-compare-left-hash={
        mode === 'compare' && compareAvailable ? (compareLeftHash ?? undefined) : undefined
      }
      data-lightbox-compare-right-hash={
        mode === 'compare' && compareAvailable ? (compareRightHash ?? undefined) : undefined
      }
      role="dialog"
      aria-modal="true"
      aria-label={
        hasGalleryNavigation
          ? `素材灯箱，第 ${galleryIndex + 1} / ${gallery.length} 张${galleryItem?.title ? `：${galleryItem.title}` : ''}`
          : '素材灯箱'
      }
    >
      <div
        ref={stageRef}
        className={styles.stage}
        data-lightbox-stage
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onClick={() => {
          // 编辑模式不吃空白单击关闭：刚框好的框、刚画的一笔、正在旋转的预览不能被误点清掉
          if (cropping || mode === 'annotate' || mode === 'rotate') return
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
              style={mediaStyle}
              onLoadedMetadata={(e) =>
                setNatural({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })
              }
              /**
               * ⚠️ **`pointerdown` 一律放行给舞台**（用户 2026-10-16：「拖动无法进行拖动图片」）。
               *
               * 平移是舞台那一层起手的；这里原先在非框选模式下 `stopPropagation()`，
               * 于是**按在图上**（最自然的位置）拖——拖不动，只有按在图片外的留白上才行。
               * 单击关闭仍然由下面那个 `onClick` 拦住（点图不该关灯箱），两件事分开。
               */
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
              style={mediaStyle}
              onLoad={(e) => {
                /**
                 * 切到第二张时**不改** `natural`：box / 选区 / 分割线全部按
                 * assetHash 那张的尺寸算，两张尺寸万一不同也不会让整块视图跳一下。
                 */
                if (!showSecondOnly) {
                  setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
                }
              }}
              /** 同上：`pointerdown` 让给舞台起手平移（框选模式下本来就是让的） */
              onClick={(e) => {
                if (!cropping) e.stopPropagation()
              }}
            />
          ))}
        {/*
          * 对比档按 compareKind 决定叠放方向：result = 左原图 / 右结果；
          * pair = 左 A / 右 B。两档都只改裁剪路径，不另写一套分割线。
          */}
        {placed && splitActive && compareUrl && box && (
          <>
            <img
              className={styles.media}
              data-lightbox-compare-media
              src={compareUrl}
              alt=""
              draggable={false}
              style={{ ...box, clipPath: compareClipPath }}
              /**
               * ⚠️ **这里不要拦 `pointerdown`**（用户 2026-10-16：「灯箱内的图片能进行鼠标拖动视图」）。
               *
               * 拦掉的后果是：对比模式下压在 B（右半）上拖**什么都拖不动** ——
               * 平移是靠舞台那一层的 `onPointerDown` 起手的，被这里一个 stopPropagation
               * 全挡掉。分割线自己有手柄（在更上面一层、自己带 `onPointerDown`），
               * 不需要靠拦整张图来让路。
               */
              onClick={(e) => e.stopPropagation()}
            />
            <div className={styles.compareTags} style={box} data-lightbox-compare-tags>
              <span className={styles.compareTag} data-lightbox-compare-tag="left">
                {compareKind === 'pair' ? 'A · 左' : '原图'}
              </span>
              <span className={styles.compareTag} data-lightbox-compare-tag="right">
                {compareKind === 'pair' ? 'B · 右' : '结果'}
              </span>
            </div>
            <div
              className={styles.compareDivider}
              data-lightbox-compare-divider
              data-lightbox-compare-ratio={splitRatio.toFixed(3)}
              style={{ left: box.left + box.width * splitRatio, top: box.top, height: box.height }}
              onPointerDown={startSplitDrag}
              /** 再拦一道 click：万一手柄被别的东西接走 pointerup，也不会冒到舞台去关灯箱 */
              onClick={(e) => e.stopPropagation()}
            >
              <span className={styles.compareKnob} />
            </div>
          </>
        )}
        {/*
          * 标注画布（2026-10-16 从独立的全屏标注层搬进灯箱，见 store 的 `openAnnotateEditor`）。
          *
          * 它与灯箱那张图**同一块矩形**（都用 `box`，连那 1px 描边都一样）：两边「指定的
          * 宽高 + 描边」完全相同，于是内容框在任何 `box-sizing` 下都对得上 —— 标注坐标
          * 天然就是图片像素，缩放 / 平移时跟着图一起走，保存时一次换算都不用做。
          * `width/height` **属性**给的是原图像素，CSS 那对宽高才是屏幕尺寸。
          *
          * 它盖在图上，所以只在这里接管左键（画）；中键照旧冒到舞台那条通用平移去。
          */}
        {annotating && box && natural && (
          <canvas
            ref={annCanvasRef}
            className={styles.annotateCanvas}
            data-annotate-layer
            data-annotate-canvas
            style={box}
            width={natural.w}
            height={natural.h}
            onPointerDown={onAnnDown}
            onPointerMove={onAnnMove}
            onPointerUp={onAnnUp}
            onPointerCancel={onAnnUp}
            /** 画完一笔松手也会触发 click：别让它冒到舞台去（舞台那条是「单击空白关灯箱」） */
            onClick={(e) => e.stopPropagation()}
          />
        )}
        {annotating && box && vp && (
          <div className={styles.annTextLayer} data-annotate-text-layer>
            {annTextItems.map((item) => {
              const selected = selectedTextId === item.id
              const editing = editingTextId === item.id
              const active = annTool === 'text'
              const lines = item.text.split('\n')
              const fontScreen = item.fontSize * vp.zoom
              return (
                <div
                  key={item.id}
                  className={active ? styles.annTextItemOn : styles.annTextItem}
                  data-annotate-text-item={item.id}
                  data-annotate-text-editing={editing ? 'true' : 'false'}
                  data-annotate-text-selected={selected ? 'true' : 'false'}
                  style={{
                    left: box.left + item.x * vp.zoom,
                    top: box.top + item.y * vp.zoom,
                    color: item.color,
                    fontSize: fontScreen,
                  }}
                  onPointerDown={(e) => startTextMove(e, item)}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    selectTextItem(item.id)
                    setEditingTextId(item.id)
                  }}
                >
                  {editing ? (
                    <textarea
                      className={styles.annTextEditor}
                      data-annotate-text-editor={item.id}
                      value={item.text}
                      autoFocus
                      spellCheck={false}
                      style={{
                        width: Math.max(
                          120,
                          Math.max(...lines.map((line) => line.length), 1) * fontScreen * 0.72 + 16,
                        ),
                        height: lines.length * fontScreen * 1.2 + 12,
                      }}
                      onChange={(e) => patchTextItem(item.id, { text: e.target.value })}
                      onFocus={(e) => e.currentTarget.select()}
                      onPointerDown={(e) => e.stopPropagation()}
                      onBlur={(e) => {
                        setEditingTextId(null)
                        if (!e.currentTarget.value.trim()) deleteTextItem(item.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' || e.shiftKey) return
                        e.preventDefault()
                        e.currentTarget.blur()
                      }}
                    />
                  ) : (
                    <span className={selected ? styles.annTextBodyOn : styles.annTextBody}>
                      {item.text}
                    </span>
                  )}
                  {selected && active && !editing ? (
                    <span
                      className={styles.annTextResize}
                      data-annotate-text-resize={item.id}
                      title="拖动缩放文字"
                      onPointerDown={(e) => startTextResize(e, item)}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
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
      {hasGalleryNavigation && mode === 'view' ? (
        <>
          <button
            type="button"
            className={`${styles.galleryNav} ${styles.galleryPrev}`}
            data-lightbox-prev
            title="上一张（←）"
            aria-label="上一张"
            onClick={() => navigateGallery(-1)}
          >
            <IconChevronLeft size={22} />
          </button>
          <button
            type="button"
            className={`${styles.galleryNav} ${styles.galleryNext}`}
            data-lightbox-next
            title="下一张（→）"
            aria-label="下一张"
            onClick={() => navigateGallery(1)}
          >
            <IconChevronRight size={22} />
          </button>
        </>
      ) : null}
      {mode !== 'view' ? (
      <div className={styles.hud}>
        {/*
          * 对比三档：first / split / second 并排；标签由 compareKind 决定
          * （融合结果 = 结果/对比/原图，对比节点 = A·左/对比/B·右）。
          */}
        {mode === 'compare' && compareAvailable && (
          <div className={styles.compareGroup} data-lightbox-compare-group>
            {compareViews.map((v) => (
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
        {/**
          * **旋转与镜像模式**（2026-10-16 从独立层搬进灯箱）：
          * 用的是灯箱自己那套按钮样式（`.close` / `.compareOff|On` / `.confirm`），
          * 与前后的「提取选区」条、对比三档同一口径 —— 这就是用户要的「统一设计」。
          */}
        {rotating ? (
          <div className={styles.cropBar} data-rotate-toolbar>
            <button
              type="button"
              className={styles.editorClose}
              data-rotate-close
              title="返回查看"
              aria-label="返回查看"
              onClick={() => setMode('view')}
            >
              <IconClose size={16} />
              <span>旋转与镜像</span>
            </button>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={styles.editorTool}
              data-rotate-left
              title={`逆时针转 ${rotateStep}°`}
              aria-label="逆时针转"
              onClick={() => setAngle((a) => a - rotateStep)}
            >
              <IconUndo size={16} />
            </button>
            <span className={styles.editorAngle} data-rotate-angle>
              {normalizedAngle}°
            </span>
            <button
              type="button"
              className={styles.editorTool}
              data-rotate-right
              title={`顺时针转 ${rotateStep}°`}
              aria-label="顺时针转"
              onClick={() => setAngle((a) => a + rotateStep)}
            >
              <IconRedo size={16} />
            </button>
            <label className={styles.editorStepWrap}>
              <span className={styles.ratioLabel}>步长</span>
              <input
                className={styles.editorStep}
                data-rotate-step
                type="number"
                min={1}
                max={180}
                step={1}
                value={rotateStep}
                onChange={(e) => {
                  const n = Number(e.target.value)
                  if (Number.isFinite(n) && n >= 1 && n <= 180) setRotateStep(Math.round(n))
                }}
              />
              <span className={styles.ratioLabel}>°</span>
            </label>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={mirrorH ? styles.editorToolOn : styles.editorTool}
              data-rotate-mirror-h
              aria-pressed={mirrorH}
              title="左右镜像"
              onClick={() => setMirrorH((v) => !v)}
            >
              <IconMirrorH size={16} />
            </button>
            <button
              type="button"
              className={mirrorV ? styles.editorToolOn : styles.editorTool}
              data-rotate-mirror-v
              aria-pressed={mirrorV}
              title="上下镜像"
              onClick={() => setMirrorV((v) => !v)}
            >
              <IconMirrorV size={16} />
            </button>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={styles.editorSave}
              data-rotate-save
              disabled={rotating2}
              onClick={() => void saveRotation()}
            >
              <IconCheck size={16} />
              <span>{rotating2 ? '保存中…' : '保存'}</span>
            </button>
          </div>
        ) : annotating ? (
          /**
           * **标注模式**（2026-10-16 从独立的全屏标注层搬进灯箱）。
           *
           * 工具条按用户列的顺序排，一个不少：✕ / 画笔 / 矩形 / 文字 / 颜色 / 粗细 /
           * 撤销 / 重做 / 保存。控件全部复用灯箱自己那套（`.compareOff` / `.compareOn`
           * / `.close` / `.confirm`），与前后的「提取选区」条、旋转条同一口径 ——
           * 这就是用户要的「统一设计」。
           */
          <div className={styles.cropBar} data-annotate-toolbar>
            <button
              type="button"
              className={styles.editorClose}
              data-annotate-close
              title="返回查看"
              aria-label="返回查看"
              onClick={() => setMode('view')}
            >
              <IconClose size={16} />
              <span>标注</span>
            </button>
            <span className={styles.barDivider} />
            {ANNOTATE_TOOLS.map((t) => (
              <button
                key={t.id}
                type="button"
                className={t.id === annTool ? styles.editorToolOn : styles.editorTool}
                data-annotate-tool={t.id}
                aria-pressed={t.id === annTool}
                aria-label={t.label}
                title={t.label}
                onClick={() => setAnnTool(t.id)}
              >
                {t.icon}
              </button>
            ))}
            <span className={styles.barDivider} />
            {/* 颜色：固定色板（圆点即色样，选中的加一圈环） */}
            {ANNOTATE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                className={c === annColor ? styles.swatchOn : styles.swatch}
                data-annotate-color={c}
                aria-pressed={c === annColor}
                aria-label={`颜色 ${c}`}
                style={{ background: c }}
                onClick={() => {
                  setAnnColor(c)
                  if (selectedTextId) patchTextItem(selectedTextId, { color: c })
                }}
              />
            ))}
            {/* 粗细：画笔 / 矩形描边共用一条滑杆（用户原话：「画笔/矩形描边的大小」） */}
            <label className={styles.annSizeWrap}>
              <span className={styles.ratioLabel}>{annTool === 'text' ? '字号' : '粗细'}</span>
              <input
                className={styles.annSize}
                data-annotate-size
                type="range"
                min={2}
                max={48}
                value={
                  annTool === 'text' && selectedTextItem
                    ? Math.min(48, Math.max(2, Math.round(selectedTextItem.fontSize / 5)))
                    : annSize
                }
                onChange={(e) => {
                  const next = Number(e.target.value)
                  setAnnSize(next)
                  if (annTool === 'text' && selectedTextId) {
                    patchTextItem(selectedTextId, { fontSize: Math.max(14, next * 5) })
                  }
                }}
              />
              <span className={styles.annSizeValue}>
                {annTool === 'text' && selectedTextItem
                  ? clampAnnotateTextSize(selectedTextItem.fontSize)
                  : annSize}
              </span>
            </label>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={styles.editorTool}
              data-annotate-tool="undo"
              aria-label="撤销"
              title="撤销"
              disabled={annOps.length === 0}
              onClick={undoAnn}
            >
              <IconUndo size={16} />
            </button>
            <button
              type="button"
              className={styles.editorTool}
              data-annotate-tool="redo"
              aria-label="重做"
              title="重做"
              disabled={annUndone.length === 0}
              onClick={redoAnn}
            >
              <IconRedo size={16} />
            </button>
            <button
              type="button"
              className={styles.editorTool}
              data-annotate-text-delete
              aria-label="删除选中的文字"
              title="删除选中的文字"
              disabled={!selectedTextItem}
              onClick={() => {
                if (selectedTextId) deleteTextItem(selectedTextId)
              }}
            >
              <IconDelete size={16} />
            </button>
            <span className={styles.barDivider} />
            <button
              type="button"
              className={styles.editorSave}
              data-annotate-save
              disabled={annSaving}
              onClick={() => void saveAnnotation()}
            >
              <IconCheck size={16} />
              <span>{annSaving ? '保存中…' : '保存'}</span>
            </button>
          </div>
        ) : cropping ? (
          /**
           * 比例档与两个按钮**放在同一组里**（用户 2026-09-30：「提取选区按钮与比例档
           * 要放在一起」，首版被中间的 spacer 拆到左右两头，眼睛要来回跳）。
           *
           * **框脸模式没有比例档**：那是「裁出来那张图的长宽比」的参数，对一个
           * 「告诉你脸在哪」的框没有意义，比例吸附反而会把框拉扁。
           */
          <div className={styles.cropBar} data-lightbox-crop-bar>
            {!faceFor && (
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
                <span className={styles.barDivider} />
              </>
            )}
            {plainCrop && !faceFor && (
              <span className={styles.cropHint} data-lightbox-crop-hint>
                裁剪不带选区上下文，融不回原图
              </span>
            )}
            <button
              type="button"
              className={styles.editorClose}
              data-lightbox-crop-cancel
              onClick={() => setMode('view')}
            >
              取消
            </button>
            <button
              type="button"
              className={styles.editorSave}
              data-lightbox-crop-apply
              disabled={!canConfirm || busy}
              title={
                canConfirm
                  ? faceFor
                    ? '用这个框当这张脸的位置，回到面板点「生成」'
                    : plainCrop
                      ? '按当前框裁下这一块（不带选区上下文，不能当融合节点的局部修改图）'
                      : '按当前框提取局部图，并保留上下文'
                  : `先在图上拖一个框（短边至少 ${FUSION_MIN_EDGE}px）`
              }
              onClick={() => void confirmCrop()}
            >
              {busy
                ? plainCrop
                  ? '裁剪中…'
                  : '提取中…'
                : faceFor
                  ? '用这个框'
                  : plainCrop
                    ? '裁剪'
                    : '提取选区'}
            </button>
          </div>
        ) : null}
      </div>
      ) : null}
      {hasGalleryNavigation && mode === 'view' ? (
        <div
          className={styles.galleryStrip}
          data-lightbox-thumbnails
          onPointerDown={(event) => event.stopPropagation()}
        >
          {gallery.map((item, index) => (
            <GalleryThumb
              key={`${item.nodeId}:${item.assetHash}`}
              item={item}
              index={index}
              active={index === galleryIndex}
              onSelect={store.selectLightboxIndex}
            />
          ))}
        </div>
      ) : null}
      {/*
       * 固定底栏：左侧像素 / 缩放，中间是能力切换，右侧是最常用的下载 / 关闭。
       * 上方只留给当前编辑器的完整工具条，和旧版全屏编辑器保持同一种阅读顺序。
       */}
      <div className={styles.bottomBar} data-lightbox-bottom-bar>
        <div className={styles.bottomLeft}>
          {hasGalleryNavigation ? (
            <span
              className={styles.chip}
              data-lightbox-gallery-counter
              aria-live="polite"
              title={galleryItem?.title}
            >
              {galleryIndex + 1} / {gallery.length}
            </span>
          ) : null}
          <span className={styles.chip} data-lightbox-size>
            {natural ? `${natural.w} × ${natural.h}` : '—'}
          </span>
          <span className={styles.chip} data-lightbox-zoom>
            {vp ? `${Math.round(vp.zoom * 100)}%` : '—'}
          </span>
        </div>
        <div className={styles.modeBar} data-lightbox-mode-bar>
          {availableModes.map((m) => (
            <button
              key={m.id}
              type="button"
              className={mode === m.id ? styles.modeBtnOn : styles.modeBtn}
              data-lightbox-mode-button={m.id}
              aria-pressed={mode === m.id}
              onClick={() => setMode(m.id)}
            >
              {m.icon}
              <span>
                {m.id === 'extract'
                  ? '提取选区'
                  : m.id === 'crop'
                    ? '裁剪'
                    : m.id === 'face'
                      ? '框脸'
                      : m.label}
              </span>
            </button>
          ))}
        </div>
        <div className={styles.bottomRight}>
          <button
            type="button"
            className={styles.close}
            data-lightbox-download
            onClick={() => void download()}
          >
            {downloaded ? '已下载' : '下载原图'}
          </button>
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
    </div>
  )
}
