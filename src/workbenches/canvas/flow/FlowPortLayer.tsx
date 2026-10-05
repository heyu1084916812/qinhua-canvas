import { memo, useMemo } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useGraph, useViewportState } from '../storeContext'
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

/** 圆点本身：props 只在图变化时变 ⇒ 平移 / 缩放帧不重排（`hits` 与 `onPortDown` 都是稳定引用） */
const PortDots = memo(function PortDots({
  hits,
  onPortDown,
}: {
  hits: PortHit[]
  onPortDown: PortDown
}) {
  return (
    <>
      {hits.map((hit) => (
        <span
          key={hit.key}
          className={styles.hit}
          data-flow-port-hit={`${hit.nodeId}:${hit.portId}`}
          title={hit.label}
          aria-label={hit.label}
          style={{
            left: hit.x - hit.size / 2,
            top: hit.y - hit.size / 2,
            width: hit.size,
            height: hit.size,
          }}
          onPointerDown={(e) => {
            e.stopPropagation()
            onPortDown(e, hit.nodeId, hit.portId)
          }}
        />
      ))}
    </>
  )
})
