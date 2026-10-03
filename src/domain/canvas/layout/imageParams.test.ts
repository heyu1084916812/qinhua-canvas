import { describe, expect, it } from 'vitest'
import { imageParamsFor } from './imageParams'

/**
 * **图片模型各自的参数能力**（用户 2026-10-03：
 * 「把图片生成节点里每个模型具体有哪些配置单独设置，不要通用设置，去官方文档找一下」）。
 *
 * 每一条的出处都写在 `imageParams.ts` 的注释里。而**面板摆哪几段**由用户 2026-10-03
 * 给的两张参考面板（图一 GPT、图二 香蕉）拍板 —— 那两张就是「用户要看到什么」。
 */
describe('imageParamsFor · 图片模型各自的参数能力', () => {
  it('★★ Agnes Image 2.0 Flash 是**像素**方言：3 个像素尺寸、没有 ratio / quality', () => {
    const spec = imageParamsFor('agnes-image-2.0-flash')
    expect(spec?.dialect).toBe('pixel')
    expect(spec?.sizes).toEqual(['1024x1024', '1024x768', '768x1024'])
    expect(spec?.ratios).toEqual([])
    expect(spec?.qualities).toEqual([])
    expect(spec?.backgrounds).toEqual([])
  })

  it('★★ Agnes Image 2.1 / 2.5 Flash 是**档位**方言：1K–4K + 8 档画幅，没有 quality', () => {
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
      expect(spec?.backgrounds).toEqual([])
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
    expect(imageParamsFor('某站的私有图片模型')).toBeUndefined()
  })

  /**
   * ★★ **生成数量对每个图片模型统一**（用户 2026-10-03：「数量这个我需要每个模型统一一下，
   * 不能有些有，有些没有」）。
   *
   * 这是**用户口径压过接口口径**的一处：Agnes 图片文档里没有 `n`，
   * 但用户在面板上要求「每个模型都有 1 / 2 / 4」，所以规格里统一给上 ——
   * 面板不再出现「这个模型有数量、那个模型没有」的漂移。
   */
  it('★★ 所有图片模型都有同一组生成数量（1 / 2 / 4）', () => {
    const names = [
      'agnes-image-2.0-flash',
      'agnes-image-2.1-flash',
      'agnes-image-2.5-flash',
      'GPT Image 2',
      'GPT Image 2.5 Flare',
      'Nano Banana Pro',
      'Nano Banana 2',
    ]
    for (const name of names) {
      expect(imageParamsFor(name)?.counts, name).toEqual([1, 2, 4])
    }
  })

  /**
   * **Nano Banana（Gemini 系）**：参数全部来自 Google 官方文档
   * 《Nano Banana 图片生成》—— 14 档宽高比 + `image_size`；
   * 走 **Gemini 原生端点**才生效（`chat` / `images` 路径会把这两个参数吃掉）。
   *
   * 用户 2026-10-03 图二的香蕉面板**最前面多一格「自适应」**，即 `auto`。
   */
  it('★★ Nano Banana Pro / 2：gemini 方言、14 档宽高比 + 自适应、尺寸档按官方文档', () => {
    const ratios = [
      'auto',
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
      expect(spec?.ratios).toEqual(ratios)
    }
  })

  it('★ 同一族的变体 ID（-2k / -4k / -preview）按前缀归一到同一份 gemini 规格', () => {
    for (const name of [
      'gemini-3-pro-image-2k',
      'gemini-3-pro-image-4k',
      'gemini-3.1-flash-image-preview',
    ]) {
      expect(imageParamsFor(name)?.dialect).toBe('gemini')
    }
  })

  /**
   * ★★ **GPT Image 三档 = 用户图一那份面板**（用户 2026-10-03：
   * 「我不想用具体的像素标志，我想要比例那种档位，和香蕉模型一样那种……而且我还想要
   * 画质那种档位，把 GPT 的，需要加上背景这个参数」）。
   *
   * 于是 GPT 的不再是「官方 size 四选一」，而是：
   * 画质（低/标准/高/超高/极致）→ 清晰度（1K/2K/4K）→ 背景（自动/保留背景/透明背景）
   * → 比例（13 档）→ 生成数量。发请求时把「比例 × 清晰度」换算成 OpenAI 认的像素 `size`。
   */
  it('★★ GPT Image 三档：比例 13 档 + 清晰度 1K/2K/4K + 五档画质 + 三档背景', () => {
    for (const name of ['GPT Image 2', 'GPT Image 2.5 Flare', 'GPT Image 2.5 Sunburst']) {
      const spec = imageParamsFor(name)
      expect(spec?.dialect).toBe('openai-images')
      expect(spec?.sizes).toEqual(['1K', '2K', '4K'])
      expect(spec?.ratios).toHaveLength(13)
      expect(spec?.ratios).toContain('21:9')
      expect(spec?.ratios).toContain('9:21')
      expect(spec?.qualities).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
      expect(spec?.backgrounds).toEqual(['auto', 'opaque', 'transparent'])
      expect(spec?.counts).toEqual([1, 2, 4])
    }
    // 上游 ID 与显示名查到同一份
    expect(imageParamsFor('gpt-image-2.5-flare')?.qualities).toEqual(
      imageParamsFor('GPT Image 2.5 Flare')?.qualities,
    )
  })
})
