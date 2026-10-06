/**
 * 应用壳左侧栏的**纯 UI 态**（架构文档 §5.10）。
 *
 * ## 两个来源，一个宽度（用户 2026-10-06 改的口径）
 *
 * - **常驻 `pinned`**：顶部折叠按钮按下去的那个"锁定"。**落盘、跨重启记住**。
 *   用户原话：「折叠按钮只是控制他是否常驻折叠或者展开」。
 * - **悬停 `hovering`**：鼠标在侧栏上时临时展开。**不落盘** ——
 *   那是"顺手看一眼"，重启后不该还开着。
 *
 * 于是 **展开 = `pinned || hovering`**；宽度是**派生的**，不单独存
 * （两个真相源迟早不一致）。**默认仍是收起**（用户没表过态时不该替他打开）。
 *
 * ⚠️ 旧口径「不记忆上次状态，刷新回到收起态」已被上面这条**取代**：
 * 现在记的是"用户锁没锁"，不是"上一次偶然是不是开着"。产品文档 §2.2 同步改了。
 *
 * ## 为什么不进 store / 命令层
 *
 * 它是「这块地方现在多宽」，跟业务数据没有半点关系：不进 store，因为 store 里的每一片
 * 都要被持久化、被撤销栈、被跨标签同步审视，而它三样都不需要 —— 放进去只会让
 * 「改宽度」和「改节点」享受同等待遇，那是把两件毫不相干的事混成一件。
 * 所以它就是一个模块级的订阅值：与 `ui/theme` 同一套路子（外部 store + 订阅）。
 */

/** 收起 / 展开两态。宽度是**派生的**，不单独存 —— 两个真相源迟早不一致。 */
export type SidebarOpen = boolean

/** 收起态宽度（px）。只够放一列图标。 */
export const SIDEBAR_COLLAPSED_W = 64
/** 展开态宽度（px）。够放图标 + 文字 + 「最近项目」列表。 */
export const SIDEBAR_EXPANDED_W = 240

/**
 * 悬停展开的延迟（ms）。
 *
 * **为什么要延迟，而不是"悬停立刻展开"**（用户 2026-10-06：「我想要顺滑的体验」）：
 * 鼠标横扫过侧栏（比如从左边栏滑向画布）会连续触发 enter/leave，
 * 0 延迟会让侧栏**一闪一合**，比"慢一点"难看得多。100ms 足够滤掉"路过"。
 */
export const SIDEBAR_HOVER_IN_MS = 100

/**
 * 悬停收起的延迟（ms）。
 *
 * 刻意**比展开长**：手抖、短暂移开去点别处再回来，不该让刚展开的侧栏又收回去。
 * 「短进长出」是这类抽屉的通行手感（进要快、退要留余地）。
 */
export const SIDEBAR_HOVER_OUT_MS = 220

/** 「常驻展开」的落盘键。与 `ui/theme` 的 `flow:` 前缀同族，避免和无主字符串撞车。 */
export const SIDEBAR_PIN_STORAGE_KEY = 'flow:sidebar-pinned'

const listeners = new Set<() => void>()

/**
 * 读落盘的常驻态。**读不到就当没锁**（隐私模式、SSR、测试环境都可能没有 localStorage）——
 * 这类"环境没有存储"不是错误，不该让侧栏挂掉。
 */
function readPinned(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_PIN_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function writePinned(next: boolean): void {
  try {
    globalThis.localStorage?.setItem(SIDEBAR_PIN_STORAGE_KEY, next ? '1' : '0')
  } catch {
    /* 忽略：存不下就只是"下次不记得"，不影响这次的使用 */
  }
}

/** 是否**常驻展开**（用户锁定的）。落盘。 */
let pinned: SidebarOpen = readPinned()
/** 鼠标是否停在侧栏上（临时）。不落盘。 */
let hovering = false

function notify(): void {
  for (const fn of listeners) fn()
}

export function getSidebarPinned(): SidebarOpen {
  return pinned
}

export function getSidebarHovering(): SidebarOpen {
  return hovering
}

/** 当前是否展开 = 常驻或悬停。**这就是唯一的"现在多宽"的判据。** */
export function getSidebarOpen(): SidebarOpen {
  return pinned || hovering
}

/** 悬停进出（延迟由调用方按 `SIDEBAR_HOVER_*_MS` 负责）。 */
export function setSidebarHovering(next: SidebarOpen): void {
  if (hovering === next) return
  hovering = next
  notify()
}

/** 直接设定常驻态（按钮用 `toggleSidebarPin`；这里给"明确要设成某态"的调用方/测试）。 */
export function setSidebarPinned(next: SidebarOpen): void {
  if (pinned === next) return
  pinned = next
  writePinned(next)
  notify()
}

/** 常驻 / 不常驻来回切（侧栏顶部那个按钮用）。 */
export function toggleSidebarPin(): void {
  setSidebarPinned(!pinned)
}

export function subscribeSidebar(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** 当前侧栏占宽（px）。`AppShell` 用它给右侧工作区让位。 */
export function sidebarWidth(openState: SidebarOpen = getSidebarOpen()): number {
  return openState ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W
}

/**
 * 仅供测试：把状态复位成「收起 + 未锁定」，并**清掉落盘的那一条**。
 *
 * 为什么需要它：模块级状态会**跨测试用例存活**，一个用例展开了侧栏，
 * 下一个用例起手就不是收起态 —— 那种「单独跑绿、连着跑红」最难查。
 * 落盘值同理：一个用例锁过之后，下一个用例会从 localStorage 读回 `true`。
 * 刻意不做成「生产代码里的 reset」：生产里没有「重置侧栏」这个动作，
 * 加一个只给测试用的公开 API 会让人以为它是个功能。
 */
export function __resetSidebarForTest(): void {
  pinned = false
  hovering = false
  try {
    globalThis.localStorage?.removeItem(SIDEBAR_PIN_STORAGE_KEY)
  } catch {
    /* 忽略 */
  }
  notify()
}
