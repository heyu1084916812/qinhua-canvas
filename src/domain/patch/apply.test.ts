import { describe, it, expect } from 'vitest'
import { applyPatch, applyPatches, invertPatch, invertPatches, patchesToTables } from './apply'
import type { Row } from './types'

const rows: Row[] = [
  { id: 'n1', title: 'A', x: 0 },
  { id: 'n2', title: 'B', x: 10 },
]

describe('补丁应用', () => {
  it('upsert 已存在行时合并字段', () => {
    const out = applyPatch(rows, { op: 'upsert', table: 'nodes', row: { id: 'n1', x: 5 } })
    expect(out.find((r) => r.id === 'n1')).toEqual({ id: 'n1', title: 'A', x: 5 })
  })

  it('upsert 新行时追加', () => {
    const out = applyPatch(rows, { op: 'upsert', table: 'nodes', row: { id: 'n3' } })
    expect(out).toHaveLength(3)
  })

  it('patch 只改指定字段', () => {
    const out = applyPatch(rows, { op: 'patch', table: 'nodes', id: 'n2', changes: { x: 99 } })
    expect(out.find((r) => r.id === 'n2')).toEqual({ id: 'n2', title: 'B', x: 99 })
  })

  it('delete 移除行且不修改入参', () => {
    const out = applyPatch(rows, { op: 'delete', table: 'nodes', id: 'n1' })
    expect(out.map((r) => r.id)).toEqual(['n2'])
    expect(rows).toHaveLength(2)
  })

  it('批量按顺序应用', () => {
    const out = applyPatches(rows, [
      { op: 'delete', table: 'nodes', id: 'n1' },
      { op: 'upsert', table: 'nodes', row: { id: 'n2', x: 42 } },
    ])
    expect(out).toEqual([{ id: 'n2', title: 'B', x: 42 }])
  })
})

describe('逆补丁', () => {
  it('upsert 已存在行的逆是恢复旧值', () => {
    const inv = invertPatch(rows, { op: 'upsert', table: 'nodes', row: { id: 'n1', x: 5 } })
    expect(inv).toEqual({ op: 'upsert', table: 'nodes', row: { id: 'n1', title: 'A', x: 0 } })
  })

  it('upsert 新行的逆是删除', () => {
    const inv = invertPatch(rows, { op: 'upsert', table: 'nodes', row: { id: 'n9' } })
    expect(inv).toEqual({ op: 'delete', table: 'nodes', id: 'n9' })
  })

  it('delete 的逆是恢复该行', () => {
    const inv = invertPatch(rows, { op: 'delete', table: 'nodes', id: 'n1' })
    expect(inv).toEqual({ op: 'upsert', table: 'nodes', row: { id: 'n1', title: 'A', x: 0 } })
  })

  it('整批补丁回滚后回到初始状态', () => {
    const patches = [
      { op: 'patch' as const, table: 'nodes' as const, id: 'n1', changes: { x: 7 } },
      { op: 'delete' as const, table: 'nodes' as const, id: 'n2' },
    ]
    const after = applyPatches(rows, patches)
    const back = applyPatches(after, invertPatches(rows, patches))
    expect(back).toEqual(rows)
  })

  it('汇总涉及的表', () => {
    expect(patchesToTables([{ op: 'delete', table: 'edges', id: 'e1' }])).toEqual(['edges'])
  })
})
