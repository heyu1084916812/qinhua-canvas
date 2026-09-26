import { describe, expect, it } from 'vitest'
import {
  ROUTE_STRATEGIES,
  resolveRouteFor,
  routeCandidatesFor,
  selectRoute,
  type RouteCandidate,
  type RouteChannelSource,
} from './modelRouting'
import { resolveUpstreamModel } from './modelMapping'

const cand = (over: Partial<RouteCandidate> & { channelId: string }): RouteCandidate => ({
  enabled: true,
  hasToken: true,
  priority: 0,
  weight: 0,
  latencyMs: null,
  upstreamModel: over.channelId + '-upstream',
  ...over,
})

describe('selectRoute', () => {
  it('没有「可用」候选时返回 null（渠道未启用 / 未映射该模型都不算可用）', () => {
    expect(selectRoute([], 'priority')).toBeNull()
    expect(
      selectRoute(
        [
          cand({ channelId: 'a', enabled: false }),
          cand({ channelId: 'b', upstreamModel: null }),
        ],
        'priority',
      ),
    ).toBeNull()
  })

  it('★ 没存令牌的渠道不参与选路（选它必然失败，旁边有配好的站就该避开）', () => {
    expect(
      selectRoute([cand({ channelId: 'noToken', hasToken: false })], 'priority'),
    ).toBeNull()
    // 同档里只有一条有令牌 → 选它
    expect(
      selectRoute(
        [
          cand({ channelId: 'noToken', hasToken: false, priority: 10 }),
          cand({ channelId: 'ok', hasToken: true, priority: 1 }),
        ],
        'priority',
      )?.channelId,
    ).toBe('ok')
  })

  it('★ priority：优先度高的先选（数值越大越优先）', () => {
    const low = cand({ channelId: 'low', priority: 1 })
    const high = cand({ channelId: 'high', priority: 10 })
    expect(selectRoute([low, high], 'priority')?.channelId).toBe('high')
  })

  it('★ priority：attempt 是**降到下一档**，不是重试同一渠道', () => {
    const low = cand({ channelId: 'low', priority: 1 })
    const mid = cand({ channelId: 'mid', priority: 5 })
    const high = cand({ channelId: 'high', priority: 10 })
    const list = [low, mid, high]
    expect(selectRoute(list, 'priority', { attempt: 0 })?.channelId).toBe('high')
    expect(selectRoute(list, 'priority', { attempt: 1 })?.channelId).toBe('mid')
    expect(selectRoute(list, 'priority', { attempt: 2 })?.channelId).toBe('low')
    // 档位用尽后停在最差一档（仍有候选可用，是否失败由调用方决定）
    expect(selectRoute(list, 'priority', { attempt: 9 })?.channelId).toBe('low')
  })

  it('★ performance：实测延迟小的先选；未测过排最后，不与「测过=慢」混档', () => {
    const slow = cand({ channelId: 'slow', latencyMs: 900 })
    const fast = cand({ channelId: 'fast', latencyMs: 12 })
    const unmeasured = cand({ channelId: 'unknown', latencyMs: null })
    expect(selectRoute([slow, fast, unmeasured], 'performance')?.channelId).toBe('fast')
    expect(
      selectRoute([slow, fast, unmeasured], 'performance', { attempt: 1 })?.channelId,
    ).toBe('slow')
    expect(
      selectRoute([slow, fast, unmeasured], 'performance', { attempt: 2 })?.channelId,
    ).toBe('unknown')
  })

  it('★ 未测过延迟的渠道不被当成「最快」（null 不参与数值比较）', () => {
    const only = cand({ channelId: 'unknown', latencyMs: null })
    expect(selectRoute([only], 'performance')?.channelId).toBe('unknown')
  })

  it('★ 同档多候选按权重随机：weight 大的更容易被选中', () => {
    // heavy 得票 = 3+10 = 13，light = 0+10 = 10，总 23 ⇒ light 区间是 (13/23, 1]
    const list = [
      cand({ channelId: 'heavy', weight: 3 }),
      cand({ channelId: 'light', weight: 0 }),
    ]
    expect(selectRoute(list, 'balanced', { random: 0 })?.channelId).toBe('heavy')
    // 13/23 ≈ 0.565，取 0.8 稳稳落在 light 一侧
    expect(selectRoute(list, 'balanced', { random: 0.8 })?.channelId).toBe('light')
    // 同档内的 priority 选路也走加权随机（档内不固定取第一个）
    expect(selectRoute(list, 'priority', { random: 0 })?.channelId).toBe('heavy')
  })

  it('★ weight=0 的候选仍有机会（floor 保证不被饿死）', () => {
    const list = [
      cand({ channelId: 'heavy', weight: 3 }),
      cand({ channelId: 'light', weight: 0 }),
    ]
    const picked = selectRoute(list, 'balanced', { random: 0.8 })
    expect(picked?.channelId).toBe('light')
  })

  it('★ 返回的是该渠道**映射后**的上游 ID，不是逻辑名', () => {
    const picked = selectRoute([cand({ channelId: 'a', upstreamModel: 'gpt-image-2' })], 'priority')
    expect(picked).toEqual({ channelId: 'a', upstreamModel: 'gpt-image-2' })
  })

  it('★ balanced 不做降级：attempt 增大仍在同一个全池里', () => {
    const list = [cand({ channelId: 'a', weight: 1000 }), cand({ channelId: 'b', weight: 0 })]
    expect(selectRoute(list, 'balanced', { attempt: 3, random: 0 })?.channelId).toBe('a')
  })

  it('random 越界（<0 / >=1）被夹回，不会抛错或选中空', () => {
    const list = [cand({ channelId: 'a' })]
    expect(selectRoute(list, 'balanced', { random: -5 })?.channelId).toBe('a')
    expect(selectRoute(list, 'balanced', { random: 5 })?.channelId).toBe('a')
  })

  it('策略表覆盖全部策略且有中文标签（界面与逻辑同源）', () => {
    const values = ROUTE_STRATEGIES.map((s) => s.value)
    expect(values).toEqual(['priority', 'performance', 'balanced'])
    for (const s of ROUTE_STRATEGIES) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(s.hint.length).toBeGreaterThan(0)
    }
  })
})

