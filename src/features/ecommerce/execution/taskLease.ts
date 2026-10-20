/**
 * 同一应用进程内的电商任务租约。
 *
 * 页面切走时 React 视图会卸载，但抓取请求并不因此停止。没有这层租约时，
 * 返回电商页触发的“遗留 running 收口”会把仍在跑的任务误判为中断。
 */
const activeTaskIds = new Set<string>()

export function acquireEcommerceTaskLease(taskId: string): void {
  if (taskId) activeTaskIds.add(taskId)
}

export function releaseEcommerceTaskLease(taskId: string): void {
  if (taskId) activeTaskIds.delete(taskId)
}

export function hasEcommerceTaskLease(taskId: string): boolean {
  return activeTaskIds.has(taskId)
}

export function resetEcommerceTaskLeasesForTest(): void {
  activeTaskIds.clear()
}
