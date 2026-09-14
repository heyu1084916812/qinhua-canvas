import { createId } from '../shared/id'

/**
 * 会话与启动（产品文档 §2.4 / §4.4 / §12）。
 * 全部函数对「非浏览器环境（node SSR / 单测）」安全：缺全局对象时直接 no-op 或返回 ok。
 * - checkIndexedDbAvailable：启动校验 IndexedDB 可用性（§2.4 / §12）
 * - flushOnPageHide：页面隐藏 / 卸载前强制 flush 未落盘事务（§4.4）
 * - broadcastWrite / subscribeExternalWrites：多标签写入检测（§2.4）
 */

const TAB_ID = createId('tab')
const CHANNEL = 'flow-cross-tab'

/** 启动校验：IndexedDB 是否可用。非浏览器环境（SSR / 单测）视为可用，不阻断渲染 */
export function checkIndexedDbAvailable(): Promise<boolean> {
  // 判据必须是 window 而不是 indexedDB：浏览器里 indexedDB 缺失（隐私模式 / 企业策略禁用）
  // 恰恰是「不可用」的真实场景，不能当成 SSR 直接放行，否则会静默丢数据。
  if (typeof window === 'undefined') return Promise.resolve(true)
  if (typeof indexedDB === 'undefined') return Promise.resolve(false)
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('__flow_health__', 1)
      req.onsuccess = () => {
        req.result.close()
        resolve(true)
      }
      req.onerror = () => resolve(false)
      req.onblocked = () => resolve(false)
    } catch {
      resolve(false)
    }
  })
}

/** 页面隐藏（visibilitychange=hidden）或卸载（beforeunload）时触发 handler（双保险 flush） */
export function flushOnPageHide(handler: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {}
  const onHide = () => {
    if (document.visibilityState === 'hidden') handler()
  }
  const onUnload = () => handler()
  window.addEventListener('beforeunload', onUnload)
  document.addEventListener('visibilitychange', onHide)
  return () => {
    window.removeEventListener('beforeunload', onUnload)
    document.removeEventListener('visibilitychange', onHide)
  }
}

/** 广播「本项目刚被本标签写入」，供其他标签检测外部写入 */
export function broadcastWrite(projectId: string): void {
  if (typeof BroadcastChannel !== 'undefined') {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ projectId, tab: TAB_ID, ts: Date.now() })
    ch.close()
    return
  }
  // 退化：跨进程用 localStorage 做时间戳标记（仅同源多进程可见）
  try {
    localStorage.setItem(`flow:write:${projectId}`, JSON.stringify({ tab: TAB_ID, ts: Date.now() }))
  } catch {
    /* 忽略：隐私模式等无法写入 */
  }
}

/**
 * 订阅「本项目被其他标签写入」事件，命中时调用 cb。
 * 返回清理函数。同一标签（TAB_ID）的写入会被忽略。
 */
export function subscribeExternalWrites(projectId: string, cb: () => void): () => void {
  const onExternal = (tab: string) => {
    if (tab && tab !== TAB_ID) cb()
  }

  let bc: BroadcastChannel | null = null
  if (typeof BroadcastChannel !== 'undefined') {
    bc = new BroadcastChannel(CHANNEL)
    bc.onmessage = (ev: MessageEvent) => {
      const msg = ev.data as { projectId?: string; tab?: string } | null
      if (msg && msg.projectId === projectId) onExternal(msg.tab ?? '')
    }
  }

  const onStorage = (e: StorageEvent) => {
    if (e.key === `flow:write:${projectId}` && e.newValue) {
      try {
        const msg = JSON.parse(e.newValue) as { tab?: string }
        onExternal(msg.tab ?? '')
      } catch {
        /* 忽略损坏值 */
      }
    }
  }
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage)

  return () => {
    bc?.close()
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage)
  }
}
