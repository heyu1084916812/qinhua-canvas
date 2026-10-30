/**
 * 画布外观偏好（**项目级**）：背景样式、背景色调、节点内容字号与默认尺寸。
 *
 * ## 为什么是项目级，而不是本机级
 *
 * 产品文档 §4.1 的三条设计红线把样式分成两层：
 *   - **界面样式**（侧栏、面板、按钮）：本机偏好，见 `domain/ui/appearance.ts`；
 *   - **内容样式**（画布底色、节点标题与正文）：**项目偏好** —— 换一台机器打开
 *     同一个项目，看到的应当是同一张画布。
 *
 * ## 存在哪：`projects.extra.canvasStyle`
 *
 * 与封面标记 `extra.cover`（见 `domain/project/cover.ts`）同一套机制：
 * 「项目行的扩展位 + 一个容错的只读解析器 + 一个不改原对象的写入器」。
 * `serializeProject` / `serializeProjectStream` 原样转发 `extra`，
 * 于是这两项**随项目导出、随项目导入**，不需要动 `.flow.json` 的版本号。
 *
 * ⚠️ **不放 `presets` 表**：那张表是**全局** UI 偏好（主键就是 id，没有 projectId，
 * 见 `state/project/presetStore.ts`），项目偏好放进去既不会随项目导出，
 * 还会在项目之间互相串。《轻画-交付功能与设置梳理.md》§4.3 曾写「项目偏好走 presets
 * 保留行……这样随项目导出」—— 那句话与实现对不上，以本文件与代码为准
 * （已在对账清单第 51 批更正）。
 *
 * ## 容错口径
 *
 * 与界面偏好同一条：**任何一项非法只回落那一项**，不让一条脏数据把整份偏好作废
 * （否则用户会遇到「改了个背景色，字号也跟着回默认」）。
 */

/** 画布背景样式：细网格 / 点阵 / 纯色（设置页清单 §6） */
export type CanvasBackgroundKind = 'grid' | 'dots' | 'solid'

/** 背景色调：六档低饱和（与容器背景那六档同一族色相，但独立成画布令牌） */
export type CanvasTone = 'slate' | 'blue' | 'green' | 'amber' | 'rose' | 'violet'
export type CanvasTheme = 'light' | 'dark'

/** 新节点默认尺寸档位 */
export type NodeDensity = 'compact' | 'standard' | 'roomy'

export interface CanvasColorPair {
  background: string | null
  dot: string | null
}

export interface CanvasStyle {
  background: CanvasBackgroundKind
  tone: CanvasTone
  /** 浅色 / 深色分别保存自定义底色与点阵色；为空时跟随该主题的六档预设。 */
  customCanvas: Record<CanvasTheme, CanvasColorPair>
  /** 浅色 / 深色分别保存节点底色；为空时跟随当前主题。 */
  customNode: Record<CanvasTheme, string | null>
  /** 节点标题字号（px）：12 / 14 / 16 / 18 */
  titleSize: number
  /** 提示词正文字号（px）：13 / 14 / 16 / 18 / 20 */
  bodySize: number
  density: NodeDensity
}

export const CANVAS_BACKGROUNDS: readonly CanvasBackgroundKind[] = ['grid', 'dots', 'solid']
export const CANVAS_TONES: readonly CanvasTone[] = [
  'slate',
  'blue',
  'green',
  'amber',
  'rose',
  'violet',
]
export const NODE_DENSITIES: readonly NodeDensity[] = ['compact', 'standard', 'roomy']
export const NODE_TITLE_SIZES: readonly number[] = [12, 14, 16, 18]
export const NODE_BODY_SIZES: readonly number[] = [13, 14, 16, 18, 20]

/**
 * 默认值 = **当前产品观感**（不是新发明的）：
 * 背景一直是点阵（React Flow `<Background variant=Dots>`）、字号 14、尺寸标准档。
 * 设置页清单把默认写成「细网格」，与今天画布上的实际观感不一致 ——
 * 这里按**现状**取默认（点阵），免得升级一次应用就把所有人的画布偷偷换掉；
 * 清单那一处已在第 51 批记为口径更正。
 */
export const DEFAULT_CANVAS_STYLE: CanvasStyle = {
  background: 'dots',
  tone: 'slate',
  customCanvas: {
    light: { background: null, dot: null },
    dark: { background: null, dot: null },
  },
  customNode: {
    light: null,
    dark: null,
  },
  titleSize: 14,
  bodySize: 14,
  density: 'standard',
}

/** `projects.extra` 里存这一笔的键 */
const STYLE_KEY = 'canvasStyle'

export function canvasBackgroundLabel(kind: CanvasBackgroundKind): string {
  return kind === 'grid' ? '细网格' : kind === 'solid' ? '纯色' : '点阵'
}

const TONE_LABELS: Record<CanvasTheme, Record<CanvasTone, string>> = {
  light: {
    slate: '暖浅灰',
    blue: '中性灰',
    green: '暖中灰',
    amber: '纯中灰',
    rose: '深暖灰',
    violet: '工程灰',
  },
  dark: {
    slate: '石板灰',
    blue: '深曜石黑',
    green: '标准深槽黑',
    amber: '微暖炭底黑',
    rose: '克制暗灰黑',
    violet: '反向提亮暗灰',
  },
}

export const CANVAS_TONE_PAIRS: Record<
  CanvasTheme,
  Record<CanvasTone, { background: string; dot: string }>
