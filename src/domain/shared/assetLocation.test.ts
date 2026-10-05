import { describe, expect, it } from 'vitest'
import {
  ASSET_EXT_FALLBACK,
  assetFileName,
  assetMimeOfName,
  expectedAssetPath,
  isAssetFileName,
  normalizeAssetLocationConfig,
} from './assetLocation'

describe('素材缺失时"它本该在哪"（对账 #196 · 增量 4）', () => {
  it('有目录 + 有 mime：给出确切文件路径（用户照着去找就行）', () => {
    expect(expectedAssetPath('我的素材', 'abc123', 'image/png')).toBe('我的素材/abc123.png')
    expect(expectedAssetPath('my-assets', 'h1', 'video/mp4')).toBe('my-assets/h1.mp4')
  })

  it('mime 未知时写 `<hash>.*`，**不猜扩展名**（猜错等于让人找一个不存在的文件）', () => {
    expect(expectedAssetPath('我的素材', 'abc123', null)).toBe('我的素材/abc123.*')
  })

  it('没选目录时返回 null：没有目录语境，"原路径"是编出来的', () => {
    expect(expectedAssetPath(null, 'abc123', 'image/png')).toBeNull()
    expect(expectedAssetPath('   ', 'abc123', 'image/png')).toBeNull()
  })
})

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
