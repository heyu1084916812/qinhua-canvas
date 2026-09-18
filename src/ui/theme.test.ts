/**
 * 主题的纯逻辑单测（ui/theme.ts）。
 *
 * 这些判定必须能在 node 下跑：它们决定首帧是不是闪白，而首帧逻辑没法靠
 * 「在浏览器里点一下看看」来验证——刷新那一下早过去了。故规则收在纯函数里，
 * 由这里钉住；DOM 侧的落地（app/ThemeProvider）只做搬运。
 */
import { describe, it, expect } from 'vitest'
import {
  nextThemeSetting,
  parseThemeSetting,
  resolveTheme,
  systemTheme,
  themeSettingLabel,
  THEME_SETTINGS,
  type ResolvedTheme,
  type ThemeSetting,
} from './theme'

describe('parseThemeSetting', () => {
  it('三个合法值原样返回', () => {
    expect(parseThemeSetting('light')).toBe('light')
    expect(parseThemeSetting('dark')).toBe('dark')
    expect(parseThemeSetting('system')).toBe('system')
  })

  /**
   * ★ 非法值回落 system 而不是 light。
   * 回落 light 会让「系统已是深色」的用户在每次读到脏数据时被弹回亮色；
   * system 是唯一「不知道就别瞎猜」的答案。
   */
  it('★ 非法 / 缺失值一律回落「跟随系统」（不是亮色）', () => {
    expect(parseThemeSetting(null)).toBe('system')
    expect(parseThemeSetting(undefined)).toBe('system')
    expect(parseThemeSetting('')).toBe('system')
    expect(parseThemeSetting('DARK')).toBe('system')
    expect(parseThemeSetting('dark-mode')).toBe('system')
    // 老版本可能存过的任意字符串
    expect(parseThemeSetting('auto')).toBe('system')
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

describe('resolveTheme', () => {
  it('显式选明 / 暗时，系统偏好说了不算', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark')
    expect(resolveTheme('light', 'dark')).toBe('light')
  })

  it('「跟随系统」才看系统脸色', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark')
    expect(resolveTheme('system', 'light')).toBe('light')
  })
})

describe('nextThemeSetting', () => {
  /**
   * ★★ 默认档（system）第一次点击必须切到**当前外观的反面**。
   * 固定顺序轮转（system → light）在「系统本来就是浅色」时等于点了没反应，
   * 用户会以为按钮坏了——这正是默认路径，故单独钉住。
   */
  it('★ 默认档第一次点击必然改变外观（切到当前外观的反面）', () => {
    expect(nextThemeSetting('system', 'light')).toBe('dark')
    expect(nextThemeSetting('system', 'dark')).toBe('light')
  })

  it('深色 → 浅色（显式档之间直接互换）', () => {
    expect(nextThemeSetting('dark', 'dark')).toBe('light')
  })

  it('浅色 → 跟随系统（交回系统控制）', () => {
    expect(nextThemeSetting('light', 'light')).toBe('system')
  })

  /**
   * 三档都走得到：从默认档连点三次回到「跟随系统」，不会卡在某一档出不来。
   * （系统亮色下的路径：system → dark → light → system。）
   */
  it('★ 连点三档能回到「跟随系统」（不会卡死在某一档）', () => {
    const start: ThemeSetting = 'system'
    let cur: ThemeSetting = start
    // resolved 始终按「当前设置 + 系统亮色」推演，模拟真实连点
    for (let i = 0; i < THEME_SETTINGS.length; i += 1) {
      cur = nextThemeSetting(cur, resolveTheme(cur, 'light'))
    }
    expect(cur).toBe(start)
  })

  it('★ 默认档下连点，外观每次都在变（没有「点了没反应」的一拍）', () => {
    // system(亮) → dark → light → system(亮)：解析出的外观序列为 亮 → 暗 → 亮 → 亮
    let cur: ThemeSetting = 'system'
    const seen: ResolvedTheme[] = []
    for (let i = 0; i < 3; i += 1) {
      const before = resolveTheme(cur, 'light')
      cur = nextThemeSetting(cur, before)
      seen.push(resolveTheme(cur, 'light'))
    }
    // 前两次点击都翻转了外观；只有第三次（显式浅色 → 跟随系统）外观不变
    expect(seen[0]).toBe('dark')
    expect(seen[1]).toBe('light')
    expect(seen[2]).toBe('light')
  })
})

describe('themeSettingLabel', () => {
  it('三档各有中文标签（按钮的可读名字，无障碍 §4.5）', () => {
    expect(themeSettingLabel('light')).toBeTruthy()
    expect(themeSettingLabel('dark')).toBeTruthy()
    expect(themeSettingLabel('system')).toBeTruthy()
    expect(new Set(THEME_SETTINGS.map(themeSettingLabel)).size).toBe(3)
  })
})
