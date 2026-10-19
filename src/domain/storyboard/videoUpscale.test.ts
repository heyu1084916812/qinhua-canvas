import { describe, expect, it } from 'vitest'
import {
  isVideoUpscaleModel,
  normalizeVideoUpscaleSettings,
  videoUpscaleActionOf,
  videoUpscaleOptionsOf,
} from './videoUpscale'

describe('漫剧视频超清档位', () => {
  it('Topaz 提供 720p / 1080p / 4k 与 30 / 60fps', () => {
    expect(videoUpscaleOptionsOf('Topaz 视频超清')).toEqual({
      resolutions: ['720p', '1080p', '4k'],
      frameRates: [30, 60],
    })
  })

  it('RH 视频超分不提供帧率档，支持 2k', () => {
    expect(videoUpscaleOptionsOf('RH 视频超分')).toEqual({
      resolutions: ['720p', '1080p', '2k', '4k'],
      frameRates: [],
    })
  })

  it('RH 视频补帧不伪造分辨率或帧率，只走视频后处理', () => {
    expect(videoUpscaleOptionsOf('RH 视频补帧')).toEqual({
      resolutions: [],
      frameRates: [],
    })
    expect(normalizeVideoUpscaleSettings('RH 视频补帧', '1080p', 60)).toEqual({
      resolution: '',
      frameRate: null,
    })
    expect(videoUpscaleActionOf('RH 视频补帧')).toBe('fps')
    expect(videoUpscaleActionOf('Topaz 视频超清')).toBe('upscale')
  })

  it('非法档位回落到 1080p 与模型默认帧率', () => {
    expect(normalizeVideoUpscaleSettings('Topaz 视频超清', '8k', 120)).toEqual({
      resolution: '1080p',
      frameRate: 30,
    })
    expect(normalizeVideoUpscaleSettings('RH 视频超分', '2k', 60)).toEqual({
      resolution: '2k',
      frameRate: null,
    })
  })

  it('只认两条真实视频超清模型', () => {
    expect(isVideoUpscaleModel('Topaz 图像超清 Standard')).toBe(false)
    expect(isVideoUpscaleModel('Topaz 视频超清')).toBe(true)
    expect(isVideoUpscaleModel('RH 视频补帧')).toBe(true)
  })
})
