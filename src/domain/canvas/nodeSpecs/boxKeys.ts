import type { Rect, Size } from '../geometry/rect'
import type { NavDir } from '../navigation/spatial'
import { aspectLockedResize, freeResize, lockedResize, type ResizeLock } from './resizeLock'

/**
 * 键盘直接改节点的框：`Alt + 方向键` 微移、`Ctrl/⌘ + Alt + 方向键` 改尺寸（§6.20）。
 *
 * ## 为什么是"右下角位移的一个特例"，而不是另写一套
 *
 * 「拖出来的框」已经有唯一一份数学（`resizeLock.ts` 的 `freeResize` / `lockedResize` /
 * `aspectLockedResize`）。键盘这条**不许另写夹取规则** —— 它走的正是缩放手柄那条链：
 * 先按比例锁算、最后按容器网格比例归位，位移量只是一次 `±1px`（`Shift` 时 `±10px`）。
 * 否则"键盘改出来的尺寸"与"拖出来的尺寸"迟早分叉（最小尺寸、比例锁、高度归内容、
 * 批量网格比例四条，少一条都是用户看得见的差别）。
 *
 * 产品文档 §4.5「拖拽替代」那行要的就是这个：*节点移动提供方向键微移*。
 */

/** 一档位移（§6.20：移动 1px） */
export const KEY_STEP = 1
/** 按住 `Shift` 的加速档（§6.20：每次 10px） */
export const KEY_STEP_FAST = 10

/**
 * 一次按键折算成**右下角(se)**的位移向量：右 / 下为 `+`，左 / 上为 `−`。
 *
 * 微移与改尺寸共用它 —— 微移是"整块按这个向量平移"，改尺寸是"只有右下角按它走"。
 */
export function keyDelta(dir: NavDir, step: number): { dx: number; dy: number } {
  switch (dir) {
    case 'right':
      return { dx: step, dy: 0 }
    case 'left':
      return { dx: -step, dy: 0 }
    case 'down':
      return { dx: 0, dy: step }
    case 'up':
      return { dx: 0, dy: -step }
  }
}

/**
 * 改尺寸要问的四件事 —— 全部来自节点本体，取值口径与 `FlowNode` 喂给
 * `NodeFrame` 的那几项**同源**（`minSizeOf` / `resizeLockOf` / `heightFromContentOf`）。
 */
export interface BoxKeyRules {
  minSize: Size
  resizeLock: ResizeLock
  /** 等比锁的基准尺寸（批量 = 网格尺寸；见 `NodeFrame.lockAspect`） */
  lockAspect?: Size
  /** 高度由内容决定（循环节点）：只吃横向位移 */
  heightFromContent?: boolean
  /**
   * 高度归内容的节点：这一刻的**实际**高度。
   *
   * 与手柄那条路同一个理由 —— 视图会按内容把高度写回去，键盘这一拍若拿
   * 起手时的旧高度覆盖它，用户每按一次方向键就会看到高度跳回去一次。
   */
  liveHeight?: number
}

/**
 * `Ctrl/⌘ + Alt + 方向键`：按右下角那一只的语义改尺寸（左上角不动）。
 *
 * 向左 / 向上是**变小**（右下角往里收），向右 / 向下是变大 —— 与"拖右下角"同一手感。
 * 夹取与归位顺序与 `NodeFrame` 的手柄逐字一致：比例锁 →（或高度归内容）→ 网格比例归位。
 */
export function resizedByKey(base: Rect, dir: NavDir, step: number, rules: BoxKeyRules): Rect {
  const delta = keyDelta(dir, step)
  /**
   * 等比锁（批量）这一档要把位移**同时给两轴**。
   *
   * 理由：`aspectLockedResize` 取两轴里**较小**的放大系数（k）—— 只给一条轴位移时，
   * 另一条轴没动 ⇒ k 恒为 1 ⇒ 按了方向键什么都不发生（等于这条路在批量节点上失效）。
   * 同时给两轴 = "整体放大 / 整体缩小"，与拖右下角的实际手感一致；
   * 缩到网格尺寸由 `k` 的下限 1 挡住，不会遮住子节点。
   */
  const along = delta.dx + delta.dy
  const dx = rules.lockAspect ? along : delta.dx
  const dy = rules.lockAspect ? along : delta.dy
  const corner = 'se' as const
  let next: Rect
  if (rules.heightFromContent) {
    next = {
      x: base.x,
      y: base.y,
      w: Math.max(rules.minSize.w, base.w + dx),
      h: rules.liveHeight ?? base.h,
    }
  } else if (rules.resizeLock !== 'free') {
    // `'current'` = 锁按下时那一拍的比例（键盘这条路没有"按下"，就是当前这一拍）
    const ratio = typeof rules.resizeLock === 'number' ? rules.resizeLock : base.w / base.h
    next = lockedResize(base, dx, dy, rules.minSize, ratio)
  } else {
    next = freeResize(base, corner, dx, dy, rules.minSize)
  }
  if (rules.lockAspect) next = aspectLockedResize(next, corner, rules.lockAspect)
  return next
}

/** 两个框是不是同一拍（键盘改到边界时**不派发空命令** —— 否则撤销栈会多出一步空操作） */
export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h
}
