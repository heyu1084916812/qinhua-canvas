import { describe, expect, it } from 'vitest'
import { hexToHsv, hsvToHex, normalizeHex, readableTextColor } from './colorMath'

describe('colorMath', () => {
  it('归一化 3 位与 6 位 HEX，并拒绝非法输入', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc')
    expect(normalizeHex(' 123456 ')).toBe('#123456')
    expect(normalizeHex('#1234')).toBeNull()
    expect(normalizeHex('red')).toBeNull()
  })

  it('HEX 与 HSV 双向转换保持色值', () => {
    for (const value of ['#000000', '#ffffff', '#123456', '#9acd32']) {
      expect(hsvToHex(hexToHsv(value))).toBe(value)
    }
  })

  it('HSV 对色相环绕与边界值稳定', () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000')
    expect(hsvToHex({ h: -60, s: 1, v: 1 })).toBe('#ff00ff')
    expect(hsvToHex({ h: 120, s: 0, v: 1 })).toBe('#ffffff')
  })

  it('亮色块使用深色文字，暗色块使用浅色文字', () => {
    expect(readableTextColor('#9acd32')).toBe('#171717')
    expect(readableTextColor('#14532d')).toBe('#ffffff')
  })
})
