/**
 * 端点拖线在**空白处松手**时弹出的可连接菜单（产品文档 §6.14「空白松手菜单」）。
 *
 * 纯函数：只回答「这一刻能列出哪些项」，不碰 DOM、不派发命令。
 * 合法性一律交 `canConnect`——与「拖到节点上松手」同一份规则，
 * 菜单里点得到的连接，和直接拖到节点上得到的连接，结果必须一致。
 *
 * 两个分区（§6.14）：
 * - 「新建并连接」：列出**建出来就能连上**的节点类型。类型是否合法按
 *   `canConnect` 判定，而不是另写一份「谁能连谁」的表——后者一旦与
 *   canConnect 漂移，菜单就会给出「建好了却连不上」的死项。
 * - 「连接已有节点」：列出当前**真的连得上**的既有节点。
 *
 * 方向语义：`side` 是**被拖的那一端**。
 * - `output`（从输出端点往外拖）→ 找下游：已有项作 target，新节点也作 target；
 * - `input`（从输入端点反向拖）→ 找上游：已有项作 source，新节点也作 source。
 */

import type { NodeType } from '../model/node'
import type { NodeSnapshot } from '../model/node'
import type { GraphSnapshot } from '../model/graph'
import { canConnect } from '../graph/canConnect'
import { CREATABLE_TYPES } from './contextMenu'
import { portDeclsOf } from '../nodeSpecs/ports'
import { getSpec } from '../nodeSpecs/registry'
import { DEFAULT_SOURCE_PORT, DEFAULT_TARGET_PORT } from '../model/edge'

export type LinkSide = 'input' | 'output'

export type LinkMenuAction =
  | { kind: 'create'; type: NodeType }
  | { kind: 'connect'; nodeId: string }

export interface LinkMenuItem {
  id: string
  label: string
  action: LinkMenuAction
}

export interface LinkMenuSection {
  id: 'create' | 'connect'
  title: string
  items: LinkMenuItem[]
}

/**
 * 试连用的占位 id。
 *
 * 「新建并连接」要预判「建出来之后连不连得上」，而 `canConnect` 收的是节点对象；
 * 造一个只有 id / type / parentId 有含义的替身即可——它不会被建出来，
 * 也不进任何表。
 */
const PROBE_ID = '__link_probe__'

/** 造一个待建节点的替身供 canConnect 判定 */
function probeOf(type: NodeType, parentId: string | null): NodeSnapshot {
  return {
    id: PROBE_ID,
    // projectId 不参与连线判定；给空串只为满足类型
    projectId: '',
    type,
    parentId,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    title: '',
    disabled: false,
    data: {} as NodeSnapshot['data'],
  }
}

/** 按拖线方向把「被拖节点 / 对端」归一成 canConnect 的 (source, target) */
function orient(
  side: LinkSide,
  dragged: NodeSnapshot,
  other: NodeSnapshot,
): [NodeSnapshot, NodeSnapshot] {
  return side === 'output' ? [dragged, other] : [other, dragged]
}

export function linkMenuSections(input: {
  nodeId: string
  side: LinkSide
  /**
   * 被拖的那只口的 id（产品文档 §6.23）。
   *
   * 缺省时按历史口径（output / input）。带上它之后，从融合节点的 `patch` 口
   * 往外拖，菜单里那一项建出来的边才会真的落在 `patch` 上。
   */
  portId?: string
  graph: GraphSnapshot
}): LinkMenuSection[] {
  const { nodeId, side, portId, graph } = input
  const dragged = graph.nodes.find((n) => n.id === nodeId)
  if (!dragged) return []

  /**
   * 对端那一侧用哪只口。
   *
   * 菜单里挑不出「融合节点的 patch 还是 input」（它只有节点名，没有位置信息），
   * 故对端统一取**第一只输入口** —— 也就是默认的 `input`。要接 `patch` 口，
   * 从 `patch` 口反向拖或直接拖到节点上（那时按离指针最近的口判定）。
   */
  const portsFor = (other: NodeSnapshot): { sourcePort: string; targetPort: string } => {
    const spec = getSpec(other.type)
    /**
     * 对端用哪只口：优先真正的输入口，其次**共用口**（`both`）。
     * 只认 `kind === 'input'` 的话，一个只有共用口的节点在菜单里会永远连不上
     * （退回到不存在的默认口 ⇒ `canConnect` 直接拒）。
     */
    const decls = spec ? portDeclsOf(spec.ports) : []
    /**
     * 对端的「出」口同理：优先真正的输出口，其次**共用口**。
     * 写死 `output` 会让「从别人的输入口反拖找上游」列不出融合节点 ——
     * 它的出边是从共用口走的（实测：G91 之外，这条险些把融合节点从菜单里漏掉）。
     */
    const firstOutput =
      decls.find((p) => p.kind === 'output') ?? decls.find((p) => p.kind === 'both')
    const firstInput =
      decls.find((p) => p.kind === 'input') ?? decls.find((p) => p.kind === 'both')
    if (side === 'output') {
      return {
        sourcePort: portId ?? DEFAULT_SOURCE_PORT,
        targetPort: firstInput?.id ?? DEFAULT_TARGET_PORT,
      }
    }
    return {
      sourcePort: firstOutput?.id ?? DEFAULT_SOURCE_PORT,
      targetPort: portId ?? DEFAULT_TARGET_PORT,
    }
  }

  // 新建节点落在与拖线起点同一个父级下，保持容器内外的连线边界一致。
  const probeParent = dragged.parentId

  const createItems: LinkMenuItem[] = []
  for (const t of CREATABLE_TYPES) {
    const probe = probeOf(t.type, probeParent)
    /**
     * 判定时必须把替身**放进 nodes**。
     *
     * canConnect 里有按 id 回溯父链的规则（容器内节点不直接外连），
     * 替身不在表里就等于「查无此节点、无祖先」，于是容器内节点拖线时，
     * 所有新建项都会被判成「容器外」而整批消失——菜单直接空掉。
     * 替身不带任何边，故不会影响重复连线与环检测的判定。
     */
    const withProbe: GraphSnapshot = { ...graph, nodes: [...graph.nodes, probe] }
    const [source, target] = orient(side, dragged, probe)
    if (!canConnect(source, target, withProbe, portsFor(probe)).ok) continue
    createItems.push({ id: `create:${t.type}`, label: t.label, action: { kind: 'create', type: t.type } })
  }

  const connectItems: LinkMenuItem[] = []
  for (const n of graph.nodes) {
    if (n.id === nodeId) continue
    const [source, target] = orient(side, dragged, n)
    if (!canConnect(source, target, graph, portsFor(n)).ok) continue
    connectItems.push({
      id: `connect:${n.id}`,
      label: n.title || n.type,
      action: { kind: 'connect', nodeId: n.id },
    })
  }

  const sections: LinkMenuSection[] = []
  if (createItems.length > 0) sections.push({ id: 'create', title: '新建并连接', items: createItems })
  if (connectItems.length > 0) sections.push({ id: 'connect', title: '连接已有节点', items: connectItems })
  return sections
}
