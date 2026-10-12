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
        /**
         * ⚠️ **取 `after` 里那一行，不要再拿 `p.changes` 叠一次**（2026-10-12，对账 #449 实修）。
         *
         * `after` 按定义就是"这批补丁**全部应用之后**"的图 ⇒ 它就是该落库的那一行。
         * 叠 `p.changes` 在正向命令上无害（两者同值），但在**撤销**上是错的：
         * 撤销走的是 `group.inverse`，它的 `changes` 装的是**改动前的旧值**，
         * `{...after, ...changes}` 于是把旧值又写了回去 —— 内存已经退回，
         * 库里却停在改动后，**刷新一次那次撤销就白做了**。
         *
         * 实测（`store.test.ts`「两次合并的微移之后 undo」）：键盘微移两步（x+1、y+10）
         * 按一次 Ctrl+Z，内存 (1,10)→(0,0)，库里却是 **(1,0)**；
         * 而 `node.move` 每帧都带 x、y 两个键，所以表现是"只错一轴"，最难看出来。
         */
        const existing = rowMap.get(p.id)
        if (existing) up.push(existing as unknown as Row)
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
