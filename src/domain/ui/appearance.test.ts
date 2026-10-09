import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  APPEARANCE_STORAGE_KEY,
  DEFAULT_APPEARANCE,
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
