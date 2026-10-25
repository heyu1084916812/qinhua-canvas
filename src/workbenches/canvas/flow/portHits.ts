import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { portDeclsOf } from '../../../domain/canvas/nodeSpecs/ports'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import {
  PORT_CENTER_OFFSET,
  PORT_HIT_INNER_PAD,
  PORT_HIT_RADIUS,
  PORT_SIZE,
} from '../../../domain/canvas/geometry/portReveal'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'

/**
 * 端点的**命中尺寸**（世界单位）：与老表面 `NodeFrame` 的端口同一口径 ——
 * 那里 `.port` 是 14px、`::after` 再往外扩 8px（有效命中 ≈ 30px）。
 *
 * ⚠️ 单位是**世界坐标**：命中层整体挂一个 `translate + scale` 的 transform，
 * 世界层缩放后，视图层再按 `1 / zoom` 反向缩放圆点与命中块，使它们固定在屏幕像素尺寸。
 */
/**
 * 命中方块要同时罩住两处，所以边长取两者的**较大者**：
 * ① 圆点自己那一圈（`2 × 命中半径`，按住圆点旁边的容错）；
 * ② **从节点边缘一直铺到圆点外沿**（`外移量 + 半直径`）——
 *    圆点第 14 批起就浮在边缘外面 20px（第 16 批要回来了），
 *    只罩圆点的话，"从节点边缘往外拖"这一手势会落在节点身体上（拖不动线）。
 *    冒烟（G91/G92）正是从节点边缘那只 `[data-port]` 锚点起拖的，所以这条是硬约束。
 * 命中块的**中心**跟着它自己的跨度走（见 `PortHit.hitX` 的注释），不是圆点圆心。
 */
/** 命中块从节点边缘往**外**铺多远（世界单位）：一直铺到圆点的外沿 */
export const PORT_HIT_REACH = PORT_CENTER_OFFSET + PORT_SIZE / 2
/** 命中块边长 = max(圆点容错圈, 边缘**内侧** 18.5px → 圆点外沿) */
export const PORT_HIT_SIZE = Math.max(PORT_HIT_RADIUS * 2, PORT_HIT_INNER_PAD + PORT_HIT_REACH)

/** 世界层会乘 `zoom`；端点子树再乘这个值，最终屏幕上仍是原始像素尺寸。 */
export function portInverseScale(zoom: number): number {
  return 1 / Math.max(0.01, zoom)
}

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
   * 圆心（**世界坐标**）：静止位在节点边缘**外面** `PORT_CENTER_OFFSET`（= 20 + 半直径），
   * 即"近边距节点边缘 20px"（用户第 14 批第 4 条；第 16 批第 3 条点名要它回来）。
   *
   * ⚠️ 这只是**圆点**的位置。**连线锚点不吃它** —— 线一律从 `edgeX`（节点边缘）起步
   *（用户第 15 批澄清 + 第 16 批「线没有在边界」）。
   */
  x: number
  y: number
  /**
   * **命中方块**的中心（世界坐标）：不是圆心，而是它自己那一跨度的中点 ——
   * 跨度 = 节点边缘**往里** `PORT_HIT_INNER_PAD`、往外到圆点外沿。
   *
   * 为什么单独给一个：圆点浮在边缘外面，而"从边缘往外拖"也得能起手势 ⇒ 命中块比圆点
   * **往里多探一段**。往哪个方向探由 `side` 决定（左口往右探、右口往左探）。
   * 视图层按 `hitX/hitY` 摆命中块、按 `x/y` 摆那颗看得见的圆点。
   */
  hitX: number
  hitY: number
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
 * **顶层节点与容器子节点都收**（用户 2026-10-14：「建组后……选择节点后也是可以有
 * 端点出现，也是可以进行连线的」）。此前只收顶层（§6.11 原口径「组内节点端点隐藏」），
 * 于是打组之后组内成员就再也连不出线了。
 *
 * 这里只算**世界坐标**（节点不动就不变）；「世界 → 屏幕」交给命中层的
 * `translate(−视口×zoom) scale(zoom)`（`transform-origin: 0 0`），
 * 于是平移 / 缩放帧只改这一层的 transform、圆点子树不重排 —— 与老画布 `EdgeLayer` 的 `EdgeWorld` 同一条手法
 * （那个文件已随 P5 收口删除，这条手法本身留了下来）。
 */
export function portHitsOf(
  graph: GraphSnapshot,
  /**
   * 当前选中的节点 id。
   *
   * **容器子节点的端点只在它被选中时收**（用户 2026-10-14：「**选择节点后**也是可以
   * 有端点出现，也是可以进行连线的」）。为什么不做常驻：端点命中块要从节点边缘
   * **往里铺 18.5px**，常驻会抢走「把子节点拖出容器」的手势 —— G15 实测，四条判据
   * 当场变红（组内子节点计数多一个、组端点拉线从 2 条变 3 条）。顶层节点维持原样。
   */
  selection: readonly string[] = [],
): PortHit[] {
  const out: PortHit[] = []
  for (const node of graph.nodes) {
    if (node.parentId && !selection.includes(node.id)) continue
    const spec = getSpec(node.type)
    if (!spec) continue
    /**
     * 子节点的 `x / y` 是**相对父容器**的局部坐标 ⇒ 先换算成世界矩形再算端点。
     * 顶层节点走同一条换算（父为空时是恒等），于是只有一份坐标口径，
     * 不会出现「顶层对、组内偏一截」。
     */
    const rect = toWorldRectInGraph(node, graph)
    for (const decl of portDeclsOf(spec.ports)) {
      const edgeX = decl.side === 'left' ? rect.x : rect.x + rect.w
      const outward = decl.side === 'left' ? -1 : 1
      const cx = edgeX + outward * PORT_CENTER_OFFSET
      const cy = rect.y + rect.h * decl.y
      /**
       * 命中块：从节点边缘**内侧** `PORT_HIT_INNER_PAD` 铺到圆点外沿（见 `PORT_HIT_SIZE`）——
       * 于是"按住节点边缘往外拖"与"按住圆点往外拖"是同一条手势。
       */
      const inner = -outward * PORT_HIT_INNER_PAD
      const hitX = edgeX + (inner + outward * PORT_HIT_REACH) / 2
      out.push({
        key: `${node.id}:${decl.id}`,
        nodeId: node.id,
        portId: decl.id,
        label: decl.label ?? '拖出连线',
        side: decl.side,
        kind: decl.kind,
        x: cx,
        y: cy,
        hitX,
        hitY: cy,
        edgeX,
        nodeLeft: rect.x,
        nodeRight: rect.x + rect.w,
        nodeTop: rect.y,
        nodeBottom: rect.y + rect.h,
        size: PORT_HIT_SIZE,
      })
    }
  }
  return out
}
