import { describe, expect, it } from 'vitest'
import {
  isVideoEditModel,
  normalizeVideoEditResolution,
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

  it('不把别的视频模型当成编辑模型', () => {
    expect(isVideoEditModel('Topaz 视频超清')).toBe(false)
    expect(isVideoEditModel('全能视频X 视频编辑')).toBe(true)
  })
})
