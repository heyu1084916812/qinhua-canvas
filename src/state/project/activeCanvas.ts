import type { WorkbenchId } from '../../domain/shared/workbench'

/**
 * 当前已打开的工作台项目（本次应用会话内有效）。
 *
 * 画布、电商、漫剧各自记住最后打开的项目，一级导航按目标工作台取对应 id。
 * 这里刻意用 sessionStorage：切去素材页再回来仍然记得，重启应用后不会拿一个
 * 陈旧项目冒充“当前打开”。
 */
const ACTIVE_CANVAS_KEY = 'qinghua:active-canvas-id'
const ACTIVE_WORKBENCH_PREFIX = 'qinghua:active-workbench:'

const memoryIds = new Map<WorkbenchId, string>()
let revision = 0
const listeners = new Set<() => void>()

function keyFor(workbench: WorkbenchId): string {
  return `${ACTIVE_WORKBENCH_PREFIX}${workbench}`
}

function notify(): void {
  revision += 1
  for (const listener of listeners) listener()
}

function session(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function rememberActiveWorkbench(workbench: WorkbenchId, projectId: string): void {
  memoryIds.set(workbench, projectId)
  try {
    session()?.setItem(keyFor(workbench), projectId)
  } catch {
    /* 隐私模式 / 存储禁用时仍保留内存值 */
  }
  notify()
}

export function activeWorkbenchId(workbench: WorkbenchId): string | null {
  try {
    return session()?.getItem(keyFor(workbench)) || memoryIds.get(workbench) || null
  } catch {
    return memoryIds.get(workbench) ?? null
  }
}

export function rememberActiveCanvas(projectId: string): void {
  rememberActiveWorkbench('canvas', projectId)
  try {
    session()?.setItem(ACTIVE_CANVAS_KEY, projectId)
  } catch {
    /* 忽略 */
  }
}

export function activeCanvasId(): string | null {
  const active = activeWorkbenchId('canvas')
  if (active) return active
  try {
    return session()?.getItem(ACTIVE_CANVAS_KEY) || null
  } catch {
    return null
  }
}

export function forgetActiveWorkbench(workbench: WorkbenchId): void {
  memoryIds.delete(workbench)
  try {
    session()?.removeItem(keyFor(workbench))
    if (workbench === 'canvas') session()?.removeItem(ACTIVE_CANVAS_KEY)
  } catch {
    /* 忽略 */
  }
  notify()
}

export function forgetActiveCanvas(): void {
  forgetActiveWorkbench('canvas')
}

export function subscribeActiveCanvas(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getActiveCanvasRevision(): number {
  return revision
}
