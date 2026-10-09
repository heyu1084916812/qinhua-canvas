import { describe, expect, it } from 'vitest'
import {
  SNAPSHOT_INTERVAL_MS,
  describeSnapshot,
  lastSnapshotAtByProject,
  shouldSnapshot,
  snapshotsToPrune,
  type ProjectSnapshot,
} from './snapshot'

/**
 * 快照规则（用户 2026-10-09，对账 #378 A4）。
 *
 * 这些断言守的是"**不要拍垃圾快照**"：
 * 空项目不拍、没改过不拍、一天内不重复拍；超量时删最旧的。
 */
const DAY = SNAPSHOT_INTERVAL_MS

describe('项目快照 · 规则', () => {
  it('★★ 三条判据缺一不可：有内容 / 改过 / 距上次够久', () => {
    const now = 10 * DAY

    // 空项目：不拍（拍了只会挤掉有价值的快照）
    expect(shouldSnapshot({ nodeCount: 0, updatedAt: now }, null, now)).toBe(false)
    // 从没拍过且有内容：拍
    expect(shouldSnapshot({ nodeCount: 3, updatedAt: now }, null, now)).toBe(true)

    const last = now - 2 * DAY
    // 改过 + 够久：拍
    expect(shouldSnapshot({ nodeCount: 3, updatedAt: now - DAY }, last, now)).toBe(true)
    // 快照之后没改过：不拍（重复拍是浪费）
    expect(shouldSnapshot({ nodeCount: 3, updatedAt: last - 1 }, last, now)).toBe(false)
    // 一天内改过但没到间隔：不拍
    expect(shouldSnapshot({ nodeCount: 3, updatedAt: now - 1000 }, now - 1000, now)).toBe(false)
  })

  it('★ 刚好满一天即算够久（边界不是"必须超过"）', () => {
    const now = 5 * DAY
    const last = now - DAY
    expect(shouldSnapshot({ nodeCount: 1, updatedAt: now }, last, now)).toBe(true)
  })

  it('★★ 超量时删**最旧的**，保留份数内一张不动', () => {
    const snaps: ProjectSnapshot[] = [1, 2, 3, 4, 5].map((i) => ({
      id: `s${i}`,
      projectId: 'p1',
      createdAt: i * 1000,
      name: 'P',
      nodeCount: 1,
    }))
    expect(snapshotsToPrune(snaps, 3)).toEqual(['s2', 's1']) // 最新的 s5/s4/s3 留着
    expect(snapshotsToPrune(snaps, 5)).toEqual([])
    expect(snapshotsToPrune(snaps, 10)).toEqual([])
    // keep=0 是"不要快照"这种极端设置：全删
    expect(snapshotsToPrune(snaps, 0)).toHaveLength(5)
  })

  it('★ 按项目取"最近一次快照时间"（多项目互不干扰）', () => {
    const snaps: ProjectSnapshot[] = [
      { id: 'a1', projectId: 'p1', createdAt: 100, name: 'A', nodeCount: 1 },
      { id: 'a2', projectId: 'p1', createdAt: 300, name: 'A', nodeCount: 1 },
      { id: 'b1', projectId: 'p2', createdAt: 200, name: 'B', nodeCount: 1 },
    ]
    const map = lastSnapshotAtByProject(snaps)
    expect(map.get('p1')).toBe(300)
    expect(map.get('p2')).toBe(200)
    expect(map.get('p3')).toBeUndefined()
  })

  it('★ 摘要含项目名 / 节点数 / 时间（用户点还原前能确认是哪一份）', () => {
    const text = describeSnapshot({
      id: 's1',
      projectId: 'p1',
      createdAt: new Date(2026, 9, 9, 8, 5).getTime(),
      name: '猫咪项目',
      nodeCount: 12,
    })
    expect(text).toContain('猫咪项目')
    expect(text).toContain('12 个节点')
    expect(text).toMatch(/\d{4}/)
  })
})
