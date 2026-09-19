import { describe, it, expect } from 'vitest'
import { clampCount, type ModelCapability } from './capability'

const cap = (over: Partial<ModelCapability> = {}): ModelCapability => ({
  id: 'm',
  category: 'image',
  inputTypes: ['text'],
  ...over,
})

describe('生成张数上限（§6.8）', () => {
  /**
   * ★ 回归：**未声明 `maxCount` = 不设限**（用户 2026-09-19）。
   *
   * 早先是 `maxCount ?? 1`，把「模型没上报这个字段」当成「最多 1 张」——
   * 而多数中转渠道的 `/v1/models` 不报它。于是面板能选 9 张、请求却静默夹回 1 张，
   * 表现成「选了 9 张只出 1 张」。这条语义必须与面板层的 `maxCount` 一致。
   */
  it('★ 未声明 maxCount 时不夹取（选 9 张就是 9 张）', () => {
    expect(clampCount(cap(), 9)).toBe(9)
    expect(clampCount(cap(), 4)).toBe(4)
    expect(clampCount(cap(), 2)).toBe(2)
  })

  it('★ 明确声明更小的上限时才收窄', () => {
    expect(clampCount(cap({ maxCount: 4 }), 9)).toBe(4)
    expect(clampCount(cap({ maxCount: 1 }), 9)).toBe(1)
    expect(clampCount(cap({ maxCount: 2 }), 4)).toBe(2)
  })

  it('声明值大于请求值时不动（模型支持得比要的更多）', () => {
    expect(clampCount(cap({ maxCount: 16 }), 4)).toBe(4)
  })

  it('声明值非法（0 / 负数）视为未声明，不夹到 1', () => {
    expect(clampCount(cap({ maxCount: 0 }), 9)).toBe(9)
    expect(clampCount(cap({ maxCount: -3 }), 9)).toBe(9)
  })

  it('下限恒为 1：0 / 负数 / 小数都收敛到至少 1 张', () => {
    expect(clampCount(cap(), 0)).toBe(1)
    expect(clampCount(cap(), -5)).toBe(1)
    expect(clampCount(cap(), 2.7)).toBe(2)
  })
})
