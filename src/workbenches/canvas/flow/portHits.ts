import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { portDeclsOf } from '../../../domain/canvas/nodeSpecs/ports'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { PORT_HIT_RADIUS } from '../../../domain/canvas/geometry/portReveal'
import { topLevelNodes } from './flowGraph'

/**
 * 端点的**命中尺寸**（世界单位）：与老表面 `NodeFrame` 的端口同一口径 ——
 * 那里 `.port` 是 14px、`::after` 再往外扩 8px（有效命中 ≈ 30px）。
 *
 * ⚠️ 单位是**世界坐标**：命中层整体挂一个 `translate + scale` 的 transform，
 * 所以圆点随缩放一起缩（与端口视觉同比例，也与老表面一致）——**不要**在这里乘 `zoom`。
 */
export const PORT_HIT_SIZE = PORT_HIT_RADIUS * 2

export interface PortHit {
  key: string
  nodeId: string
  portId: string
  label: string
  /** 这只口在节点的哪一侧（出场判定按"指针离**这一侧**边缘多远"算） */
  side: 'left' | 'right'
  /** `input` / `output` / `both`（`both` 的圆点换个画法，见 `FlowPortLayer.module.css`） */
  kind: string
  /**
   * 圆心（**世界坐标**）：**就落在节点的边缘上**（第 15 批澄清：端点是动效点，
   * 线也从这条边缘起步 ⇒ 两者重合，不再有"线从边缘起、点却在外面飘"的错位）。
   */
  x: number
  y: number
  /** 节点边缘在这一侧的 **x**（世界坐标）—— 横向距离从它算起，不是从圆心 */
  edgeX: number
  /** 节点左右边（世界坐标 x）：`activePortNode` 判"指针在不在这个节点里"要用 */
  nodeLeft: number
  nodeRight: number
  /** 节点的上下边（世界坐标 y）—— 纵向范围判定用 */
  nodeTop: number
  nodeBottom: number
  /** 命中方块的边长（世界单位） */
  size: number
}

/**
 * 算出所有**可收拖线手势**的端点圆点（`FlowPortLayer` 只负责把它们画出来）。
 *
 * 为什么单独一层、而不是用 React Flow 的 `Handle` 收手势：RF 的节点元素带 `transform`
 * （自己就是一个层叠上下文），相邻节点会整块盖住它的 Handle —— 实测两节点重叠 17px，
 * 端点就再也拖不出线（G91 ⑦ 复现）。这一层在所有节点之上，端点**永远**点得到。
 *
 * 只收**顶层节点**：容器子节点按 §6.11 隐藏端口（与老表面 `portsHidden` 一致）。
 *
 * 这里只算**世界坐标**（节点不动就不变）；「世界 → 屏幕」交给命中层的
 * `translate(−视口×zoom) scale(zoom)`（`transform-origin: 0 0`），
 * 于是平移 / 缩放帧只改这一层的 transform、圆点子树不重排 —— 与老画布 `EdgeLayer` 的 `EdgeWorld` 同一条手法
 * （那个文件已随 P5 收口删除，这条手法本身留了下来）。
 */
export function portHitsOf(graph: GraphSnapshot): PortHit[] {
  const out: PortHit[] = []
  for (const node of topLevelNodes(graph)) {
    const spec = getSpec(node.type)
    if (!spec) continue
    for (const decl of portDeclsOf(spec.ports)) {
      const edgeX = decl.side === 'left' ? node.x : node.x + node.w
      out.push({
        key: `${node.id}:${decl.id}`,
        nodeId: node.id,
        portId: decl.id,
        label: decl.label ?? '拖出连线',
        side: decl.side,
        kind: decl.kind,
        /** 圆心就在边缘上（第 15 批：端点是动效点，线也从边缘起步） */
        x: edgeX,
        y: node.y + node.h * decl.y,
        edgeX,
        nodeLeft: node.x,
        nodeRight: node.x + node.w,
        nodeTop: node.y,
        nodeBottom: node.y + node.h,
        size: PORT_HIT_SIZE,
      })
    }
  }
  return out
}
