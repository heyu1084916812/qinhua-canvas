import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import styles from './ChoicePicker.module.css'

export interface ChoiceOption {
  value: string
  label: string
  hint?: string
  disabled?: boolean
  group?: string
}

export interface ChoicePickerProps {
  name: string
  value: string
  options: readonly ChoiceOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  disabled?: boolean
  className?: string
  compact?: boolean
  triggerIcon?: ReactNode
  iconOnly?: boolean
  alignEnd?: boolean
}

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function ChoicePicker({
  name,
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '请选择',
  disabled = false,
  className,
  compact = false,
  triggerIcon,
  iconOnly = false,
  alignEnd = false,
}: ChoicePickerProps) {
  const [open, setOpen] = useState(false)
  const [above, setAbove] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const popRef = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.value === value)

  useIsoLayoutEffect(() => {
    if (!open) return
    const wrap = wrapRef.current
    const pop = popRef.current
    if (!wrap || !pop) return
    const anchor = wrap.getBoundingClientRect()
    const menuHeight = pop.getBoundingClientRect().height
    setAbove(
      window.innerHeight - anchor.bottom < menuHeight + 12 &&
        anchor.top > window.innerHeight - anchor.bottom,
    )
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div
      ref={wrapRef}
      className={[styles.wrap, className].filter(Boolean).join(' ')}
      data-choice-picker={name}
      data-choice-value={value}
    >
      <button
        type="button"
        className={[
          styles.trigger,
          compact ? styles.compact : '',
          iconOnly ? styles.iconOnly : '',
          open ? styles.triggerOpen : '',
        ]
          .filter(Boolean)
          .join(' ')}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={iconOnly ? current?.label ?? ariaLabel : undefined}
        onClick={() => setOpen((next) => !next)}
      >
        {iconOnly && triggerIcon ? (
          <span className={styles.triggerIcon}>{triggerIcon}</span>
        ) : (
          <>
            <span className={styles.triggerLabel}>{current?.label ?? placeholder}</span>
            <svg
              className={open ? `${styles.chevron} ${styles.chevronOpen}` : styles.chevron}
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="M3.5 5.25 7 8.75l3.5-3.5" />
            </svg>
          </>
        )}
      </button>
      {open && (
        <div
          ref={popRef}
          className={[
            styles.popup,
            above ? styles.above : styles.below,
            alignEnd ? styles.alignEnd : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="listbox"
          aria-label={ariaLabel}
        >
          {options.map((option, index) => {
            const previousGroup = index > 0 ? options[index - 1]?.group : undefined
            const showGroup = option.group && option.group !== previousGroup
            return (
              <div key={`${option.group ?? ''}:${option.value}`}>
                {showGroup ? <div className={styles.groupLabel}>{option.group}</div> : null}
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={[
                    styles.option,
                    option.value === value ? styles.optionOn : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  data-choice-option={option.value}
                  disabled={option.disabled}
                  onClick={() => {
                    if (option.disabled) return
                    onChange(option.value)
                    setOpen(false)
                  }}
                >
                  <span className={styles.optionText}>
                    <span className={styles.optionLabel}>{option.label}</span>
                    {option.hint ? <span className={styles.optionHint}>{option.hint}</span> : null}
                  </span>
                  {option.value === value ? (
                    <span className={styles.check} aria-hidden>
                      ✓
                    </span>
                  ) : null}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
