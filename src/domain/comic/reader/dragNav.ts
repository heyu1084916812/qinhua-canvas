/**
 * 拖拽翻页的规则（M6-10，纯函数）。
 *
 * M6-7 的翻页动效只是「翻完之后的进场位移」——用户仍然是**点按钮 / 按方向键**
 * 才能翻页。本模块补的是**直接操作**：按住页往旁边拖，页跟着手走；拖过阈值松手就翻，
 * 没拖够就弹回去。
 *
 * 三条口径与 `readerNav` 严格同源，避免「拖」与「按」翻出不同结果：
 *   1. **叙事位移**仍是 ±1（`+1` = 下一页），**不因输入方式改变语义**；
 *   2. **方向只管手势**：`ltr` 往左拖才是下一页、`rtl` 往右拖才是下一页——
 *      与「`rtl` 下 `←` 才是前进」是同一件事的两种输入；
 *   3. **到边界是「拖不动」**：不是夹回、不是原地假成功——跟手位移只给一个
 *      明显更小的阻尼值，松手也不翻。
 *
 * 另外一条独立的判定：**只接管横向手势**。纵向位移更大时不参与，把滚动留给页面
 * （阅读器舞台是可滚动的），否则拖页会吃掉滚动。
 *
 * 纯函数、无 React / platform / 持久化（架构 §2.2 domain 纯度约束）。
 */

import type { ReadingDirection } from '../model/comicProject'

/** 拖拽输入（屏幕坐标；右为正、下为正） */
export interface DragTurnInput {
  /** 横向位移 */
  dx: number
  /** 纵向位移（用于判定手势主轴） */
  dy: number
  /** 舞台宽度（阈值按比例换算，窄屏也能用） */
  width: number
  direction: ReadingDirection
  hasPrev: boolean
  hasNext: boolean
}

/** 拖拽意图：横向手势换算出的叙事位移；`null` = 不是横向手势（不接管） */
export interface DragIntent {
  delta: -1 | 1
  /** 该方向已到边界（首页还想往前、末页还想往后）——只给阻尼，不真翻 */
  blocked: boolean
}

/** 跟手系数：可翻动方向（跟手但不 1:1，留一点「页被拽住」的重量感） */
const FOLLOW = 0.55
/** 跟手系数：已到边界的方向（明显更小，手感上就是「拖不动」） */
const FOLLOW_BLOCKED = 0.22
/** 跟手位移上限（px）——拖到天边也只挪这么多，避免页被拽飞 */
const MAX_OFFSET = 72
/** 翻页阈值：`宽度的 28%`，夹在 48..120 之间（太窄的屏不至于一碰就翻、太宽的屏不至于要拖半屏） */
const THRESHOLD_RATIO = 0.28
const THRESHOLD_MIN = 48
const THRESHOLD_MAX = 120

function num(v: number, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

/**
 * 手势主轴：`x` = 横向（接管翻页）、`y` = 纵向（留给滚动）。
 *
 * 相等时判给横向——完全水平的拖动显然是想翻页。
 */
export function dragAxis(dx: number, dy: number): 'x' | 'y' {
  return Math.abs(num(dx)) >= Math.abs(num(dy)) ? 'x' : 'y'
}

/** 翻页阈值（px）：宽度的 28%，夹在 48..120 */
export function dragTurnThreshold(width: number): number {
  const w = Math.max(0, num(width))
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, w * THRESHOLD_RATIO))
}

/**
 * 拖拽意图：横向位移 → 叙事位移。
 *
 * `null` 表示「这次手势不该由翻页接管」（纵向手势，或根本没有位移）。
 */
export function dragIntent(input: DragTurnInput): DragIntent | null {
  const dx = num(input.dx)
  const dy = num(input.dy)
  if (dx === 0 || dragAxis(dx, dy) !== 'x') return null
  // 屏幕方向 → 叙事方向：ltr 往左拖 = 下一页；rtl 往右拖 = 下一页
  const forward = input.direction === 'ltr' ? dx < 0 : dx > 0
  const delta: -1 | 1 = forward ? 1 : -1
  return { delta, blocked: delta === 1 ? !input.hasNext : !input.hasPrev }
}

/**
 * 拖拽中的**跟手位移**（px，右为正）：越界方向阻尼更小，并统一夹在 ±72。
 *
 * 不 1:1 跟手是刻意的：页是有重量的东西，完全跟手会让「翻页」失去确认感。
 */
export function dragTurnOffset(input: DragTurnInput): number {
  const intent = dragIntent(input)
  if (intent === null) return 0
  const raw = num(input.dx) * (intent.blocked ? FOLLOW_BLOCKED : FOLLOW)
  return Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, raw))
}

/**
 * 松手判定：返回要翻的**叙事位移**（±1），或 `null`（回弹 = 不翻）。
 *
 * 四种不翻的情况：① 纵向手势；② 位移没过阈值；③ 该方向已到边界；
 * 与 `pageNeighbor` / `spreadNeighbor` 同口径——**越界是无动作**，不是夹回。
 */
export function dragTurnVerdict(input: DragTurnInput): -1 | 1 | null {
  const intent = dragIntent(input)
  if (intent === null) return null
  if (Math.abs(num(input.dx)) < dragTurnThreshold(input.width)) return null
  if (intent.blocked) return null
  return intent.delta
}
