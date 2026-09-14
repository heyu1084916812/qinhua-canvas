import { describe, it, expect } from 'vitest'
import { acceptToTypes } from './fileSystemAccessFiles'

describe('acceptToTypes（File System Access 的 types 构造）', () => {
  it('逗号串被拆成「mime → 扩展名」映射，而不是当成一个 key', () => {
    const types = acceptToTypes('image/png,image/jpeg,image/webp')
    expect(types).toEqual([
      { accept: { 'image/png': ['.png'], 'image/jpeg': ['.jpg', '.jpeg'], 'image/webp': ['.webp'] } },
    ])
  })

  it('整串当 key 是错的——这正是「点上传毫无反应」的根因（Chrome 抛 Invalid type）', () => {
    const types = acceptToTypes('image/png,image/jpeg')
    const keys = Object.keys(types[0]!.accept)
    for (const k of keys) expect(k).not.toContain(',')
  })

  it('视频类型也带上扩展名', () => {
    const types = acceptToTypes('video/mp4,video/webm,video/quicktime')
    expect(types[0]!.accept['video/quicktime']).toEqual(['.mov'])
  })

  it('映射表里没有的类型跳过（不把野 key 丢给浏览器报错）', () => {
    expect(acceptToTypes('application/x-foo,image/png')).toEqual([{ accept: { 'image/png': ['.png'] } }])
  })

  it('全都认不出时返回空数组 = 不过滤（而不是丢一个非法 types）', () => {
    expect(acceptToTypes('application/x-foo')).toEqual([])
    expect(acceptToTypes(undefined)).toEqual([])
  })

  it('空串 / 空白也返回空数组', () => {
    expect(acceptToTypes('  ,  ')).toEqual([])
  })
})
