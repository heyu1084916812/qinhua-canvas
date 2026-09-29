import type { NodeSnapshot } from '../model/node'
import type { GraphSnapshot } from '../model/graph'
import { indexNodes } from '../model/graph'
import { getSpec } from '../nodeSpecs/registry'
import { portDeclOf } from '../nodeSpecs/ports'
import { DEFAULT_SOURCE_PORT, DEFAULT_TARGET_PORT, hasEdge } from '../model/edge'
import { isReachable } from './topoSort'

export type ConnectCheck = { ok: true } | { ok: false; reason: string }

const OK: ConnectCheck = { ok: true }

/** 节点所在的最外层画板 id（画板内外不建立边） */
function boardAncestorOf(nodeId: string, graph: GraphSnapshot): string | null {
  const index = indexNodes(graph.nodes)
  let current = index.get(nodeId)
  const seen = new Set<string>()
  let board: string | null = null
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.type === 'board') board = current.id
    current = current.parentId ? index.get(current.parentId) : undefined
  }
  return board
}

/**
 * 连线合法性（架构 §4.1 / 产品文档 §6.14 与 §11.3）
 * 四条硬规则 + 类型匹配 + 环检测：
 * 1. 输出端点只能连输入端点
 * 2. 结果组本身不作为边端点（组内标准生成节点才是端点）
 * 3. 画板无端点；画板内外不建立边
 * 4. 分组 / 批量的子节点之间及其与外部不建立边
 */
export function canConnect(
  source: NodeSnapshot,
  target: NodeSnapshot,
  graph: GraphSnapshot,
  /**
   * 端点（产品文档 §6.23）。缺省 = 历史口径（右 `output` → 左 `input`），
   * 既有调用点因此不必逐个改。
   */
  opts?: { sourcePort?: string; targetPort?: string },
): ConnectCheck {
  const sourcePort = opts?.sourcePort ?? DEFAULT_SOURCE_PORT
  const targetPort = opts?.targetPort ?? DEFAULT_TARGET_PORT

  if (source.id === target.id) return { ok: false, reason: '不能连自己' }

  const sourceSpec = getSpec(source.type)
  const targetSpec = getSpec(target.type)

  /**
   * 端点的存在性与方向：**按 id 解析**，而不是看 `ports.output` 布尔。
   *
   * 融合节点的 `patch` 在右侧但语义是输入 —— 只看「左 = 入 / 右 = 出」会把
   * 它判反。方向一律由声明的 `kind` 说话。
   */
  const sourceDecl = sourceSpec ? portDeclOf(sourceSpec.ports, sourcePort) : null
  const targetDecl = targetSpec ? portDeclOf(targetSpec.ports, targetPort) : null
  if (sourceSpec && (!sourceDecl || sourceDecl.kind !== 'output')) {
    return { ok: false, reason: `${source.type} 没有输出端点 ${sourcePort}` }
  }
  if (targetSpec && (!targetDecl || targetDecl.kind !== 'input')) {
    return { ok: false, reason: `${target.type} 没有输入端点 ${targetPort}` }
  }

  /**
   * 去重：同一条**端到端**只允许一条边；`multi` 口（融合节点的 `patch`）例外。
   *
   * 例外是必须的：那里「同一个节点连两次」就是有意义的两份输入，
   * 按端到端去重会把用户的第二次连接静默吃掉。
   */
  if (!targetDecl?.multi && hasEdge(graph.edges, source.id, target.id, sourcePort, targetPort)) {
    return { ok: false, reason: '这条连线已存在' }
  }

  if (source.type === 'board' || target.type === 'board') {
    return { ok: false, reason: '画板没有端点' }
  }
  if (boardAncestorOf(source.id, graph) !== boardAncestorOf(target.id, graph)) {
    return { ok: false, reason: '画板内外不建立边' }
  }

  // 规则 4：子节点与外部、子节点之间不建立边
  const childOfContainer = (n: NodeSnapshot): boolean => {
    if (!n.parentId) return false
    const parent = indexNodes(graph.nodes).get(n.parentId)
    return parent ? parent.type === 'group' || parent.type === 'batch' : false
  }
  if (childOfContainer(source) || childOfContainer(target)) {
    return { ok: false, reason: '容器内节点不直接与外部连线' }
  }

  if (targetSpec && !targetSpec.accepts.upstream.includes(source.type)) {
    return { ok: false, reason: `${target.type} 不接受来自 ${source.type} 的输入` }
  }

  if (isReachable(graph.edges, target.id, source.id)) {
    return { ok: false, reason: '会形成环路' }
  }

  return OK
}
