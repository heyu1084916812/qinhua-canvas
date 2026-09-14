import type { Patch, Row, TableName } from './types'

/** 在不可变行集合上应用补丁，返回新数组（不修改入参） */
export function applyPatch<T extends Row>(rows: readonly T[], patch: Patch): T[] {
  switch (patch.op) {
    case 'upsert': {
      const row = patch.row as T
      const idx = rows.findIndex((r) => r.id === row.id)
      if (idx === -1) return [...rows, row]
      const next = rows.slice()
      next[idx] = { ...next[idx], ...row }
      return next
    }
    case 'delete':
      return rows.filter((r) => r.id !== patch.id)
    case 'patch':
      return rows.map((r) => (r.id === patch.id ? { ...r, ...patch.changes } : r))
  }
}

export function applyPatches<T extends Row>(rows: readonly T[], patches: readonly Patch[]): T[] {
  return patches.reduce<T[]>((acc, p) => applyPatch(acc, p), rows.slice())
}

/**
 * 生成逆补丁：upsert ↔ delete；patch 反向记录旧值。
 * 行不存在时 upsert 的逆是 delete，patch 无逆（返回 null）。
 */
export function invertPatch<T extends Row>(rows: readonly T[], patch: Patch): Patch | null {
  const existing = rows.find((r) => r.id === (patch.op === 'upsert' ? patch.row.id : patch.id))
  switch (patch.op) {
    case 'upsert':
      return existing
        ? { op: 'upsert', table: patch.table, row: { ...existing } }
        : { op: 'delete', table: patch.table, id: patch.row.id }
    case 'delete':
      return existing ? { op: 'upsert', table: patch.table, row: { ...existing } } : null
    case 'patch': {
      if (!existing) return null
      const changes: Record<string, unknown> = {}
      for (const key of Object.keys(patch.changes)) {
        changes[key] = (existing as Record<string, unknown>)[key]
      }
      return { op: 'patch', table: patch.table, id: patch.id, changes }
    }
  }
}

/** 逆序求逆，得到整批补丁的回滚方案 */
export function invertPatches<T extends Row>(
  rows: readonly T[],
  patches: readonly Patch[],
): Patch[] {
  // 逐条正向应用，记录每一步之前的状态，再逆序产出逆补丁
  const snapshots: (readonly T[])[] = []
  let current = rows.slice()
  for (const p of patches) {
    snapshots.push(current)
    current = applyPatch(current, p)
  }
  const inverse: Patch[] = []
  for (let i = patches.length - 1; i >= 0; i -= 1) {
    const inv = invertPatch(snapshots[i]!, patches[i]!)
    if (inv) inverse.push(inv)
  }
  return inverse
}

export function patchesToTables(patches: readonly Patch[]): TableName[] {
  return [...new Set(patches.map((p) => p.table))]
}
