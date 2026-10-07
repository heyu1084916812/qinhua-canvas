import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useGraph, useViewportState } from '../storeContext'
import { PORT_REVEAL_FULL, PORT_SIZE, portReveal } from '../../../domain/canvas/geometry/portReveal'
import { NO_MAGNET, portMagnet } from '../../../domain/canvas/geometry/portMagnet'
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
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        if (Math.abs(x - cx) > r.width / 2 || Math.abs(y - cy) > r.height / 2) continue
        const d = Math.hypot(x - cx, y - cy)
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

      for (const hit of hits) {
        const el = map.get(hit.key)
        if (!el) continue
        const reveal = portReveal({
          edgeGap: hit.side === 'left' ? hit.edgeX - world.x : world.x - hit.edgeX,
          pointerY: world.y,
          nodeTop: hit.nodeTop,
          nodeBottom: hit.nodeBottom,
        })
        el.dataset.portOpen = reveal.progress > 0 ? '1' : '0'
        /** 收回 = 沿横向朝节点边缘挪；左右两侧方向相反 */
        el.style.setProperty('--port-pop', `${(hit.side === 'left' ? 1 : -1) * reveal.pop}px`)

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
      {hits.map((hit) => (
        <span
          key={hit.key}
          className={styles.hit}
          data-flow-port-hit={`${hit.nodeId}:${hit.portId}`}
          data-port-side={hit.side}
          data-port-kind={hit.kind}
          data-port-open="0"
          title={hit.label}
          aria-label={hit.label}
          ref={(el) => {
            if (el) refs.current.set(hit.key, el)
            else refs.current.delete(hit.key)
          }}
          style={{
            left: hit.x - hit.size / 2,
            top: hit.y - hit.size / 2,
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
            style={{ width: PORT_SIZE, height: PORT_SIZE }}
            aria-hidden="true"
          />
        </span>
      ))}
    </>
  )
})
