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
    expect(imageParamsFor('Midjourney')).toBeUndefined()
    expect(imageParamsFor('')).toBeUndefined()
  })

  /**
   * **Nano Banana（Gemini 系）**：参数全部来自 Google 官方文档
   * 《Nano Banana 图片生成》（2026-10-03 浏览器实读）—— 14 档宽高比 + `image_size`；
   * 走 **Gemini 原生端点**才生效（`chat` / `images` 路径会把这两个参数吃掉）。
   */
  it('★★ Nano Banana Pro / 2：gemini 方言、14 档宽高比、尺寸档按官方文档', () => {
    const ratios = [
      '1:1',
      '1:4',
      '1:8',
      '2:3',
      '3:2',
      '3:4',
      '4:1',
      '4:3',
      '4:5',
      '5:4',
      '8:1',
      '9:16',
      '16:9',
      '21:9',
    ]
    for (const name of ['Nano Banana Pro', 'gemini-3-pro-image']) {
      const spec = imageParamsFor(name)
      expect(spec?.dialect).toBe('gemini')
      expect(spec?.ratios).toEqual(ratios)
      /** 官方：「512 像素 (0.5K) 仅限 Gemini 3.1 Flash Image」 ⇒ Pro 只有 1K/2K/4K */
      expect(spec?.sizes).toEqual(['1K', '2K', '4K'])
    }
    for (const name of ['Nano Banana 2', 'gemini-3.1-flash-image']) {
      const spec = imageParamsFor(name)
      expect(spec?.dialect).toBe('gemini')
      expect(spec?.sizes).toEqual(['512', '1K', '2K', '4K'])
      expect(spec?.qualities).toEqual([])
      expect(spec?.counts).toEqual([1])
    }
  })

  it('★ 同一族的变体 ID（-2k / -4k / -preview）按前缀归一到同一份 gemini 规格', () => {
    for (const name of ['gemini-3-pro-image-2k', 'gemini-3-pro-image-4k', 'gemini-3.1-flash-image-preview']) {
      expect(imageParamsFor(name)?.dialect).toBe('gemini')
    }
  })

  /**
   * **GPT Image 三档 = OpenAI 官方规范**（用户 2026-10-03：「就走官方的」）。
   * 出处：官方 OpenAPI 的 `CreateImageRequest` —— `size` 四选一、`quality` 六档、`n` 1–10。
   */
  it('★★ GPT Image 三档：官方 size（auto + 三个像素）/ 六档 quality / 最多 9 张 / 无独立画幅', () => {
    for (const name of ['GPT Image 2', 'GPT Image 2.5 Flare', 'GPT Image 2.5 Sunburst']) {
      const spec = imageParamsFor(name)
      expect(spec?.dialect).toBe('openai-images')
      expect(spec?.sizes).toEqual(['auto', '1024x1024', '1536x1024', '1024x1536'])
      /** 官方画幅由 size 表达 ⇒ 不再单独摆一档「比例」 */
      expect(spec?.ratios).toEqual([])
      expect(spec?.qualities).toEqual(['auto', 'low', 'medium', 'high', 'xhigh', 'max'])
      expect(spec?.counts).toEqual([1, 2, 4, 9])
    }
    // 上游 ID 与显示名查到同一份
    expect(imageParamsFor('gpt-image-2.5-flare')?.qualities).toEqual(
      imageParamsFor('GPT Image 2.5 Flare')?.qualities,
    )
  })
})
