import { describe, expect, it } from 'vitest'
import { isVideoEraseModel, VIDEO_ERASE_MODEL_IDS } from './videoErase'

describe('漫剧视频字幕擦除模型', () => {
  it('只包含官方标准版与精细化版', () => {
    expect(VIDEO_ERASE_MODEL_IDS).toEqual([
      '火山字幕擦除 标准版',
      '火山字幕擦除 精细化版',
    ])
  })

  it('不把普通视频编辑或超清模型当成擦除模型', () => {
    expect(isVideoEraseModel('火山字幕擦除 标准版')).toBe(true)
    expect(isVideoEraseModel('Kling O3 Pro 视频编辑')).toBe(false)
    expect(isVideoEraseModel('Topaz 视频超清')).toBe(false)
  })
})
