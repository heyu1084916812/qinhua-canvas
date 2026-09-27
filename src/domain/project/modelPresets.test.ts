import { describe, expect, it } from 'vitest'
import {
  PRESET_CHAT_MODELS,
  PRESET_IMAGE_MODELS,
  PRESET_MODELS,
  PRESET_VIDEO_MODELS,
  isPresetModel,
  presetModelsOf,
} from './modelPresets'

/**
 * 固定显示名清单（用户 2026-09-27 拍板）。
 *
 * 这份清单是**用户逐条点头过的**，所以这里逐条钉住：
 * 谁改了它、加了一个用户没要的模型，测试就会红 ——
 * 而不是悄悄多出一个用户从没见过、也没配过映射的名字。
 */
describe('固定模型目录', () => {
  it('★ 生图六个：Nano Banana 2 Lite 不要、GPT Image 2 要', () => {
    expect(PRESET_IMAGE_MODELS.map((m) => m.id)).toEqual([
      'GPT Image 2.5 Flare',
      'GPT Image 2.5 Sunburst',
      'GPT Image 2',
      'Nano Banana Pro',
      'Nano Banana 2',
      'Midjourney',
    ])
    expect(PRESET_IMAGE_MODELS.some((m) => m.id.includes('Lite'))).toBe(false)
  })

  it('★ 对话四个：OpenAI 三个全要、Google 只留 Gemini 3.8 Flash', () => {
    expect(PRESET_CHAT_MODELS.map((m) => m.id)).toEqual([
      'GPT-6 Astra',
      'GPT-6 Sol',
      'GPT-6 Luna',
      'Gemini 3.8 Flash',
    ])
    // 图 4 里的旧名字不该还在（用户明确说「这些是旧的了」）
    const ids = PRESET_CHAT_MODELS.map((m) => m.id)
    expect(ids).not.toContain('Gemini 3.1 Pro')
    expect(ids).not.toContain('GPT 5.5')
    expect(ids).not.toContain('GPT 5.6 Terra')
  })

  it('★ 视频五个（用户：「只要前五个先」）', () => {
    expect(PRESET_VIDEO_MODELS.map((m) => m.id)).toEqual([
      '即梦 2.5',
      'Gemini Omni Flash 1.1',
      'Minimax H3 Max',
      'MiniMax H3',
      'Wan 3.0',
    ])
  })

  it('每个显示名只出现一次（跨分类也不重名）', () => {
    const ids = PRESET_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('presetModelsOf 按分类返回，且保持清单顺序', () => {
    expect(presetModelsOf('image').map((m) => m.id)).toEqual(
      PRESET_IMAGE_MODELS.map((m) => m.id),
    )
    expect(presetModelsOf('video')).toHaveLength(5)
    expect(presetModelsOf('chat')).toHaveLength(4)
  })

  it('presetModelsOf 返回的是副本，改它不影响常量', () => {
    const a = presetModelsOf('image')
    a.pop()
    expect(presetModelsOf('image')).toHaveLength(6)
  })

  it('isPresetModel 认固定名、不认别的（含两端空白归一）', () => {
    expect(isPresetModel('GPT Image 2')).toBe(true)
    expect(isPresetModel('  Midjourney  ')).toBe(true)
    expect(isPresetModel('mock-image-1')).toBe(false)
    expect(isPresetModel('')).toBe(false)
  })

  it('每个条目都带厂商（面板要靠它取图标）', () => {
    for (const m of PRESET_MODELS) {
      expect(m.vendor.length).toBeGreaterThan(0)
    }
  })
})
