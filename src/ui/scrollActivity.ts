/**
 * Per-scroller activity flags.
 *
 * Scroll events do not bubble, so a capture listener can observe every nested
 * scroller. The flag must still live on the element that actually scrolled:
 * one global flag makes an unrelated panel light up its scrollbar at the same
 * time.
 */
export const SCROLL_ACTIVITY_IDLE_MS = 1000

type ScrollActivityElement = {
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
  root?: ScrollActivityElement
  target?: ScrollActivityTarget
  idleMs?: number
} = {}): () => void {
  const timers = new WeakMap<ScrollActivityElement, ReturnType<typeof setTimeout>>()
  const touched = new Set<ScrollActivityElement>()

  root.dataset.scrollActive = 'false'
  const listenerOptions: AddEventListenerOptions = { capture: true, passive: true }

  const elementFor = (event: Event): ScrollActivityElement => {
    const candidate = event.target
    if (
      candidate &&
      typeof candidate === 'object' &&
      'dataset' in candidate &&
      candidate.dataset
    ) {
      return candidate as ScrollActivityElement
    }
    return root
  }

  const onScroll: EventListener = (event) => {
    const element = elementFor(event)
    touched.add(element)
    element.dataset.scrollActive = 'true'
    const previous = timers.get(element)
    if (previous !== undefined) clearTimeout(previous)
    const timer = setTimeout(() => {
      element.dataset.scrollActive = 'false'
      timers.delete(element)
    }, idleMs)
    timers.set(element, timer)
  }

  target.addEventListener('scroll', onScroll, listenerOptions)

  return () => {
    target.removeEventListener('scroll', onScroll, listenerOptions)
    for (const element of touched) {
      const timer = timers.get(element)
      if (timer !== undefined) clearTimeout(timer)
      element.dataset.scrollActive = 'false'
    }
    touched.clear()
    root.dataset.scrollActive = 'false'
  }
}
