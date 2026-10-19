import { describe, expect, it } from 'vitest'
import {
  isVideoEditModel,
  normalizeVideoEditResolution,
  videoEditRequiresReferenceImage,
  videoEditResolutionsOf,
} from './videoEdit'

describe('漫剧视频编辑档位', () => {
  it('全能视频X 只提供官方目录声明的 480p / 720p', () => {
    expect(videoEditResolutionsOf('全能视频X 视频编辑')).toEqual(['480p', '720p'])
  })

  it('非法分辨率回落到 480p', () => {
    expect(normalizeVideoEditResolution('全能视频X 视频编辑', '1080p')).toBe('480p')
    expect(normalizeVideoEditResolution('全能视频X 视频编辑', '720p')).toBe('720p')
  })

  it('Kling O3 Pro 官方端点没有清晰度参数，界面不应伪造档位', () => {
    expect(videoEditResolutionsOf('Kling O3 Pro 视频编辑')).toEqual([])
    expect(normalizeVideoEditResolution('Kling O3 Pro 视频编辑', '720p')).toBe('')
  })

  it('每个新增编辑模型只暴露官方目录里真实存在的清晰度档', () => {
    expect(videoEditResolutionsOf('Kling O3 Std 视频编辑')).toEqual([])
    expect(videoEditResolutionsOf('Kling O1 Std 视频编辑')).toEqual([])
    expect(videoEditResolutionsOf('全能视频 Omni Flash 视频编辑')).toEqual([
      '720p',
      '1080p',
      '4k',
    ])
    expect(videoEditResolutionsOf('HappyHorse 1.0 视频编辑')).toEqual([
      '720p',
      '1080p',
    ])
    expect(videoEditResolutionsOf('全能视频R Gen4 Aleph 视频编辑')).toEqual([])
    expect(videoEditResolutionsOf('万相2.7 视频编辑')).toEqual(['720P', '1080P'])
  })

  it('只有万相 2.7 视频编辑把参考画面声明为必需', () => {
    expect(videoEditRequiresReferenceImage('万相2.7 视频编辑')).toBe(true)
    expect(videoEditRequiresReferenceImage('Kling O3 Pro 视频编辑')).toBe(false)
  })

  it('不把别的视频模型当成编辑模型', () => {
    expect(isVideoEditModel('Topaz 视频超清')).toBe(false)
    expect(isVideoEditModel('全能视频X 视频编辑')).toBe(true)
    expect(isVideoEditModel('Kling O3 Pro 视频编辑')).toBe(true)
    expect(isVideoEditModel('全能视频 Omni Flash 视频编辑')).toBe(true)
    expect(isVideoEditModel('万相2.7 视频编辑')).toBe(true)
  })
})
