import { useEffect, type MouseEvent as ReactMouseEvent } from 'react'
import { useSyncExternalStore } from 'react'
import { useCanvasStore, useUndoBar } from '../storeContext'
import styles from './UndoBar.module.css'

/**
 * 撤销条（§6.12「底部撤销条保留 6 秒」）。
 * 删除等可撤销操作后弹出，提供「撤销 / 重做」入口；6s 后自动消失。
 * 点击「撤销 / 重做」后条保留至计时结束，便于紧接着反向操作。
 *
 * 用 role=status + aria-live=polite 播报（产品文档 §4.5「动态播报」）。
 * 无投影、1px 细描边、8px 圆角（与画布其余浮层一致，§3 / §4.2）。
 */
const keepCanvasFocus = { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() }

export function UndoBar() {
  const store = useCanvasStore()
  const undoBar = useUndoBar()
  const canUndo = useSyncExternalStore(store.subscribe, store.canUndo, store.canUndo)
  const canRedo = useSyncExternalStore(store.subscribe, store.canRedo, store.canRedo)

  useEffect(() => {
    if (!undoBar) return
    const t = setTimeout(() => store.clearUndoBar(undoBar.id), 6000)
    return () => clearTimeout(t)
  }, [undoBar, store])

  if (!undoBar) return null

  return (
    <div className={styles.bar} role="status" aria-live="polite" data-undo-bar>
      <span className={styles.text}>{undoBar.text}</span>
      <button
        className={styles.btn}
        onClick={() => store.undo()}
        disabled={!canUndo}
        {...keepCanvasFocus}
      >
        撤销
      </button>
      <button
        className={styles.btn}
        onClick={() => store.redo()}
        disabled={!canRedo}
        {...keepCanvasFocus}
      >
        重做
      </button>
    </div>
  )
}
