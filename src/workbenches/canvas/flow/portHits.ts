import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { portDeclsOf } from '../../../domain/canvas/nodeSpecs/ports'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { topLevelNodes } from './flowGraph'

/**
 * 端点的**命中尺寸**（世界单位）：与老表面 `NodeFrame` 的端口同一口径 ——
 * 那里 `.port` 是 14px、`::after` 再往外扩 8px（有效命中 ≈ 30px）。
 *
 * ⚠️ 单位是**世界坐标**：命中层整体挂一个 `translate + scale` 的 transform，
 * 所以圆点随缩放一起缩（与端口视觉同比例，也与老表面一致）——**不要**在这里乘 `zoom`。
 */
export const PORT_HIT_SIZE = 30

export interface PortHit {
  key: string
  nodeId: string
  portId: string
  label: string
  /** 圆心（**世界坐标**；视口换算由命中层的 transform 承担） */
  x: number
  y: number
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
 * 于是平移 / 缩放帧只改这一层的 transform、圆点子树不重排 —— 与老表面 `EdgeLayer` 的 `EdgeWorld` 同一条手法。
 */
export function portHitsOf(graph: GraphSnapshot): PortHit[] {
  const out: PortHit[] = []
  for (const node of topLevelNodes(graph)) {
    const spec = getSpec(node.type)
    if (!spec) continue
    for (const decl of portDeclsOf(spec.ports)) {
      out.push({
        key: `${node.id}:${decl.id}`,
        nodeId: node.id,
        portId: decl.id,
        label: decl.label ?? '拖出连线',
        x: decl.side === 'left' ? node.x : node.x + node.w,
        y: node.y + node.h * decl.y,
        size: PORT_HIT_SIZE,
      })
    }
  }
  return out
}
