/**
 * 素材操作菜单（用户 2026-09-17）：节点自身素材右上角的按钮，点开出「清除 / 替换」。
 *
 * 为什么单独成组件而不是塞进 `Thumb`：
 * - `Thumb` 已经承担了「编号角标 / 小眼睛 / 拖动排序 / 删除」四件事，
 *   再往里加一套「浮层开合 + 点外关闭 + Esc」会让那个组件失去单一职责；
 * - 菜单的**交互**（开合、关闭时机、键盘可达）与素材的**展示**是两件事，
 *   分开后菜单将来也能给集合卡复用。
 *
 * 关闭时机沿用面板的既有口径：**Esc / 点外面**都关，且同一时刻只开一个
 * （由父级持有 `openId` 保证，不在这里各自为政）。
 */
import { useEffect, useRef } from 'react'
import styles from './AssetMenu.module.css'

export interface AssetMenuItem {
  id: string
  label: string
  /** 次级说明（悬停提示） */
  hint: string
  /**
   * 左侧图标（用户 2026-09-18 参考设计：菜单项带图标）。
   * 只认这几个具名图标，而不是让调用方传任意 ReactNode——
   * 图标集合收敛在一处，才不会每个调用点各画一套、粗细与尺寸互不相同。
   */
  icon?: 'save' | 'upload' | 'clear' | 'history'
  onSelect: () => void
}

/** 菜单项图标（14px 线框，与全局图标风格一致） */
function MenuIcon({ name }: { name: AssetMenuItem['icon'] }) {
  if (name === 'save') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 2.2v7.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="m4.8 6.6 3.2 3.2 3.2-3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.5 10.4v1.8a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-1.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'upload') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M8 10.5V2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <path d="M4.8 5.4 8 2.2l3.2 3.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M2.5 10.5v2a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5v-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    )
  }
  if (name === 'history') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.5" />
        <path d="M8 5.2V8l2 1.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (name === 'clear') {
    return (
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  return null
}

export function AssetMenu({
  items,
  onClose,
  anchor,
}: {
  items: readonly AssetMenuItem[]
  onClose: () => void
  /**
   * 展开方向。默认向下——挂在**节点本体的右上角**时，向右展开会顶到节点右边界
   * 被压成竖排的一列字（实测菜单宽 96px 被压到只剩 20px）。
   */
  anchor?: 'right' | 'below'
}) {
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        /**
         * 与面板参数浮层同款：这里也必须 `preventDefault()` 声明「这次 Esc 我吃了」。
         * 否则事件继续冒到 window，被节点跟随栏接走清空选中——
         * 用户只是想收起这个小菜单，结果整个面板没了。
         */
        e.preventDefault()
        onClose()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={wrapRef}
      className={anchor === 'right' ? `${styles.menu} ${styles.right}` : `${styles.menu} ${styles.below}`}
      data-asset-menu
      role="menu"
    >
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          className={styles.item}
          title={it.hint}
          data-asset-menu-item={it.id}
          onClick={(e) => {
            e.stopPropagation()
            onClose()
            it.onSelect()
          }}
        >
          {it.icon && <MenuIcon name={it.icon} />}
          {it.label}
        </button>
      ))}
    </div>
  )
}
