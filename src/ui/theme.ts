/**
 * 主题（明 / 暗）的纯逻辑层。
 *
 * 为什么要有这一层，而不是直接 `document.documentElement.dataset.theme = 'dark'`：
 * 「当前到底是明还是暗」要解决三件事——用户选了什么、系统现在是什么、
 * 上次的选择从 localStorage 读回来是否还合法。这三件事都是**纯数据判定**，
 * 不该和 DOM 写在一起，否则既没法在 node 下单测，也没法解释
 * 「为什么刷新后闪一下白」。故判定在这里，落 DOM 在 app/ThemeProvider。
 *
 * 与 ui/tokens.css 的分工：本文件决定**用哪一套**，tokens.css 决定**每一套长什么样**。
 * 组件样式只引用 token 名，不认识明 / 暗，因此加主题不需要改任何组件 CSS。
 */

/** 用户可选的三种设置（对应产品文档 §3.1 的色彩表，明 / 暗两套取值） */
export type ThemeSetting = 'light' | 'dark' | 'system'

/** 真正落到 `<html data-theme>` 上的两种取值 */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_SETTINGS: readonly ThemeSetting[] = ['light', 'dark', 'system']

/** localStorage 键：与 `session.ts` 的 `flow:*` 前缀同族，避免和无主字符串撞车 */
export const THEME_STORAGE_KEY = 'flow:theme'

/**
 * 读回上次的选择。
 *
 * 非法值（手改过、旧版本写的东西、null）一律回落到 `system`，**不抛错也不回落到
 * light**：回落 light 会让「系统已经是暗色」的用户在每次升级后都被弹回亮色，
 * 而 `system` 是唯一「不知道就别瞎猜」的答案。
 */
export function parseThemeSetting(raw: string | null | undefined): ThemeSetting {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/**
 * 系统当前偏好。读不到（老浏览器 / SSR / 测试环境）当**亮色**。
 *
 * 为什么不是暗色：亮色是本项目原本的、也是设计文档 §3.1 唯一定义过的那套，
 * 「读不到」时保持现状比擅自切到另一套更稳。
 */
export function systemTheme(query: string | null | undefined): ResolvedTheme {
  return query === '(prefers-color-scheme: dark)' || query === 'dark' ? 'dark' : 'light'
}

/**
 * 设置 + 系统偏好 → 实际主题。`system` 是唯一需要看系统脸色的一档。
 */
export function resolveTheme(setting: ThemeSetting, system: ResolvedTheme): ResolvedTheme {
  return setting === 'system' ? system : setting
}

/** 设置项的中文标签（UI 与 aria-label 共用一份，避免两处文案漂移） */
export function themeSettingLabel(setting: ThemeSetting): string {
  if (setting === 'light') return '浅色'
  if (setting === 'dark') return '深色'
  return '跟随系统'
}

/**
 * 下一次点击该切到哪一档。
 *
 * **不是固定顺序轮转**（浅 → 深 → 跟随系统 那样）：默认档是「跟随系统」，
 * 固定顺序下第一次点击会落到「浅色」——而系统本来就是浅的，于是**点了没反应**，
 * 用户会以为是按钮坏了。故规则改成「从跟随系统出发，先切到当前外观的**反面**」，
 * 保证默认状态下第一次点击必然看得见变化。
 *
 * 轮转顺序（以系统为浅色为例）：跟随系统 → 深色 → 浅色 → 跟随系统。
 * 三档都走得到，且只有「显式浅色 → 跟随系统」这一档在视觉上不动（它换的是
 * 语义而非外观，档位名会变，不算失灵）。
 */
export function nextThemeSetting(setting: ThemeSetting, resolved: ResolvedTheme): ThemeSetting {
  if (setting === 'system') return resolved === 'dark' ? 'light' : 'dark'
  if (setting === 'dark') return 'light'
  return 'system'
}
