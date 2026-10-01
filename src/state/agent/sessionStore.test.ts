import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { AGENT_CONTEXT_WINDOW, createAgentSessionStore } from './sessionStore'

/**
 * Agent 会话存储（设计文档 §8 / §12）。
 *
 * 最要紧的两条断言都在「隔离」上：会话按项目过滤、上下文只取自己那一份。
 * 这两处一旦做错，表现是「它知道我没在这个会话里说过的事」—— 很难查，所以钉死。
 */

const store = () => createAgentSessionStore(createMemoryPlatform().storage)

describe('Agent 会话 · 基本 CRUD', () => {
  it('★ 建了能列出来，默认标题与默认模型都带上', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const list = await s.list('p1')
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: a.id, title: '新对话', model: 'm1' })
  })

  it('★ 改名与删除', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.rename(a.id, '做详情页')
    expect((await s.list('p1'))[0]!.title).toBe('做详情页')
    await s.remove(a.id)
    expect(await s.list('p1')).toHaveLength(0)
  })
})

describe('Agent 会话 · 隔离（最容易出错的地方）', () => {
  it('★★ 会话按项目过滤：A 项目的会话不会出现在 B 项目里', async () => {
    const s = store()
    await s.create({ projectId: 'p1', channelId: 'c', model: 'm' })
    await s.create({ projectId: 'p2', channelId: 'c', model: 'm' })
    expect(await s.list('p1')).toHaveLength(1)
    expect(await s.list('p2')).toHaveLength(1)
  })

  it('★★ 上下文只取当前会话：两个会话各说各的，互不串味', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c', model: 'm' })
    const b = await s.create({ projectId: 'p1', channelId: 'c', model: 'm' })

    await s.save({ ...a, messages: [{ role: 'user', content: 'A 会话说的话' }] })
    await s.save({ ...b, messages: [{ role: 'user', content: 'B 会话说的话' }] })

    const ctxA = await s.contextFor(a.id)
    const ctxB = await s.contextFor(b.id)
    expect(ctxA.map((m) => m.content)).toEqual(['A 会话说的话'])
    expect(ctxB.map((m) => m.content)).toEqual(['B 会话说的话'])
    // 关键：A 的上下文里**不可能**出现 B 说过的话
    expect(JSON.stringify(ctxA)).not.toContain('B 会话')
  })

  it('★★ 上下文窗口从尾部截断：保留最近的，丢掉最早那几条', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c', model: 'm' })
    const many = Array.from({ length: AGENT_CONTEXT_WINDOW + 5 }, (_, i) => ({
      role: 'user' as const,
      content: `第${i}条`,
    }))
    await s.save({ ...a, messages: many })
    const ctx = await s.contextFor(a.id)
    expect(ctx).toHaveLength(AGENT_CONTEXT_WINDOW)
    expect(ctx.at(-1)!.content).toBe(`第${many.length - 1}条`)
    expect(ctx[0]!.content).toBe(`第${many.length - AGENT_CONTEXT_WINDOW}条`)
  })

  /*
   * 「删项目连带删会话」**不在这层测**：那条规则现在只有一处实现 ——
   * `state/project/repository.ts` 的 `PROJECT_CASCADE_TABLES`（删项目的唯一入口）。
   * 会话 store 曾经也有一份 `removeByProject`，两处实现同一件事，
   * 正是「规则写两遍必然漂移」的形状，故删掉那份，断言移去
   * `repository.test.ts`「删项目连执行日志与 Agent 会话一起清」。
   */

  it('★ 会话不存在时上下文是空的（不抛错，也不拿别人的顶上）', async () => {
    const s = store()
    expect(await s.contextFor('nope')).toEqual([])
  })
})
