/**
 * Global scrollbar activity flag.
 *
 * Scroll events do not bubble. Capture mode lets one lightweight listener
 * cover page scrollers and nested panels without attaching per component.
 */
export const SCROLL_ACTIVITY_IDLE_MS = 1000

type ScrollActivityRoot = {
  dataset: Record<string, string | undefined>
}

type ScrollActivityTarget = {
  addEventListener: (
    type: string,
    listener: EventListener,
    options?: boolean | AddEventListenerOptions,
  ) => void
  removeEventListener: (
    type: string,
    listener: EventListener,
    options?: boolean | EventListenerOptions,
  ) => void
}

export function installScrollActivity({
  root = document.documentElement,
  target = document,
  idleMs = SCROLL_ACTIVITY_IDLE_MS,
}: {
  root?: ScrollActivityRoot
  target?: ScrollActivityTarget
  idleMs?: number
} = {}): () => void {
  let active = false
  let timer: ReturnType<typeof setTimeout> | null = null

  root.dataset.scrollActive = 'false'
  const listenerOptions: AddEventListenerOptions = { capture: true, passive: true }

  const onScroll: EventListener = () => {
    if (!active) {
      active = true
      root.dataset.scrollActive = 'true'
    }
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      active = false
      timer = null
      root.dataset.scrollActive = 'false'
    }, idleMs)
  }

  target.addEventListener('scroll', onScroll, listenerOptions)

  return () => {
    target.removeEventListener('scroll', onScroll, listenerOptions)
    if (timer !== null) clearTimeout(timer)
    timer = null
    active = false
    root.dataset.scrollActive = 'false'
  }
}
