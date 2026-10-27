import { describe, expect, it } from 'vitest'
import {
  buildRoutePlan,
  routeCandidateKey,
  type RoutePlanChannel,
} from './routePlan'

function channel(input: Partial<RoutePlanChannel> & { id: string }): RoutePlanChannel {
  return {
    id: input.id,
    enabled: input.enabled ?? true,
    hasToken: input.hasToken ?? true,
    priority: input.priority ?? 0,
    weight: input.weight ?? 0,
    lastTestLatency: input.lastTestLatency ?? null,
    models: input.models ?? [{ id: 'gpt-5', category: 'chat' }],
    modelMap: input.modelMap ?? {},
    credentialGroups: input.credentialGroups ?? [],
  }
}

describe('RoutePlan', () => {
  it('展开同一渠道的可用 Key 分组，空分组不参与', () => {
    const result = buildRoutePlan({
      channels: [
        channel({
          id: 'relay',
          credentialGroups: [
            {
              id: 'primary',
              hasToken: true,
              priority: 10,
              models: [{ id: 'gpt-5', category: 'chat' }],
            },
            {
              id: 'empty',
              hasToken: false,
              priority: 20,
              models: [{ id: 'gpt-5', category: 'chat' }],
            },
            {
              id: 'backup',
              hasToken: true,
              priority: 0,
              models: [{ id: 'gpt-5', category: 'chat' }],
            },
          ],
        }),
      ],
      logicalModel: 'gpt-5',
      capability: 'chat',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.candidates.map((candidate) => candidate.credentialGroupId)).toEqual([
      'primary',
      'backup',
    ])
  })

  it('★★ 用户勾选分组后只允许勾选项参与，不静默回落到其他分组', () => {
    const source = channel({
      id: 'relay',
      credentialGroups: [
        {
          id: 'a',
          hasToken: true,
          priority: 10,
          models: [{ id: 'gpt-5', category: 'chat' }],
        },
        {
          id: 'b',
          hasToken: true,
          priority: 5,
          models: [{ id: 'gpt-5', category: 'chat' }],
        },
      ],
    })
    const result = buildRoutePlan({
      channels: [source],
      logicalModel: 'gpt-5',
      capability: 'chat',
      policy: {
        allowedCandidates: [{ channelId: 'relay', credentialGroupId: 'b' }],
      },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.candidates.map((candidate) => candidate.credentialGroupId)).toEqual(['b'])

    expect(buildRoutePlan({
      channels: [source],
      logicalModel: 'gpt-5',
      capability: 'chat',
      policy: {
        allowedCandidates: [{ channelId: 'relay', credentialGroupId: 'missing' }],
      },
    })).toEqual({ ok: false, reason: 'policy_excluded' })
  })

  it('优先级先渠道后分组；maxAttempts 是硬上限', () => {
    const result = buildRoutePlan({
      channels: [
        channel({
          id: 'low',
          priority: 1,
          credentialGroups: [{
            id: 'low-primary',
            hasToken: true,
            priority: 99,
            models: [{ id: 'gpt-5', category: 'chat' }],
          }],
        }),
        channel({
          id: 'high',
          priority: 9,
          credentialGroups: [
            { id: 'backup', hasToken: true, priority: 1, models: [{ id: 'gpt-5', category: 'chat' }] },
            { id: 'primary', hasToken: true, priority: 8, models: [{ id: 'gpt-5', category: 'chat' }] },
          ],
        }),
      ],
      logicalModel: 'gpt-5',
      capability: 'chat',
      policy: { strategy: 'priority', maxAttempts: 2 },
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.candidates.map((candidate) => candidate.key)).toEqual([
      routeCandidateKey({ channelId: 'high', credentialGroupId: 'primary' }),
      routeCandidateKey({ channelId: 'high', credentialGroupId: 'backup' }),
    ])
  })

  it('★★ round_robin 在最高渠道优先档内按游标轮转，并返回下一游标', () => {
    const channels = [
      channel({ id: 'a', priority: 10 }),
      channel({ id: 'b', priority: 10 }),
      channel({ id: 'c', priority: 1 }),
    ]
    const first = buildRoutePlan({
      channels,
      logicalModel: 'gpt-5',
      capability: 'chat',
      policy: { strategy: 'round_robin', maxAttempts: 3 },
      cursor: 0,
    })
    const second = buildRoutePlan({
      channels,
      logicalModel: 'gpt-5',
      capability: 'chat',
      policy: { strategy: 'round_robin', maxAttempts: 3 },
      cursor: 1,
    })

    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.plan.candidates.map((candidate) => candidate.channelId)).toEqual(['a', 'b', 'c'])
    expect(first.plan.nextCursor).toBe(1)
    expect(first.plan.cursorModulus).toBe(2)
    expect(second.plan.candidates.map((candidate) => candidate.channelId)).toEqual(['b', 'a', 'c'])
    expect(second.plan.nextCursor).toBe(0)
  })

  it('性能优先把有实测延迟的候选排前，未测过的排最后', () => {
    const result = buildRoutePlan({
      channels: [
        channel({ id: 'unknown', lastTestLatency: null }),
        channel({ id: 'slow', lastTestLatency: 900 }),
        channel({ id: 'fast', lastTestLatency: 120 }),
      ],
      logicalModel: 'gpt-5',
      capability: 'chat',
      policy: { strategy: 'performance', maxAttempts: 3 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.candidates.map((candidate) => candidate.channelId)).toEqual([
      'fast',
      'slow',
      'unknown',
    ])
  })

  it('停用渠道即使有关键和模型，也不进入路由候选', () => {
    const result = buildRoutePlan({
      channels: [
        channel({ id: 'enabled', priority: 1 }),
        channel({ id: 'disabled', priority: 99, enabled: false }),
      ],
      logicalModel: 'gpt-5',
      capability: 'chat',
      policy: { maxAttempts: 3 },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.candidates.map((candidate) => candidate.channelId)).toEqual([
      'enabled',
    ])
  })

  it('渠道级模型映射和旧的无分组路径保持兼容', () => {
    const result = buildRoutePlan({
      channels: [
        channel({
          id: 'legacy',
          models: [],
          modelMap: { 'GPT-5': 'gpt-5-2026' },
        }),
      ],
      logicalModel: 'GPT-5',
      capability: 'chat',
    })
    expect(result).toMatchObject({
      ok: true,
      plan: {
        candidates: [{
          channelId: 'legacy',
          upstreamModel: 'gpt-5-2026',
        }],
      },
    })
  })
})
