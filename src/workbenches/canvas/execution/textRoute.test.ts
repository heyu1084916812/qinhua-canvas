import { describe, expect, it } from 'vitest'
import type { CatalogChannelLike } from '../../../domain/project/modelCatalog'
import { resolveTextRoute } from './textRoute'

const chat = (id: string) => ({
  id,
  category: 'chat' as const,
  inputTypes: ['text' as const],
})

const channel = (
  id: string,
  patch: Partial<CatalogChannelLike> = {},
): CatalogChannelLike => ({
  id,
  enabled: true,
  models: [],
  modelCache: [],
  modelMap: {},
  ...patch,
})

describe('resolveTextRoute', () => {
  it('旧渠道只剩未勾选缓存时，改走真正勾选并提供该模型的启用渠道', () => {
    const channels = [
      channel('soonstudio', {
        models: [chat('gemini-nano-banana-2.1')],
        modelCache: [chat('Deepseek 4.1 Flash')],
      }),
      channel('workbuddy', {
        models: [chat('cn:deepseek-v4.1-flash')],
        modelMap: { 'Deepseek 4.1 Flash': 'cn:deepseek-v4.1-flash' },
      }),
    ]

    expect(resolveTextRoute(channels, 'soonstudio', 'Deepseek 4.1 Flash')).toEqual({
      channelId: 'workbuddy',
      model: 'Deepseek 4.1 Flash',
    })
  })

  it('首选渠道确实支持该模型时保持原选择', () => {
    const channels = [
      channel('preferred', { models: [chat('Deepseek 4.1 Flash')] }),
      channel('other', { models: [chat('Deepseek 4.1 Flash')] }),
    ]

    expect(resolveTextRoute(channels, 'preferred', 'Deepseek 4.1 Flash')).toEqual({
      channelId: 'preferred',
      model: 'Deepseek 4.1 Flash',
    })
  })

  it('首选渠道已停用时改走启用渠道', () => {
    const channels = [
      channel('old', {
        enabled: false,
        models: [chat('Deepseek 4.1 Flash')],
      }),
      channel('live', { models: [chat('Deepseek 4.1 Flash')] }),
    ]

    expect(resolveTextRoute(channels, 'old', 'Deepseek 4.1 Flash')?.channelId).toBe('live')
  })

  it('启用渠道都不支持该模型时返回 null，不回退旧渠道', () => {
    const channels = [
      channel('soonstudio', {
        models: [chat('gemini-nano-banana-2.1')],
        modelCache: [chat('Deepseek 4.1 Flash')],
      }),
    ]

    expect(resolveTextRoute(channels, 'soonstudio', 'Deepseek 4.1 Flash')).toBeNull()
  })

  it('旧上游 ID 会先归一成逻辑名，再进行选路', () => {
    const channels = [
      channel('relay', {
        models: [chat('deepseek-v4-flash')],
        modelMap: { 'Deepseek 4.1 Flash': 'deepseek-v4-flash' },
      }),
    ]

    expect(resolveTextRoute(channels, undefined, 'deepseek-v4-flash')).toEqual({
      channelId: 'relay',
      model: 'Deepseek 4.1 Flash',
    })
  })
})
