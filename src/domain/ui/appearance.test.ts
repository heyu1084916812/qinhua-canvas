import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ACCENT_PALETTES,
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
  accentOf,
  accentTokens,
  letterSpacingValue,
  parseAppearance,
  readAppearance,
  uiScaleFactor,
  uiScaleLabel,
  writeAppearance,
} from './appearance'

/**
 * 界面外观偏好（用户 2026-10-09）。
 *
 * 重点不是"能读能写"，而是**容错**：任何一项坏值只回落它自己，
 * 不能把整份偏好带成默认 —— 否则用户改一个字距会看到字号也跳回去。
 */
describe('界面外观偏好', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('★ 档位与取值一一对应（三档字号 + 两档字距）', () => {
    expect(uiScaleLabel('compact')).toBe('紧凑')
    expect(uiScaleLabel('standard')).toBe('标准')
    expect(uiScaleLabel('comfortable')).toBe('舒适')
    // 标准必须是 1：不然"默认"会整体改变现有排版
    expect(uiScaleFactor('standard')).toBe(1)
    expect(uiScaleFactor('compact')).toBeLessThan(1)
    expect(uiScaleFactor('comfortable')).toBeGreaterThan(1)
    expect(letterSpacingValue('normal')).toBe('normal')
    expect(letterSpacingValue('wide')).toBe('0.04em')
  })

  it('★★ 单项坏值只回落它自己，不牵连其他项', () => {
    const parsed = parseAppearance({
      font: { kind: 'custom', fontId: 'font1' },
      scale: '巨大', // 坏值
      letterSpacing: 'normal',
    })
    expect(parsed.scale).toBe('standard') // 只有它回落
    expect(parsed.letterSpacing).toBe('normal') // 好的那项原样保留
    expect(parsed.font).toEqual({ kind: 'custom', fontId: 'font1' })
  })

  it('★ 字体选择不合法时回落系统字体（不留半截自定义引用）', () => {
    expect(parseAppearance({ font: { kind: 'custom' } }).font).toEqual({ kind: 'system' })
    expect(parseAppearance({ font: 'system' }).font).toEqual({ kind: 'system' })
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE)
    expect(parseAppearance('not-an-object')).toEqual(DEFAULT_APPEARANCE)
  })

  it('★ 落盘再读回是同一份（本机偏好跨刷新保持）', () => {
    const backing = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
      removeItem: (k: string) => void backing.delete(k),
    })

    const prefs = {
      ...DEFAULT_APPEARANCE,
      font: { kind: 'custom' as const, fontId: 'font-9' },
      scale: 'comfortable' as const,
      letterSpacing: 'normal' as const,
    }
    writeAppearance(prefs)
    expect(backing.has(APPEARANCE_STORAGE_KEY)).toBe(true)
    expect(readAppearance()).toEqual(prefs)
  })

  it('★★ localStorage 不可用 / 内容损坏时回默认，不让应用崩', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('隐私模式禁止访问')
      },
      setItem: () => {
        throw new Error('配额已满')
      },
      removeItem: () => {},
    })
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
    // 写失败也不能抛（本次生效就够，重启回落默认）
    expect(() => writeAppearance(DEFAULT_APPEARANCE)).not.toThrow()

    vi.stubGlobal('localStorage', {
      getItem: () => '{ 这不是 JSON',
      setItem: () => {},
      removeItem: () => {},
    })
    expect(readAppearance()).toEqual(DEFAULT_APPEARANCE)
  })
})

/**
 * 强调色（#379 剩余项）。
 *
 * 判据是**算式**不是眼睛：每一档的 accent 与 accent-text 在亮 / 暗两套主题下
 * 都要 ≥ 4.5:1 —— "看着差不多、实际浅字压浅底"是这类功能最典型的翻车方式。
 */
describe('强调色色板', () => {
  const channel = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const luminance = (hex: string) => {
    const h = hex.replace('#', '')
    return (
      0.2126 * channel(parseInt(h.slice(0, 2), 16)) +
      0.7152 * channel(parseInt(h.slice(2, 4), 16)) +
      0.0722 * channel(parseInt(h.slice(4, 6), 16))
    )
  }
  const contrast = (a: string, b: string) => {
    const la = luminance(a)
    const lb = luminance(b)
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
  }

  it('八档色板，id 各不相同', () => {
    expect(ACCENT_PALETTES).toHaveLength(8)
    expect(new Set(ACCENT_PALETTES.map((p) => p.id)).size).toBe(8)
  })

  it('★ 每一档在亮 / 暗两套下：accent 对 accent-text 都 ≥ 4.5:1（算式，不靠肉眼）', () => {
    const weak = ACCENT_PALETTES.flatMap((p) =>
      (
        [
          ['light', p.light],
          ['dark', p.dark],
        ] as const
      )
        .map(([theme, pair]) => ({ id: `${p.id}/${theme}`, ratio: contrast(pair.accent, pair.text) }))
        .filter((x) => x.ratio < 4.5),
    )
    expect(weak).toEqual([])
  })

  it('★ 默认档（ink）就是主题令牌里那两个值 —— 升级不改老用户观感', () => {
    expect(accentTokens('ink', 'light')).toEqual({ accent: '#171716', text: '#ffffff' })
    expect(accentTokens('ink', 'dark')).toEqual({ accent: '#efefef', text: '#161616' })
  })


  it('非法 / 缺失 id 一律回落默认档（不留半截引用）', () => {
    expect(accentOf('nope').id).toBe('ink')
    expect(accentOf(undefined).id).toBe('ink')
    expect(accentTokens(undefined, 'light').accent).toBe('#171716')
  })
})

describe('动效与小地图（#379 剩余项）', () => {
  it('默认 = 现状：完整动效 + 显示小地图', () => {
    expect(DEFAULT_APPEARANCE.motion).toBe('full')
    expect(DEFAULT_APPEARANCE.showMinimap).toBe(true)
    expect(DEFAULT_APPEARANCE.accent).toBe('ink')
  })

  it('★ 单项坏值只回落它自己，不牵连其他项', () => {
    const parsed = parseAppearance({
      accent: 'blue',
      motion: '冰住', // 坏值
      showMinimap: 'yes', // 坏值（要 boolean，不给字符串）
      scale: 'comfortable',
    })
    expect(parsed.accent).toBe('blue')
    expect(parsed.motion).toBe('full')
    expect(parsed.showMinimap).toBe(true)
    expect(parsed.scale).toBe('comfortable')
  })
})
