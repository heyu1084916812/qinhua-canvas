export interface RafThrottled<A extends unknown[]> {
  (...args: A): void
  cancel(): void
  /** 立即执行帧内待调用的最后一次（松手时补上最后一拍，位置不落后光标） */
  flush(): void
}

/**
 * 指针移动处理统一经 rafThrottle 合帧：同一帧内只计算一次（产品文档 §1.7）
 */
export function rafThrottle<A extends unknown[]>(fn: (...args: A) => void): RafThrottled<A> {
  let frame: number | null = null
  let pending: A | null = null

  const wrapped = ((...args: A) => {
    pending = args
    if (frame !== null) return
    frame = requestAnimationFrame(() => {
      frame = null
      const args2 = pending
      pending = null
      if (args2) fn(...args2)
    })
  }) as RafThrottled<A>

  wrapped.cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    pending = null
  }

  wrapped.flush = () => {
    if (frame === null) return
    cancelAnimationFrame(frame)
    frame = null
    const args2 = pending
    pending = null
    if (args2) fn(...args2)
  }

  return wrapped
}

/**
 * 指针移动合帧统一入口（产品文档 §1.7「指针移动处理使用 rAF 合帧」）。
 * 浏览器：同一帧内只执行最后一次；无 rAF 环境（node 单测的假 window）：
 * 立即同步执行——控制器单测可以像从前一样 dispatch 后直接断言。
 */
export function coalescePointerMove<A extends unknown[]>(fn: (...args: A) => void): RafThrottled<A> {
  if (typeof requestAnimationFrame !== 'function') {
    const immediate = ((...args: A) => fn(...args)) as RafThrottled<A>
    immediate.cancel = () => {}
    immediate.flush = () => {}
    return immediate
  }
  return rafThrottle(fn)
}
