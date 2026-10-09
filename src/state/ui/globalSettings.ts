/**
 * 「全局设置」浮层的**纯 UI 态**（用户 2026-10-06 定，对账 #259）。
 *
 * 三条口径（都是用户原话）：
 * 1. 它是**模态浮层**：打开时整窗盖一层遮罩，「需要关掉才能点击其他的功能」；
 * 2. 入口在**侧栏底部**、排在「检查更新」**上方**（不是一级导航）；
 * 3. 打开时**可以直接落到某一栏**：画布里的「去后台设置」= 打开浮层**并落到渠道配置**
 *    （用户明确「不单单是打开浮层」）—— 所以 `open()` 收一个栏目参数。
 *
 * 与 `sidebarState` 同一套路子：模块级订阅值 + **不落盘**。
 * 它是"现在有没有挡着一层窗"，跟业务数据无关，也不该被持久化
 * （谁都不想重启后被设置挡住）。
 *
 * ⚠️ **为什么它在 `state/ui/` 而不在 `app/`**：`侧栏状态` 只有壳层用，放 `app/` 没问题；
 * 但这一份**画布页也要用**（画布里的「去后台设置」= 打开浮层并落到渠道配置）。
 * 分层表里 `pages` 不能依赖 `app`（那是向上依赖），而 `state` 是两侧都能依赖的一层 ——
 * 架构 §2.1 的分层图里本来就留了 `state/ui` 这个切片，这里就落在它身上。
 */

export type GlobalSettingsSection =
  | 'channels'
  | 'cli'
  | 'hosting'
  | 'storage'
  /**
   * 外观与体验（用户 2026-10-09：「我能加入字体吗？……设置那个地方给我加一个这个功能」）。
   *
   * 它是**本机界面偏好**：字体 / 字号 / 字距。与业务配置分栏放，
   * 因为改它不会影响任何项目数据（也正因为如此，它是这一批里风险最低的一栏）。
   */
  | 'appearance'
  /**
   * 备份与恢复（用户 2026-10-09，对账 #378）。
   *
   * 与「存储」分工：「存储」回答"东西在哪"，「备份与恢复」回答"出事怎么办"。
   * 两件事紧急程度不同，混在一起会被日常项淹没，故单开一栏。
   */
  | 'backup'

export interface GlobalSettingsState {
  open: boolean
  /** 打开时落在哪一栏。关闭后保留 —— 下次打开回到上次看的那一栏，符合直觉。 */
  section: GlobalSettingsSection
}

/** 子菜单（浮层内那一排标签）。**标签与内容一处定义**，免得"标签写 A、内容是 B"。 */
export const GLOBAL_SETTINGS_SECTIONS: { id: GlobalSettingsSection; label: string }[] = [
  { id: 'channels', label: '渠道配置' },
  // 「CLI」（对账 #308）：用户点名"就在渠道配置的**下面**"——顺序即口径，别往后挪
  { id: 'cli', label: 'CLI' },
  { id: 'hosting', label: '素材传输' },
  // 「存储」（对账 #261）：存储概况 / 数据目录 / 网页缓存 / 素材文件夹
  { id: 'storage', label: '存储' },
  // 「外观与体验」（用户 2026-10-09）：字体 / 界面字号 / 字距
  { id: 'appearance', label: '外观与体验' },
  // 「备份与恢复」（用户 2026-10-09）：全量备份导出 / 导入（#378）
  { id: 'backup', label: '备份与恢复' },
]

let state: GlobalSettingsState = { open: false, section: 'channels' }
const listeners = new Set<() => void>()

function notify(): void {
  for (const fn of listeners) fn()
}

export function getGlobalSettings(): GlobalSettingsState {
  return state
}

/** 打开（默认落在「渠道配置」）。已经开着且栏目没变时不通知 —— 免得白重渲。 */
export function openGlobalSettings(section: GlobalSettingsSection = 'channels'): void {
  if (state.open && state.section === section) return
  state = { open: true, section }
  notify()
}

export function closeGlobalSettings(): void {
  if (!state.open) return
  state = { ...state, open: false }
  notify()
}

export function subscribeGlobalSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 仅供测试：复位成「关着 + 渠道配置」。 */
export function __resetGlobalSettingsForTest(): void {
  state = { open: false, section: 'channels' }
  notify()
}
