import { describe, expect, it } from 'vitest'
import {
  DETAIL_HIGHLIGHT_OPTIONS,
  buildEcommerceModeOptionsPrompt,
  batchWhiteOutputError,
  defaultEcommerceModeOptions,
  ecommerceModeCount,
  normalizeEcommerceModeOptions,
  whiteBgCountsOf,
} from './modeOptions'

describe('ecommerce mode options', () => {
  it('drops malformed values and keeps bounded strings, arrays and count maps', () => {
    const out = normalizeEcommerceModeOptions({
      strategy: 'custom',
      empty: '   ',
      list: ['a', '', 'a', 'b'],
      counts: { whiteBg: 2, scene: -4, detail: 999, bad: '3' },
      bad: ['x', { nope: true }],
    })
    expect(out).toEqual({
      strategy: 'custom',
      list: ['a', 'b'],
      counts: { whiteBg: 2, scene: 0, detail: 20 },
      bad: ['x'],
    })
  })

  it('uses the sum of custom product-set counts as the actual request count', () => {
    const options = {
      ...defaultEcommerceModeOptions('product-set'),
      setStrategy: 'custom',
      setCounts: { whiteBg: 1, scene: 2, sellingPoint: 2, detail: 1, other: 0 },
    }
    expect(ecommerceModeCount('product-set', 8, options)).toBe(6)
    expect(
      ecommerceModeCount('product-set', 8, {
        ...options,
        setCounts: { whiteBg: 0, scene: 0, sellingPoint: 0, detail: 0, other: 0 },
      }),
    ).toBe(1)
  })

  it('product-white sums per-angle counts and migrates the old multi-angle option', () => {
    expect(
      ecommerceModeCount('product-white', 1, {
        whiteBgCounts: { front: 1, left45: 2, back: 1 },
      }),
    ).toBe(4)
    expect(whiteBgCountsOf({ whiteStyle: 'multi' })).toMatchObject({
      front: 1,
      left45: 1,
      right45: 1,
      side: 1,
      back: 1,
      top: 1,
      bottom: 1,
      detail: 1,
    })
    expect(
      buildEcommerceModeOptionsPrompt('product-white', {
        whiteBgCounts: { front: 1, left45: 2 },
      }),
    ).toContain('白底角度：正面1张、左45°2张')
  })

  it('★★ A+ 详情页按已选优化项计算张数，14 项就是 14 张', () => {
    expect(
      ecommerceModeCount('product-detail', 4, {
        detailHighlights: DETAIL_HIGHLIGHT_OPTIONS.map((option) => option.id),
      }),
    ).toBe(14)
    expect(
      ecommerceModeCount('product-detail', 4, {
        detailHighlights: ['hero', 'usageScene', 'sizeChart', 'not-a-real-option'],
      }),
    ).toBe(3)
  })

  it('batch white enforces 12 source images and 36 total outputs', () => {
    expect(batchWhiteOutputError(12, 3)).toBeNull()
    expect(batchWhiteOutputError(12, 4)).toContain('36')
    expect(batchWhiteOutputError(13, 1)).toContain('12')
    expect(batchWhiteOutputError(2, 0)).toContain('至少要选择')
  })

  it('turns stable option ids into a model-facing prompt for each feature family', () => {
    expect(
      buildEcommerceModeOptionsPrompt('product-detail', {
        detailHighlights: ['hero', 'usageScene', 'sizeChart'],
      }),
    ).toContain('首屏主视觉、使用场景图、尺寸尺码图')
    expect(
      buildEcommerceModeOptionsPrompt('product-recolor', {
        targetColor: '#123456',
        colorTolerance: '70',
      }),
    ).toContain('目标颜色：#123456')
    expect(
      buildEcommerceModeOptionsPrompt('video-commerce', {
        videoTypes: ['ugc', 'demo'],
        modelGender: 'female',
        modelAge: 'young',
        modelEthnicity: 'asian',
        modelBody: 'standard',
      }),
    ).toContain('视频类型：UGC 种草、产品演示')
    expect(
      buildEcommerceModeOptionsPrompt('wear-detail', {
        wearDetails: ['collar', 'fabric'],
      }),
    ).toContain('细节类型：领口、面料')
  })
})
