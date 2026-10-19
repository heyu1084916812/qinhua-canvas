import { describe, expect, it } from 'vitest'
import { resolveSpeechTarget } from './chatTarget'
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
