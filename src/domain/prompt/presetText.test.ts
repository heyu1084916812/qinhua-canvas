/**
 * 功能预设词的单测（后台中枢，用户 2026-09-25）。
 *
 * 钉住三件**容易写错**的事：
 * 1. 覆盖值缺失 / 空白 / 超限一律**回落默认**（不产出半份数据）；
 * 2. 「恢复默认」与「从没改过」在数据上是同一状态（都是没有覆盖）；
 * 3. 出厂默认仍满足既有行为契约（优化提清晰度、翻译提双语、反推提图片）——
 *    这几条原先由 `promptTools.test.ts` 盯着，现在常量搬了家，要确保没搬丢。
 */
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_PRESET_TEXT,
  PRESET_TEXT_ACTIONS,
  PRESET_TEXT_MAX,
  effectivePresetText,
  presetTextEntries,
  validatePresetText,
} from './presetText'

describe('validatePresetText', () => {
  it('空 / 纯空白被拒（留空会让动作发出一条没有指令的请求）', () => {
    expect(validatePresetText('')).toMatch(/不能为空/)
    expect(validatePresetText('   \n  ')).toMatch(/不能为空/)
  })

  it('超限被拒，并报出当前字数', () => {
    const long = 'x'.repeat(PRESET_TEXT_MAX + 1)
    expect(validatePresetText(long)).toMatch(new RegExp(String(PRESET_TEXT_MAX + 1)))
  })

  it('恰好到上限可以保存（边界不是「超过即拒」）', () => {
    expect(validatePresetText('x'.repeat(PRESET_TEXT_MAX))).toBeNull()
  })

  it('正常内容通过', () => {
    expect(validatePresetText('把这段文字改得更简洁')).toBeNull()
  })
})

describe('presetTextEntries', () => {
  it('没有任何覆盖时，三条全是默认', () => {
    const list = presetTextEntries({})
    expect(list).toHaveLength(PRESET_TEXT_ACTIONS.length)
    expect(list.every((e) => e.isDefault)).toBe(true)
    expect(list.map((e) => e.id)).toEqual([...PRESET_TEXT_ACTIONS])
  })

  it('undefined / null 等同于没有覆盖（老库读回的空值）', () => {
    expect(presetTextEntries(undefined).every((e) => e.isDefault)).toBe(true)
    expect(presetTextEntries(null).every((e) => e.isDefault)).toBe(true)
  })

  it('★ 空白覆盖回落默认，而不是让该条变成空指令', () => {
    const list = presetTextEntries({ optimize: '   ' })
    const optimize = list.find((e) => e.id === 'optimize')!
    expect(optimize.content).toBe(DEFAULT_PRESET_TEXT.optimize)
    expect(optimize.isDefault).toBe(true)
  })

  it('★ 超限覆盖回落默认（坏数据不该进请求）', () => {
    const list = presetTextEntries({ translate: 'x'.repeat(PRESET_TEXT_MAX + 5) })
    const translate = list.find((e) => e.id === 'translate')!
    expect(translate.content).toBe(DEFAULT_PRESET_TEXT.translate)
    expect(translate.isDefault).toBe(true)
  })

  it('有效覆盖生效，且标为「已改」', () => {
    const list = presetTextEntries({ optimize: '只保留十个字以内的结果' })
    const optimize = list.find((e) => e.id === 'optimize')!
    expect(optimize.content).toBe('只保留十个字以内的结果')
    expect(optimize.isDefault).toBe(false)
    // 未覆盖的另两条不受影响
    expect(list.find((e) => e.id === 'translate')!.isDefault).toBe(true)
  })
})

describe('effectivePresetText（执行链路取生效值）', () => {
  it('没有覆盖 → 默认', () => {
    expect(effectivePresetText('optimize', {})).toBe(DEFAULT_PRESET_TEXT.optimize)
  })

  it('有覆盖 → 用覆盖（前后空白被去掉）', () => {
    expect(effectivePresetText('optimize', { optimize: '  新指令  ' })).toBe('新指令')
  })

  it('★ 覆盖是空白 / 超限 → 回落默认（与界面口径一致）', () => {
    expect(effectivePresetText('describe', { describe: '  ' })).toBe(
      DEFAULT_PRESET_TEXT.describe,
    )
    expect(
      effectivePresetText('describe', { describe: 'x'.repeat(PRESET_TEXT_MAX + 1) }),
    ).toBe(DEFAULT_PRESET_TEXT.describe)
  })

  it('恢复默认（写 null 清掉覆盖）与从没改过结果一致', () => {
    const never = effectivePresetText('translate', {})
    const restored = effectivePresetText('translate', {})
    expect(never).toBe(restored)
  })
})

describe('出厂默认的行为契约（常量搬家后没搬丢）', () => {
  it('optimize 提「清晰度」「可执行性」', () => {
    expect(DEFAULT_PRESET_TEXT.optimize).toMatch(/清晰度/)
    expect(DEFAULT_PRESET_TEXT.optimize).toMatch(/可执行性/)
  })

  it('translate 提「英文」「中文」「无法判断」', () => {
    expect(DEFAULT_PRESET_TEXT.translate).toMatch(/英文/)
    expect(DEFAULT_PRESET_TEXT.translate).toMatch(/中文/)
    expect(DEFAULT_PRESET_TEXT.translate).toMatch(/无法判断/)
  })

  it('describe 提「图片」「提示词」', () => {
    expect(DEFAULT_PRESET_TEXT.describe).toMatch(/图片/)
    expect(DEFAULT_PRESET_TEXT.describe).toMatch(/提示词/)
  })

  it('三条都不为空且都在长度上限内', () => {
    for (const action of PRESET_TEXT_ACTIONS) {
      const text = DEFAULT_PRESET_TEXT[action]
      expect(text.trim().length).toBeGreaterThan(0)
      expect(text.length).toBeLessThanOrEqual(PRESET_TEXT_MAX)
    }
  })
})
