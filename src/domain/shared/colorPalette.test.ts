import { describe, expect, it } from 'vitest'
import {
  PALETTE_UNAVAILABLE,
  extractPaletteFromUrl,
  paletteFromPixels,
  paletteTextFor,
  type PaletteDecoder,
} from './colorPalette'

describe('paletteFromPixels', () => {
  it('从像素里提取稳定的主色', () => {
    const data = new Uint8ClampedArray([
      255, 0, 0, 255,
      255, 0, 0, 255,
      255, 0, 0, 255,
      0, 0, 255, 255,
      0, 0, 255, 255,
    ])
    expect(paletteFromPixels(data)).toEqual(['#ff0000', '#0000ff'])
  })

  it('忽略透明像素；没有可用像素时返回空数组', () => {
    expect(paletteFromPixels(new Uint8ClampedArray([255, 0, 0, 0]))).toEqual([])
    expect(paletteFromPixels(new Uint8ClampedArray())).toEqual([])
  })
})

describe('extractPaletteFromUrl', () => {
  it('解码成功时返回颜色', async () => {
    const decoder: PaletteDecoder = async () => ({
      data: new Uint8ClampedArray([0, 255, 0, 255]),
      width: 1,
      height: 1,
    })
    expect(await extractPaletteFromUrl('blob:image', decoder)).toEqual(['#00ff00'])
  })

  it('解码失败时安全返回空数组，不把页面打崩', async () => {
    const decoder: PaletteDecoder = async () => {
      throw new Error('decode failed')
    }
    expect(await extractPaletteFromUrl('blob:broken', decoder)).toEqual([])
  })
})

describe('paletteTextFor', () => {
  it('视频明确显示暂不可用', () => {
    expect(paletteTextFor('video', ['#ff0000'])).toBe(PALETTE_UNAVAILABLE)
  })

  it('图片没有可提取颜色时也显示暂不可用', () => {
    expect(paletteTextFor('image', [])).toBe(PALETTE_UNAVAILABLE)
  })

  it('图片有颜色时显示色值摘要', () => {
    expect(paletteTextFor('image', ['#ff0000', '#0000ff'])).toBe('#ff0000 / #0000ff')
  })
})
