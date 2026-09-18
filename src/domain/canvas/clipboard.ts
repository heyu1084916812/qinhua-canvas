import type { GraphSnapshot } from './model/graph'
import type { NodeData, NodeSnapshot } from './model/node'
import type { Point, Size } from './geometry/rect'
import { indexNodes } from './model/graph'
import { toWorldRect } from './geometry/coords'

/**
 * 画布剪贴板（产品文档 §4.2「复制与粘贴」）。
 *
 * 为什么是**快照**而不是「记一组 id」：剪贴板得活过原件的删除。若只记 id，
 * 用户「复制 → 删掉原件 → 再粘贴」就会拿到一个空操作（或更糟：粘出一堆
 * 引用着已消失节点的悬空数据）。所以 `Ctrl+C` 的那一刻就把节点**连内容**
 * 拍下来，之后与原图再无关系——这也是它能跨项目粘贴的原因（素材按 hash
 * 引用，assets 表全局共享，不需要搬字节）。
 *
 * 纯度：只依赖 model / geometry，不认识 store、命令与 DOM（架构 §2.2）。
 */

export interface ClipboardEdge {
  source: string
  target: string
}

export interface ClipboardPayload {
  /**
   * 归一化后的节点：
   * - **顶层**（被选中的那些）`parentId` 置空，`x/y` 已减去包围盒原点 ⇒ 粘贴时
   *   整体平移即可，不必知道原位置；
   * - **后代**（容器子节点）保持 `parentId` 与 local 坐标——它们随父移动，
   *   单独加偏移反而会散架。
   *
   * 于是「是不是顶层」在 payload 里恒等于 `parentId === null`，粘贴侧不必再带一份清单。
   */
  nodes: NodeSnapshot[]
  /**
   * 两端**都在**本次复制集合内的连线（§4.2「复制选中节点及其全部内容」）。
   *
   * 连到集合外的连线刻意不带：粘贴是把这段内容搬到别处，若把外部上下游也接上，
   * 会在原处牵一根长线、且往往因成环被拒——结果是「粘出来了但线不对」，
   * 比干脆不连更难懂。Alt + 拖动是**原地**复制，语义不同，那边才 `rewire`。
   */
  edges: ClipboardEdge[]
  /** 顶层节点包围盒尺寸：粘贴时让包围盒**中心**落在目标点（§4.2「落位在当前鼠标位置」） */
  size: Size
}

/**
 * 数据里持有「节点 id 列表」的字段。
 *
 * 复制必须重映射这些字段，否则粘出来的分组会用 `childIds` 指向**原件**的子节点
 * ——两个容器同时拥有同一批孩子，界面上看不出来，一动就错。
 * 不在本次复制集合内的 id（外部引用）一律**丢弃**：与「外部连线不复制」同口径。
 */
const ID_LIST_FIELDS = [
  'childIds',
  'hiddenIds',
  'hiddenPromptIds',
  'linkedPromptNodeIds',
  'thumbOrder',
  'upstreamHidden',
] as const

/** 上溯 `parentId`，判断该节点是不是选中集合的后代（环用 seen 兜住） */
function isDescendantOf(
  node: NodeSnapshot,
  rootIds: ReadonlySet<string>,
  index: ReadonlyMap<string, NodeSnapshot>,
): boolean {
  const seen = new Set<string>([node.id])
  let current = node.parentId ? index.get(node.parentId) : undefined
  while (current && !seen.has(current.id)) {
    if (rootIds.has(current.id)) return true
    seen.add(current.id)
    current = current.parentId ? index.get(current.parentId) : undefined
  }
  return false
}

/** 顶层节点的世界矩形（容器内存的是 local，直接拿 x/y 会算到错误位置——架构 §5.3） */
function worldRectOf(node: NodeSnapshot, index: ReadonlyMap<string, NodeSnapshot>) {
  const parent = node.parentId ? index.get(node.parentId) ?? null : null
  return toWorldRect(node, parent)
}

/**
 * 复制选中节点及其全部内容（后代 + 集合内部连线）。
 *
 * 没有命中任何节点时返回 `null`（空剪贴板不该被当成「复制了一份空的」——
 * 那样右键「粘贴」会亮起来却什么都粘不出）。
 */
