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
    expect(imageParamsFor('Nano Banana Pro')).toBeUndefined()
    expect(imageParamsFor('Midjourney')).toBeUndefined()
    expect(imageParamsFor('')).toBeUndefined()
  })

  /**
   * **Comfy-gpt 的三个 GPT Image 档**（2026-10-03 真令牌问出来的口径，对账 #119）：
   * `size` 必须是 `WxH` 像素（传档位字符串回 `size must be in WxH pixels format`），
   * `quality` 合法值是 `auto/low/medium/high/xhigh/max`（服务端错误原文列出），
   * 画幅 9 档（含 21:9 / 9:21）、分辨率 1k/2k 由渠道上报。
   */
  it('★★ Comfy-gpt 的 GPT Image 三档：画幅 × 分辨率换算像素、quality 六档、最多 4 张', () => {
    for (const name of ['GPT Image 2', 'GPT Image 2.5 Flare', 'GPT Image 2.5 Sunburst']) {
      const spec = imageParamsFor(name)
      expect(spec?.dialect).toBe('ratio+resolution')
      expect(spec?.sizes).toEqual(['1k', '2k'])
      expect(spec?.ratios).toEqual([
        '1:1',
        '4:3',
        '3:4',
        '3:2',
        '2:3',
        '16:9',
        '9:16',
        '21:9',
        '9:21',
      ])
      expect(spec?.qualities).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
      expect(spec?.counts).toEqual([1, 2, 4])
    }
    // 上游 ID 与显示名查到同一份
    expect(imageParamsFor('gpt-image-2.5-flare')?.qualities).toEqual(
      imageParamsFor('GPT Image 2.5 Flare')?.qualities,
    )
  })
})
