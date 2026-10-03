/**
 * 滚轮该归谁：**可滚动区域优先于画布缩放**。
 *
 * 用户 2026-10-03 报的 bug：「面板如果有多余的地方的话用滚轮无法下拉，而是缩放画布了」。
 * 根因是画布的滚轮监听器（`CanvasSurface`，非 passive 的原生监听）**无条件**
 * `preventDefault()` —— 而 `preventDefault()` 取消的正是「滚到最近的滚动容器」这个默认行为。
 * 于是参数浮层里那列放不下的选项一个都滚不动，画布反倒缩放了。
 *
 * 判据刻意做成**纯函数**（输入是「祖先链的可滚动性快照」而不是 DOM），
 * 这样「哪些情况该让路」能直接单测，不必起浏览器。
 */

/** 祖先链上的一个节点：只保留判定需要的三个事实 */
export interface WheelChainNode {
  /** `getComputedStyle(el).overflowY` 的已解析值 */
  overflowY: string
  /** 内容高度与可视高度（`overflowY` 是 auto/scroll 时，前者大于后者才真能滚） */
  scrollHeight: number
  clientHeight: number
  /**
   * 显式声明「这块自己吃滚轮」（`data-wheel-owner="1"`）。
   *
   * 参数浮层那种**菜单**用得上：菜开着的时候滚轮不该穿到底下的画布去缩放 ——
   * 哪怕这个菜单当前没得滚（选项刚好装得下），缩放也是一件让人莫名其妙的事。
   */
  wheelOwner?: boolean
}

/** 这一个节点是否该把滚轮留在自己身上 */
export function takesWheel(node: WheelChainNode): boolean {
  if (node.wheelOwner) return true
  if (node.overflowY !== 'auto' && node.overflowY !== 'scroll') return false
  /** +1：子像素布局下 `scrollHeight` 可能比 `clientHeight` 大不到 1px */
  return node.scrollHeight > node.clientHeight + 1
}

/** 祖先链上只要有一处真能滚（或声明了自己吃滚轮），滚轮就不归画布 */
export function wheelBelongsToChain(chain: readonly WheelChainNode[]): boolean {
  return chain.some(takesWheel)
}

/**
 * 从事件目标往上采到 `stopAt`（含）为止的快照。
 *
 * 为什么要 `stopAt`：画布根节点之外（`body` / `html`）不该参与判断 ——
 * 页面上万一有个可滚的祖先，也不能让整个画布的滚轮缩放失效。
 *
 * `limit` 是防御性的：事件目标理论上可能在很深的 DOM 里，
 * 走太远既没意义、又要在每次滚轮时多算几次 `getComputedStyle`。
 */
export function wheelChainOf(
  target: EventTarget | null,
  stopAt: Element | null,
  limit = 12,
): WheelChainNode[] {
  const out: WheelChainNode[] = []
  let el: Element | null = target instanceof Element ? target : null
  for (let steps = 0; el && steps < limit; steps += 1) {
    const style = getComputedStyle(el)
    out.push({
      overflowY: style.overflowY,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      wheelOwner: el instanceof HTMLElement && el.dataset.wheelOwner === '1',
    })
    if (el === stopAt) break
    el = el.parentElement
  }
  return out
}
