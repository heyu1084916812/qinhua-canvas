import { describe, expect, it } from 'vitest'
import {
  isVideoExtendModel,
  normalizeVideoExtendSettings,
  videoExtendDurationsOf,
  videoExtendResolutionsOf,
} from './videoExtend'

describe('漫剧视频续写档位', () => {
  it('只暴露官方端点声明的 720P / 1080P 与 2–15 秒', () => {
    expect(videoExtendResolutionsOf('万相2.7 视频续写')).toEqual(['720P', '1080P'])
    expect(videoExtendDurationsOf('万相2.7 视频续写')).toHaveLength(14)
  })

  it('非法值回落到真实默认档', () => {
    expect(normalizeVideoExtendSettings('万相2.7 视频续写', '4K', 30)).toEqual({
      resolution: '720P',
      duration: 2,
    })
  })

  it('新增续写模型分别只暴露自己的真实参数', () => {
    expect(normalizeVideoExtendSettings('全能视频X 视频续写', '1080P', 10)).toEqual({
      resolution: '',
      duration: 10,
    })
    expect(videoExtendDurationsOf('全能视频X 视频续写')).toEqual([6, 10])
    expect(videoExtendResolutionsOf('全能视频V3.1 Pro 视频扩展')).toEqual([
      '720p',
      '1080p',
    ])
    expect(videoExtendDurationsOf('全能视频V3.1 Pro 视频扩展')).toEqual([])
    expect(normalizeVideoExtendSettings('全能视频V3.1 Pro 视频扩展', '1080p', 10)).toEqual({
      resolution: '1080p',
      duration: null,
    })
  })

  it('不把其他视频模型当成续写模型', () => {
    expect(isVideoExtendModel('全能视频X 视频编辑')).toBe(false)
    expect(isVideoExtendModel('万相2.7 视频续写')).toBe(true)
    expect(isVideoExtendModel('全能视频V3.1 Fast 视频扩展')).toBe(true)
  })
})