describe('routeCandidatesFor', () => {
  const ch = (over: Partial<RouteChannelSource> & { id: string }): RouteChannelSource => ({
    enabled: true,
    hasToken: true,
    priority: 0,
    weight: 0,
    lastTestLatency: null,
    modelIds: [],
    modelMap: {},
    routeStrategy: 'priority',
    ...over,
  })

  it('★ 只有「提供该逻辑名」的渠道才成为候选', () => {
    const out = routeCandidatesFor(
      [ch({ id: 'a', modelIds: ['image-2'] }), ch({ id: 'b', modelIds: ['other'] })],
      'image-2',
      resolveUpstreamModel,
    )
    expect(out.map((c) => c.channelId)).toEqual(['a'])
  })

  it('★ 上游 ID 按**各渠道自己的**映射表解析（同名不同站）', () => {
    const out = routeCandidatesFor(
      [
        ch({ id: 'A', modelIds: ['image-2'], modelMap: { 'image-2': 'gpt-image-2' } }),
        ch({ id: 'B', modelIds: ['image-2'] }), // 无映射 → 恒等
      ],
      'image-2',
      resolveUpstreamModel,
    )
    expect(out[0]!.upstreamModel).toBe('gpt-image-2')
    expect(out[1]!.upstreamModel).toBe('image-2')
  })

  it('★ 延迟与优先度透传（选路的两条排序依据）', () => {
    const out = routeCandidatesFor(
      [ch({ id: 'a', modelIds: ['m'], priority: 7, lastTestLatency: 42 })],
      'm',
      resolveUpstreamModel,
    )
    expect(out[0]).toMatchObject({ priority: 7, latencyMs: 42 })
  })

  it('空逻辑名不产生候选', () => {
    expect(routeCandidatesFor([ch({ id: 'a', modelIds: ['m'] })], '  ', resolveUpstreamModel)).toEqual(
      [],
    )
  })

  it('★ 端到端：两个站都能出图时，performance 选快的那个', () => {
    const candidates = routeCandidatesFor(
      [
        ch({ id: 'slow', modelIds: ['image-2'], lastTestLatency: 800 }),
        ch({ id: 'fast', modelIds: ['image-2'], lastTestLatency: 20 }),
      ],
      'image-2',
      resolveUpstreamModel,
    )
    expect(selectRoute(candidates, 'performance')?.channelId).toBe('fast')
  })
})

