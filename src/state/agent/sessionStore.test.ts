import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { QueuedAgentTurn } from '../../domain/agent/queuedTurn'
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

  /**
   * ★ 图片 / 视频 / 对话**三档模型**都要存得住、读得回（用户 2026-10-03 的三档选择）。
   *
   * 这三档是各存各的：存错字段的表现不是报错，而是「切走再切回，模型自己变回去了」。
   */
  it('★ 图片 / 视频模型与对话模型分开存、都能读回', async () => {
    const s = store()
    const a = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'Agnes 2.5 Pro',
      imageModel: 'Agnes Image 2.5 Flash',
      videoModel: 'Agnes Video 2.5 Flash',
    })
    const row = (await s.list('p1')).find((x) => x.id === a.id)!
    expect(row).toMatchObject({
      model: 'Agnes 2.5 Pro',
      imageModel: 'Agnes Image 2.5 Flash',
      videoModel: 'Agnes Video 2.5 Flash',
    })
  })

  it('★ 新建会话可以直接带入单技能，空值不落库', async () => {
    const s = store()
    const withSkill = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
      skillId: 'skill-1',
    })
    const without = await s.create({
      projectId: 'p1',
      channelId: 'c1',
      model: 'm1',
    })
    const rows = await s.list('p1')
    expect(rows.find((row) => row.id === withSkill.id)?.skillId).toBe('skill-1')
    expect(rows.find((row) => row.id === without.id)?.skillId).toBeUndefined()
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

describe('Agent 会话 · 待执行任务队列', () => {
  const turn = (id: string, text = `任务 ${id}`): QueuedAgentTurn => ({
    id,
    text,
    createdAt: Number(id),
    channelId: 'channel-a',
    model: 'chat-a',
  })

  it('队列随会话落库，切走或重开仍能读回', async () => {
    const storage = createMemoryPlatform().storage
    const s = createAgentSessionStore(storage)
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const queued = await s.enqueueTurn(a.id, turn('1'))
    expect(queued.ok).toBe(true)

    const reopened = createAgentSessionStore(storage)
    expect((await reopened.get(a.id))?.queuedTurns.map((item) => item.id)).toEqual(['1'])
  })

  it('★★ 消息写回只更新 messages，不会把运行中后来入队的任务整行覆盖掉', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    const queued = await s.enqueueTurn(a.id, turn('1'))
    expect(queued.ok).toBe(true)

    const saved = await s.saveMessages(a.id, [{ role: 'user', content: '正在执行的回合' }])
    expect(saved?.messages.map((message) => message.content)).toEqual(['正在执行的回合'])
    expect(saved?.queuedTurns.map((item) => item.id)).toEqual(['1'])
  })

  it('FIFO 取队首；删除单项只影响指定任务', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.enqueueTurn(a.id, turn('1'))
    await s.enqueueTurn(a.id, turn('2'))
    await s.enqueueTurn(a.id, turn('3'))

    await s.removeQueuedTurn(a.id, '2')
    const first = await s.takeNextQueuedTurn(a.id)
    expect(first?.turn.id).toBe('1')
    expect(first?.session.queuedTurns.map((item) => item.id)).toEqual(['3'])
    expect((await s.takeNextQueuedTurn(a.id))?.turn.id).toBe('3')
    expect(await s.takeNextQueuedTurn(a.id)).toBeNull()
  })

  it('后台回合只清理已发送的素材引用，不误删运行中后来附加的素材', async () => {
    const s = store()
    const a = await s.create({ projectId: 'p1', channelId: 'c1', model: 'm1' })
    await s.save({ ...a, pendingAssetIds: ['sent', 'new'] })
    const next = await s.clearPendingAssetIds(a.id, ['sent'])
    expect(next?.pendingAssetIds).toEqual(['new'])
  })
})
