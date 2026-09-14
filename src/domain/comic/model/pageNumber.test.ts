import { describe, expect, it } from 'vitest'
import { pageBadgeText } from './pageNumber'

describe('pageBadgeText / 叙事页码（缩略角标与导出页脚共用）', () => {
  it('下标 0 起 → 页码 1 起', () => {
    expect(pageBadgeText(0)).toBe('1')
    expect(pageBadgeText(4)).toBe('5')
  })

  it('负数 / NaN / Infinity 夹回首页（宁可错到 1，也不显示 NaN）', () => {
    expect(pageBadgeText(-3)).toBe('1')
    expect(pageBadgeText(Number.NaN)).toBe('1')
    expect(pageBadgeText(Number.POSITIVE_INFINITY)).toBe('1')
    expect(pageBadgeText(Number.NEGATIVE_INFINITY)).toBe('1')
  })

  it('浮点截断', () => {
    expect(pageBadgeText(1.7)).toBe('2')
    expect(pageBadgeText(2.2)).toBe('3')
  })

  it('-0 不会变成 "0"（Math.trunc(-0.4) 得 -0，夹回后仍是 0 → "1"）', () => {
    expect(pageBadgeText(-0.4)).toBe('1')
  })
})
