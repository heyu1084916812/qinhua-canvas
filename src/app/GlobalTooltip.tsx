import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import styles from './GlobalTooltip.module.css'

const SHOW_DELAY_MS = 160
const VIEWPORT_GAP = 8

interface TooltipState {
  text: string
  source: HTMLElement
  sourceRect: DOMRect
}

function tooltipTextOf(element: HTMLElement): string {
  return (
    element.dataset.tooltip?.trim() ||
    element.getAttribute('title')?.trim() ||
    ''
  )
}

function hideSourceText(element: HTMLElement): void {
  const text = tooltipTextOf(element)
  if (!text) return
  element.dataset.globalTooltipText = text
  if (element.hasAttribute('title')) {
    element.dataset.globalTooltipHadTitle = 'true'
    element.removeAttribute('title')
  }
  if (
    !element.hasAttribute('aria-label') &&
    !element.hasAttribute('aria-labelledby')
  ) {
    element.dataset.globalTooltipHadAria = 'true'
    element.setAttribute('aria-label', text)
  }
}

function restoreSourceText(element: HTMLElement): void {
  const text = element.dataset.globalTooltipText
  if (!text) return
  if (element.dataset.globalTooltipHadTitle === 'true') {
    element.setAttribute('title', text)
  }
  if (element.dataset.globalTooltipHadAria === 'true') {
    element.removeAttribute('aria-label')
  }
  delete element.dataset.globalTooltipText
  delete element.dataset.globalTooltipHadTitle
  delete element.dataset.globalTooltipHadAria
}

export function GlobalTooltip() {
  const [tooltip, setTooltip] = useState<TooltipState | null>(null)
  const [position, setPosition] = useState({ left: 0, top: 0, ready: false })
  const activeSourceRef = useRef<HTMLElement | null>(null)
  const showTimerRef = useRef<number | null>(null)
  const tooltipRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current !== null) {
        window.clearTimeout(showTimerRef.current)
        showTimerRef.current = null
      }
    }

    const hide = (restore = true) => {
      clearShowTimer()
      const active = activeSourceRef.current
      if (active && restore) restoreSourceText(active)
      activeSourceRef.current = null
      setTooltip(null)
      setPosition({ left: 0, top: 0, ready: false })
    }

    const sourceOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof Element)) return null
      const source = target.closest<HTMLElement>('[title], [data-tooltip]')
      if (!source || source.closest('[data-global-tooltip-ignore]')) return null
      return tooltipTextOf(source) ? source : null
    }

    const show = (source: HTMLElement, delay: number) => {
      if (activeSourceRef.current === source) return
      hide()
      clearShowTimer()
      showTimerRef.current = window.setTimeout(() => {
        hideSourceText(source)
        activeSourceRef.current = source
        const text = source.dataset.globalTooltipText ?? ''
        if (!text) return
        setTooltip({
          text,
          source,
          sourceRect: source.getBoundingClientRect(),
        })
      }, delay)
    }

    const onPointerOver = (event: PointerEvent) => {
      const source = sourceOf(event.target)
      if (source) show(source, SHOW_DELAY_MS)
    }
    const onPointerOut = (event: PointerEvent) => {
      const active = activeSourceRef.current
      if (!active) return
      const next = event.relatedTarget
      if (next instanceof Node && active.contains(next)) return
      hide()
    }
    const onFocusIn = (event: FocusEvent) => {
      const source = sourceOf(event.target)
      if (source) show(source, 0)
    }
    const onFocusOut = (event: FocusEvent) => {
      const active = activeSourceRef.current
      const next = event.relatedTarget
      if (active && next instanceof Node && active.contains(next)) return
      hide()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide()
    }
    const onViewportChange = () => hide()

    document.addEventListener('pointerover', onPointerOver, true)
    document.addEventListener('pointerout', onPointerOut, true)
    document.addEventListener('focusin', onFocusIn, true)
    document.addEventListener('focusout', onFocusOut, true)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)

    return () => {
      clearShowTimer()
      if (activeSourceRef.current) restoreSourceText(activeSourceRef.current)
      document.removeEventListener('pointerover', onPointerOver, true)
      document.removeEventListener('pointerout', onPointerOut, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [])

  useLayoutEffect(() => {
    if (!tooltip || !tooltipRef.current) return
    const { sourceRect } = tooltip
    const rect = tooltipRef.current.getBoundingClientRect()
    const centered = sourceRect.left + sourceRect.width / 2 - rect.width / 2
    const left = Math.min(
      Math.max(VIEWPORT_GAP, centered),
      Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP),
    )
    const above = sourceRect.top - rect.height - VIEWPORT_GAP
    const top =
      above >= VIEWPORT_GAP
        ? above
        : Math.min(
            sourceRect.bottom + VIEWPORT_GAP,
            window.innerHeight - rect.height - VIEWPORT_GAP,
          )
    setPosition({ left, top, ready: true })
  }, [tooltip])

  if (!tooltip) return null
  return createPortal(
    <div
      ref={tooltipRef}
      id="global-tooltip"
      className={styles.tooltip}
      role="tooltip"
      data-global-tooltip
      style={{
        left: position.left,
        top: position.top,
        opacity: position.ready ? 1 : 0,
      }}
    >
      {tooltip.text}
    </div>,
    document.body,
  )
}
