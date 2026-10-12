import { useEffect } from 'react'
import type { CanvasStore } from '../state/workbenches/canvas/store'
import { broadcastWrite, flushOnPageHide } from './session'

/**
 * 项目级「写盘保险」：**离开前台 / 关闭前强制落一次** + **改动后广播**（多标签写入检测）。
 *
 * ## 为什么要抽成一份（2026-10-12，对账 #453）
 *
 * 画布页与电商页**共用同一个 store**（`state/workbenches/canvas/storeCache.ts` 那份缓存），
 * 所以这两道保险也必须共用一份 —— 原先**只有画布页接了**，于是：
 * ① 在电商页出完图 / 改完节点参数，**立刻关窗口或切走**，那 ≤800ms 防抖窗口里的写入
 *    没有兜底（画布页同一动作有）；② 两个窗口并排时，**电商页的写入不会通知对面刷新**。
 * 这正是本项目反复吃亏的那类洞 ——「同一个应用里两种手感 = 会被当成坏了」（见 INVARIANTS）。
 */
export function useProjectWriteSafety(projectId: string, store: CanvasStore): void {
  /** ① 离开前台（`visibilitychange=hidden`）/ 关闭（`beforeunload`）前强制 flush —— 双保险 */
  useEffect(() => {
    if (projectId === 'demo') return
    return flushOnPageHide(() => {
      void store.flush()
      broadcastWrite(projectId)
    })
  }, [store, projectId])

  /** ② 落库后即广播（不只页面隐藏时）：两个窗口并排时也能收到"别处改过"的提示 */
  useEffect(() => {
    if (projectId === 'demo') return
    let timer: ReturnType<typeof setTimeout> | null = null
    let lastGraph = store.getSnapshot()
    const unsub = store.subscribe(() => {
      const g = store.getSnapshot()
      if (g === lastGraph) return
      lastGraph = g
      if (timer) clearTimeout(timer)
      // 略晚于 800ms 的持久化防抖，确保广播时数据已落库
      timer = setTimeout(() => broadcastWrite(projectId), 1000)
    })
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
  }, [store, projectId])
}