export function clipboardFromSelection(
  graph: GraphSnapshot,
  ids: readonly string[],
): ClipboardPayload | null {
  const index = indexNodes(graph.nodes)
  const roots = ids
    .map((id) => index.get(id))
    .filter((n): n is NodeSnapshot => !!n)
  if (roots.length === 0) return null

  const rootIds = new Set(roots.map((n) => n.id))
  const inSet = new Set<string>(rootIds)
  const descendants: NodeSnapshot[] = []
  for (const n of graph.nodes) {
    if (inSet.has(n.id)) continue
    if (isDescendantOf(n, rootIds, index)) {
      inSet.add(n.id)
      descendants.push(n)
    }
  }

  /**
   * 尺寸**一律不动**。
   *
   * 结果组在世时这里要特判「从组里复制出来 → 恢复产物真实比例」——组内的节点
   * 是统一格位、比例被让渡了。组删掉后，parentId 只剩容器节点（分组 / 批量 / 画板），
   * 而复制容器时后代随容器一起走、本就不该改尺寸。于是这段特判连同它的判据
   * 一起消失，复制变成纯粹的「原样带走」（用户手动调过的尺寸不会被顺手改掉）。
   */
  const sized = roots

  // 包围盒只按**顶层**算：后代的 local 坐标不参与世界定位。
  // 尺寸先于包围盒：换过比例后仍按旧尺寸居中，粘出来的节点会偏出鼠标一截。
  const rects = sized.map((n) => worldRectOf(n, index))
  const minX = Math.min(...rects.map((r) => r.x))
  const minY = Math.min(...rects.map((r) => r.y))
  const maxX = Math.max(...rects.map((r) => r.x + r.w))
  const maxY = Math.max(...rects.map((r) => r.y + r.h))

  const nodes: NodeSnapshot[] = [
    ...sized.map((n, i) => {
      const r = rects[i]!
      return {
        ...n,
        parentId: null,
        x: r.x - minX,
        y: r.y - minY,
        // 深拷贝：剪贴板不能与图共享 data 引用，否则随后编辑原件会改到剪贴板里的内容
        data: structuredClone(n.data),
      } satisfies NodeSnapshot
    }),
    ...descendants.map((n) => ({ ...n, data: structuredClone(n.data) }) satisfies NodeSnapshot),
  ]

  const edges: ClipboardEdge[] = graph.edges
    .filter((e) => inSet.has(e.source) && inSet.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }))

  return { nodes, edges, size: { w: maxX - minX, h: maxY - minY } }
}

/** 把 id 列表字段重映射到新 id；不在集合内的（外部引用）丢弃，与外部连线不复制同口径 */
function remapIdLists(data: unknown, idMap: ReadonlyMap<string, string>): Record<string, unknown> {
  const out = { ...(data as Record<string, unknown>) }
  for (const field of ID_LIST_FIELDS) {
    const list = out[field]
    if (!Array.isArray(list)) continue
    out[field] = list
      .filter((v): v is string => typeof v === 'string')
      .map((v) => idMap.get(v))
      .filter((v): v is string => !!v)
  }
  return out
}

/**
 * 生成要落库的节点（`node.paste` 的载荷）。
 *
 * 落点语义：`at` 是**包围盒中心**要去的地方（§4.2「粘贴，落位在当前鼠标位置」——
 * 对着哪儿按 V 就以哪儿为中心冒出来，比「左上角对齐」更贴合直觉）。
 * 后代不额外加偏移：它们跟着父节点走。
 *
 * 标上「陈旧」等于告诉用户「这内容过期了」——可它明明刚粘出来、画面就在那儿。
 */
export function pasteNodes(
  payload: ClipboardPayload,
  at: Point,
  newIds: readonly string[],
): NodeSnapshot[] {
  if (newIds.length !== payload.nodes.length) {
    throw new Error(
      `[clipboard] newIds 与剪贴板节点数不一致：${newIds.length} vs ${payload.nodes.length}`,
    )
  }
  const idMap = new Map(payload.nodes.map((n, i) => [n.id, newIds[i]!]))
  const offX = at.x - payload.size.w / 2
  const offY = at.y - payload.size.h / 2

  return payload.nodes.map((n, i) => {
    const id = newIds[i]!
    const isRoot = n.parentId === null
    const parentId = isRoot ? null : idMap.get(n.parentId!) ?? null
    return {
      ...n,
      id,
      parentId,
      x: isRoot ? n.x + offX : n.x,
      y: isRoot ? n.y + offY : n.y,
      // 重映射只动 id 列表，其余字段原样带过 —— 类型上仍是 NodeData，故在此收口断言，
      // 不把 Record<string, unknown> 泄漏到 NodeSnapshot 上
      data: remapIdLists(n.data, idMap) as unknown as NodeData,
    } satisfies NodeSnapshot
  })
}

/** 剪贴板里的连线端点换成新 id（两端都能换上时才保留，否则这条边无从谈起） */
export function pasteEdges(
  payload: ClipboardPayload,
  newIds: readonly string[],
): ClipboardEdge[] {
  const idMap = new Map(payload.nodes.map((n, i) => [n.id, newIds[i]!]))
  const out: ClipboardEdge[] = []
  for (const e of payload.edges) {
    const source = idMap.get(e.source)
    const target = idMap.get(e.target)
    if (!source || !target) continue
    out.push({ source, target })
  }
  return out
}
