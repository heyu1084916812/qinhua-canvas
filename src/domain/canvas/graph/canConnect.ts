import type { NodeSnapshot } from '../model/node'
import type { GraphSnapshot } from '../model/graph'
import { indexNodes } from '../model/graph'
import { getSpec } from '../nodeSpecs/registry'
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
): ConnectCheck {
  if (source.id === target.id) return { ok: false, reason: '不能连自己' }

  const resultGroupIds = new Set(graph.resultGroups.map((g) => g.id))
  if (resultGroupIds.has(source.id) || resultGroupIds.has(target.id)) {
    return { ok: false, reason: '结果组不作为边端点' }
  }
  /**
   * 结果组的**子节点**（逐张结果）同样不作为端点。
   *
   * 只按 id 判会漏掉它们：这些子节点类型是 generation、`parentId` 指向
   * resultGroups 表里的组（不在 nodes 表里），于是「连到一张结果缩略图」在
   * domain 层一直是合法的。真正的恶果在视图层——它们的 x/y 是组内 local 坐标，
   * 命中检测又找不到父节点、只能当世界坐标用，结果在画布原点占下一块隐形命中区，
   * 把落在那里的连线全抢走（用户看到的是：明明松手在提示词节点上，却连上了
   * 一个屏幕上根本不存在的节点）。规则必须在这里定死，视图层才只是「执行」。
   */
  const inResultGroup = (n: NodeSnapshot): boolean => !!n.parentId && resultGroupIds.has(n.parentId)
  if (inResultGroup(source) || inResultGroup(target)) {
    return { ok: false, reason: '结果组内的结果不参与连线' }
  }

  if (graph.edges.some((e) => e.source === source.id && e.target === target.id)) {
    return { ok: false, reason: '这条连线已存在' }
  }

  const sourceSpec = getSpec(source.type)
  const targetSpec = getSpec(target.type)

  if (sourceSpec && !sourceSpec.ports.output) {
    return { ok: false, reason: `${source.type} 没有输出端点` }
  }
  if (targetSpec && !targetSpec.ports.input) {
    return { ok: false, reason: `${target.type} 没有输入端点` }
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
