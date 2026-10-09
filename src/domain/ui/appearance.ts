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
  /** 强调色档位（#379 剩余项）：只换 `--accent` / `--accent-text` 两个令牌 */
  accent: AccentId
  /**
   * 减少动效：把**时长令牌**归零。
   *
   * 刻意不是"全局 `transition: none`" —— 用户要的是"别动"，不是"别变"：
   * 归零后颜色 / 位置仍然立刻到位，只是没有过渡（与设计稿的验收判据一致）。
   */
  motion: MotionPref
  /** 是否显示画布右下角的小地图（本机偏好；关掉只是少一个导航控件） */
  showMinimap: boolean
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  font: { kind: 'system' },
  scale: 'standard',
  letterSpacing: 'wide',
  /* 默认 = 现状：近黑/近白强调色、完整动效、显示小地图 —— 升级不改老用户观感 */
  accent: 'ink',
  motion: 'full',
  showMinimap: true,
}

/** localStorage 键：与 `flow:theme` / 侧栏键同族 */
export const APPEARANCE_STORAGE_KEY = 'flow:appearance'

export const UI_SCALES: readonly UiScale[] = ['compact', 'standard', 'comfortable']
export const LETTER_SPACINGS: readonly LetterSpacing[] = ['normal', 'wide']

/**
 * 强调色档位（对应设置清单 §6「主题 → 强调色」，用户 2026-10-09）。
 *
 * 两条实现约束（《文档总索引》§4 漏洞 #2 定的）：
 * 1. **色板是 JS 常量数据**，运行时按 id 覆盖 `:root` 的 `--accent` / `--accent-text` ——
 *    不写进 CSS，否则会撞上主题守卫的白名单（组件样式里不许出现字面量颜色）；
 * 2. 亮 / 暗各一套值：强调色是"深底浅字 / 浅底深字"翻转过来的（tokens.css 的主题注释），
 *    只给一套值会在另一套主题上出现"浅字压浅底"。
 *
 * 每一档的 `accent` 与 `text` 的对比度由 `appearance.test.ts` 逐个算式验（≥ 4.5:1），
 * 不靠肉眼挑色。
 */
export type AccentId = 'ink' | 'slate' | 'blue' | 'cyan' | 'green' | 'amber' | 'rose' | 'violet'

export interface AccentPalette {
  id: AccentId
  label: string
  light: { accent: string; text: string }
  dark: { accent: string; text: string }
}

export const ACCENT_PALETTES: readonly AccentPalette[] = [
  // ink = 现状（亮色近黑 / 深色近白），是默认档 —— 升级后观感一个像素不变
  { id: 'ink', label: '墨黑', light: { accent: '#171716', text: '#ffffff' }, dark: { accent: '#efefef', text: '#161616' } },
  { id: 'slate', label: '石板', light: { accent: '#3f4a5a', text: '#ffffff' }, dark: { accent: '#b9c3d4', text: '#12161d' } },
  { id: 'blue', label: '靛蓝', light: { accent: '#2f5ad9', text: '#ffffff' }, dark: { accent: '#8fa8ff', text: '#10141f' } },
  { id: 'cyan', label: '青', light: { accent: '#0f7490', text: '#ffffff' }, dark: { accent: '#6fd0e8', text: '#0b1a1f' } },
  { id: 'green', label: '松绿', light: { accent: '#2f7d5a', text: '#ffffff' }, dark: { accent: '#6fd3a2', text: '#0d1a14' } },
  { id: 'amber', label: '琥珀', light: { accent: '#8a5a12', text: '#ffffff' }, dark: { accent: '#e8b566', text: '#1a1408' } },
  { id: 'rose', label: '绛', light: { accent: '#b3475e', text: '#ffffff' }, dark: { accent: '#f09aac', text: '#1d1013' } },
  { id: 'violet', label: '紫', light: { accent: '#6b4fc9', text: '#ffffff' }, dark: { accent: '#b7a4ff', text: '#140f21' } },
]

/** 减少动效两档（`full` = 现状） */
export type MotionPref = 'full' | 'reduced'
export const MOTION_PREFS: readonly MotionPref[] = ['full', 'reduced']

export const DEFAULT_ACCENT: AccentId = 'ink'

/** 按 id 取色板；非法 / 缺失一律回落默认档（调用方不必自己判空） */
export function accentOf(id: unknown): AccentPalette {
  return ACCENT_PALETTES.find((p) => p.id === id) ?? ACCENT_PALETTES[0]!
}

/** 当前主题下该档的两个令牌值（Provider 直接写进 `:root` 的内联样式） */
export function accentTokens(id: unknown, theme: 'light' | 'dark'): { accent: string; text: string } {
  const palette = accentOf(id)
  return theme === 'dark' ? palette.dark : palette.light
}

export function accentLabel(id: unknown): string {
  return accentOf(id).label
}

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
    accent: ACCENT_PALETTES.some((p) => p.id === v.accent)
      ? (v.accent as AccentId)
      : DEFAULT_APPEARANCE.accent,
    motion: MOTION_PREFS.includes(v.motion as MotionPref)
      ? (v.motion as MotionPref)
      : DEFAULT_APPEARANCE.motion,
    showMinimap:
      typeof v.showMinimap === 'boolean' ? v.showMinimap : DEFAULT_APPEARANCE.showMinimap,
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
