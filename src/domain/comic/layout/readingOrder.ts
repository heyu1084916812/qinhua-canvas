/**
 * 版式切割树的遍历与阅读顺序派生（M6-2，纯函数）。
 *
 * **关键设计：版式树是几何结构，阅读顺序由「树 + 阅读方向」共同派生。**
 *
 *   - `h`（横切，上下分行）→ 行序恒为「上 → 下」，**不随方向翻转**（中日漫画皆然）
 *   - `v`（竖切，左右分列）→ 列序在 `ltr` 下「左 → 右」、在 `rtl` 下「右 → 左」
 *
 * 这样编辑器只需按几何顺序追加子节点（`children[0]` = 最左 / 最上），
 * 不必为日漫式排版额外调换 children 顺序——避免一个「必须记得调换」的隐藏约定。
 * 反过来说：`readingOrderOf` 必须显式传阅读方向，不做默认，避免静默产出错序。
 *
 * 依赖方向：本模块 `import type` 模型（类型，运行时擦除），模型 `import` 本模块的
 * `countLayoutPanels`（值）——运行时无环。
 */

import type {
  ComicPage,
  ComicPanel,
  LayoutLeaf,
  LayoutNode,
  ReadingDirection,
} from '../model/comicProject'

/** 深度优先收集版式叶子（几何顺序） */
export function layoutLeaves(nodes: readonly LayoutNode[]): LayoutLeaf[] {
  const out: LayoutLeaf[] = []
  const visit = (ns: readonly LayoutNode[]): void => {
    for (const n of ns) {
      if (n.kind === 'panel') out.push(n)
      else visit(n.children)
    }
  }
  visit(nodes)
  return out
}

/** 版式引用的格 id 序列（几何顺序，与阅读方向无关） */
export function layoutPanelIds(nodes: readonly LayoutNode[]): string[] {
  return layoutLeaves(nodes).map((leaf) => leaf.panelId)
}

/** 版式内的格数（= 叶子数；与方向无关） */
export function countLayoutPanels(nodes: readonly LayoutNode[]): number {
  return layoutLeaves(nodes).length
}

/**
 * 页的阅读顺序（格 id 序列）。
 *
 * 注意：只做「切割顺序 → 阅读顺序」的映射，**不解析池中内容**。
 * 版式树为空时返回空数组（尚未排版，不是「满页单格」——见模型文件头说明）。
 */
export function readingOrderOf(page: ComicPage, direction: ReadingDirection): string[] {
  const out: string[] = []
  const visit = (ns: readonly LayoutNode[]): void => {
    for (const n of ns) {
      if (n.kind === 'panel') {
        out.push(n.panelId)
        continue
      }
      // 竖切在 RTL 下按「右 → 左」读：翻转子序（`children[0]` 恒为最左列）
      const children = n.direction === 'v' && direction === 'rtl' ? [...n.children].reverse() : n.children
      visit(children)
    }
  }
  visit(page.layout)
  return out
}

/**
 * 按阅读顺序取出格内容（版式叶子 → 池查找）。
 * 版式引用了池中不存在的 id 时跳过而非抛错——单格数据损坏不应让整页渲不出来。
 */
export function panelsInReadingOrder(page: ComicPage, direction: ReadingDirection): ComicPanel[] {
  const byId = new Map(page.panels.map((p) => [p.id, p]))
  return readingOrderOf(page, direction)
    .map((id) => byId.get(id))
    .filter((p): p is ComicPanel => p !== undefined)
}

/**
 * 池中未被版式引用的格 id（孤儿）。
 *
 * 这是「删格不丢内容」设计的可验证面：把某格从版式移除后，其内容仍留在池里，
 * 于是此函数会列出它——供后续「回收 / 重新放入版式」用（M6-3）。
 */
export function orphanPanelIds(page: ComicPage): string[] {
  const inLayout = new Set(layoutPanelIds(page.layout))
  return page.panels.filter((p) => !inLayout.has(p.id)).map((p) => p.id)
}
