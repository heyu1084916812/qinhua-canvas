/**
 * 应用壳左侧栏的**纯 UI 态**（架构文档 §5.10）。
 *
 * ## 为什么不进 store / 命令层
 *
 * 它是「这块地方现在多宽」，跟业务数据没有半点关系：
 *  - 不进 store：store 里的每一片都要被持久化、被撤销栈、被跨标签同步审视，
 *    而它三样都不需要。放进去只会让「改宽度」和「改节点」享受同等待遇 ——
 *    那是把两件毫不相干的事混成一件；
 *  - 不进 localStorage：产品文档 §2.2 明写「**不记忆上次状态，刷新回到收起态**」。
 *    持久化属于**故意的功能**，做了反而违背这一条。
 *
 * 所以它就是一个模块级的订阅值：与 `ui/theme` 同一套路子（外部 store + 订阅），
 * 只是**刻意不落盘**。
 */

/** 收起 / 展开两态。宽度是**派生的**，不单独存 —— 两个真相源迟早不一致。 */
export type SidebarOpen = boolean

/** 收起态宽度（px）。只够放一列图标。 */
export const SIDEBAR_COLLAPSED_W = 64
/** 展开态宽度（px）。够放图标 + 文字 + 「最近项目」列表。 */
export const SIDEBAR_EXPANDED_W = 240

const listeners = new Set<() => void>()

/**
 * 当前是否展开。
 *
 * ⚠️ **初始值必须是 `false`（收起）**，这是产品口径而不是实现细节：
 * 刷新回到收起态、把画布让到最大。改这个初值等于改产品行为，
 * 所以它有一条专门的单测钉住。
 */
let open: SidebarOpen = false

export function getSidebarOpen(): SidebarOpen {
  return open
}

export function setSidebarOpen(next: SidebarOpen): void {
  if (open === next) return
  open = next
  for (const fn of listeners) fn()
}

/** 展开 / 收起来回切（侧栏顶部那个按钮用）。 */
export function toggleSidebar(): void {
  setSidebarOpen(!open)
}

export function subscribeSidebar(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 当前侧栏占宽（px）。`AppShell` 用它给右侧工作区让位。 */
export function sidebarWidth(openState: SidebarOpen = open): number {
  return openState ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W
}

/**
 * 仅供测试：把状态复位成「收起」。
 *
 * 为什么需要它：模块级状态会**跨测试用例存活**，一个用例展开了侧栏，
 * 下一个用例起手就不是收起态 —— 那种「单独跑绿、连着跑红」最难查。
 * 刻意不做成「生产代码里的 reset」：生产里没有「重置侧栏」这个动作，
 * 加一个只给测试用的公开 API 会让人以为它是个功能。
 */
export function __resetSidebarForTest(): void {
  setSidebarOpen(false)
}
