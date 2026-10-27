/**
 * 同一会话的活动回合锁。
 *
 * 放在组件外，是因为画布页按 projectId 卸载重挂；锁若跟着组件销毁，
 * 旧异步回合仍在跑、新面板却会认为会话空闲并启动第二次调用。
 */
const activeSessions = new Map<string, { startedAt: number; queueTurnId?: string }>()
const autoDrainSessions = new Set<string>()
const releaseListeners = new Set<(sessionId: string) => void>()

export function claimSessionActivity(sessionId: string, queueTurnId?: string): boolean {
  if (activeSessions.has(sessionId)) return false
  activeSessions.set(sessionId, {
    startedAt: Date.now(),
    ...(queueTurnId ? { queueTurnId } : {}),
  })
  return true
}

export function isSessionActivityActive(sessionId: string): boolean {
  return activeSessions.has(sessionId)
}

export function activeQueueTurnOf(sessionId: string): string | undefined {
  return activeSessions.get(sessionId)?.queueTurnId
}

export function releaseSessionActivity(sessionId: string, queueTurnId?: string): void {
  const active = activeSessions.get(sessionId)
  if (!active) return
  if (queueTurnId && active.queueTurnId && active.queueTurnId !== queueTurnId) return
  activeSessions.delete(sessionId)
  for (const listener of releaseListeners) listener(sessionId)
}

export function requestQueueDrain(sessionId: string): void {
  autoDrainSessions.add(sessionId)
}

export function clearQueueDrain(sessionId: string): void {
  autoDrainSessions.delete(sessionId)
}

export function shouldDrainQueue(sessionId: string): boolean {
  return autoDrainSessions.has(sessionId)
}

export function subscribeSessionRelease(listener: (sessionId: string) => void): () => void {
  releaseListeners.add(listener)
  return () => {
    releaseListeners.delete(listener)
  }
}
