export const ECOMMERCE_CHANNEL_REMOVED_MESSAGE =
  '渠道已删除，电商生成计划已停止；请重新选择平台后再生成'

export interface EcommercePreflightBoundary {
  interrupt(): void
  isInterrupted(): boolean
  assertActive(): void
  run<T>(operation: () => Promise<T>): Promise<T>
}

/**
 * Covers the async window between channel preflight and runEngine startup.
 * Once interrupted, no later step is allowed to start.
 */
export function createEcommercePreflightBoundary(): EcommercePreflightBoundary {
  let interrupted = false

  const assertActive = () => {
    if (interrupted) throw new Error(ECOMMERCE_CHANNEL_REMOVED_MESSAGE)
  }

  return {
    interrupt() {
      interrupted = true
    },
    isInterrupted() {
      return interrupted
    },
    assertActive,
    async run<T>(operation: () => Promise<T>): Promise<T> {
      assertActive()
      try {
        const result = await operation()
        assertActive()
        return result
      } catch (error) {
        assertActive()
        throw error
      }
    },
  }
}
