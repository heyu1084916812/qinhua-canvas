import { describe, expect, it } from 'vitest'
import {
  resolveRoutedChatTarget,
  resolveSpeechTarget,
  userConfiguredChannels,
} from './chatTarget'
import type { Channel } from '../project/channel'

const channel = (over: Partial<Channel>): Channel =>
  ({
    id: 'ch1',
    protocol: 'mock',
    baseUrl: '',
    hasToken: false,
    hasAltToken: false,
    name: '测试渠道',
    enabled: true,
    models: [],
    modelMap: {},
    ...over,
  }) as Channel

describe('channel routing eligibility', () => {
  it('keeps configured built-in channels but excludes the offline mock channel', () => {
    const channels = [
      channel({ id: 'ch_builtin_modelscope', protocol: 'modelscope' }),
      channel({ id: 'ch_smoke_mock', protocol: 'mock' }),
      channel({ id: 'ch_mine', protocol: 'openai-compatible', baseUrl: 'https://mine.test/v1' }),
    ]
    expect(userConfiguredChannels(channels).map((item) => item.id)).toEqual([
      'ch_builtin_modelscope',
      'ch_mine',
    ])
  })

  it('does not auto-select a remote speech channel without a saved token', () => {
    expect(
      resolveSpeechTarget([
        channel({
          protocol: 'openai-compatible',
          baseUrl: 'https://example.com/v1',
          hasToken: false,
          hasAltToken: false,
          models: [{ id: 'tts-1', category: 'audio', inputTypes: ['text'] }],
        }),
      ]),
    ).toBeNull()
  })
})

describe('resolveSpeechTarget', () => {
  it('只挑已启用且勾了 audio 模型的渠道，并带出音色清单', () => {
    const target = resolveSpeechTarget([
      channel({ id: 'off', enabled: false, models: [{ id: 'tts-1', category: 'audio', inputTypes: ['text'] }] }),
      channel({ id: 'chat', models: [{ id: 'gpt', category: 'chat', inputTypes: ['text'] }] }),
      channel({
        id: 'speech',
        models: [
          {
            id: 'tts-1',
            category: 'audio',
            inputTypes: ['text'],
            voices: ['alloy', 'nova'],
          },
        ],
      }),
    ])
    expect(target).toEqual({
      channelId: 'speech',
      model: 'tts-1',
      label: '测试渠道 · OpenAI TTS',
      voices: ['alloy', 'nova'],
    })
  })

  it('没有可用的 audio 模型就如实返回 null', () => {
    expect(resolveSpeechTarget([channel({ models: [] })])).toBeNull()
  })
})

describe('resolveRoutedChatTarget', () => {
  const chatModel = { id: 'gpt-6-astra', category: 'chat' as const, inputTypes: ['text' as const] }

  it('固定显示名交给全局优先度选路，不依赖会话里上次的渠道', () => {
    const target = resolveRoutedChatTarget(
      [
        channel({
          id: 'low',
          protocol: 'openai-compatible',
          baseUrl: 'https://low.test/v1',
          hasToken: true,
          priority: 1,
          models: [chatModel],
        }),
        channel({
          id: 'high',
          protocol: 'openai-compatible',
          baseUrl: 'https://high.test/v1',
          hasToken: true,
          priority: 9,
          models: [chatModel],
        }),
      ],
      'GPT-6 Astra',
      'priority',
      { random: 0 },
    )
    expect(target).toEqual({
      channelId: 'high',
      logicalModel: 'GPT-6 Astra',
      upstreamModel: 'gpt-6-astra',
    })
  })

  it('模型映射参与候选解析，返回该渠道的真实上游 ID', () => {
    const target = resolveRoutedChatTarget(
      [
        channel({
          id: 'mapped',
          protocol: 'openai-compatible',
          baseUrl: 'https://mapped.test/v1',
          hasToken: true,
          modelMap: { 'GPT-6 Astra': 'gpt-6-astra-site' },
        }),
      ],
      'GPT-6 Astra',
      'priority',
    )
    expect(target?.channelId).toBe('mapped')
    expect(target?.upstreamModel).toBe('gpt-6-astra-site')
  })

  it('没有令牌的远程渠道不参与选路', () => {
    expect(
      resolveRoutedChatTarget(
        [
          channel({
            id: 'no-token',
            protocol: 'openai-compatible',
            baseUrl: 'https://no-token.test/v1',
            hasToken: false,
            models: [chatModel],
          }),
        ],
        'GPT-6 Astra',
        'priority',
      ),
    ).toBeNull()
  })

  it('没有任何渠道提供该固定显示名时返回 null', () => {
    expect(
      resolveRoutedChatTarget(
        [
          channel({
            id: 'other-model',
            protocol: 'openai-compatible',
            baseUrl: 'https://other.test/v1',
            hasToken: true,
            models: [{ id: 'other-chat', category: 'chat', inputTypes: ['text'] }],
          }),
        ],
        'GPT-6 Astra',
        'priority',
      ),
    ).toBeNull()
  })
})
