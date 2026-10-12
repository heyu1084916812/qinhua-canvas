import { describe, it, expect } from 'vitest'
import { createMemoryStorage } from '../../../platform/memory'
import { trimProjectTasks } from './taskLog'

/**
 * `tasks` 表的滚动裁剪（产品文档 §6.18「按项目保留最近 500 条，超出滚动裁剪」，对账 #460）。
 *
 * 判据挑的是**谁也替不了的那几条**：到上限之前一根手指都不碰；到上限之后**删的是最老的**；
 * **只删本项目的行**（按 projectId 分区）；同一时间戳时结果**稳定可复现**（不靠查询返回顺序）。
 */

const task = (id: string, projectId: string, createdAt: number) => ({ id, projectId, createdAt })

describe('trimProjectTasks / tasks 表滚动裁剪', () => {
  it('没到上限：什么都不删（返回 0，行数不变）', async () => {
    const storage = createMemoryStorage({
      rows: { tasks: [task('t1', 'p1', 1), task('t2', 'p1', 2), task('t3', 'p1', 3)] },
    })
    expect(await trimProjectTasks(storage, 'p1', 5)).toBe(0)
    expect(await storage.query('tasks', { projectId: 'p1' })).toHaveLength(3)
  })

  it('超过上限：只留最近 N 条 —— 删掉的是**最老的**那几条', async () => {
    const rows = Array.from({ length: 8 }, (_, i) => task(`t${i}`, 'p1', i))
    const storage = createMemoryStorage({ rows: { tasks: rows } })

    expect(await trimProjectTasks(storage, 'p1', 3)).toBe(5)

    const left = await storage.query('tasks', { projectId: 'p1' })
    expect(left).toHaveLength(3)
    expect(left.map((r) => r.id).sort()).toEqual(['t5', 't6', 't7'])
  })

  it('★ 只删本项目的行：另一个项目的日志一条都不能少', async () => {
    const storage = createMemoryStorage({
      rows: {
        tasks: [
          task('a1', 'p1', 1),
          task('a2', 'p1', 2),
          task('a3', 'p1', 3),
          task('b1', 'p2', 1),
          task('b2', 'p2', 2),
          task('b3', 'p2', 3),
        ],
      },
    })

    expect(await trimProjectTasks(storage, 'p1', 2)).toBe(1)

    expect((await storage.query('tasks', { projectId: 'p1' })).map((r) => r.id).sort()).toEqual(['a2', 'a3'])
    expect((await storage.query('tasks', { projectId: 'p2' }))).toHaveLength(3)
  })

  it("★ 同一时间戳时结果稳定：按 id 倒序留（不靠查询返回顺序）", async () => {
    const storage = createMemoryStorage({
      rows: {
        tasks: [task('a', 'p1', 100), task('c', 'p1', 100), task('b', 'p1', 100)],
      },
    })
    expect(await trimProjectTasks(storage, 'p1', 2)).toBe(1)
    expect((await storage.query('tasks', { projectId: 'p1' })).map((r) => r.id).sort()).toEqual(['b', 'c'])
  })

  it('缺 createdAt 的行当作最老（不会被误当成"最新"留下）', async () => {
    const storage = createMemoryStorage({
      rows: { tasks: [{ id: 'old', projectId: 'p1' }, task('new1', 'p1', 10), task('new2', 'p1', 11)] },
    })
    expect(await trimProjectTasks(storage, 'p1', 2)).toBe(1)
    const left = await storage.query('tasks', { projectId: 'p1' })
    expect(left.map((r) => r.id)).not.toContain('old')
  })
})
