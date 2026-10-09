/**
 * 「新手引导看过没有」——纯本机 UI 态（对账 #388 / E7）。
 *
 * 与主题、外观偏好同族（`flow:*` 命名空间 + localStorage），但只有一位布尔：
 * 引导是一次性的，看完就不再打扰；想再看从「设置 → 帮助」点「重看新手引导」。
 *
 * 为什么不落业务库：它跟项目数据没关系 —— 换一台机器再看到一次引导是**对的**，
 * 那台机器上确实还没有配过渠道。
 *
 * 模块级订阅而不是 React state：AppShell（引导浮层）与设置面板（重看按钮）
 * 是两棵子树，需要一个共同的真值来源。
 */

const KEY = 'flow:onboarded'
/**
 * 空画布"从模板开始"卡片要不要再出现。
 *
 * 为什么不复用 `KEY`：引导模态是**一次性的**（看过就不该再弹），而空画布卡片是
 * **按场景**出现的 —— 用户看过引导之后第一次进空白画布，恰恰最需要它。
 * 两者共用一个标记会自相矛盾：模态关掉的同一刻，卡片也永远不会出现（实测踩到）。
 *
 * 什么时候算"不用再给"：用户在卡片里点过模板（他自己选过了），
 * 或者点过卡片上的关闭。清空画布不再重新推荐 —— 那是老用户在整理，不是在犯难。
 */
const CANVAS_KEY = 'flow:canvasGuideDismissed'

function read(): boolean {
  try {
    return globalThis.localStorage?.getItem(KEY) === '1'
  } catch {
    /* 隐私模式：读不到就当"没看过"，引导会再出现一次 —— 比让应用挂掉好 */
    return false
  }
}

let done = read()
let canvasGuideDismissed = readCanvasGuide()
const listeners = new Set<() => void>()

function readCanvasGuide(): boolean {
  try {
    return globalThis.localStorage?.getItem(CANVAS_KEY) === '1'
  } catch {
    return false
  }
}

function notify(): void {
  for (const fn of listeners) fn()
}

export function isOnboardingDone(): boolean {
  return done
}

export function isCanvasGuideDismissed(): boolean {
  return canvasGuideDismissed
}

/** 用户选过模板 / 主动关掉卡片：以后别再自动出现 */
export function dismissCanvasGuide(): void {
  canvasGuideDismissed = true
  try {
    globalThis.localStorage?.setItem(CANVAS_KEY, '1')
  } catch {
    /* 同上：只影响下次还弹不弹 */
  }
  notify()
}

export function subscribeOnboarding(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** 看完了 / 跳过了：都算"别再自动弹"（跳过是用户的明确选择，不该被反复打扰） */
export function completeOnboarding(): void {
  done = true
  try {
    globalThis.localStorage?.setItem(KEY, '1')
  } catch {
    /* 存不下只影响下次启动会不会再弹，不影响本次使用 */
  }
  notify()
}

/** 「重看新手引导」：把标记清掉，引导立刻回来 */
export function resetOnboarding(): void {
  done = false
  /* 「重看新手引导」= 连同空画布卡片一起恢复（否则用户重看之后仍看不到那三个模板） */
  canvasGuideDismissed = false
  try {
    globalThis.localStorage?.removeItem(KEY)
    globalThis.localStorage?.removeItem(CANVAS_KEY)
  } catch {
    /* 同上 */
  }
  notify()
}
