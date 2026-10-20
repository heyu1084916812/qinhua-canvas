import { describe, expect, it } from 'vitest'
import {
  buildEcommerceModeOptionsPrompt,
  defaultEcommerceModeOptions,
  ecommerceModeCount,
  normalizeEcommerceModeOptions,
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
