import { describe, expect, it } from 'vitest'
import {
  ECOMMERCE_UPSCALE_OPTIONS,
  isUpscaleScale,
  upscaleNoteOf,
  upscaleOptionOf,
} from './upscale'

describe('电商 AI 超清配置', () => {
  it('五个 profile 都映射到唯一的 Topaz 上游模型', () => {
    const models = ECOMMERCE_UPSCALE_OPTIONS.map((item) => item.model)
    expect(new Set(models).size).toBe(models.length)
    expect(upscaleOptionOf('text-refine').model).toBe('Topaz 图像超清 Text Refine')
  })

  it('只接受 2x / 4x / 6x；非法值不混进请求', () => {
    expect(['2x', '4x', '6x'].every(isUpscaleScale)).toBe(true)
    expect(isUpscaleScale('8x')).toBe(false)
    expect(isUpscaleScale(undefined)).toBe(false)
  })

  it('任务要求明确是真实超分，不是生图提示词', () => {
    expect(upscaleNoteOf('standard', '4x')).toContain('AI 超清')
    expect(upscaleNoteOf('standard', '4x')).toContain('4x 无损放大')
    expect(upscaleNoteOf('standard', '4x')).toContain('内容不变')
  })
})
