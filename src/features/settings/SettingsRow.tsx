import type { ReactNode } from 'react'
import styles from './SettingsRow.module.css'

interface SettingsRowProps {
  label: ReactNode
  description?: ReactNode
  control?: ReactNode
  className?: string
  align?: 'start' | 'center'
}

export function SettingsRow({
  label,
  description,
  control,
  className,
  align = description ? 'start' : 'center',
}: SettingsRowProps) {
  return (
    <div
      className={[styles.row, align === 'start' ? styles.alignStart : '', className]
        .filter(Boolean)
        .join(' ')}
      data-settings-row
    >
      <div className={styles.copy}>
        <div className={styles.rowLabel} data-settings-row-label>
          {label}
        </div>
        {description ? (
          <div className={styles.description} data-settings-row-description>
            {description}
          </div>
        ) : null}
      </div>
      {control ? (
        <div className={styles.control} data-settings-row-control>
          {control}
        </div>
      ) : null}
    </div>
  )
}
