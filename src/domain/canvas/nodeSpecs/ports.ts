import { DEFAULT_SOURCE_PORT, DEFAULT_TARGET_PORT } from '../model/edge'

/**
 * 端点声明（产品文档 §6.23 融合节点）。
 *
 * 在此之前「端点」是一个布尔对（有输入 / 有输出），位置写死在左中 / 右中 ——
 * 对所有节点都成立，唯独融不进去节点：它右侧要同时有「局部修改图入口」与
 * 「融合结果出口」。于是把端点从布尔升级成**声明**：
 *
 * - `id`：连线上记的就是它（`Edge.sourcePort` / `targetPort`）；
 * - `side` + `y`：位置（`y` 是相对节点高度的比例，0.5 = 纵向中点）；
 * - `kind`：入 / 出。
 *
 * 默认那一对刻意沿用历史 id `input` / `output`：冒烟与既有选择器都按
 * `[data-port="input"]` 定位，改名等于把它们全部改红，而那不是这次要动的东西。
 */
export interface PortDecl {
  id: string
  kind: 'input' | 'output'
  side: 'left' | 'right'
  /** 纵向位置，0 = 顶边、1 = 底边、0.5 = 中点 */
  y: number
  /** 悬停提示（有名字的口才需要） */
  label?: string
  /**
   * 允许多条同源入边。
   *
   * 默认 `false`（同一条端到端只允许一条边，防止重复连线）；融合节点的 `patch`
   * 口置 `true` —— 同一个生成节点连两次就是「两张局部修改图」，是合法输入。
   */
  multi?: boolean
}

/** 节点规格里声明的端口集合 */
export interface NodePorts {
  input: boolean
  output: boolean
  /** 默认口之外的附加口（目前只有融合节点的 `patch`），顺序 = 渲染顺序 */
  extras?: readonly PortDecl[]
}

/** 节点规格里 `ports` 字段的类型（`input: true` 这类字面量写法仍要能过） */
export type PortsDeclaration = NodePorts

export const INPUT_PORT: PortDecl = { id: DEFAULT_TARGET_PORT, kind: 'input', side: 'left', y: 0.5 }
export const OUTPUT_PORT: PortDecl = { id: DEFAULT_SOURCE_PORT, kind: 'output', side: 'right', y: 0.5 }

/**
 * 展开节点规格的端口声明为一份完整清单。
 *
 * 顺序有意义：`input` 在前、`output` 在后、附加口最后 —— 与 DOM 顺序一致，
 * 「同侧多口谁在上面」因此是可预测的（`patch` 在右上、`output` 在右中）。
 */
export function portDeclsOf(ports: NodePorts): PortDecl[] {
  const out: PortDecl[] = []
  if (ports.input) out.push(INPUT_PORT)
  if (ports.output) out.push(OUTPUT_PORT)
  if (ports.extras) out.push(...ports.extras)
  return out
}

/** 按 id 取端点声明；找不到返回 null（调用方据此拒绝连线 / 不画锚点） */
export function portDeclOf(ports: NodePorts, portId: string): PortDecl | null {
  return portDeclsOf(ports).find((p) => p.id === portId) ?? null
}
