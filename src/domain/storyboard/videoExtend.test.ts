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

  it('不把其他视频模型当成续写模型', () => {
    expect(isVideoExtendModel('全能视频X 视频编辑')).toBe(false)
    expect(isVideoExtendModel('万相2.7 视频续写')).toBe(true)
  })
})
