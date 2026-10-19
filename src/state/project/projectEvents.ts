let revision = 0
const listeners = new Set<() => void>()

/**
 * 项目行 / 文件夹的任何可见变更都递增一次。
 *
 * 侧栏常驻挂载，不能只靠路由变化重新读库；否则在项目页重命名、置顶或移动后，
 * 左侧树会一直显示旧值，直到用户切页。
 */
export function notifyProjectsChanged(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function subscribeProjectsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getProjectsRevision(): number {
  return revision
}
