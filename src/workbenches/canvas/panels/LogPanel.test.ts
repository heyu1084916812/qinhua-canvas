import { describe, it, expect } from 'vitest'
import { formatLogTime, statusLabel } from './LogPanel'

/**
 * 日志面板的纯展示逻辑（产品文档 §6.18）：
 * 上排胶囊状态文案与时间格式——这两项是记录排版里唯一的确定性映射，单独抽出便于单测。
 */
describe('LogPanel / 展示逻辑', () => {
  it('状态徽标：成功 / 失败 / 已取消 / 已中断', () => {
    expect(statusLabel('succeeded')).toBe('成功')
    expect(statusLabel('failed')).toBe('失败')
    expect(statusLabel('canceled')).toBe('已取消')
    expect(statusLabel('interrupted')).toBe('已中断')
  })

  it('时间格式为 YYYY/MM/DD HH:mm:ss', () => {
    const ts = new Date(2026, 7, 28, 8, 52, 15).getTime() // 2026-08-28 08:52:15
    expect(formatLogTime(ts)).toBe('2026/08/28 08:52:15')
  })

  it('个位数月 / 日 / 时补零', () => {
    const ts = new Date(2026, 0, 5, 3, 4, 9).getTime()
    expect(formatLogTime(ts)).toBe('2026/01/05 03:04:09')
  })
})
