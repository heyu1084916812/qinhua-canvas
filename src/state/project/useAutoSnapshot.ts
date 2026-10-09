import { useEffect, useRef } from 'react'
import { createSnapshotStore } from './snapshotStore'
import type { StoragePort } from '../../platform/ports'

/** 本次启动是否已经拍过 —— 同一会话里切页面、重挂载都不要再跑一遍 */
let ranThisSession = false

/** 仅供测试复位（模块级标志会让用例互相影响） */
export function __resetAutoSnapshotForTest(): void {
  ranThisSession = false
}

/**
 * 自动快照（用户 2026-10-09，对账 #378 A4）。
 *
 * ## 什么时候跑
 *
 * **应用启动时跑一次**，由 `shouldSnapshot` 决定"哪些项目真的需要拍"
 * （空项目不拍、没改过不拍、距上次不到一天不拍）。所以它**不是定时器** ——
 * 一个桌面工具没必要常驻一个 setInterval；用户开着应用一整天，
 * 关掉再开时那次就是新的"一天"。
 *
 * ## 为什么静默失败
 *
 * 快照是**兜底机制**，不是用户主动发起的动作。它失败（磁盘满 / 权限问题）时
 * 不该弹一个打断操作的错误 —— 用户真正主动做的事情（生成、保存）优先。
 * 失败只吞掉，不写日志面板：日志面板属于画布工作台，这里是壳级行为。
 */
export function useAutoSnapshot(storage: StoragePort, enabled = true): void {
  const storageRef = useRef(storage)
  storageRef.current = storage

  useEffect(() => {
    if (!enabled || ranThisSession) return
    ranThisSession = true
    let cancelled = false
    void (async () => {
      try {
        const store = createSnapshotStore(storageRef.current)
        await store.runAuto()
        if (cancelled) return
      } catch {
        /* 见文件头：兜底机制静默失败 */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [enabled])
}