> = {
  light: {
    slate: { background: '#f0efed', dot: '#dad8d4' },
    blue: { background: '#efefef', dot: '#d9d9d9' },
    green: { background: '#ecebe8', dot: '#d5d3ce' },
    amber: { background: '#ededed', dot: '#d6d6d6' },
    rose: { background: '#eae9e6', dot: '#d2d0cb' },
    violet: { background: '#e8e8e8', dot: '#cfcfcf' },
  },
  dark: {
    slate: { background: '#161616', dot: '#303030' },
    blue: { background: '#0a0a0a', dot: '#222222' },
    green: { background: '#0d0d0d', dot: '#242424' },
    amber: { background: '#0f0e0e', dot: '#262524' },
    rose: { background: '#111111', dot: '#272727' },
    violet: { background: '#1a1a1a', dot: '#2e2e2e' },
  },
}

export function canvasToneLabel(tone: CanvasTone, theme: CanvasTheme = 'light'): string {
  return TONE_LABELS[theme][tone]
}

export function canvasTonePair(tone: CanvasTone, theme: CanvasTheme): { background: string; dot: string } {
  return CANVAS_TONE_PAIRS[theme][tone]
}

export function nodeDensityLabel(density: NodeDensity): string {
  return density === 'compact' ? '紧凑' : density === 'roomy' ? '宽敞' : '标准'
}

/**
 * 档位 → 新节点尺寸系数。
 *
 * 只缩「新建节点的默认宽高」，不改已有节点 —— 用户挑的是"以后新加的节点多大"，
 * 不是"把画布上已有的东西全部重排"（那会毁掉手工摆好的布局）。
 */
export function nodeDensityFactor(density: NodeDensity): number {
  return density === 'compact' ? 0.85 : density === 'roomy' ? 1.15 : 1
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function pickSize(value: unknown, allowed: readonly number[], fallback: number): number {
  return typeof value === 'number' && allowed.includes(value) ? value : fallback
}

/** 只接受十六进制颜色；三位写法展开为六位，脏值回 null（绝不让项目数据直接成为任意 CSS）。 */
export function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim()
  if (!/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(raw)) return null
  if (raw.length === 4) {
    return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase()
  }
  return raw.toLowerCase()
}

/** 从 `projects.extra` 读回画布偏好；缺字段 / 脏数据逐项回落默认 */
export function readCanvasStyle(extra: unknown): CanvasStyle {
  if (!extra || typeof extra !== 'object') return cloneCanvasStyle(DEFAULT_CANVAS_STYLE)
  const raw = (extra as Record<string, unknown>)[STYLE_KEY]
  if (!raw || typeof raw !== 'object') return cloneCanvasStyle(DEFAULT_CANVAS_STYLE)
  const v = raw as Record<string, unknown>
  const rawCanvas =
    v.customCanvas && typeof v.customCanvas === 'object'
      ? (v.customCanvas as Record<string, unknown>)
      : {}
  const rawNode =
    v.customNode && typeof v.customNode === 'object'
      ? (v.customNode as Record<string, unknown>)
      : {}
  const lightCanvas =
    rawCanvas.light && typeof rawCanvas.light === 'object'
      ? (rawCanvas.light as Record<string, unknown>)
      : {}
  const darkCanvas =
    rawCanvas.dark && typeof rawCanvas.dark === 'object'
      ? (rawCanvas.dark as Record<string, unknown>)
      : {}
  const legacyCanvas = normalizeHexColor(v.customColor)
  const legacyNode = normalizeHexColor(v.nodeColor)
  return {
    background: pick(v.background, CANVAS_BACKGROUNDS, DEFAULT_CANVAS_STYLE.background),
    tone: pick(v.tone, CANVAS_TONES, DEFAULT_CANVAS_STYLE.tone),
    customCanvas: {
      light: {
        background: normalizeHexColor(lightCanvas.background) ?? legacyCanvas,
        dot: normalizeHexColor(lightCanvas.dot),
      },
      dark: {
        background: normalizeHexColor(darkCanvas.background),
        dot: normalizeHexColor(darkCanvas.dot),
      },
    },
    customNode: {
      light: normalizeHexColor(rawNode.light) ?? legacyNode,
      dark: normalizeHexColor(rawNode.dark),
    },
    titleSize: pickSize(v.titleSize, NODE_TITLE_SIZES, DEFAULT_CANVAS_STYLE.titleSize),
    bodySize: pickSize(v.bodySize, NODE_BODY_SIZES, DEFAULT_CANVAS_STYLE.bodySize),
    density: pick(v.density, NODE_DENSITIES, DEFAULT_CANVAS_STYLE.density),
  }
}

/** 写入画布偏好（返回新的 extra，**不改原对象** —— 项目行是持久化数据，就地改最容易出事） */
export function withCanvasStyle(extra: unknown, style: CanvasStyle): Record<string, unknown> {
  const base = extra && typeof extra === 'object' ? (extra as Record<string, unknown>) : {}
  return { ...base, [STYLE_KEY]: cloneCanvasStyle(style) }
}

export function cloneCanvasStyle(style: CanvasStyle): CanvasStyle {
  return {
    ...style,
    customCanvas: {
      light: { ...style.customCanvas.light },
      dark: { ...style.customCanvas.dark },
    },
    customNode: { ...style.customNode },
  }
}
