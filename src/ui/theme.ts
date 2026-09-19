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

/**
 * 用户可选的设置（对应产品文档 §3.1 的色彩表）。
 *
 * **只有明 / 暗两档**（用户 2026-09-19 第 9 条：「只要两个主题色，去掉跟随系统」）。
 * 早先是明 / 暗 / 跟随系统三档轮转，但本产品的色彩表只定义了两套取值，
 * 第三档既不产生新外观、又让「点一下到底变成了什么」多一层心算；
 * 用户明确要求收敛成两档，故这里是**两档**。
 */
export type ThemeSetting = 'light' | 'dark'

/** 真正落到 `<html data-theme>` 上的两种取值 */
export type ResolvedTheme = 'light' | 'dark'

export const THEME_SETTINGS: readonly ThemeSetting[] = ['light', 'dark']

/** localStorage 键：与 `session.ts` 的 `flow:*` 前缀同族，避免和无主字符串撞车 */
export const THEME_STORAGE_KEY = 'flow:theme'

/**
 * 读回上次的选择。
 *
 * 非法值（手改过、旧版本写的东西、null）一律回落到 **`system` 的等价物**——
 * 两档之后没有 `system` 可存，故直接按**系统当前偏好**落成 light / dark。
 *
 * 为什么不让 `parseThemeSetting` 自己回落：它是纯函数，读不到系统偏好；
 * 把「旧值 `system` 该解析成什么」交给调用方（ThemeProvider 能拿到系统偏好），
 * 这里只负责**判定合法值**。旧版本存下的 `'system'` 会被判为非法，
 * 由调用方按系统偏好落地——这正是「跟随系统」用户升级后应有的行为。
 */
export function parseThemeSetting(raw: string | null | undefined): ThemeSetting | null {
  return raw === 'light' || raw === 'dark' ? raw : null
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

/** 设置项的中文标签（UI 与 aria-label 共用一份，避免两处文案漂移） */
export function themeSettingLabel(setting: ThemeSetting): string {
  return setting === 'light' ? '浅色' : '深色'
}

/**
 * 下一次点击该切到哪一档。
 *
 * 两档之后就是**互切**：浅 → 深 → 浅。每次点击必然产生可见的外观变化，
 * 不存在「点了没反应」的档位。
 */
export function nextThemeSetting(setting: ThemeSetting): ThemeSetting {
  return setting === 'dark' ? 'light' : 'dark'
}
