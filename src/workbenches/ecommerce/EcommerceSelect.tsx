import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './EcommerceSelect.module.css'

export interface EcommerceSelectOption {
  value: string
  label: string
  icon?: ReactNode
  disabled?: boolean
}

interface EcommerceSelectProps {
  ariaLabel: string
  value: string
  options: readonly EcommerceSelectOption[]
  onChange: (value: string) => void
  name: string
  disabled?: boolean
  placeholder?: string
  menuMinWidth?: number
  dataAttributes?: Record<string, string | number | boolean | undefined>
}

interface MenuPosition {
  left: number
  top?: number
  bottom?: number
  width: number
  maxHeight: number
}

const POPUP_GAP = 6
const POPUP_EDGE = 12
const POPUP_MAX_HEIGHT = 420

export function EcommerceSelect({
  ariaLabel,
  value,
  options,
  onChange,
  name,
  disabled = false,
  placeholder = '',
  menuMinWidth = 220,
  dataAttributes,
}: EcommerceSelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<MenuPosition | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()
  const current = options.find((option) => option.value === value)

  const selectedIndex = options.findIndex(
    (option) => option.value === value && !option.disabled,
  )

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight
    const width = Math.min(Math.max(rect.width, menuMinWidth), viewportW - POPUP_EDGE * 2)
    const below = viewportH - rect.bottom - POPUP_EDGE - POPUP_GAP
    const above = rect.top - POPUP_EDGE - POPUP_GAP
    const placementBelow = below >= Math.min(POPUP_MAX_HEIGHT, 180) || below >= above
    const available = Math.max(72, placementBelow ? below : above)
    const left = Math.max(
      POPUP_EDGE,
      Math.min(rect.left, viewportW - width - POPUP_EDGE),
    )
    setPosition({
      left,
      width,
      maxHeight: Math.min(POPUP_MAX_HEIGHT, available),
      ...(placementBelow
        ? { top: rect.bottom + POPUP_GAP }
        : { bottom: viewportH - rect.top + POPUP_GAP }),
    })
  }, [menuMinWidth])

  const openMenu = useCallback(() => {
    if (disabled || options.length === 0) return
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }, [disabled, options.length, selectedIndex])

  const closeMenu = useCallback(
    (restoreFocus = false) => {
      setOpen(false)
      setActiveIndex(-1)
      if (restoreFocus) triggerRef.current?.focus()
    },
    [],
  )

  const choose = useCallback(
    (index: number) => {
      const option = options[index]
      if (!option || option.disabled) return
      onChange(option.value)
      closeMenu(true)
    },
    [closeMenu, onChange, options],
  )

  useLayoutEffect(() => {
    if (!open) return
    updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu()
    }
    const onViewportChange = () => updatePosition()
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [closeMenu, open, updatePosition])

  useEffect(() => {
    if (disabled && open) closeMenu()
  }, [closeMenu, disabled, open])

  const moveActive = (direction: 1 | -1) => {
    if (options.length === 0) return
    let next = activeIndex
    for (let step = 0; step < options.length; step += 1) {
      next = (next + direction + options.length) % options.length
      if (!options[next]?.disabled) {
        setActiveIndex(next)
        return
      }
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        openMenu()
      }
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeMenu(true)
      return
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveActive(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveActive(-1)
      return
    }
    if (event.key === 'Home') {
      event.preventDefault()
      const first = options.findIndex((option) => !option.disabled)
      if (first >= 0) setActiveIndex(first)
      return
    }
    if (event.key === 'End') {
      event.preventDefault()
      for (let index = options.length - 1; index >= 0; index -= 1) {
        if (!options[index]?.disabled) {
          setActiveIndex(index)
          break
        }
      }
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(activeIndex)
    }
  }

  const menu =
    open && position ? (
      <div
        ref={menuRef}
        id={listboxId}
        className={styles.menu}
        role="listbox"
        aria-label={ariaLabel}
        data-ecommerce-menu={name}
        style={{
          left: position.left,
          top: position.top,
          bottom: position.bottom,
          width: position.width,
          maxHeight: position.maxHeight,
        }}
      >
        {options.map((option, index) => {
          const selected = option.value === value
          const active = index === activeIndex
          return (
            <button
              key={`${option.value}\u0000${index}`}
              id={`${listboxId}-option-${index}`}
              type="button"
              role="option"
              aria-selected={selected}
              className={[
                styles.option,
                selected ? styles.optionSelected : '',
                active ? styles.optionActive : '',
              ]
                .filter(Boolean)
                .join(' ')}
              data-ecommerce-select-option={option.value}
              data-ecommerce-select-option-on={selected ? 'true' : undefined}
              disabled={option.disabled}
              onPointerEnter={() => {
                if (!option.disabled) setActiveIndex(index)
              }}
              onClick={() => choose(index)}
            >
              {option.icon ? <span className={styles.optionIcon}>{option.icon}</span> : null}
              <span className={styles.optionLabel}>{option.label}</span>
              {selected ? (
                <svg
                  className={styles.check}
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="m3.2 8.2 3.1 3.1 6.5-6.6" />
                </svg>
              ) : null}
            </button>
          )
        })}
      </div>
    ) : null

  return (
    <span className={styles.wrap} data-ecommerce-select={name}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={
          open && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
        }
        data-value={value}
        disabled={disabled}
        onClick={() => {
          if (open) closeMenu()
          else openMenu()
        }}
        onKeyDown={onKeyDown}
        {...dataAttributes}
      >
        {current?.icon ? <span className={styles.currentIcon}>{current.icon}</span> : null}
        <span className={styles.currentLabel}>{current?.label ?? placeholder}</span>
        <svg
          className={styles.chevron}
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {menu && typeof document !== 'undefined' ? createPortal(menu, document.body) : null}
    </span>
  )
}