describe('resolveRouteFor', () => {
  const ch = (over: Partial<RouteChannelSource> & { id: string }): RouteChannelSource => ({
    enabled: true,
    hasToken: true,
    priority: 0,
    weight: 0,
    lastTestLatency: null,
    modelIds: [],
    modelMap: {},
    routeStrategy: 'priority',
    ...over,
  })

  it('★ 没有任何渠道提供该逻辑模型 → null（调用方必须如实报错，不静默按原名发）', () => {
    expect(resolveRouteFor([ch({ id: 'a', modelIds: ['other'] })], 'image-2')).toBeNull()
    expect(resolveRouteFor([], 'image-2')).toBeNull()
    expect(resolveRouteFor([ch({ id: 'a', modelIds: ['image-2'] })], '  ')).toBeNull()
  })

  it('★ 主导策略取**节点所选渠道**的（用户心里的主站），不是候选里第一条', () => {
    // 慢站是数组第一条，但主站声明 performance ⇒ 应选快的那条
    const picked = resolveRouteFor(
      [
        ch({ id: 'slow', modelIds: ['image-2'], lastTestLatency: 900 }),
        ch({
          id: 'main',
          modelIds: ['image-2'],
          lastTestLatency: 15,
          routeStrategy: 'performance',
        }),
      ],
      'image-2',
      { governingChannelId: 'main' },
    )
    expect(picked?.channelId).toBe('main')
  })

  it('★ 主站不在候选里时回落 priority（不需要实测数据，行为最可预测）', () => {
    const picked = resolveRouteFor(
      [
        ch({ id: 'x', modelIds: ['image-2'], priority: 1 }),
        ch({ id: 'y', modelIds: ['image-2'], priority: 9 }),
      ],
      'image-2',
      { governingChannelId: '已删除的渠道' },
    )
    expect(picked?.channelId).toBe('y')
  })

  it('★ 返回的是被选中渠道**自己映射**出来的上游 ID（各站叫法不同）', () => {
    const picked = resolveRouteFor(
      [
        ch({ id: 'A', modelIds: ['image-2'], modelMap: { 'image-2': 'gpt-image-2' }, priority: 9 }),
        ch({ id: 'B', modelIds: ['image-2'], priority: 1 }),
      ],
      'image-2',
    )
    expect(picked).toEqual({ channelId: 'A', upstreamModel: 'gpt-image-2' })
  })

  it('★ attempt 走降级：主站优先度高但失败一次后降到下一档', () => {
    const list = [
      ch({ id: 'p10', modelIds: ['m'], priority: 10 }),
      ch({ id: 'p1', modelIds: ['m'], priority: 1 }),
    ]
    expect(resolveRouteFor(list, 'm', { attempt: 0 })?.channelId).toBe('p10')
    expect(resolveRouteFor(list, 'm', { attempt: 1 })?.channelId).toBe('p1')
  })

  it('未启用的渠道不参与选路', () => {
    expect(
      resolveRouteFor([ch({ id: 'off', modelIds: ['m'], enabled: false })], 'm'),
    ).toBeNull()
  })

  it('★ 端到端：优先度最高的那条没存令牌 → 落到次优先的那条', () => {
    const picked = resolveRouteFor(
      [
        ch({ id: 'vip', modelIds: ['m'], priority: 100, hasToken: false }),
        ch({ id: 'backup', modelIds: ['m'], priority: 1, hasToken: true }),
      ],
      'm',
    )
    expect(picked?.channelId).toBe('backup')
  })
})
