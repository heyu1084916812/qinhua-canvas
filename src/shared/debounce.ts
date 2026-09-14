export interface Debounced<A extends unknown[]> {
  (...args: A): void
  cancel(): void
  /** 立即执行挂起的调用（离开页面前强制 flush） */
  flush(): void
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, waitMs: number): Debounced<A> {
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const wrapped = ((...args: A) => {
    pending = args
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      const args2 = pending
      pending = null
      if (args2) fn(...args2)
    }, waitMs)
  }) as Debounced<A>

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
  }

  wrapped.flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    const args2 = pending
    pending = null
    if (args2) fn(...args2)
  }

  return wrapped
}
