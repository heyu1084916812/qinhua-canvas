/**
 * 运行记录写入信号。
 *
 * 为什么不能只靠画布 store 订阅：`node.runRecord.append` 刻意**只落 runRecords 表**，
 * 不改变图快照（见 reducer）。日志面板若只订阅图快照，运行中失败写进库了也不会刷新，
 * 用户看到的仍是空列表或旧列表。
 */
const listeners = new Set<() => void>()

export function emitRunRecordChanged(): void {
  for (const listener of [...listeners]) listener()
}

export function subscribeRunRecordChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
