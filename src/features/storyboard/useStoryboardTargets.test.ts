import { describe, expect, it } from 'vitest'
import type { ModelCapability } from '../../domain/shared/capability'
import type { Channel } from '../../domain/project/channel'
import { VIDEO_EDIT_MODEL_IDS } from '../../domain/storyboard/videoEdit'
import { VIDEO_ERASE_MODEL_IDS } from '../../domain/storyboard/videoErase'
import { VIDEO_EXTEND_MODEL_IDS } from '../../domain/storyboard/videoExtend'
import { VIDEO_UPSCALE_MODEL_IDS } from '../../domain/storyboard/videoUpscale'
import { resolveStoryboardTargets } from './useStoryboardTargets'

const model = (
  id: string,
  category: ModelCapability['category'],
  inputTypes: ModelCapability['inputTypes'],
  extra: Partial<ModelCapability> = {},
): ModelCapability => ({ id, category, inputTypes, ...extra })

const channel = (over: Partial<Channel>): Channel =>
  ({
    id: 'channel-1',
    name: '漫剧渠道',
    protocol: 'mock',
    baseUrl: '',
    icon: null,
    credentialRef: null,
    tokenTail: null,
    hasToken: false,
    enabled: true,
    models: [],
    modelCache: [],
    modelMap: {},
    ...over,
  }) as Channel

describe('resolveStoryboardTargets', () => {
  it('从同一份渠道快照解析数字人、四类视频后处理和 chat / speech 目标', () => {
    const targets = resolveStoryboardTargets([
      channel({
        models: [
          model('Kling V2 数字人口播 Std', 'video', ['text'], {
            upstreamCategory: 'video',
          }),
          model(VIDEO_UPSCALE_MODEL_IDS[0], 'video', ['video']),
          model(VIDEO_EDIT_MODEL_IDS[0], 'video', ['video', 'image']),
          model(VIDEO_ERASE_MODEL_IDS[0], 'video', ['video']),
          model(VIDEO_EXTEND_MODEL_IDS[0], 'video', ['video']),
          model('chat-model', 'chat', ['text']),
          model('tts-model', 'audio', ['text'], {
            voices: ['alloy', 'nova'],
          }),
        ],
      }),
    ])

    expect(targets.digitalHumanTarget).toEqual({
      channelId: 'channel-1',
      channelName: '漫剧渠道',
      model: 'Kling V2 数字人口播 Std',
    })
    expect(targets.videoUpscaleTargets).toHaveLength(1)
    expect(targets.videoUpscaleTargets[0]).toMatchObject({
      channelId: 'channel-1',
      model: VIDEO_UPSCALE_MODEL_IDS[0],
      resolutions: ['720p', '1080p', '4k'],
      frameRates: [30, 60],
    })
    expect(targets.videoEditTargets[0]).toMatchObject({
      model: VIDEO_EDIT_MODEL_IDS[0],
      supportsReferenceImage: true,
    })
    expect(targets.videoEraseTargets[0]?.model).toBe(VIDEO_ERASE_MODEL_IDS[0])
    expect(targets.videoExtendTargets[0]?.model).toBe(VIDEO_EXTEND_MODEL_IDS[0])
    expect(targets.chatTarget).toMatchObject({
      channelId: 'channel-1',
      model: 'chat-model',
    })
    expect(targets.speechTarget).toMatchObject({
      channelId: 'channel-1',
      model: 'tts-model',
      voices: ['alloy', 'nova'],
    })
  })

  it('停用渠道不贡献任何目标', () => {
    const targets = resolveStoryboardTargets([
      channel({
        enabled: false,
        models: [
          model('Kling V2 数字人口播 Std', 'video', ['text']),
          model(VIDEO_UPSCALE_MODEL_IDS[0], 'video', ['video']),
          model('chat-model', 'chat', ['text']),
          model('tts-model', 'audio', ['text']),
        ],
      }),
    ])

    expect(targets.digitalHumanTarget).toBeNull()
    expect(targets.videoUpscaleTargets).toEqual([])
    expect(targets.chatTarget).toBeNull()
    expect(targets.speechTarget).toBeNull()
  })
})
