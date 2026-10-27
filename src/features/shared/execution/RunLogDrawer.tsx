import { useEffect } from 'react'
import { RunLogList, type RunLogFilter } from './RunLogList'
import styles from './RunLogDrawer.module.css'

export function RunLogDrawer({
  title,
  filter,
  onClose,
}: {
  title: string
  filter: RunLogFilter
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className={styles.scrim}
      role="presentation"
      data-run-log-drawer
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside className={styles.drawer} role="dialog" aria-modal="true" aria-label={title}>
        <header className={styles.head}>
          <strong>{title}</strong>
          <button type="button" onClick={onClose} aria-label="关闭日志">
            关闭
          </button>
        </header>
        <div className={styles.body}>
          <RunLogList filter={filter} />
        </div>
      </aside>
    </div>
  )
}
