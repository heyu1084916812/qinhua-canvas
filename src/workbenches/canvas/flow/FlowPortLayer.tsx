import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useGraph, useViewportState } from '../storeContext'
import {
  PORT_EDGE_GAP,
  PORT_MIN_SCALE,
  PORT_REVEAL_FULL,
  PORT_SIZE,
  activePortNode,
  portReveal,
  type PortNodeRect,
} from '../../../domain/canvas/geometry/portReveal'
import { NO_MAGNET, portMagnet } from '../../../domain/canvas/geometry/portMagnet'
import { IconPlus } from '../toolbar/icons'
import { portHitsOf, type PortHit } from './portHits'
import styles from './FlowPortLayer.module.css'

type PortDown = (e: ReactPointerEvent, nodeId: string, portId: string) => void

/**
 * 端点命中层（见 `.module.css` 里的长注释：为什么不能让 RF 的 `Handle` 收手势）。
 *
 * 只画**顶层节点**的端口：容器子节点按 §6.11 隐藏端口（与老表面 `NodeFrame.portsHidden` 一致）。
 * 层本身铺满 surface，只有端点是可点的 —— 节点选框、平移、框选照常落在下面那层。
 *
 * 位置分两段算（**别合成一个组件**）：世界坐标只跟图走，视口换算挂成一个 transform。
 */
export function FlowPortLayer({ onPortDown }: { onPortDown: PortDown }) {
  const graph = useGraph()
  /** 端点在世界坐标里是常量（节点不动就不动）⇒ 只跟图走，**不跟视口走** */
  const hits = useMemo<PortHit[]>(() => portHitsOf(graph), [graph])
  return <PortHitViewport hits={hits} onPortDown={onPortDown} />
}

/**
 * 只订阅视口的一层：平移 / 缩放帧只改**一个 transform**，圆点子树的 props 不变
 * ⇒ `memo` 直接跳过整棵子树（与老画布 `EdgeLayer` 的 `EdgeWorld` 同一条手法；那个文件已随 P5 收口删除）。
 *
 * 换算口径：`屏幕 = (世界 − 视口) × zoom`（`storeViewport` 的语义，见 `viewportBridge.ts`）。
 * **不要**照抄 RF 视口的 `x/y`（那是屏幕像素位移，同名不同义）。
 */
const PortHitViewport = memo(function PortHitViewport({
  hits,
  onPortDown,
}: {
  hits: PortHit[]
  onPortDown: PortDown
}) {
  const viewport = useViewportState()
  const zoom = viewport.zoom || 1
  return (
    /**
     * 两层是**必需**的（别合成一层）：外层 `inset: 0` + `overflow: hidden` 把内层的溢出**收在这里**。
     * 单层版本会让整层（连同它的 transform）超出 surface ⇒ surface 就有了可滚余量，
     * 浏览器在"把某个控件 scrollIntoView"时会顺手把它滚一下 ⇒ 画布上的节点整体平移（G76/G104 实测）。
     */
    <div className={styles.clip} data-flow-port-layer>
      <div
        className={styles.layer}
        style={{
          transform: `translate(${-viewport.x * zoom}px, ${-viewport.y * zoom}px) scale(${zoom})`,
        }}
      >
        <PortDots hits={hits} onPortDown={onPortDown} />
      </div>
    </div>
  )
})

/**
 * 端点圆点的**吸附最大位移**（世界单位）。
 *
 * 与"离边缘多远"那几条一样，用画布自己的像素 —— 端点长在节点上，吸的幅度也该跟节点
 * 一起缩放（缩得很小时吸 8px 会显得整个点在乱窜）。
 */
const MAX_PULL = 8

/**
 * 端点里那个加号的尺寸。
 *
 * 画布左工具栏的「新建节点」按钮是 **36px 的圆 + 26px 的加号**（比例 0.72）——
 * 用户第 15 批说"照它的静态显示来"，所以这里按同一比例换算到 42px 的端点：
 * `42 × 0.72 ≈ 30`。
 */
const PORT_PLUS_SIZE = Math.round(PORT_SIZE * (26 / 36))

/**
 * 圆点本身：props 只在图变化时变 ⇒ 平移 / 缩放帧不重排（`hits` 与 `onPortDown` 都是稳定引用）。
 *
 * ## 出场由**指针距离**驱动（用户 2026-10-06 第 14 批第 4 条）
 *
 * 三件事都在一个 `pointermove` 里做完，**全部是命令式 DOM 写入、不 setState**：
 * ① 展开度（0-50 全开 / 50-70 收回，见 `portReveal`）→ `--port-pop` 与 `data-port-open`；
 * ② 吸附鼠标（靠近时往指针方向挪一点，`portMagnet`）→ `--port-pull-x/y`；
 * ③ 热态标记（完全展开时）→ `data-port-hot`（样式用它做一点点加强）。
 *
 * 为什么不用 React 状态：一次 pointermove 要更新**每个**端点的样式，而端点数 =
 * 节点数 × 口数（用户手上有几百个节点的图）。走 setState 等于每帧重渲染上千个元素；
 * 命令式只改真正变化的属性，且两端一致（与 `NodeFrame` 那套磁吸同一条手法）。
 *
 * 换算只有一处要注意：**层内的世界 → 屏幕是 `× zoom`**，所以指针坐标要 `/ zoom`
 * 换回世界单位再交给 `portReveal`（详见 `portReveal` 顶部"单位只有一套"那段）。
 */
