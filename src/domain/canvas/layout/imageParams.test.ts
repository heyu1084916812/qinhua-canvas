import { describe, expect, it } from 'vitest'
import { imageParamsFor } from './imageParams'

/**
 * **图片模型各自的参数能力**（用户 2026-10-03：「每个图片模型有哪些配置单独设置，
 * 不要通用设置，去官方文档找一下」）。
 *
 * 每一条的出处都写在 `imageParams.ts` 的注释里（Agnes 官方文档
 * `wiki.agnes-ai.com/en/docs/agnes-image-{20,21,25}-flash`，2026-10-03 实读）。
 */
describe('imageParamsFor · 图片模型各自的参数能力', () => {
  it('★★ Agnes Image 2.0 Flash 是**像素**方言：3 个像素尺寸、没有 ratio / quality / 张数', () => {
    const spec = imageParamsFor('agnes-image-2.0-flash')
    expect(spec?.dialect).toBe('pixel')
    expect(spec?.sizes).toEqual(['1024x1024', '1024x768', '768x1024'])
    expect(spec?.ratios).toEqual([])
    expect(spec?.qualities).toEqual([])
    expect(spec?.counts).toEqual([1])
  })

  it('★★ Agnes Image 2.1 / 2.5 Flash 是**档位**方言：1K–4K + 8 档画幅，同样没有 quality / 张数', () => {
    for (const model of ['agnes-image-2.1-flash', 'agnes-image-2.5-flash']) {
      const spec = imageParamsFor(model)
      expect(spec?.dialect).toBe('tier')
      expect(spec?.sizes).toEqual(['1K', '2K', '3K', '4K'])
      expect(spec?.ratios).toEqual([
        '1:1',
        '3:4',
        '4:3',
        '16:9',
        '9:16',
        '2:3',
        '3:2',
        '21:9',
      ])
      expect(spec?.qualities).toEqual([])
      expect(spec?.counts).toEqual([1])
    }
  })

  it('★ 前端显示名与上游 ID 都能查到同一份规格', () => {
    expect(imageParamsFor('Agnes Image 2.5 Flash')?.sizes).toEqual(
      imageParamsFor('agnes-image-2.5-flash')?.sizes,
    )
  })

  it('非 Agnes 模型**故意没有规格**（参数以渠道上报为准，不凭猜写死）', () => {
    expect(imageParamsFor('GPT Image 2')).toBeUndefined()
    expect(imageParamsFor('Nano Banana Pro')).toBeUndefined()
    expect(imageParamsFor('Midjourney')).toBeUndefined()
    expect(imageParamsFor('')).toBeUndefined()
  })
})
