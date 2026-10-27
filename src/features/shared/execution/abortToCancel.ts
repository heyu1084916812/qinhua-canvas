/**
 * 把 Agent 等上层调用方的 AbortSignal 接到一次已排好的执行计划。
 *
 * 返回解除绑定的函数；调用方必须放在 finally 里，避免计划结束后监听器仍引用旧 runPlan。
 */
export function bindAbortToCancel(
  signal: AbortSignal | undefined,
  cancel: () => void,
): () => void {
  if (!signal) return () => {}
  if (signal.aborted) {
    cancel()
    return () => {}
  }
  let fired = false
  const onAbort = () => {
    if (fired) return
    fired = true
    cancel()
  }
  signal.addEventListener('abort', onAbort, { once: true })
  return () => signal.removeEventListener('abort', onAbort)
}
