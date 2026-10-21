import { describe, expect, it } from 'vitest'
import { imagePromptFamilyOf, imagePromptForModel } from './imagePromptProfile'

const english =
  'Editorial studio-lifestyle product photograph with soft daylight, sage green padding and clean oak surface.'

describe('image prompt profiles', () => {
  it('routes GPT Image、Nano Banana、Midjourney 与 Seedream', () => {
    expect(imagePromptFamilyOf('GPT Image 2.5 Sunburst')).toBe('gpt-image')
    expect(imagePromptFamilyOf('Nano Banana 2')).toBe('nano-banana')
    expect(imagePromptFamilyOf('Midjourney v8')).toBe('midjourney')
    expect(imagePromptFamilyOf('Seedream 5.0')).toBe('seedream')
    expect(imagePromptFamilyOf('全能图片X')).toBe('generic')
  })

  it('GPT Image 英文正文只追加英文分段，不混入中文约束', () => {
    const out = imagePromptForModel({
      prompt: english,
      model: 'GPT Image 2.5 Sunburst',
      ratio: '3:4',
      headline: '360° CUSHIONED SUPPORT',
      subheadline: 'Plush Raised Bolsters & Removable Inner Pad',
    })
    expect(out).toContain('Image goal:')
    expect(out).toContain('Composition: 3:4 aspect ratio')
    expect(out).toContain('"360° CUSHIONED SUPPORT"')
    expect(out).not.toMatch(/[\u3400-\u9fff]/)
  })

  it('Nano Banana 保持叙述式段落，不切成关键词清单', () => {
    const out = imagePromptForModel({
      prompt: english,
      model: 'Nano Banana 2',
      ratio: '21:9',
    })
    expect(out).toContain(english)
    expect(out).toContain('21:9 aspect ratio')
    expect(out).not.toContain('Image goal:')
  })

  it('Midjourney 使用一行短语流和参数', () => {
    const out = imagePromptForModel({
      prompt: english,
      model: 'Midjourney',
      ratio: '16:9',
    })
    expect(out).toContain('--ar 16:9')
    expect(out).toContain('--raw')
    expect(out.replace(/\s+/g, ' ')).toContain('--no watermark')
  })

  it('中文正文仍追加中文约束，避免反向混语言', () => {
    const out = imagePromptForModel({
      prompt: '户外露营场景中的绿色宠物车座，柔和自然光，产品完整入画。',
      model: 'GPT Image 2.5',
      ratio: '4:3',
      headline: '舒适支撑',
    })
    expect(out).toContain('构图：使用 4:3 画幅')
    expect(out).toContain('主文案必须逐字排为「舒适支撑」')
    expect(out).not.toContain('Image goal:')
  })
})
