/**
 * 对白贴纸的**格内几何**（M6-4 起，纯函数）。
 *
 * 对白坐标是**格内 0..1 相对值**（模型约定：格尺寸随版式变，绝对像素会全乱），
 * 因此这里只回答四件事：
 *   1. 一个新贴纸落在哪（按该格已有贴纸数**纵向叠放**）；
 *   2. 拖拽后的坐标怎么**夹回格内**（贴纸不能被拖出格）；
 *   3. 缩放后的尺寸怎么**夹回格内**（M6-14：右下角手柄改 w/h，左上角不动）；
 *   4. 换类型 / 拖尾巴时**尾巴**怎么跟着变（`speech` / `thought` 才有尾巴）。
 *
 * **尾巴的一条不变量**：气泡与尾巴作为**一体**参与平移与缩放——平移保持尾巴的
 * *相对偏移*（`movedBalloonRect`）、缩放保持尾巴的*相对比例*（`resizedBalloonRect`），
 * 于是唯一能改变「尾巴指向」的操作是显式拖尾巴（`movedTail`）。
 * 少了这条，「拖走气泡留下尾巴」和「放大气泡把尾巴吞进气泡里」就都会发生。
 *
 * **尾巴的形状不在这里**：这里只维护锚点坐标（0..1），形态（菱形 / 尾巴粗细）在 UI 层。
 *
 * 纯数据结构 + 纯函数，不含 React / platform / 持久化（架构 §2.2 domain 纯度约束）。
 */

import type { BalloonType, ComicBalloon } from '../model/comicProject'

/** 格内相对矩形（0..1，左上原点；与格尺寸解耦） */
export interface BalloonRect {
  x: number
  y: number
  w: number
  h: number
  tail?: { x: number; y: number }
}

/** 贴纸默认尺寸（占格宽的 60%、高的 16%）与下限（避免短格上贴纸不可读） */
export const BALLOON_DEFAULT_W = 0.6
export const BALLOON_DEFAULT_H = 0.16
export const BALLOON_MIN_W = 0.12
export const BALLOON_MIN_H = 0.05

/** 叠放步长（贴纸高度 + 一点间距） */
const STACK_GAP = 0.04

/** 只有 `speech` / `thought` 有尾巴（ACBF：caption / sound 无指向） */
export function hasTail(type: BalloonType): boolean {
  return type === 'speech' || type === 'thought'
}

/** 把数值夹进 [0, 1] */
export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.min(1, Math.max(0, v))
}

/** 默认尾巴锚点：贴纸下缘中点（语音/心理气泡指向说话人） */
function bottomCenterTail(rect: { x: number; y: number; w: number; h: number }): {
  x: number
  y: number
} {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h }
}

/**
 * 新贴纸的默认位置：**纵向叠放**（第 n 个往下挪一格）。
 *
 * `index` = 该格**已有**贴纸数（0 起）。叠放在超出格高时贴底（夹回交给调用方，
 * 这里先按上限收住，避免返回值本身就出格）。
 */
export function defaultBalloonRect(type: BalloonType, index: number): BalloonRect {
  const w = BALLOON_DEFAULT_W
  const h = BALLOON_DEFAULT_H
  const step = Math.max(0, index) * (h + STACK_GAP)
  const rect: BalloonRect = {
    x: 0.2,
    y: Math.min(1 - h, 0.06 + step),
    w,
    h,
  }
  if (hasTail(type)) rect.tail = bottomCenterTail(rect)
  return rect
}

/**
 * 夹回格内：尺寸收进 [下限, 1]，位置收进 `[0, 1-尺寸]`（保证整个矩形不出格），
 * 尾巴锚点收进 `[0, 1]`。返回新对象（无变化时字段值相同）。
 */
export function clampBalloonRect(rect: BalloonRect): BalloonRect {
  const w = Math.min(1, Math.max(BALLOON_MIN_W, rect.w))
  const h = Math.min(1, Math.max(BALLOON_MIN_H, rect.h))
  const out: BalloonRect = {
    x: Math.min(1 - w, clamp01(rect.x)),
    y: Math.min(1 - h, clamp01(rect.y)),
    w,
    h,
  }
  if (rect.tail) out.tail = { x: clamp01(rect.tail.x), y: clamp01(rect.tail.y) }
  return out
}

/** 两个可选尾巴锚点是否等价（都为 `undefined` 也算等价） */
export function sameTail(
  a?: { x: number; y: number },
  b?: { x: number; y: number },
): boolean {
  if (!a || !b) return !a && !b
  return a.x === b.x && a.y === b.y
}

/**
 * 把贴纸拖到新位置 `(x, y)`：夹回格内，并让**尾巴跟随平移**（保持相对偏移，
 * 否则拖走气泡后尾巴会留在原地）。
 */
export function movedBalloonRect(balloon: ComicBalloon, x: number, y: number): BalloonRect {
  const rect: BalloonRect = { x, y, w: balloon.w, h: balloon.h }
  if (balloon.tail) {
    rect.tail = {
      x: balloon.tail.x + (x - balloon.x),
      y: balloon.tail.y + (y - balloon.y),
    }
  }
  return clampBalloonRect(rect)
}

/**
 * 缩放贴纸到新尺寸 `(w, h)`（M6-14）：**左上角固定**（手柄画在右下角），尺寸夹进
 * `[下限, 1]`、位置跟着夹回格内，并让**尾巴按相对比例跟随**——
 * 尾巴在气泡里的比例位置 `(fx, fy)` 不变，于是「下缘中点的尾巴」放大后仍是
 * 下缘中点；而用户显式拖过尾巴的位置也会随气泡等比拉开，不会被甩出气泡。
 *
 * 比例基准取**原尺寸**（`balloon.w/h`），并用**夹回后的** `x/y/w/h` 反算锚点，
 * 保证返回值本身就合规矩（调用方不必再夹一次）。
 */
export function resizedBalloonRect(balloon: ComicBalloon, w: number, h: number): BalloonRect {
  const rect = clampBalloonRect({ x: balloon.x, y: balloon.y, w, h })
  if (!balloon.tail) return rect
  const fx = balloon.w > 0 ? (balloon.tail.x - balloon.x) / balloon.w : 0.5
  const fy = balloon.h > 0 ? (balloon.tail.y - balloon.y) / balloon.h : 1
  rect.tail = { x: clamp01(rect.x + fx * rect.w), y: clamp01(rect.y + fy * rect.h) }
  return rect
}

/**
 * 拖尾巴改变**指向**（M6-14）：直接把锚点设到 `(x, y)`，夹进格内 `[0, 1]`。
 *
 * 无尾巴的贴纸（`caption` / `sfx`）返回 `null`——没有指向的贴纸不该被拖出尾巴；
 * 调用方拿到 `null` 即视为「无变化」。
 */
export function movedTail(
  balloon: ComicBalloon,
  x: number,
  y: number,
): { x: number; y: number } | null {
  if (!balloon.tail) return null
  return { x: clamp01(x), y: clamp01(y) }
}

/**
 * 换对白类型：同步**尾巴的存在性**——
 * 切到 `speech` / `thought` 时若无尾巴则补默认尾巴（下缘中点），
 * 切到其余类型时去掉尾巴。类型未变则返回原引用（供 reducer 判「无变化」）。
 */
export function withBalloonType(balloon: ComicBalloon, type: BalloonType): ComicBalloon {
  if (balloon.type === type) return balloon
  const next: ComicBalloon = { ...balloon, type }
  if (hasTail(type)) {
    next.tail = balloon.tail ?? bottomCenterTail(balloon)
  } else if (balloon.tail) {
    delete next.tail
  }
  return next
}
