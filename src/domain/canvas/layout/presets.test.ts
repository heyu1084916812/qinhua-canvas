import { describe, expect, it } from 'vitest'
import {
  DEFAULT_EMOTION_ID,
  EMOTIONS,
  PRESETS,
  PRESET_CATEGORIES,
  defaultPresetOptions,
  emotionById,
  presetById,
  presetPromptOf,
  presetPromptSuffix,
} from './presets'

describe('预设表（用户 2026-10-05 第 14 条）', () => {
  it('四大类都有条目', () => {
    for (const c of PRESET_CATEGORIES) {
      expect(PRESETS.filter((p) => p.category === c.id).length, c.id).toBeGreaterThan(0)
    }
  })

  it('id 唯一（重复 id 会让「选中的是哪一条」变得不确定）', () => {
    const ids = PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条都有名字、示例小字与那句会拼进提示词的话', () => {
    for (const p of PRESETS) {
      expect(p.name.trim(), p.id).not.toBe('')
      expect(p.hint.trim(), p.id).not.toBe('')
      expect(p.prompt.trim(), p.id).not.toBe('')
    }
  })

  it('示例小字**不进提示词**（它只是界面上的说明）', () => {
    const p = presetById('storyboard')!
    expect(presetPromptOf(p.id, undefined)).toBe(p.prompt)
    expect(presetPromptOf(p.id, undefined)).not.toContain(p.hint)
  })

  it('二级搭配的默认值 = 每组中间那档（参考图里高亮的就是中间）', () => {
    const p = presetById('portrait-texture')!
    const opts = defaultPresetOptions(p)
    expect(opts).toEqual({
      fusion: 'natural',
      light: 'natural',
      skin: 'natural',
      grain: 'natural',
      sharp: 'standard',
    })
  })

  it('带搭配的预设：把那五组拼成一句可读的话', () => {
    const p = presetById('portrait-texture')!
    const text = presetPromptOf(p.id, defaultPresetOptions(p))
    expect(text).toContain('写实人像摄影质感')
    expect(text).toContain('人景融合「自然融合」')
    expect(text).toContain('锐度「标准清晰」')
  })

  it('搭配缺项 / 取值不认识 → 退回中间那档，不把 undefined 拼进去', () => {
    const p = presetById('portrait-texture')!
    const text = presetPromptOf(p.id, { skin: '不存在的那一档' })
    expect(text).toContain('皮肤「自然肤质」')
    expect(text).not.toContain('undefined')
  })

  it('没选预设 → 空串（不是一句空话）', () => {
    expect(presetPromptOf(null, undefined)).toBe('')
    expect(presetPromptOf('不存在的 id', undefined)).toBe('')
  })

  it('情绪：正好 25 个，五行五列，名字不重复', () => {
    expect(EMOTIONS).toHaveLength(25)
    expect(new Set(EMOTIONS.map((e) => e.name)).size).toBe(25)
    const rows = new Map<number, number>()
    for (const e of EMOTIONS) rows.set(e.row, (rows.get(e.row) ?? 0) + 1)
    expect([...rows.values()]).toEqual([5, 5, 5, 5, 5])
    expect([...rows.keys()].sort()).toEqual([0, 1, 2, 3, 4])
  })

  it('默认情绪是**正中间**那颗（淡然自若）', () => {
    const e = emotionById(DEFAULT_EMOTION_ID)!
    expect(e.name).toBe('淡然自若')
    expect([e.row, e.col]).toEqual([2, 2])
  })

  it('情绪与预设一起拼：两段之间换行，顺序是先预设后情绪', () => {
    const text = presetPromptSuffix({ preset: 'cinematic-light', emotion: 'serene' })
    const lines = text.split('\n')
    expect(lines[0]).toBe(presetById('cinematic-light')!.prompt)
    /**
     * 情绪那段**必须自带「只改面部、其余不变」**（用户 2026-10-05 第五批第 1 条）。
     * 判据不写死整句：那句话以后可能还会调措辞，但「只改面部 + 保持不变」这两层意思不能丢。
     */
    expect(lines[1]).toContain('表情设定：淡然自若')
    expect(lines[1]).toContain('面部表情')
    expect(lines[1]).toContain('保持不变')
  })

  it('两个都没选 → 空串（拼在提示词后面时不该多出一个空行）', () => {
    expect(presetPromptSuffix({})).toBe('')
  })
})
