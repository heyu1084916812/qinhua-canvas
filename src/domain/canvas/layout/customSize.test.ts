import { describe, it, expect } from 'vitest'
import {
  customImageSize,
  customSizeIssue,
  parseCustomSize,
  CUSTOM_SIZE_MAX_EDGE,
  CUSTOM_SIZE_MAX_PIXELS,
  CUSTOM_SIZE_MIN_PIXELS,
} from './customSize'

/**
 * 自定义像素尺寸的规则（对账 #542 / #526 的收尾）。
 *
 * 这份测试钉两件事：
 * ① 校验本身（每条约束各一例，且**能说出是哪一条** —— 面板要靠这个给用户人话）；
 * ② 两个出口**同源**：`customImageSize(v) === null` ⟺ `customSizeIssue(v) !== null`
 *    （各写一份规则的话，面板会放行传输层拒收的值，或反过来）。
 */
describe('自定义像素尺寸（domain/canvas/layout/customSize）', () => {
  it('合法值归一成 `宽x高`（空格、`×`、`*` 都认）', () => {
    expect(customImageSize('1024x1536')).toBe('1024x1536')
    expect(customImageSize(' 2048 × 1152 ')).toBe('2048x1152')
    expect(customImageSize('1024*1024')).toBe('1024x1024')
    expect(customSizeIssue('1024x1536')).toBeNull()
  })

  it('解析与约束分开：`parseCustomSize` 只认格式，不管边界', () => {
    expect(parseCustomSize('1024X1536')).toEqual({ w: 1024, h: 1536 })
    expect(parseCustomSize('1024x1000')).toEqual({ w: 1024, h: 1000 })
    expect(parseCustomSize('1024x')).toBeNull()
    expect(parseCustomSize('')).toBeNull()
    expect(parseCustomSize('abc')).toBeNull()
    expect(parseCustomSize(1024)).toBeNull()
  })

  it('★ 每条约束各报各的原因（面板就靠它说人话）', () => {
    /** 格式：压根不是 `宽x高` */
    expect(customSizeIssue('1024x')).toBe('format')
    expect(customSizeIssue('1024 1536')).toBe('format')
    /** 16 的倍数 */
    expect(customSizeIssue('1024x1000')).toBe('snap')
    /** 最长边 */
    expect(customSizeIssue('4096x1024')).toBe('edge')
    /** 总像素：太小 / 太大 */
    expect(customSizeIssue('256x256')).toBe('pixels')
    expect(customSizeIssue('3840x3840')).toBe('pixels')
    /** 长短边比 */
    expect(customSizeIssue('3840x1024')).toBe('aspect')
  })

  it('边界值本身是**合法**的（下限 / 上限都含在内）', () => {
    /** 655360 = 1024×640，正好压在下限上 */
    expect(customSizeIssue('1024x640')).toBeNull()
    /** 最长边 3840 且总像素不超上限 */
    expect(customSizeIssue(`${CUSTOM_SIZE_MAX_EDGE}x1536`)).toBeNull()
    /** 3:1 正好是上限，不是超限 */
    expect(customSizeIssue('3072x1024')).toBeNull()
    expect(CUSTOM_SIZE_MIN_PIXELS).toBe(1024 * 640)
    expect(CUSTOM_SIZE_MAX_PIXELS).toBe(8294400)
  })

  it('两个出口同源：`customImageSize` 为 null ⟺ `customSizeIssue` 非 null', () => {
    const cases = [
      '1024x1536',
      '1024x1000',
      '4096x1024',
      '256x256',
      '3840x3840',
      '3840x1024',
      '1024x',
      '',
    ]
    for (const v of cases) {
      expect(customImageSize(v) === null).toBe(customSizeIssue(v) !== null)
    }
  })
})
