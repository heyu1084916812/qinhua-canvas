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
  onSelect: () => void
}

export function AssetMenu({
  items,
  onClose,
  anchor,
}: {
  items: readonly AssetMenuItem[]
  onClose: () => void
  /** 锚点位置：固定在素材右上角，故由父级定位、这里只认 'top-right' */
  anchor?: 'top-right'
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
      className={anchor === 'top-right' ? `${styles.menu} ${styles.topRight}` : styles.menu}
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
          {it.label}
        </button>
      ))}
    </div>
  )
}
