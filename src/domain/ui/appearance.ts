/**
 * 界面外观偏好（用户 2026-10-09：「设置那个地方给我加一个这个功能」）。
 *
 * 与主题（`ui/theme.ts`）同一族：**本机偏好**，落 `localStorage` 的 `flow:*` 命名空间，
 * 同步读取（刷新时不闪），不进业务库、不随项目导出。
 *
 * 只管三件事，都是**界面**：
 *   - 用哪个字族（系统栈 / 自定义字体）；
 *   - 界面字号档位（紧凑 / 标准 / 舒适）；
 *   - 字距（标准 / 宽松）。
 *
 * ⚠️ **不碰生成参数**：字体与字号永远不影响出图结果，界面上也要这么写清楚。
 * 画布缩放、节点内容字号属于另外的事，不在这里。
 */
import type { FontChoice } from './fonts'

/** 界面字号档位：以 `--fs-body` 为基准整体缩放（三档都要能看清） */
export type UiScale = 'compact' | 'standard' | 'comfortable'
export type LetterSpacing = 'normal' | 'wide'

export interface AppearancePrefs {
  font: FontChoice
  scale: UiScale
  letterSpacing: LetterSpacing
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  font: { kind: 'system' },
  scale: 'standard',
  letterSpacing: 'wide',
}

/** localStorage 键：与 `flow:theme` / 侧栏键同族 */
export const APPEARANCE_STORAGE_KEY = 'flow:appearance'

export const UI_SCALES: readonly UiScale[] = ['compact', 'standard', 'comfortable']
export const LETTER_SPACINGS: readonly LetterSpacing[] = ['normal', 'wide']

export function uiScaleLabel(scale: UiScale): string {
  return scale === 'compact' ? '紧凑' : scale === 'comfortable' ? '舒适' : '标准'
}

/**
 * 档位 → 缩放系数。
 *
 * 只缩放**字号类令牌**，不缩放间距与圆角 —— 否则"改字号"会变成"改版式"，
 * 那是另一个功能（界面密度），本项目不做。
 */
export function uiScaleFactor(scale: UiScale): number {
  return scale === 'compact' ? 0.92 : scale === 'comfortable' ? 1.08 : 1
}

export function letterSpacingValue(value: LetterSpacing): string {
  return value === 'normal' ? 'normal' : '0.04em'
}

/** localStorage 里存的形状（故意宽松：多一个字段不算坏值） */
function parseChoice(value: unknown): FontChoice {
  if (!value || typeof value !== 'object') return DEFAULT_APPEARANCE.font
  const v = value as Record<string, unknown>
  if (v.kind === 'custom' && typeof v.fontId === 'string' && v.fontId) {
    return { kind: 'custom', fontId: v.fontId }
  }
  return { kind: 'system' }
}

/**
 * 解析落盘值。**任何一项非法都单独回落默认**，不让一处坏值把整份偏好作废 ——
 * 否则用户会看到"改了个字距，字号也跟着回到默认"这种莫名其妙的行为。
 */
export function parseAppearance(raw: unknown): AppearancePrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_APPEARANCE }
  const v = raw as Record<string, unknown>
  return {
    font: parseChoice(v.font),
    scale: UI_SCALES.includes(v.scale as UiScale) ? (v.scale as UiScale) : DEFAULT_APPEARANCE.scale,
    letterSpacing: LETTER_SPACINGS.includes(v.letterSpacing as LetterSpacing)
      ? (v.letterSpacing as LetterSpacing)
      : DEFAULT_APPEARANCE.letterSpacing,
  }
}

/** 读一次（读不到 / 坏值都回默认；隐私模式下 localStorage 抛错也不让应用挂） */
export function readAppearance(): AppearancePrefs {
  try {
    const raw = globalThis.localStorage?.getItem(APPEARANCE_STORAGE_KEY)
    return raw ? parseAppearance(JSON.parse(raw)) : { ...DEFAULT_APPEARANCE }
  } catch {
    return { ...DEFAULT_APPEARANCE }
  }
}

/** 写一次（存不下不影响本次生效，与 ThemeProvider 同一口径） */
export function writeAppearance(prefs: AppearancePrefs): void {
  try {
    globalThis.localStorage?.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    /* 忽略：隐私模式 / 配额满 */
  }
}
