import { describe, expect, it } from 'vitest'
import {
  ASSET_EXT_FALLBACK,
  assetFileName,
  assetMimeOfName,
  isAssetFileName,
  normalizeAssetLocationConfig,
} from './assetLocation'

describe('素材文件名规则', () => {
  it('按 mime 起扩展名（hash 即内容哈希 ⇒ 重传同图幂等）', () => {
    expect(assetFileName('abc123', 'image/png')).toBe('abc123.png')
    expect(assetFileName('abc123', 'image/jpeg')).toBe('abc123.jpg')
    expect(assetFileName('abc123', 'video/mp4')).toBe('abc123.mp4')
  })

  it('mime 带参数 / 大小写不一时仍认得出', () => {
    expect(assetFileName('h', 'image/png;charset=binary')).toBe('h.png')
    expect(assetFileName('h', 'IMAGE/PNG')).toBe('h.png')
  })

  it('认不出的类型落 fallback，而不是丢素材', () => {
    expect(assetFileName('h', 'application/octet-stream')).toBe(`h.${ASSET_EXT_FALLBACK}`)
    expect(assetFileName('h', '')).toBe(`h.${ASSET_EXT_FALLBACK}`)
  })
})

describe('从文件名反推类型（"加载某个文件夹的内容"要用）', () => {
  it('认得出图片 / 视频', () => {
    expect(assetMimeOfName('abc.png')).toBe('image/png')
    expect(assetMimeOfName('abc.JPEG')).toBe('image/jpeg')
    expect(assetMimeOfName('abc.webm')).toBe('video/webm')
  })

  it('非素材文件返回 null（扫描时要被过滤掉）', () => {
    expect(assetMimeOfName('READEME.md')).toBe(null)
    expect(assetMimeOfName('.DS_Store')).toBe(null)
    expect(assetMimeOfName('noext')).toBe(null)
    expect(isAssetFileName('READEME.md')).toBe(false)
    expect(isAssetFileName('abc.webp')).toBe(true)
  })
})

describe('配置归一化', () => {
  it('非法输入回落成内置库（宁可退回默认档，也不要落到错的一档）', () => {
    expect(normalizeAssetLocationConfig(null)).toEqual({ mode: 'library', folderName: null })
    expect(normalizeAssetLocationConfig({ mode: 'something' })).toEqual({ mode: 'library', folderName: null })
    expect(normalizeAssetLocationConfig({ mode: 'library', folderName: 'x' })).toEqual({
      mode: 'library',
      folderName: null,
    })
  })

  it('folder 档保留目录名并去空白', () => {
    expect(normalizeAssetLocationConfig({ mode: 'folder', folderName: '  我的素材  ' })).toEqual({
      mode: 'folder',
      folderName: '我的素材',
    })
    expect(normalizeAssetLocationConfig({ mode: 'folder' })).toEqual({ mode: 'folder', folderName: null })
  })
})
