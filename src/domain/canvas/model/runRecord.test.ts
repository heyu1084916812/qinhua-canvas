import { describe, it, expect } from 'vitest'
import type { NodeData } from './node'
import {
  createRunRecord,
  inputsSummaryOf,
  filterRunRecords,
  nextVersion,
  liveFingerprintOf,
  type RunRecord,
} from './runRecord'

function rec(overrides: Partial<RunRecord> & { id: string; version: number }): RunRecord {
  return createRunRecord({
    nodeId: 'n1',
    projectId: 'p1',
    createdAt: overrides.version * 1000,
    status: 'succeeded',
    inputs: [],
    params: {} as NodeData,
    outputHashes: [],
    fingerprint: `fp-${overrides.version}`,
    taskId: 't1',
    durationMs: 100,
    ...overrides,
  })
}

describe('inputsSummaryOf / 输入源摘要（§6.21）', () => {
  it('空输入 → 无输入', () => {
    expect(inputsSummaryOf([])).toBe('无输入')
  })

  it('文本与图分别计数', () => {
    const inputs = [
      { kind: 'text', nodeId: 'a', text: 'x' },
      { kind: 'text', nodeId: 'b', text: 'y' },
      { kind: 'asset', nodeId: 'c', assetHash: 'h1', mime: 'image/png' },
    ] as const
    expect(inputsSummaryOf(inputs as unknown as RunRecord['inputs'])).toBe('文本×2 · 图×1')
  })

  it('集合卡计卡数并附内部项总数', () => {
    const items = [
      { kind: 'asset', nodeId: 'x', assetHash: 'h1', mime: 'image/png' },
      { kind: 'asset', nodeId: 'y', assetHash: 'h2', mime: 'image/png' },
      { kind: 'asset', nodeId: 'z', assetHash: 'h3', mime: 'image/png' },
    ] as const
    const inputs = [
      { kind: 'collection', nodeId: 'b1', items: items as unknown as RunRecord['inputs'] },
    ] as unknown as RunRecord['inputs']
    expect(inputsSummaryOf(inputs)).toBe('集合×1(共3项)')
  })
})

describe('filterRunRecords / 时间轴与版本历史共用过滤（§6.21）', () => {
  const records = [
    rec({ id: 'r1', version: 1, nodeId: 'n1', createdAt: 100 }),
    rec({ id: 'r2', version: 2, nodeId: 'n2', createdAt: 300, status: 'failed' }),
    rec({ id: 'r3', version: 3, nodeId: 'n1', createdAt: 200 }),
  ]

  it('无过滤条件 → 全量按时间倒序（新在前）', () => {
    expect(filterRunRecords(records, {}).map((r) => r.id)).toEqual(['r2', 'r3', 'r1'])
  })

  it('按节点过滤', () => {
    expect(filterRunRecords(records, { nodeId: 'n1' }).map((r) => r.id)).toEqual(['r3', 'r1'])
  })

  it('按状态过滤', () => {
    expect(filterRunRecords(records, { status: 'failed' }).map((r) => r.id)).toEqual(['r2'])
  })

  it('节点 + 状态组合过滤', () => {
    expect(filterRunRecords(records, { nodeId: 'n2', status: 'succeeded' })).toEqual([])
  })
})

describe('版本版本号与 LiveFingerprint（既有行为回归锁定）', () => {
  it('nextVersion 取最大 version + 1，失败版本也计入', () => {
    const records = [
      rec({ id: 'r1', version: 2 }),
      rec({ id: 'r2', version: 5, status: 'failed' }),
    ]
    expect(nextVersion(records)).toBe(6)
    expect(nextVersion([])).toBe(1)
  })

  it('liveFingerprintOf 只取 succeeded 中 version 最大者', () => {
    const records = [
      rec({ id: 'r1', version: 3 }),
      rec({ id: 'r2', version: 5, status: 'failed' }),
      rec({ id: 'r3', version: 4 }),
    ]
    expect(liveFingerprintOf(records)).toBe('fp-4')
    expect(liveFingerprintOf([rec({ id: 'r1', version: 1, status: 'failed' })])).toBeNull()
  })
})
