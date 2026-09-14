/**
 * 版式切割树：几何计算 + 树编辑（M6-3，纯函数）。
 *
 * 与 `readingOrder.ts` 的分工：
 *   - `readingOrder.ts` 回答「按什么顺序读」（顺序问题，与几何无关）；
 *   - 本模块回答「每个格在页面上占哪块」（几何问题）+「如何切割/删除」（编辑问题）。
 *
 * **几何口径（务必与阅读顺序模块分开理解）**：
 *   - `h` 切 = 横切 = **上下分行** → 在 y 轴累加偏移（行序恒「上→下」，与阅读方向无关）；
 *   - `v` 切 = 竖切 = **左右分列** → 在 x 轴累加偏移（`children[0]` 恒为**最左**列）。
 *   RTL 只翻转「阅读顺序」（`readingOrder.ts`），**不翻转几何**——位置是画出来的，
 *   顺序是读出来的，两者解耦。这样编辑器只按几何顺序追加子节点即可。
 *
 * **坐标口径**：输出 0..1 的**页内相对矩形**（左上原点），与页尺寸解耦——
 * 页比例是渲染层的事（领域层不引入页尺寸字段，见模型文件头）。
 *
 * **`count` 字段的口径**：几何计算一律以 `children.length` 为准，`count` 只作切割
 * 时的「等分条数」记录（冗余信息）。这样任何对 children 的编辑都不会与 `count`
 * 打架——否则要维护两处一致性，是 bug 温床。
 *
 * 纯数据结构 + 纯函数，不含 React / platform / 持久化（架构 §2.2 domain 纯度约束）。
 */

import type { CutDirection, CutPosition, LayoutNode } from '../model/comicProject'

/** 页内相对矩形（0..1，左上原点；与页尺寸解耦） */
export interface LayoutRect {
  panelId: string
  x: number
  y: number
  w: number
  h: number
}

// ─────────────────────────────────────────────────────────────
// 几何
// ─────────────────────────────────────────────────────────────

/**
 * 求一个切割节点各子块的**比例**（和为 1）。
 *
 * - `equal`（或子块数 ≠ 2 时的兜底）：等分；
 * - `start` / `center` / `end`（单刀）：两子块按 1/3 : 2/3、1/2 : 1/2、2/3 : 1/3 分。
 *
 * 以 `childCount` 为准而非节点的 `count` 字段——见文件头说明。
 */
export function divisionRatios(childCount: number, position: CutPosition): number[] {
  const n = Math.max(1, childCount)
  if (position === 'equal' || n !== 2) return new Array(n).fill(1 / n)
  const r = position === 'start' ? 1 / 3 : position === 'end' ? 2 / 3 : 1 / 2
  return [r, 1 - r]
}

/**
 * 由切割树算出每格的页内相对矩形（DFS 几何顺序，与 `layoutPanelIds` 同序）。
 *
 * 空树 → 空数组（「尚未排版」，不是「满页单格」——见模型文件头）。
 */
export function layoutRects(nodes: readonly LayoutNode[]): LayoutRect[] {
  const out: LayoutRect[] = []

  const visit = (ns: readonly LayoutNode[], rect: LayoutRect2): void => {
    for (const n of ns) {
      if (n.kind === 'panel') {
        out.push({ panelId: n.panelId, x: rect.x, y: rect.y, w: rect.w, h: rect.h })
        continue
      }
      const ratios = divisionRatios(n.children.length, n.position)
      let offset = 0
      for (let i = 0; i < n.children.length; i++) {
        const r = ratios[i] ?? 0
        const child: LayoutRect2 =
          n.direction === 'h'
            ? { x: rect.x, y: rect.y + rect.h * offset, w: rect.w, h: rect.h * r }
            : { x: rect.x + rect.w * offset, y: rect.y, w: rect.w * r, h: rect.h }
        visit([n.children[i]!], child)
        offset += r
      }
    }
  }

  visit(nodes, { x: 0, y: 0, w: 1, h: 1 })
  return out
}

/** 内部用的纯矩形（无 panelId），避免 `layoutRects` 里反复构造对象 */
interface LayoutRect2 {
  x: number
  y: number
  w: number
  h: number
}

// ─────────────────────────────────────────────────────────────
// 树编辑
// ─────────────────────────────────────────────────────────────

/**
 * 把目标叶子替换成二分切割（`children[0]` 保留原格、`children[1]` 为新兄弟格）。
 *
 * 返回 `null` 表示「目标格不在版式里」——调用方据此返回原快照（不做空写）。
 * 未命中时返回原数组引用，命中时返回新数组（浅层未变的子树保持原引用）。
 *
 * 新兄弟格的 `panelId` 由调用方提供（reducer 负责同步在内容池里建格）——
 * 本模块只管树结构，不碰内容。
 */
export function splitLeaf(
  nodes: readonly LayoutNode[],
  targetPanelId: string,
  direction: CutDirection,
  siblingPanelId: string,
): LayoutNode[] | null {
  let found = false

  const map = (ns: readonly LayoutNode[]): LayoutNode[] => {
    let changed = false
    const next: LayoutNode[] = ns.map((n) => {
      if (n.kind === 'panel') {
        if (n.panelId !== targetPanelId) return n
        found = true
        changed = true
        return {
          kind: 'cut' as const,
          direction,
          position: 'equal' as const,
          count: 2,
          children: [n, { kind: 'panel' as const, panelId: siblingPanelId }],
        }
      }
      const children = map(n.children)
      if (children === n.children) return n
      changed = true
      return { ...n, children }
    })
    return changed ? next : (ns as LayoutNode[])
  }

  const result = map(nodes)
  return found ? result : null
}

/**
 * 从版式中移除某格（**内容仍留在 `page.panels` 池里**，靠 `orphanPanelIds` 可回收）。
 *
 * 顺手**折叠**失去意义的切割：某切割只剩 1 个子块时用该子块替掉切割本身
 * （否则会留下「切一刀只出一格」的退化结构，几何上虽等价，但阅读顺序与后续
 * 切割都会变得难以理解）。
 *
 * 返回 `null` = 目标格不在版式里。
 */
export function removeLeaf(nodes: readonly LayoutNode[], panelId: string): LayoutNode[] | null {
  let found = false

  /** 返回 `null` 表示该子树被移除干净 */
  const prune = (n: LayoutNode): LayoutNode | null => {
    if (n.kind === 'panel') {
      if (n.panelId !== panelId) return n
      found = true
      return null
    }
    let changed = false
    const children: LayoutNode[] = []
    for (const c of n.children) {
      const kept = prune(c)
      if (kept === null) {
        changed = true
        continue
      }
      if (kept !== c) changed = true
      children.push(kept)
    }
    if (children.length === 0) return null
    if (children.length === 1) return children[0]!
    if (!changed) return n
    return { ...n, children, count: Math.max(2, children.length) }
  }

  const out: LayoutNode[] = []
  let changed = false
  for (const n of nodes) {
    const kept = prune(n)
    if (kept === null) {
      changed = true
      continue
    }
    if (kept !== n) changed = true
    out.push(kept)
  }

  if (!found) return null
  return changed ? out : (nodes as LayoutNode[])
}

/**
 * 把空版式实例化成「满页单格」——**这是编辑器的行为，不是领域约定**
 * （见模型文件头：空 `layout` 表示尚未排版，本函数是首次编辑时的落点）。
 */
export function instantiateFullPage(panelId: string): LayoutNode[] {
  return [{ kind: 'panel', panelId }]
}
