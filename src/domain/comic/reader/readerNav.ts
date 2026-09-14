/**
 * 翻页预览的导航规则（M6-6，纯函数）。
 *
 * **口径（务必与阅读顺序模块分开理解）**：
 *   - **页序 = 叙事序**（`episode.pages` 的数组顺序，1,2,3…），**不随阅读方向翻转**。
 *     阅读方向管的是「**格内**阅读顺序」（`layout/readingOrder.ts`）与「翻页的手感方向」，
 *     不是页的排列——日漫 `rtl` 下页序仍是 1→2→3，只是**从左往右翻**。
 *   - 因此本模块只回答三件事：① 把「用户按下的左/右」换算成叙事上的前进/后退；
 *     ② 把页序夹回合法范围（决定边界按钮是否禁用）；③ 双页模式下把页序分组为跨页、
 *     并给出跨页步进与左右槽位（M6-7）。
 *
 * 纯函数、无 React / platform / 持久化（架构 §2.2 domain 纯度约束）。
 */

import type { ReadingDirection } from '../model/comicProject'

/** 方向键的左右语义（尚未按阅读方向换算） */
export type PageNavKey = 'left' | 'right'

/**
 * 把页序夹回 `[0, count-1]`。无页可翻（`count <= 0`）返回 `null`。
 *
 * 非整数输入会先取整（防御调用方传入索引运算的浮点误差）。
 */
export function clampPageIndex(index: number, count: number): number | null {
  if (count <= 0) return null
  // `Math.max(0, …)` 顺带把 `-0`（`Math.trunc(-0.4)`）规范化成 `+0`——否则 `Object.is(-0, 0)` 为假
  const raw = Number.isFinite(index) ? Math.trunc(index) : 0
  return Math.min(count - 1, Math.max(0, raw))
}

/**
 * 相对当前页的**叙事位移**目标页序；越界返回 `null`（调用方据此禁用按钮）。
 *
 * 不夹回——「到边界了还按下一页」应当是**无动作**，而不是原地不动地假成功。
 */
export function pageNeighbor(index: number, count: number, delta: -1 | 1): number | null {
  const target = clampPageIndex(index, count)
  if (target === null) return null
  const next = target + delta
  return next >= 0 && next <= count - 1 ? next : null
}

/**
 * 方向键 → 叙事位移。
 *
 *   - `ltr`：`→`(right) = 前进(+1)、`←`(left) = 后退(-1)；
 *   - `rtl`：`→`(right) = 后退(-1)、`←`(left) = 前进(+1)——日漫手感（往左翻才是下一页）。
 */
export function pageStepForKey(key: PageNavKey, direction: ReadingDirection): -1 | 1 {
  if (direction === 'ltr') return key === 'right' ? 1 : -1
  return key === 'right' ? -1 : 1
}

/** 「下一页」在视觉上落在哪一侧（用于摆放箭头朝向）：`ltr` 为右、`rtl` 为左 */
export function nextSide(direction: ReadingDirection): 'left' | 'right' {
  return direction === 'ltr' ? 'right' : 'left'
}

/* ───────────────────────────── 跨页（spread，M6-7）─────────────────────────────
 *
 * 双页阅读把「一次翻动」从「一页」变成「一组页」。口径仍是**页序 = 叙事序**：
 * 分组只决定「哪几页同时出现」，不改变页的先后；方向只管组的**左右镜像**与翻页手感。
 */

/**
 * 跨页分组：把页序切成若干组，组内页序升序。
 *
 * `loneFirst = true` 时**第 1 页单独成组**（封面惯例），其后两页一组；
 * 末尾剩单页也单独成组。例：5 页 → `[[0], [1, 2], [3, 4]]`；6 页 → `[[0], [1, 2], [3, 4], [5]]`。
 *
 * 页数 `<= 0` 返回空数组（调用方据此显示空态）。
 */
export function spreadGroups(count: number, loneFirst: boolean): number[][] {
  const total = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0
  if (total === 0) return []
  const groups: number[][] = []
  let i = 0
  if (loneFirst) {
    groups.push([0])
    i = 1
  }
  for (; i < total; i += 2) {
    groups.push(i + 1 < total ? [i, i + 1] : [i])
  }
  return groups
}

/**
 * 页序所在的跨页组；越界先夹回、无页返回 `null`。
 * `start` = 组内首页序（跨页步进后索引停在组首，便于「同组内的页都指向同一组」）。
 */
export function spreadOfPage(
  index: number,
  count: number,
  loneFirst: boolean,
): { start: number; pages: number[] } | null {
  const current = clampPageIndex(index, count)
  if (current === null) return null
  for (const pages of spreadGroups(count, loneFirst)) {
    if (current >= pages[0] && current <= pages[pages.length - 1]) return { start: pages[0], pages }
  }
  return null
}

/**
 * 相邻跨页组的**首页序**；越界返回 `null`。
 *
 * 与 `pageNeighbor` 同口径：跨页步进（不是按页 ±1），到边界是**无动作**而非原地假成功。
 */
export function spreadNeighbor(
  index: number,
  count: number,
  loneFirst: boolean,
  delta: -1 | 1,
): number | null {
  const found = spreadOfPage(index, count, loneFirst)
  if (found === null) return null
  const groups = spreadGroups(count, loneFirst)
  const at = groups.findIndex((group) => group[0] === found.start)
  const target = at + delta
  if (target < 0 || target >= groups.length) return null
  return groups[target][0]
}

/**
 * 跨页的**视觉槽位**（左 → 右，定长 2）；`null` 表示该侧留空。
 *
 * - 双页：`ltr` 较早页在左、`rtl` 较早页在右（整体镜像）；
 * - 单页（封面 / 末尾落单）：落在「先读到的一侧」——`ltr` 靠左、`rtl` 靠右。
 *
 * 定长 2 是为了给单页那侧一个**显式占位**：单页应站在它本来的位置上，而不是被居中。
 */
export function spreadSlots(pages: number[], direction: ReadingDirection): (number | null)[] {
  if (pages.length === 0) return [null, null]
  if (pages.length === 1) return direction === 'ltr' ? [pages[0], null] : [null, pages[0]]
  const [first, second] = pages
  return direction === 'ltr' ? [first, second] : [second, first]
}
