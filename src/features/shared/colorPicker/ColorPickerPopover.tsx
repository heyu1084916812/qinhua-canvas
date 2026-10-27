import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import {
  HUE_GRADIENT,
  hexToHsv,
  hsvToHex,
  normalizeHex,
  type HsvColor,
} from './colorMath'
import styles from './ColorPickerPopover.module.css'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect
const VIEWPORT_GAP = 8
const PANEL_WIDTH = 300

interface PopoverPosition {
  left: number
  top: number
  maxHeight: number
}

export interface ColorPickerRenderArgs {
  open: boolean
  toggle: () => void
  value: string
}

export interface ColorPickerPopoverProps {
  value: string
  label?: string
  target?: string
  disabled?: boolean
  showName?: boolean
  nameValue?: string
  namePlaceholder?: string
  confirmLabel?: string
  className?: string
  renderTrigger: (args: ColorPickerRenderArgs) => ReactNode
  onNameChange?: (value: string) => void
  onOpenChange?: (open: boolean) => void
  onCommit: (value: string) => void
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function ColorPickerPopover({
  value,
  label = '选择颜色',
  target,
  disabled = false,
  showName = false,
  nameValue = '',
  namePlaceholder = '为颜色命名',
  confirmLabel = '应用',
  className,
  renderTrigger,
  onNameChange,
  onOpenChange,
  onCommit,
}: ColorPickerPopoverProps) {
  const normalizedValue = normalizeHex(value) ?? '#000000'
  const [open, setOpenState] = useState(false)
  const [hsv, setHsv] = useState<HsvColor>(() => hexToHsv(normalizedValue))
  const [hexDraft, setHexDraft] = useState(normalizedValue.slice(1).toUpperCase())
  const [hexInvalid, setHexInvalid] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }

  const draft = hsvToHex(hsv)

  useEffect(() => {
    if (!open) return
    const next = normalizeHex(value) ?? '#000000'
    setHsv(hexToHsv(next))
    setHexDraft(next.slice(1).toUpperCase())
    setHexInvalid(false)
  }, [open, value])

  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => {
      if (showName) nameRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [open, showName])

  useIsoLayoutEffect(() => {
    if (!open) return
    const anchor = anchorRef.current
    const popover = popoverRef.current
    if (!anchor || !popover) return
    const anchorRect = anchor.getBoundingClientRect()
    const popoverRect = popover.getBoundingClientRect()
    const width = popoverRect.width || PANEL_WIDTH
    const height = popoverRect.height || 420
    const roomBelow = window.innerHeight - anchorRect.bottom - VIEWPORT_GAP
    const roomAbove = anchorRect.top - VIEWPORT_GAP
    const below = roomBelow >= height || roomBelow >= roomAbove
    const left = clamp(anchorRect.left, VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP)
    const preferredTop = below ? anchorRect.bottom + 6 : anchorRect.top - height - 6
    const top = clamp(
      preferredTop,
      VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, window.innerHeight - height - VIEWPORT_GAP),
    )
    setPosition({
      left,
      top,
      maxHeight: Math.max(240, window.innerHeight - VIEWPORT_GAP * 2),
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (
        anchorRef.current?.contains(target) ||
        popoverRef.current?.contains(target)
      ) {
        return
      }
      setOpen(false)
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
      }
    }
    const closeOnOutsideScroll = (event: Event) => {
      if (popoverRef.current?.contains(event.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeOnOutsideScroll)
    document.addEventListener('scroll', closeOnOutsideScroll, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeOnOutsideScroll)
      document.removeEventListener('scroll', closeOnOutsideScroll, true)
    }
  }, [open])

  const setFromPoint = (
    event: ReactPointerEvent<HTMLDivElement>,
    target: HTMLDivElement,
    hueLocked = false,
  ) => {
    const rect = target.getBoundingClientRect()
    const saturation = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    const brightness = 1 - clamp((event.clientY - rect.top) / rect.height, 0, 1)
    setHsv((current) => ({
      h: hueLocked ? current.h : current.h,
      s: saturation,
      v: brightness,
    }))
    const next = hsvToHex({ h: hsv.h, s: saturation, v: brightness })
    setHexDraft(next.slice(1).toUpperCase())
    setHexInvalid(false)
  }

  const setHueFromPoint = (
    event: ReactPointerEvent<HTMLDivElement>,
    target: HTMLDivElement,
  ) => {
    const rect = target.getBoundingClientRect()
    const hue = clamp((event.clientX - rect.left) / rect.width, 0, 1) * 359.999
    setHsv((current) => ({ ...current, h: hue }))
    const next = hsvToHex({ h: hue, s: hsv.s, v: hsv.v })
    setHexDraft(next.slice(1).toUpperCase())
    setHexInvalid(false)
  }

  const commit = () => {
    const next = normalizeHex(`#${hexDraft}`)
    if (!next) {
      setHexInvalid(true)
      return
    }
    onCommit(next)
    setOpen(false)
  }

