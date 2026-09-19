/**
 * 主题的纯逻辑单测（ui/theme.ts）。
 *
 * 这些判定必须能在 node 下跑：它们决定首帧是不是闪白，而首帧逻辑没法靠
 * 「在浏览器里点一下看看」来验证——刷新那一下早过去了。故规则收在纯函数里，
 * 由这里钉住；DOM 侧的落地（app/ThemeProvider）只做搬运。
 *
 * 2026-09-19：用户第 9 条要求「只要两个主题色，去掉跟随系统」，
 * 原来的三档（light / dark / system）收敛成**两档**。旧契约的测试整体重写，
 * 并补上「旧版本存下的 'system' 怎么处理」这条迁移用例。
 */
import { describe, it, expect } from 'vitest'
import {
  nextThemeSetting,
  parseThemeSetting,
  systemTheme,
  themeSettingLabel,
  THEME_SETTINGS,
  type ResolvedTheme,
  type ThemeSetting,
} from './theme'

describe('parseThemeSetting', () => {
  it('两个合法值原样返回', () => {
    expect(parseThemeSetting('light')).toBe('light')
    expect(parseThemeSetting('dark')).toBe('dark')
  })

  /**
   * ★ 非法 / 缺失值返回 `null`（而不是自作主张挑一档）。
   *
   * 挑哪一档需要知道**系统偏好**，而这是纯函数拿不到的信息；调用方
   * （ThemeProvider / 首帧脚本）才有 matchMedia。故这里只回答「合法吗」，
   * 回落策略留给调用方——这样两档之后仍然保住「不知道就看系统」的原意。
   */
  it('★ 非法 / 缺失值返回 null（回落策略交给调用方）', () => {
    expect(parseThemeSetting(null)).toBeNull()
    expect(parseThemeSetting(undefined)).toBeNull()
    expect(parseThemeSetting('')).toBeNull()
    expect(parseThemeSetting('DARK')).toBeNull()
    expect(parseThemeSetting('dark-mode')).toBeNull()
    expect(parseThemeSetting('auto')).toBeNull()
  })

  /**
   * ★ 回归：旧版本存下的 `'system'` 不再是合法档位。
   *
   * 它必须被判为「没有有效选择」，由调用方按系统偏好落成一个**具体**档位——
   * 否则第三档会从旧数据里复活，正是用户这次要求去掉的那一档。
   */
  it('★ 旧值 system 不再是合法档位（否则第三档会从旧数据复活）', () => {
    expect(parseThemeSetting('system')).toBeNull()
  })
})

describe('systemTheme', () => {
  it('matchMedia 查询串为真时返回深色', () => {
    expect(systemTheme('(prefers-color-scheme: dark)')).toBe('dark')
  })

  it('读不到 / 不支持时按亮色处理（保持现状，不擅自切主题）', () => {
    expect(systemTheme(null)).toBe('light')
    expect(systemTheme(undefined)).toBe('light')
    expect(systemTheme('(prefers-color-scheme: light)')).toBe('light')
  })
})

describe('nextThemeSetting', () => {
  it('浅 → 深（点击必然产生可见变化）', () => {
    expect(nextThemeSetting('light')).toBe('dark')
  })

  it('深 → 浅', () => {
    expect(nextThemeSetting('dark')).toBe('light')
  })

  /**
   * ★ 连点必回原点，且**每一拍外观都在变**。
   * 两档之后不存在「点了没反应」的档位——这是去掉 system 档顺带拿到的性质。
   */
  it('★ 连点必然在两档间往复，不存在「点了没反应」', () => {
    let cur: ThemeSetting = 'light'
    const seen: ResolvedTheme[] = []
    for (let i = 0; i < 4; i += 1) {
      cur = nextThemeSetting(cur)
      seen.push(cur)
    }
    expect(seen).toEqual(['dark', 'light', 'dark', 'light'])
  })

  it('★ 两档都走得到（不会卡死在某一档）', () => {
    const reached = new Set<ThemeSetting>()
    let cur: ThemeSetting = 'light'
    for (let i = 0; i < THEME_SETTINGS.length; i += 1) {
      cur = nextThemeSetting(cur)
      reached.add(cur)
    }
    expect(reached).toEqual(new Set(THEME_SETTINGS))
  })
})

describe('themeSettingLabel', () => {
  it('两档各有一个不同的中文标签（按钮的可读名字，无障碍 §4.5）', () => {
    expect(themeSettingLabel('light')).toBeTruthy()
    expect(themeSettingLabel('dark')).toBeTruthy()
    expect(new Set(THEME_SETTINGS.map(themeSettingLabel)).size).toBe(2)
  })

  it('★ 没有任何一档叫「跟随系统」（用户第 9 条）', () => {
    expect(THEME_SETTINGS.map(themeSettingLabel)).not.toContain('跟随系统')
  })
})
