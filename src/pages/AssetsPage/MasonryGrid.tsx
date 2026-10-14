import {
  Children,
  useEffect,
  isValidElement,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { layoutMasonry, type MasonryLayout } from './masonryLayout'
import styles from './AssetsPage.module.css'

/**
 * 素材网格的**最短列堆砌**容器（对账 #502）。
 *
 * 用户 2026-10-14 第 4 条：「左侧菜单收起来后，有个小bug，有空余的地方」。
 * 根因不是壳层（收起后侧栏 64 / 占位 64 / 工作区 x=64，实测没有横向残留），
 * 而是素材网格的 CSS 多列：放不下的卡片整张挪到下一列 ⇒ 同一组里会出现
 * 「左边三列提前结束、右边还有卡」的大块空洞。这里把它换成按最短列放置。
 *
 * ## 两段式渲染
 *
 * 1. **测量前 / SSR**：容器保持 `.grid` 的 CSS 多列（`columns: 240px`），
 *    卡片包一层 `.masonryItem`。这样首帧有兜底、无 JS 时也读得下去。
 * 2. **测量后**：容器切到 `data-masonry="on"`，卡片绝对定位、由 `left/top` 摆放
 *    （不用 `transform`：它会给卡片菜单的 `position: fixed` 遮罩换包含块，见下面注释），
 *    容器高度由布局结果给出。
 *
 * 为什么用 `ResizeObserver` 而不是只量一次：侧栏展开 / 收起、窗口缩放、
 * 卡片内容变化都会改变容器宽度与卡片高度；只量一次会把布局留在旧列宽上。
 * 观察**容器 + 每个卡片**，任意一个尺寸变了就重排。
 *
 * 为什么 SSR 用 `useEffect`、浏览器用 `useLayoutEffect`：浏览器要在绘制前摆好，
 * 否则会先闪一下多列兜底；SSR 没有 window，用 `useEffect` 避免 React 的警告。
 */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** 与 `.grid` 的 `columns: 240px` / `column-gap: var(--space-5)` 同一口径 */
const MIN_COLUMN_WIDTH = 240
const GAP = 20

function sameLayout(a: MasonryLayout | null, b: MasonryLayout): boolean {
  if (!a) return false
  if (a.columns !== b.columns) return false
  if (Math.abs(a.containerHeight - b.containerHeight) > 0.5) return false
  if (Math.abs(a.columnWidth - b.columnWidth) > 0.5) return false
  if (a.offsets.length !== b.offsets.length) return false
  return a.offsets.every(
    (o, i) =>
      Math.abs(o.x - b.offsets[i]!.x) <= 0.5 && Math.abs(o.y - b.offsets[i]!.y) <= 0.5,
  )
}

export function MasonryGrid({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [layout, setLayout] = useState<MasonryLayout | null>(null)
  const items = Children.toArray(children)
  /** 只认「卡片身份」：选中态变化不该把观察器整个重建 */
  const keySignature = items
    .map((item) => (isValidElement(item) ? String(item.key ?? '') : ''))
    .join('|')
  /**
   * 卡片数变了（筛选 / 切页签）而布局还没重算时，**先退回多列兜底**：
   * 旧布局的 offsets 不够长，硬套会让多出来的卡片没有坐标（`undefined.x` 直接抛，
   * 整页会被卸载 —— G90 在「视频筛选 → 全部」这一步实测踩到）。
   * 退回一帧后 ResizeObserver 会重算，再把 `data-masonry="on"` 接回来。
   */
  const activeLayout = layout && layout.offsets.length === items.length ? layout : null

  useIsomorphicLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return

    let frame = 0
    const measure = () => {
      frame = 0
      const width = el.clientWidth
      if (width <= 0) return
      const heights = Array.from(el.children).map((child) =>
        child.getBoundingClientRect().height,
      )
      const next = layoutMasonry(heights, width, {
        minColumnWidth: MIN_COLUMN_WIDTH,
        gap: GAP,
      })
      setLayout((prev) => (sameLayout(prev, next) ? prev : next))
    }
    const schedule = () => {
      if (frame) return
      frame = requestAnimationFrame(measure)
    }

    schedule()
    const observer = new ResizeObserver(schedule)
    observer.observe(el)
    for (const child of el.children) observer.observe(child)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [keySignature])

  return (
    <div
      ref={ref}
      className={styles.grid}
      data-assets-grid
      data-masonry={activeLayout ? 'on' : 'off'}
      style={activeLayout ? { height: `${activeLayout.containerHeight}px` } : undefined}
    >
      {items.map((item, index) => (
        <div
          key={isValidElement(item) ? (item.key ?? index) : index}
          className={styles.masonryItem}
          data-masonry-item
          style={
            activeLayout
              ? {
                  width: `${activeLayout.columnWidth}px`,
                  /**
                   * ⚠️ **不能用 `transform` 定位**：卡片菜单的遮罩是 `position: fixed`，
                   * 而 transform 会给 fixed 后代换包含块 —— 实测遮罩不再盖视口、
                   * 反过来挡住菜单项，点「取消收藏」永远点不到（G90 抓到）。
                   * 用 left / top 定位没有这个副作用。
                   */
                  left: `${activeLayout.offsets[index]!.x}px`,
                  top: `${activeLayout.offsets[index]!.y}px`,
                }
              : undefined
          }
        >
          {item}
        </div>
      ))}
    </div>
  )
}
