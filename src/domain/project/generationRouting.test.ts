import { describe, expect, it } from 'vitest'
import { createChannel, type Channel } from './channel'
import { BUILTIN_CATALOG } from './protocol'
import type { ModelCapability } from '../shared/capability'
import { generationAvailabilityOf, resolveGenerationTarget } from './generationRouting'

function image(id: string): ModelCapability {
  return {
    id,
    category: 'image',
    inputTypes: ['text', 'image'],
  }
}

function channel(over: {
  id: string
  protocol: string
  models: ModelCapability[]
  priority?: number
  modelMap?: Record<string, string>
  enabled?: boolean
  hasToken?: boolean
  credentialGroups?: Channel['credentialGroups']
}): Channel {
  return {
    ...createChannel({
      name: over.id,
      protocol: over.protocol,
      baseUrl: over.protocol === 'mock' ? '' : 'https://example.com/v1',
    }),
    id: over.id,
    enabled: over.enabled ?? true,
    hasToken: over.hasToken ?? true,
    priority: over.priority ?? 0,
    models: over.models,
    modelMap: over.modelMap ?? {},
    ...(over.credentialGroups ? { credentialGroups: over.credentialGroups } : {}),
  }
}

describe('resolveGenerationTarget', () => {
  it('有真实渠道时，即使 mock 优先度更高也不会被选中', () => {
    const target = resolveGenerationTarget({
      channels: [
        channel({
          id: 'smoke',
          protocol: 'mock',
          priority: 999,
          models: [image('GPT Image 2.5 Sunburst')],
        }),
        channel({
          id: 'comfly',
          protocol: 'openai-compatible',
          priority: 0,
          models: [image('gpt-image-2.5-sunburst')],
          modelMap: { 'GPT Image 2.5 Sunburst': 'gpt-image-2.5-sunburst' },
        }),
      ],
      category: 'image',
      catalog: BUILTIN_CATALOG,
      logicalModel: 'GPT Image 2.5 Sunburst',
    })
    expect(target).toMatchObject({
      channelId: 'comfly',
      logicalModel: 'GPT Image 2.5 Sunburst',
      upstreamModel: 'gpt-image-2.5-sunburst',
      usedMock: false,
    })
  })

  it('真实渠道存在但没有用户所选模型时，明确返回空而不偷换到 mock', () => {
    const target = resolveGenerationTarget({
      channels: [
        channel({
          id: 'smoke',
          protocol: 'mock',
          priority: 999,
          models: [image('GPT Image 2.5 Sunburst')],
        }),
        channel({
          id: 'comfly',
          protocol: 'openai-compatible',
          models: [image('other-image')],
        }),
      ],
      category: 'image',
      catalog: BUILTIN_CATALOG,
      logicalModel: 'GPT Image 2.5 Sunburst',
    })
    expect(target).toBeNull()
  })

  it('隔离测试库只有 mock 时仍允许生成', () => {
    const target = resolveGenerationTarget({
      channels: [
        channel({
          id: 'smoke',
          protocol: 'mock',
          models: [image('mock-image-1')],
        }),
      ],
      category: 'image',
      catalog: BUILTIN_CATALOG,
    })
    expect(target).toMatchObject({
      channelId: 'smoke',
      logicalModel: 'mock-image-1',
      usedMock: true,
    })
  })

  it('显式渠道返回可用的 Key 分组降级链', () => {
    const target = resolveGenerationTarget({
      channels: [
        channel({
          id: 'multi-key',
          protocol: 'openai-compatible',
          models: [image('gpt-image')],
          hasToken: true,
          credentialGroups: [
            {
              id: 'primary',
              name: 'primary',
              credentialRef: '',
              tokenTail: null,
              hasToken: false,
              priority: 2,
              models: [image('gpt-image')],
              modelCache: [],
              createdAt: 0,
            },
            {
              id: 'backup',
              name: 'backup',
              credentialRef: 'cred-backup',
              tokenTail: 'tail',
              hasToken: true,
              priority: 1,
              models: [image('gpt-image')],
              modelCache: [],
              createdAt: 1,
            },
          ],
        }),
      ],
      category: 'image',
      catalog: BUILTIN_CATALOG,
      logicalModel: 'gpt-image',
      channelId: 'multi-key',
    })

    expect(target).toMatchObject({
      channelId: 'multi-key',
      credentialGroupId: 'backup',
      credentialGroupIds: ['backup'],
    })
  })

  it('默认配方来自 mock 时，有真实渠道就改用真实渠道同类别模型', () => {
    const target = resolveGenerationTarget({
      channels: [
        channel({
          id: 'smoke',
          protocol: 'mock',
          priority: 999,
          models: [image('mock-image-1')],
        }),
        channel({
          id: 'real',
          protocol: 'openai-compatible',
          models: [image('real-image')],
        }),
      ],
      category: 'image',
      catalog: BUILTIN_CATALOG,
      recipe: { channelId: 'smoke', model: 'mock-image-1' },
    })
    expect(target).toMatchObject({
      channelId: 'real',
      logicalModel: 'real-image',
      usedMock: false,
    })
  })
})

describe('generationAvailabilityOf', () => {
  it('没有渠道、渠道停用、缺令牌、缺图片模型时分别给出可执行原因', () => {
    expect(generationAvailabilityOf([], 'image')).toEqual({
      ready: false,
      reason: '还没有配置任何渠道',
    })
    expect(generationAvailabilityOf([channel({ id: 'off', protocol: 'openai-compatible', models: [image('m')], enabled: false })], 'image').reason).toBe(
      '已配置的渠道都未启用',
    )
    expect(generationAvailabilityOf([channel({ id: 'no-token', protocol: 'openai-compatible', models: [image('m')], hasToken: false })], 'image').reason).toBe(
      '已启用的渠道缺少有效令牌、地址或可用协议',
    )
    expect(generationAvailabilityOf([channel({ id: 'text', protocol: 'openai-compatible', models: [] })], 'image').reason).toBe(
      '可路由的渠道里还没有勾选图片模型',
    )
  })

  it('存在可路由且带对应模型的渠道时标记为可用', () => {
    expect(
      generationAvailabilityOf(
        [channel({ id: 'ready', protocol: 'openai-compatible', models: [image('m')] })],
        'image',
      ),
    ).toEqual({ ready: true, reason: null })
  })
})
