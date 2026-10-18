import { describe, expect, it } from 'vitest'
import {
  PRESET_AGNES_MODELS,
  PRESET_CHAT_MODELS,
  PRESET_IMAGE_MODELS,
  PRESET_MODELS,
  PRESET_VIDEO_MODELS,
  isPresetModel,
  isPresetModelOfCategory,
  presetIdForUpstream,
  presetModelsOf,
  upstreamAliasesOf,
} from './modelPresets'

/**
 * 固定显示名清单（用户 2026-09-27 拍板）。
 *
 * 这份清单是**用户逐条点头过的**，所以这里逐条钉住：
 * 谁改了它、加了一个用户没要的模型，测试就会红 ——
 * 而不是悄悄多出一个用户从没见过、也没配过映射的名字。
 */
describe('固定模型目录', () => {
  it('★ 生图七个：Nano Banana 2.1 要、Nano Banana 2 Lite 不要、GPT Image 2 要', () => {
    expect(PRESET_IMAGE_MODELS.map((m) => m.id)).toEqual([
      'GPT Image 2.5 Flare',
      'GPT Image 2.5 Sunburst',
      'GPT Image 2',
      'Nano Banana Pro',
      'Nano Banana 2.1',
      'Nano Banana 2',
      'Midjourney',
    ])
    expect(PRESET_IMAGE_MODELS.some((m) => m.id.includes('Lite'))).toBe(false)
  })

  it('★ 对话七个：OpenAI 三个 + Gemini 3.8 Flash + 用户点名的国产三个（#519）', () => {
    expect(PRESET_CHAT_MODELS.map((m) => m.id)).toEqual([
      'GPT-6 Astra',
      'GPT-6 Sol',
      'GPT-6 Luna',
      'Gemini 3.8 Flash',
      'Deepseek 4.1 Flash',
      'GLM 5.3 Flash',
      'HY 4',
    ])
    // 图 4 里的旧名字不该还在（用户明确说「这些是旧的了」）
    const ids = PRESET_CHAT_MODELS.map((m) => m.id)
    expect(ids).not.toContain('Gemini 3.1 Pro')
    expect(ids).not.toContain('GPT 5.5')
    expect(ids).not.toContain('GPT 5.6 Terra')
  })

  /**
   * 对账 #519：这三个显示名的**别名必须覆盖 `cn:` 与 `global:` 两套前缀**。
   *
   * 中转站 `/v1/models` 里的 id 就是这两种形态（实测 51 个模型两种都有）。
   * 少写一套，渠道上报另一套时它就会以「另一个模型」的身份漏回下拉
   * （同一个模型在界面上出现两行）。
   */
  it('★★ 国产三个的别名覆盖 cn: 与 global: 两套前缀（#519）', () => {
    const aliasesOf = (id: string): readonly string[] => {
      const hit = PRESET_CHAT_MODELS.find((m) => m.id === id)!
      return hit.aliases ?? []
    }
    expect(aliasesOf('Deepseek 4.1 Flash')).toEqual([
      'cn:deepseek-v4.1-flash',
      'global:deepseek-v4.1-flash',
      'global:deepseek-v4.1-flash-sg',
    ])
    expect(aliasesOf('GLM 5.3 Flash')).toEqual(['cn:glm-5.3-flash', 'global:glm-5.3-flash'])
    expect(aliasesOf('HY 4')).toEqual([
      'cn:hy4-preview',
      'cn:hy4-preview-f',
      'global:hy4-preview',
      'global:hy4-preview-f',
    ])
    /** 归一显示：上游 ID 进来要能映射到显示名（界面不出现两行） */
    for (const a of [...aliasesOf('Deepseek 4.1 Flash'), ...aliasesOf('GLM 5.3 Flash'), ...aliasesOf('HY 4')]) {
      expect(presetIdForUpstream(a)).not.toBe(a)
    }
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

  it('Agnes video defaults to the currently free 2.5 Flash preset', () => {
    const video = PRESET_AGNES_MODELS.find((m) => m.category === 'video')
    expect(video?.id).toBe('Agnes Video 2.5 Flash')
    expect(video?.aliases).toContain('agnes-video-2.5-flash')
    expect(presetIdForUpstream('agnes-video-2.5-flash')).toBe('Agnes Video 2.5 Flash')
    expect(presetIdForUpstream('agnes-video-v2.0')).toBe('Agnes Video 2.5 Flash')
  })

  it('每个显示名只出现一次（跨分类也不重名）', () => {
    const ids = PRESET_MODELS.map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('presetModelsOf 按分类返回，且保持清单顺序', () => {
    // 与「PRESET_MODELS 里该类别的顺序」逐项对齐 —— 不写死数字，
    // 这样以后加显示名（如 Agnes 那三条）时不必回来改断言
    const ofCategory = (c: 'image' | 'chat' | 'video') =>
      PRESET_MODELS.filter((m) => m.category === c).map((m) => m.id)
    expect(presetModelsOf('image').map((m) => m.id)).toEqual(ofCategory('image'))
    expect(presetModelsOf('chat').map((m) => m.id)).toEqual(ofCategory('chat'))
    expect(presetModelsOf('video').map((m) => m.id)).toEqual(ofCategory('video'))
    // 旧的固定清单仍是其子集（原有那几个名字一个都没丢）
    for (const m of [...PRESET_IMAGE_MODELS]) {
      expect(presetModelsOf('image').map((x) => x.id)).toContain(m.id)
    }
  })

  it('presetModelsOf 返回的是副本，改它不影响常量', () => {
    const a = presetModelsOf('image')
    const before = a.length
    a.pop()
    expect(presetModelsOf('image')).toHaveLength(before)
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

/**
 * 上游 ID ↔ 显示名（用户 2026-09-27 第 8 轮）。
 *
 * 用户原话：「`gpt-image-2` 这个和头两个模型 id 格式不一样，应该是 `GPT Image 2`」。
 * 两组函数的用途不同，别混：
 *  - `presetIdForUpstream`：**显示**用（把 ID 变成拍板过的名字）；
 *  - `upstreamAliasesOf`：**选路**用（判断这条渠道到底提不提供这个模型）。
 */
describe('上游 ID ↔ 显示名', () => {
  it('★ gpt-image-2 归一成「GPT Image 2」（用户点名的那个）', () => {
    expect(presetIdForUpstream('gpt-image-2')).toBe('GPT Image 2')
  })

  it('★ 其余三家也各自归一', () => {
    expect(presetIdForUpstream('gemini-3-pro-image')).toBe('Nano Banana Pro')
    expect(presetIdForUpstream('gemini-nano-banana-2.1')).toBe('Nano Banana 2.1')
    expect(presetIdForUpstream('gemini-3.1-flash-image')).toBe('Nano Banana 2')
    expect(presetIdForUpstream('gpt-6-astra')).toBe('GPT-6 Astra')
    expect(presetIdForUpstream('seedance-2.5')).toBe('即梦 2.5')
    expect(presetIdForUpstream('gemini-omni-1.1-flash')).toBe('Gemini Omni Flash 1.1')
  })

  it('显示名本身就是显示名 → 原样返回（幂等）', () => {
    expect(presetIdForUpstream('GPT Image 2')).toBe('GPT Image 2')
    expect(presetIdForUpstream('Midjourney')).toBe('Midjourney')
  })

  it('★ 认不出来就原样返回 —— 不把未知模型硬塞进某个显示名', () => {
    expect(presetIdForUpstream('advanced-voice')).toBe('advanced-voice')
    expect(presetIdForUpstream('some-relay-model')).toBe('some-relay-model')
    expect(presetIdForUpstream('')).toBe('')
  })

  it('★ upstreamAliasesOf 含显示名本身与其别名（选路据此认候选）', () => {
    const aliases = upstreamAliasesOf('GPT Image 2')
    expect(aliases).toContain('GPT Image 2')
    expect(aliases).toContain('gpt-image-2')
  })

  it('非固定名 → 只有它自己（不猜别名）', () => {
    expect(upstreamAliasesOf('advanced-voice')).toEqual(['advanced-voice'])
    expect(upstreamAliasesOf('')).toEqual([])
  })

  it('别名字符串两两不冲突（一个上游 ID 不能同时属于两个显示名）', () => {
    const seen = new Map<string, string>()
    for (const m of PRESET_MODELS) {
      for (const key of [m.id, ...(m.aliases ?? [])]) {
        const prev = seen.get(key)
        expect(prev === undefined || prev === m.id, `${key} 同时属于 ${prev} 与 ${m.id}`).toBe(true)
        seen.set(key, m.id)
      }
    }
  })

  it('isPresetModelOfCategory 按类别收口（对话名不会被当成视频名）', () => {
    expect(isPresetModelOfCategory('GPT-6 Astra', 'chat')).toBe(true)
    expect(isPresetModelOfCategory('GPT-6 Astra', 'video')).toBe(false)
    expect(isPresetModelOfCategory('GPT-6 Astra')).toBe(true)
    expect(isPresetModelOfCategory('advanced-voice', 'chat')).toBe(false)
  })
})
