import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { Patch, PersistPlan, TableName, Row } from '../../../domain/patch/types'
import { applyPatches } from '../../../domain/patch/apply'

const GRAPH_TABLES: TableName[] = ['nodes', 'edges']

/** 把正向补丁翻译成持久化计划（架构 §4.3：persist 由 patches 派生，避免双份真相）
 *  `after` 是应用补丁后的图：patch 操作在此解析为完整行再 upsert，避免落库丢字段。 */
export function toPersistPlan(patches: readonly Patch[], after: GraphSnapshot): PersistPlan {
  const tables = [...new Set(patches.map((p) => p.table))]
  const upserts: PersistPlan['upserts'] = []
  const deletes: PersistPlan['deletes'] = []

  for (const table of tables) {
    const tablePatches = patches.filter((p) => p.table === table)
    if (!tablePatches.length) continue
    const rows = table === 'nodes' ? after.nodes : after.edges
    const rowMap = new Map(rows.map((r) => [r.id, r as unknown as Row]))
    const up: Row[] = []
    const delIds: string[] = []
    for (const p of tablePatches) {
      if (p.op === 'upsert') up.push(p.row)
      else if (p.op === 'delete') delIds.push(p.id)
      else {
        const existing = rowMap.get(p.id)
        if (existing) up.push({ ...existing, ...p.changes } as unknown as Row)
      }
    }
    if (up.length) upserts.push({ table, rows: up })
    if (delIds.length) deletes.push({ table, ids: delIds })
  }

  return { tables, upserts, deletes }
}

/** 把补丁应用到图快照（按 table 路由到 nodes / edges） */
export function applyGraphPatches(graph: GraphSnapshot, patches: readonly Patch[]): GraphSnapshot {
  const next: GraphSnapshot = { ...graph }
  for (const table of GRAPH_TABLES) {
    const tablePatches = patches.filter((p) => p.table === table)
    if (!tablePatches.length) continue
    if (table === 'nodes') {
      next.nodes = applyPatches(graph.nodes as unknown as Row[], tablePatches) as unknown as GraphSnapshot['nodes']
    } else if (table === 'edges') {
      next.edges = applyPatches(graph.edges as unknown as Row[], tablePatches) as unknown as GraphSnapshot['edges']
    }
  }
  return next
}