  const onSatKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    let next = hsv
    if (event.key === 'ArrowLeft') next = { ...hsv, s: clamp(hsv.s - step, 0, 1) }
    else if (event.key === 'ArrowRight') next = { ...hsv, s: clamp(hsv.s + step, 0, 1) }
    else if (event.key === 'ArrowUp') next = { ...hsv, v: clamp(hsv.v + step, 0, 1) }
    else if (event.key === 'ArrowDown') next = { ...hsv, v: clamp(hsv.v - step, 0, 1) }
    else return
    event.preventDefault()
    setHsv(next)
    const hex = hsvToHex(next)
    setHexDraft(hex.slice(1).toUpperCase())
    setHexInvalid(false)
  }

  const onHueKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowRight' ? 1 : -1
    const next = { ...hsv, h: (hsv.h + direction * (event.shiftKey ? 10 : 2) + 360) % 360 }
    setHsv(next)
    const hex = hsvToHex(next)
    setHexDraft(hex.slice(1).toUpperCase())
    setHexInvalid(false)
  }

  const saturationStyle: CSSProperties = {
    background: `linear-gradient(to top, #000000, transparent), linear-gradient(to right, #ffffff, hsl(${hsv.h} 100% 50%))`,
  }
  const hueStyle: CSSProperties = { background: HUE_GRADIENT }
  const popoverStyle: CSSProperties | undefined = position
    ? {
        left: position.left,
        top: position.top,
        maxHeight: position.maxHeight,
      }
    : { left: 0, top: 0, visibility: 'hidden' }

  return (
    <span className={[styles.anchor, className].filter(Boolean).join(' ')} ref={anchorRef}>
      {renderTrigger({
        open,
        value: normalizedValue,
        toggle: () => {
          if (!disabled) setOpen(!open)
        },
      })}
      {open
        ? createPortal(
            <div
              ref={popoverRef}
              className={styles.popover}
              style={popoverStyle}
              role="dialog"
              aria-label={label}
              data-color-picker-popover
              data-color-picker-target={target}
            >
              {showName ? (
                <input
                  ref={nameRef}
                  className={styles.nameInput}
                  value={nameValue}
                  placeholder={namePlaceholder}
                  aria-label={namePlaceholder}
                  data-color-name-input
                  onChange={(event) => onNameChange?.(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commit()
                  }}
                />
              ) : null}

              <div
                className={styles.saturation}
                style={saturationStyle}
                role="slider"
                tabIndex={0}
                aria-label="饱和度和亮度"
                aria-valuetext={`饱和度 ${Math.round(hsv.s * 100)}%，亮度 ${Math.round(hsv.v * 100)}%`}
                onKeyDown={onSatKeyDown}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setFromPoint(event, event.currentTarget)
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                  setFromPoint(event, event.currentTarget)
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
              >
                <span
                  className={styles.saturationKnob}
                  style={{
                    left: `${hsv.s * 100}%`,
                    top: `${(1 - hsv.v) * 100}%`,
                    background: draft,
                  }}
                />
              </div>

              <div
                className={styles.hue}
                style={hueStyle}
                role="slider"
                tabIndex={0}
                aria-label="色相"
                aria-valuemin={0}
                aria-valuemax={359}
                aria-valuenow={Math.round(hsv.h)}
                onKeyDown={onHueKeyDown}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setHueFromPoint(event, event.currentTarget)
                }}
                onPointerMove={(event) => {
                  if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
                  setHueFromPoint(event, event.currentTarget)
                }}
                onPointerUp={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                    event.currentTarget.releasePointerCapture(event.pointerId)
                  }
                }}
              >
                <span
                  className={styles.hueKnob}
                  style={{ left: `${(hsv.h / 360) * 100}%` }}
                />
              </div>

              <div className={styles.hexRow}>
                <span className={styles.preview} style={{ background: draft }} aria-hidden />
                <label className={hexInvalid ? `${styles.hexField} ${styles.hexInvalid}` : styles.hexField}>
                  <span aria-hidden>#</span>
                  <input
                    value={hexDraft}
                    maxLength={6}
                    spellCheck={false}
                    autoComplete="off"
                    aria-label="HEX 色值"
                    aria-invalid={hexInvalid}
                    data-color-hex-input
                    onChange={(event) => {
                      const next = event.target.value
                        .replace(/[^0-9a-f]/gi, '')
                        .slice(0, 6)
                        .toUpperCase()
                      setHexDraft(next)
                      const normalized = normalizeHex(`#${next}`)
                      setHexInvalid(false)
                      if (normalized) setHsv(hexToHsv(normalized))
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commit()
                    }}
                  />
                </label>
              </div>
              {hexInvalid ? (
                <p className={styles.error} role="alert">
                  请输入 3 位或 6 位十六进制色值
                </p>
              ) : null}

              <div className={styles.actions}>
                <button type="button" className={styles.cancel} onClick={() => setOpen(false)}>
                  取消
                </button>
                <button
                  type="button"
                  className={styles.confirm}
                  data-color-confirm
                  onClick={commit}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </span>
  )
}
