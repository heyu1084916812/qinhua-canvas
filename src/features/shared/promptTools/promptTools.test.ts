import { describe, it, expect } from 'vitest'
import { PROMPT_TOOL_SYSTEM, promptToolGuard, trimToolResult } from './promptTools'

describe('promptToolGuard', () => {
  it('未配置文本模型 → 提示先选平台与模型', () => {
    expect(promptToolGuard({ text: 'x', action: 'optimize' })).toMatch(/文本模型/)
    expect(promptToolGuard({ channelId: 'c1', text: 'x', action: 'optimize' })).toMatch(/文本模型/)
    expect(promptToolGuard({ model: 'm1', text: 'x', action: 'optimize' })).toMatch(/文本模型/)
    expect(promptToolGuard({ channelId: 'c1', model: '', text: 'x', action: 'optimize' })).toMatch(/文本模型/)
  })

  it('文本为空 → 提示没有可处理文本', () => {
    expect(promptToolGuard({ channelId: 'c1', model: 'm1', text: '', action: 'optimize' })).toMatch(/没有可处理/)
    expect(promptToolGuard({ channelId: 'c1', model: 'm1', text: '   ', action: 'optimize' })).toMatch(/没有可处理/)
  })

  it('配置齐全且文本非空 → 可执行', () => {
    expect(promptToolGuard({ channelId: 'c1', model: 'm1', text: '一只猫', action: 'optimize' })).toBeNull()
  })

  it('反推：文本可以为空，但必须有图（图就是输入）', () => {
    expect(
      promptToolGuard({ channelId: 'c1', model: 'm1', text: '', action: 'describe', imageCount: 1 }),
    ).toBeNull()
    expect(promptToolGuard({ channelId: 'c1', model: 'm1', text: '', action: 'describe' })).toMatch(
      /上游图片/,
    )
    expect(
      promptToolGuard({
        channelId: 'c1',
        model: 'm1',
        text: '一只猫',
        action: 'describe',
        imageCount: 0,
      }),
    ).toMatch(/上游图片/)
  })

  it('反推：没配文本模型时优先报模型缺失（图齐了也没用）', () => {
    expect(promptToolGuard({ text: '', action: 'describe', imageCount: 2 })).toMatch(/文本模型/)
  })
})

describe('PROMPT_TOOL_SYSTEM', () => {
  it('优化指令包含清晰度/结构/可执行性目标，翻译指令包含中英互译与就地说明', () => {
    expect(PROMPT_TOOL_SYSTEM.optimize).toMatch(/清晰度/)
    expect(PROMPT_TOOL_SYSTEM.optimize).toMatch(/可执行性/)
    expect(PROMPT_TOOL_SYSTEM.translate).toMatch(/英文/)
    expect(PROMPT_TOOL_SYSTEM.translate).toMatch(/中文/)
    expect(PROMPT_TOOL_SYSTEM.translate).toMatch(/无法判断/)
  })

  it('反推指令要求「看图产出提示词」，不是描述要求本身', () => {
    expect(PROMPT_TOOL_SYSTEM.describe).toMatch(/图片/)
    expect(PROMPT_TOOL_SYSTEM.describe).toMatch(/提示词/)
  })

  it('三个动作都有指令，且互不为空（新增动作时这里会先红）', () => {
    for (const [k, v] of Object.entries(PROMPT_TOOL_SYSTEM)) {
      expect(v.length, `${k} 指令为空`).toBeGreaterThan(10)
    }
  })
})

describe('trimToolResult', () => {
  it('去首尾空白与成对引号包裹', () => {
    expect(trimToolResult('  一只猫  ')).toBe('一只猫')
    expect(trimToolResult('"一只猫"')).toBe('一只猫')
    expect(trimToolResult('“一只猫”')).toBe('一只猫')
    expect(trimToolResult('"一只猫 Says "hi""')).toBe('一只猫 Says "hi')
  })

  it('内部内容不动', () => {
    expect(trimToolResult('a\n\nb')).toBe('a\n\nb')
  })
})