const PortDots = memo(function PortDots({
  hits,
  onPortDown,
}: {
  hits: PortHit[]
  onPortDown: PortDown
}) {
  const refs = useRef(new Map<string, HTMLSpanElement | null>())

  /**
   * 指针这一点上**该算哪只端点**。
   *
   * 为什么不能直接用"事件落在哪个元素上"：端点现在停在节点**外面** 20px
   * （用户 2026-10-06 第 14 批第 4 条），相邻两只端点（A 的输出 = A 右边 +27、
   * B 的输入 = B 左边 -27）之间只要隔不到 54px，命中方块就会**叠在一起**，
   * 而浏览器只把事件交给 DOM 上层的那个 —— 于是"拖 A 的输出端"实际会变成
   * "拖 B 的输入端"（实测：G92 的「生成 → 融合」那条边就是这么丢的，
   * 上游节点的输出端正好压在下游节点的输入端上）。
   *
   * 判据改成**离指针最近的那只**（与"落点选最近的输入口"同一套口径），
   * 于是谁被拖由几何决定，不再受 DOM 层序影响。
   */
  const nearestPortAt = useCallback(
    (x: number, y: number): PortHit | null => {
      let best: PortHit | null = null
      let bestDist = Infinity
      for (const hit of hits) {
        const el = refs.current.get(hit.key)
        if (!el) continue
        const r = el.getBoundingClientRect()
        /** 命中块是"世界单位"画的 ⇒ 它的屏幕宽度 ÷ 声明宽度 = 缩放 */
        const zoom = hit.size > 0 ? r.width / hit.size || 1 : 1
        /**
         * 距离从**锚点**（节点边缘上、线的起点）算，**不是**从命中块的中心算：
         * 命中块为了罩住"从边缘起拖"往节点里探了一段（`PORT_HIT_INNER_PAD`），圆点又浮在边缘外面 ⇒
         * 它的几何中心两头不靠。按中心算会把"按住 A 的输出端起拖"判给
         * **隔壁那个面对面节点的输入口**（实测：融合节点那组第二张局部图连不上）。
         * 锚点才是这次手势真正的起点（冒烟 / 探针也正是按它起拖的）。
         */
        const ax = r.left + Number(el.dataset.portAnchorX ?? 0) * zoom
        const ay = r.top + Number(el.dataset.portAnchorY ?? 0) * zoom
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue
        const d = Math.hypot(x - ax, y - ay)
        if (d < bestDist) {
          bestDist = d
          best = hit
        }
      }
      return best
    },
    [hits],
  )

  useEffect(() => {
    const reset = () => {
      for (const el of refs.current.values()) {
        if (!el) continue
        el.dataset.portOpen = '0'
        delete el.dataset.portHot
        el.style.removeProperty('--port-pop')
        el.style.removeProperty('--port-progress')
        el.style.removeProperty('--port-scale')
        el.style.removeProperty('--port-pull-x')
        el.style.removeProperty('--port-pull-y')
      }
    }

    const onMove = (e: PointerEvent) => {
      const map = refs.current
      /** 任何一个端点元素都行：它的父级就是那个带 transform 的世界层 */
      const sample = map.values().next().value
      const layer = sample?.parentElement
      if (!layer) return
      const box = layer.getBoundingClientRect()
      /** `clientWidth` 是**布局**宽度（不含 transform）⇒ 比值就是 zoom，不必再从 store 传一个进来 */
      const zoom = layer.clientWidth > 0 ? box.width / layer.clientWidth || 1 : 1
      /** 指针在**世界坐标**下的位置（只算这一次，逐个端点复用） */
      const world = { x: (e.clientX - box.left) / zoom, y: (e.clientY - box.top) / zoom }

      /**
       * ★★ 先定出**唯一的活动节点**（用户 2026-10-07 图二：「我选择悬停左边的节点的时候，
       * 右边也会出现端点」）——挨得近的两个节点各自按"指针到自己边缘的距离"判断，
       * 就会一起冒端点；定了活动节点，其余节点一律不露。
       */
      const rects = new Map<string, PortNodeRect>()
      for (const hit of hits) {
        if (rects.has(hit.nodeId)) continue
        rects.set(hit.nodeId, {
          id: hit.nodeId,
          left: hit.nodeLeft,
          right: hit.nodeRight,
          top: hit.nodeTop,
          bottom: hit.nodeBottom,
        })
      }
      /** 端点也一起交进去：指针正戳在端点上时，那只端点所属的节点优先（见 `activePortNode`） */
      const active = activePortNode(
        world,
        [...rects.values()],
        /**
         * ⚠️ 交**锚点**（节点边缘上、线的起点），**不是圆点圆心**：
         * 圆点自第 16 批起浮在边缘外面 20px，用户（和冒烟 / 探针）却是**按住节点边缘**
         * 起拖的 —— 拿圆心当判据，那一下就会离圆心 30px 开外、判给"指针所在的别的节点"
         *（实测：下游节点压在端点上时，`activePortNode` 选了压在下面的那个，
         *  这只口于是**不展开**（`pointer-events: none`），整段拖线手势静默失效）。
         */
        hits.map((h) => ({ nodeId: h.nodeId, x: h.edgeX, y: h.y })),
      )

      for (const hit of hits) {
        const el = map.get(hit.key)
        if (!el) continue
        const reveal =
          hit.nodeId === active
            ? portReveal({
                edgeGap: hit.side === 'left' ? hit.edgeX - world.x : world.x - hit.edgeX,
                pointerY: world.y,
                nodeTop: hit.nodeTop,
                nodeBottom: hit.nodeBottom,
              })
          : { progress: 0, hot: false, scale: PORT_MIN_SCALE, pop: PORT_EDGE_GAP }
        el.dataset.portOpen = reveal.progress > 0 ? '1' : '0'
        /**
         * 出场 = **从节点边缘沿横向渐显弹出**（用户第 14 批第 4 条，第 16 批第 3 条要它回来）：
         * `--port-pop` 把圆点从静止位**朝节点边缘**推回去（收回量），左右两侧方向相反；
         * `--port-progress` 管不透明度、`--port-scale` 管尺寸。
         */
        el.style.setProperty('--port-pop', `${(hit.side === 'left' ? 1 : -1) * reveal.pop}px`)
        el.style.setProperty('--port-progress', String(reveal.progress))
        el.style.setProperty('--port-scale', String(reveal.scale))

        const magnet = reveal.hot ? portMagnet(hit, world, { radius: PORT_REVEAL_FULL, maxPull: MAX_PULL }) : NO_MAGNET
        if (magnet.hot) {
          el.dataset.portHot = '1'
          el.style.setProperty('--port-pull-x', `${magnet.dx}px`)
          el.style.setProperty('--port-pull-y', `${magnet.dy}px`)
        } else {
          delete el.dataset.portHot
          el.style.removeProperty('--port-pull-x')
          el.style.removeProperty('--port-pull-y')
        }
      }
    }

    window.addEventListener('pointermove', onMove)
    /** 指针离开窗口（切标签 / 移出视口）也要复位，否则端点停在展开或吸附的位置 */
    window.addEventListener('pointerleave', reset)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', reset)
      window.removeEventListener('blur', reset)
    }
  }, [hits])

  return (
    <>
      {hits.map((hit) => {
        /** 命中块左上角（世界坐标）—— 圆点与锚点都按它算相对偏移 */
        const hitLeft = hit.hitX - hit.size / 2
        const hitTop = hit.hitY - hit.size / 2
        return (
          <span
            key={hit.key}
            className={styles.hit}
            data-flow-port-hit={`${hit.nodeId}:${hit.portId}`}
            data-port-side={hit.side}
            data-port-kind={hit.kind}
            data-port-open="0"
            /** 锚点（节点边缘上、线的起点）相对命中块左上角的偏移（**世界单位**，命中手势按它算远近） */
            data-port-anchor-x={hit.edgeX - hitLeft}
            data-port-anchor-y={hit.y - hitTop}
            title={hit.label}
            aria-label={hit.label}
            ref={(el) => {
              if (el) refs.current.set(hit.key, el)
              else refs.current.delete(hit.key)
            }}
            style={{
              left: hitLeft,
              top: hitTop,
              width: hit.size,
              height: hit.size,
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              /** 叠在一起时按"离指针最近"的那只算（见 `nearestPortAt` 的说明） */
              const target = nearestPortAt(e.clientX, e.clientY) ?? hit
              onPortDown(e, target.nodeId, target.portId)
            }}
          >
            {/* 看得见的那颗圆点（含中间的加号）：尺寸与 `portReveal.PORT_SIZE` 同一份口径 */}
            <span
              className={styles.dot}
              data-port-dot={hit.portId}
              /**
               * 圆点**不居中**在命中块里（命中块为了罩住"从边缘起拖"往节点那边多探了一段）：
               * 位置按圆心算 —— 它才是用户看到的那颗点，命中块只是手势范围。
               */
              style={{
                width: PORT_SIZE,
                height: PORT_SIZE,
                left: hit.x - hitLeft - PORT_SIZE / 2,
                top: hit.y - hitTop - PORT_SIZE / 2,
              }}
              aria-hidden="true"
            >
              {/*
                加号是**真矢量**，与画布左工具栏那个「新建节点」按钮**同一个 `IconPlus`**
                —— 用户第 15 批：「你直接参考我画布工作区左侧功能栏的第一个按钮的静态显示」。
              */}
              <IconPlus size={PORT_PLUS_SIZE} />
            </span>
          </span>
        )
      })}
    </>
  )
})
