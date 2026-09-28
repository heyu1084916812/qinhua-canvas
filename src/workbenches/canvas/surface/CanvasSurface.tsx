import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  PointerEvent as ReactPointerEvent,
  MouseEvent as ReactMouseEvent,
  DragEvent as ReactDragEvent,
} from 'react'
import { useCanvasStore, useGraph, useViewportState } from '../storeContext'
import { useViewport } from '../../../features/canvas/useViewport'
import { useEdgeDrag } from '../../../features/canvas/useEdgeDrag'
import { useClipboardHotkeys, rememberPointer } from '../../../features/canvas/useClipboard'
import { isTextEntryElement, isActivationTarget } from '../../../features/shared/textTarget'
import { coalescePointerMove } from '../../../shared/rafThrottle'
import { screenToWorld, toWorldRect } from '../../../domain/canvas/geometry/coords'
import {
  firstNodeId,
  lastNodeId,
  nextNodeId,
  nearestInDirection,
  type NavDir,
} from '../../../domain/canvas/navigation/spatial'
import type { Rect } from '../../../domain/canvas/geometry/rect'
import { EdgeLayer } from '../layers/EdgeLayer'
import { NodeLayer } from '../layers/NodeLayer'
import { OverlayLayer } from '../layers/OverlayLayer'
import { PanelLayer } from '../panels/PanelLayer'
import { NodeFollowBar } from '../toolbar/NodeFollowBar'
import { CanvasNotice } from './CanvasNotice'
import { UndoBar } from './UndoBar'
import { Minimap } from './Minimap'
import { fitCanvasView } from './fitView'
import { ContextMenu } from '../menu/ContextMenu'
import { LinkMenu } from '../menu/LinkMenu'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { createAssetNode, importAssetFile, isImportableMedia, IMPORT_ACCEPT } from '../../../features/canvas/importAsset'
import { downloadAsset } from '../../../features/canvas/downloadAsset'
import type { ImportedAsset } from '../../../features/canvas/importAsset'
import { assetNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import styles from './CanvasSurface.module.css'

/** 中键：拖拽平移（无视是否选中节点，产品文档 §6.3） */
const MIDDLE_BUTTON = 1

/** 拖入多个文件时，相邻节点的水平间距 */
const IMPORT_GAP = 24

/** dataTransfer 里带的是文件（而不是画布内的节点拖拽） */
function draggedFiles(e: { dataTransfer: DataTransfer }): File[] {
  const types = Array.from(e.dataTransfer.types ?? [])
  if (!types.includes('Files')) return []
  return Array.from(e.dataTransfer.files ?? [])
}

/**
 * 画布工作台表面：视口变换容器 + 事件总线。
 * 平移方式（产品文档 §6.3）：空白处拖拽 / 空格 + 拖拽 / 中键拖拽（无视选中）；
 * 框选（§4.2 / §6.15 / §6.20）：Ctrl/Cmd + 空白拖拽 = 自由框选（替换选中），
 * Shift + 空白拖拽 = 框选追加；滚轮以光标为锚点缩放（10%–500%）。
 * 平移 / 缩放只改 transform 与 store.viewport，不触发节点重渲染（架构 §5.4）。
 *
 * 框选矩形存「surface 局部屏幕坐标」而非世界坐标：OverlayLayer 在 [data-world] 之外，
 * 不受视口 transform 影响，存世界坐标会导致缩放 / 平移后矩形与光标错位。
 */
export function CanvasSurface({
  onOpenSettings,
  onOpenSkills,
}: {
  onOpenSettings?: () => void
  /** 打开技能库（用户 2026-09-24）：由页面容器注入路由跳转 */
  onOpenSkills?: () => void
} = {}) {
  const store = useCanvasStore()
  const graph = useGraph()
  const viewport = useViewportState()
  const vp = useViewport(store)
  const ref = useRef<HTMLDivElement>(null)
  const [marquee, setMarquee] = useState<Rect | null>(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [importHover, setImportHover] = useState(false)
  const platform = usePlatform()
  /**
   * 下载节点自身素材（用户 2026-09-18）。
   *
   * 就地实现而不往页面容器透传：Surface 已经持有 platform（导入素材就走它），
   * 而跟随栏是 Surface 的子层。多绕一层页面只会让「谁能下载」这件事
   * 在两个文件里各说一半。
   */
  const handleDownload = useCallback(
    (nodeId: string) => {
      const node = store.getSnapshot().nodes.find((n) => n.id === nodeId)
      const hash = (node?.data as { assetHash?: string } | undefined)?.assetHash
      if (!hash) return
      void downloadAsset({ assets: platform.assets, files: platform.files }, hash).then((r) => {
        // 如实反馈：静默失败会让用户以为「下载坏了」，而其实是素材已不在表里
        if (!r.ok) {
          store.notify(r.reason === 'missing' ? '这张素材已不在素材库里' : '下载失败')
        }
      })
    },
    [platform, store],
  )
  const edgeDrag = useEdgeDrag(store)
  const edgeDragBegin = edgeDrag.begin
  // Ctrl/Cmd + C/V（§4.2）：剪贴板是模块级单例、不订阅，故不参与本组件重渲染
  useClipboardHotkeys(store)

  // 端点在节点层内按下，拖线草稿在连线层绘制：这里把 begin 下发给节点层。
  // useCallback 保证引用稳定 → memo(NodeLayer) 在平移帧不被父级重渲打断
  const beginEdgeDrag = useCallback(
    (e: ReactPointerEvent, nodeId: string, side: 'input' | 'output') => {
      if (!ref.current) return
      edgeDragBegin(e, nodeId, side, ref.current)
    },
    [edgeDragBegin],
  )

  const rectOf = () => {
    const r = ref.current!.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }

  // 空格键跟踪：按住时进入平移模式（在文本框内输入空格时不接管）
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      // 文本框内要能打出空格；焦点在按钮上时空格应激活控件（无障碍 §4.5）
      if (isTextEntryElement(target) || isActivationTarget(target)) return
      e.preventDefault()
      setSpaceDown(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      setSpaceDown(false)
    }
    const reset = () => setSpaceDown(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])

  // Delete / Backspace 删除选中节点或连线（§6.20）；文本框内输入时不拦截
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if (isTextEntryElement(e.target as { tagName?: string } | null)) return
      const sel = store.getSelection()
      const edgeSel = store.getEdgeSelection()
      if (sel.length === 0 && edgeSel.length === 0) return
      e.preventDefault()
      if (sel.length > 0) store.dispatch({ kind: 'node.delete', ids: sel })
      for (const id of edgeSel) store.dispatch({ kind: 'edge.remove', id })
      store.setSelection([])
      store.setEdgeSelection([])
      // 删除是已落撤销栈的可恢复操作 → 弹撤销条（§6.12「底部撤销条保留 6 秒」）
      store.showUndoBar(sel.length > 0 ? '已删除节点' : '已删除连线')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  // 撤销 / 重做 / 视图复位 / Tab 空间导航 / 方向键切换 / Home End（§6.20）
  useEffect(() => {
    const topLevelNavNodes = () => {
      const g = store.getSnapshot()
      return g.nodes
        .filter((n) => !n.parentId)
        .map((n) => ({ id: n.id, rect: { x: n.x, y: n.y, w: n.w, h: n.h } }))
    }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as { tagName?: string; isContentEditable?: boolean } | null
      const inText = isTextEntryElement(target)

      // —— 撤销 / 重做 / 复位视图 ——
      // 文本输入元素内不拦截 Ctrl/Cmd+Z，让浏览器处理本地文本撤销
      if (e.code === 'KeyZ') {
        if (inText) return
        e.preventDefault()
        if (e.ctrlKey || e.metaKey) {
          if (e.shiftKey) store.redo()
          else store.undo()
        } else if (e.shiftKey) {
          store.redo()
        } else {
          // 单独 Z = 复位视图（§6.20）：缩放到全部节点可见（§6.3）
          fitCanvasView(store)
        }
        return
      }

      // —— 文本框 / 激活类控件（按钮等）内不接管 Tab，保留原生焦点移动（无障碍 §4.5） ——
      // 小地图有自己的一套导航（方向键平移 / Home 复位），焦点在它里面时这里整体让位
      if (inMinimap(e.target)) return
      if (e.key === 'Tab') {
        if (inText || isActivationTarget(target)) return
        const nodes = topLevelNavNodes()
        if (nodes.length === 0) return
        e.preventDefault()
        const sel = store.getSelection()
        const next = nextNodeId(nodes, sel.length ? sel[sel.length - 1] : null)
        if (next) store.setSelection([next])
        return
      }

      const dirMap: Record<string, NavDir> = {
        ArrowLeft: 'left',
        ArrowRight: 'right',
        ArrowUp: 'up',
        ArrowDown: 'down',
      }
      if (e.key in dirMap) {
        if (inText || isActivationTarget(target)) return
        const nodes = topLevelNavNodes()
        const sel = store.getSelection()
        // 尚无选中：方向键进入画布选中首个节点（与 Tab 一致）
        if (sel.length === 0) {
          const first = firstNodeId(nodes)
          if (first) {
            e.preventDefault()
            store.setSelection([first])
          }
          return
        }
        e.preventDefault()
        const target2 = nearestInDirection(nodes, sel[sel.length - 1], dirMap[e.key])
        if (target2) store.setSelection([target2])
        return
      }

      if (e.key === 'Home' || e.key === 'End') {
        if (inText || isActivationTarget(target)) return
        const nodes = topLevelNavNodes()
        const id = e.key === 'Home' ? firstNodeId(nodes) : lastNodeId(nodes)
        if (id) {
          e.preventDefault()
          store.setSelection([id])
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])

  /**
   * 滚轮缩放必须挂**非 passive** 的原生监听器。
   *
   * React 的 `onWheel` 走 passive 注册，回调里的 `preventDefault()` 会被浏览器
   * 直接忽略（控制台刷 `Unable to preventDefault inside passive event listener
   * invocation`）。后果不是「多滚了一点」：缩放画布的**同时**文档也在滚——
   * `body` 默认 8px 外边距配上 `.page` 的 100vh，恰好留出 16px 可滚区，
   * 于是缩小画布时整页上滚 16px，绝对定位的顶栏与左对齐工具栏跟着往上跳，
   * 而用户以为那是浮层自己在动（M6-29 实测 Δy = −16px，与可滚量一模一样）。
   *
   * 换成 `addEventListener('wheel', fn, { passive: false })` 后 preventDefault
   * 生效，滚轮彻底归画布：既不滚文档，Ctrl/⌘ + 滚轮（触控板捏合）也不会触发
   * 浏览器整页缩放。
   */
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      // 指针位于节点 / 面板文本框内时，滚轮归文本框处理（§6.3）
      if (isTextEntryElement(e.target as { tagName?: string } | null)) return
      e.preventDefault()
      vp.onWheel(e, rectOf())
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [vp])

  /**
   * 空白处拖入素材 → 就地落成生成节点。
   *
   * 这是「素材从哪来」的入口：批量套图这类模板要求用户往容器里塞素材，
   * 而此前画布根本没有导入通道（只有生成节点本体的 `+`，且它还因文件选择器
   * 参数非法而静默失败），模板等于开不了工。
   *
   * 落在**节点上**的拖放由节点自己处理并 `stopPropagation`，故这里只收空白处的。
   * 一次拖多张就横向依次排开——叠成一摞等于只导进了一张。
   */
  const onDropFiles = async (e: ReactDragEvent) => {
    const files = draggedFiles(e)
    if (files.length === 0) return
    e.preventDefault()
    setImportHover(false)

    const container = rectOf()
    const world = screenToWorld({ x: e.clientX, y: e.clientY }, store.getViewport(), container)
    const deps = { platform, store, projectId: store.getSnapshot().projectId }

    // 先取齐素材（异步），再**同步**建节点：计划区间内不夹 await，
    // 于是整批 import 真的合成一个撤销单元（§6.3「一次导入 = 一次撤销步骤」）
    const assets: ImportedAsset[] = []
    let rejected = 0
    for (const file of files) {
      if (file.type && !isImportableMedia(file.type)) {
        rejected += 1
        continue
      }
      const asset = await importAssetFile(deps, file)
      if (asset) assets.push(asset)
    }
    if (rejected > 0) store.notify(`跳过 ${rejected} 个文件：只支持图片 / 视频素材`)
    if (assets.length === 0) return

    const ids: string[] = []
    // `activePlan` 是单个变量 ⇒ 计划不可嵌套，故整批只开一次、createAssetNode 传 ownPlan=false
    store.beginPlan(`import:${assets.map((a) => a.hash.slice(0, 8)).join('-')}`, '导入素材')
    let offsetX = 0
    for (const asset of assets) {
      const size = assetNodeSize({ width: asset.width, height: asset.height })
      const id = createAssetNode(
        deps,
        asset,
        {
          x: Math.round(world.x + offsetX - size.w / 2),
          y: Math.round(world.y - size.h / 2),
        },
        false,
      )
      if (id) ids.push(id)
      offsetX += size.w + IMPORT_GAP
    }
    store.endPlan()

    if (ids.length > 0) {
      store.setSelection(ids)
      store.showUndoBar(`已导入 ${ids.length} 个素材`)
    }
  }

  // 右键菜单（§4.1）：空白 → 画布菜单；节点上 → 节点菜单（并选中该节点）。
  // 注意：不要对文本输入元素提前 return——节点正文常驻 textarea，右键仍需弹出节点菜单。
  const onContextMenu = (e: ReactMouseEvent) => {
    e.preventDefault()
    const container = rectOf()
    const x = e.clientX - container.x
    const y = e.clientY - container.y
    const nodeEl = (e.target as HTMLElement).closest('[data-node-id]')
    const nodeId = nodeEl?.getAttribute('data-node-id') ?? null
    if (nodeId) {
      if (!store.getSelection().includes(nodeId)) store.setSelection([nodeId])
      store.setMenu(x, y, { kind: 'node', nodeId })
    } else {
      store.setMenu(x, y, { kind: 'canvas' })
    }
  }

  /**
   * 捕获阶段接管：中键拖拽（无视是否选中节点）与空格 + 拖拽平移。
   * 在捕获阶段 stopPropagation，节点自身的拖拽逻辑不会被触发。
   */
  const onPointerDownCapture = (e: ReactPointerEvent) => {
    // 菜单上的按下一律不启动平移（同上：菜单在 surface 内，事件会冒泡进来）
    if (isInsideMenu(e.target)) return
    if (e.button === MIDDLE_BUTTON || (e.button === 0 && spaceDown)) {
      e.preventDefault()
      e.stopPropagation()
      vp.beginPan(e)
    }
  }

/**
 * 框选命中判定：只考虑**顶层节点**（无 parentId）。
 * 容器内子节点的 frame 由容器按网格摆放（local 坐标归零），
 * 它们的可视矩形不等于自身 x/y，纳入框选会产生「框了看不见的地方却选中」的错觉。
 */
function hitTestNodes(nodes: readonly { id: string; rect: Rect }[], world: Rect): string[] {
  return nodes.filter((n) => rectsIntersect(n.rect, world)).map((n) => n.id)
}

/**
 * 浮层菜单内部发生的按下**不是画布手势**。
 *
 * LinkMenu / ContextMenu 都渲染在 surface 之内（浮层要靠 surface 的局部屏幕坐标定位），
 * 于是点菜单项的 pointerdown 会一路冒泡到 surface 的 onPointerDown。此前这里只判
 * 「菜单开着没有」就 closeLinkMenu()，等于在点菜单项的第一帧就把菜单卸载了 ——
 * 后面的 mouseup / click 找不到目标，「新建并连接」点了没反应，只有菜单消失。
 *
 * 判定必须落到**按下的目标在不在菜单里**，不能只看菜单是否开着：
 * 这样既保住了「按画布空白处关菜单」，又不会误杀菜单自己的点击。
 */
function isInsideMenu(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-link-menu], [data-context-menu]')
}

const onPointerDown = (e: ReactPointerEvent) => {
  // 中键与空格平移已在捕获阶段处理，这里不再重复
  if (e.button !== 0 || spaceDown) return
  // 菜单内部的按下归菜单自己处理，不进画布手势（见 isInsideMenu 注释）
  if (isInsideMenu(e.target)) return
  /**
   * 连线菜单开着时，画布这一次按下只用来**关菜单**（§6.14「菜单打开期间画布指针
   * 事件不触发平移、框选或节点选择」）。否则一按空白：菜单刚弹出就被同一串事件
   * 里的平移判定吃掉，看起来像「菜单闪一下就没了」。
   */
  if (store.getLinkMenu()) {
    store.closeLinkMenu()
    return
  }
  const container = rectOf()
  // 框选矩形用「surface 局部屏幕坐标」：OverlayLayer 在 [data-world] 之外，
  // 若存 world 坐标则缩放 / 平移后矩形与光标对不上（M3-4 修复）。
  const startScreen = { x: e.clientX - container.x, y: e.clientY - container.y }
  const marqueeMode = e.ctrlKey || e.metaKey || e.shiftKey

  if (marqueeMode) {
    e.preventDefault()
    const additive = e.shiftKey && !e.ctrlKey && !e.metaKey
    setMarquee({ x: startScreen.x, y: startScreen.y, w: 0, h: 0 })
    const move = coalescePointerMove((ev: PointerEvent) => {
      const cx = ev.clientX - container.x
      const cy = ev.clientY - container.y
      setMarquee({
        x: Math.min(startScreen.x, cx),
        y: Math.min(startScreen.y, cy),
        w: Math.abs(cx - startScreen.x),
        h: Math.abs(cy - startScreen.y),
      })
    })
    const up = () => {
      move.flush()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setMarquee((current) => {
        if (current && (current.w > 2 || current.h > 2)) {
          const vp = store.getViewport()
          // 屏幕矩形 → 世界矩形（两角分别换算，缩放/平移都正确）
          const tl = screenToWorld(
            { x: container.x + current.x, y: container.y + current.y },
            vp,
            container,
          )
          const br = screenToWorld(
            { x: container.x + current.x + current.w, y: container.y + current.y + current.h },
            vp,
            container,
          )
          const worldRect: Rect = { x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }
          const hits = hitTestNodes(
            store
              .getSnapshot()
              .nodes.filter((n) => !n.parentId)
              .map((n) => ({ id: n.id, rect: toWorldRect(n) })),
            worldRect,
          )
          // Ctrl/Cmd 拖拽 = 替换选中；Shift 拖拽 = 追加到已有选中（§6.15）
          const merged = additive ? [...new Set([...store.getSelection(), ...hits])] : hits
          store.setSelection(merged)
        }
        return null
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return
  }

  // 空白单击：同时清空节点选择与连线选择（§6.14 / §6.15）
  store.setSelection([])
  store.setEdgeSelection([])
  vp.beginPan(e)
}

  const transform = `translate(${-viewport.x * viewport.zoom}px, ${-viewport.y * viewport.zoom}px) scale(${viewport.zoom})`

  return (
    <div
      ref={ref}
      className={`${styles.surface} ${spaceDown ? styles.spaceMode : ''}`}
      data-canvas-surface
      onPointerDownCapture={onPointerDownCapture}
      onPointerDown={onPointerDown}
      // 拖入素材：dragover 必须 preventDefault，否则浏览器按「不可放置」处理、根本不派发 drop
      onDragOver={(e) => {
        if (draggedFiles(e).length === 0) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setImportHover(true)
      }}
      onDragLeave={() => setImportHover(false)}
      onDrop={(e) => void onDropFiles(e)}
      data-import-hover={importHover ? 'true' : 'false'}
      data-import-accept={IMPORT_ACCEPT}
      // 只记坐标、不 setState：粘贴落点要用「当前鼠标位置」（§4.2）
      onPointerMove={(e) => rememberPointer({ x: e.clientX, y: e.clientY })}
      onContextMenu={onContextMenu}
      onAuxClick={(e) => {
        // 屏蔽中键的系统自动滚动
        if (e.button === MIDDLE_BUTTON) e.preventDefault()
      }}
    >
      {/* 连线层在 [data-world] 之外：SVG 根必须铺满 surface（屏幕空间），
          视口变换挂在它内部的 <g data-edge-world> 上。放回 0×0 的 .world 内会被
          Chrome 整块跳过绘制（DOM 与样式全正常、屏幕上却没有线） */}
      <EdgeLayer nodes={graph.nodes} edges={graph.edges} draft={edgeDrag.draft} />
      <div className={styles.world} data-world style={{ transform, transformOrigin: '0 0' }}>
        <NodeLayer onPortPointerDown={beginEdgeDrag} surfaceRef={ref} onOpenSettings={onOpenSettings} />
      </div>
      <OverlayLayer marquee={marquee} />
      <NodeFollowBar onOpenSettings={onOpenSettings} onDownload={handleDownload} />
      <PanelLayer onOpenSettings={onOpenSettings} onOpenSkills={onOpenSkills} />
      <ContextMenu />
      <LinkMenu />
      <CanvasNotice />
      <UndoBar />
      {/* 小地图（§6.4）：右下角导航浮层，最后渲染以免被别的浮层压住 */}
      <Minimap />
    </div>
  )
}

/** 事件是否发生在小地图里（小地图自带键盘导航，画布这套让位） */
function inMinimap(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-canvas-minimap]') !== null
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}
