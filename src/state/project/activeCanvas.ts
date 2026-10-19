/**
 * 当前已打开画布（本次应用会话内有效）。
 *
 * 素材页不在画布路由上，但仍然需要知道“发到哪个画布”。这里刻意用
 * sessionStorage：切去素材页再回来仍然记得，重启应用后不会拿一个陈旧项目
 * 冒充“当前打开”。
 */
const ACTIVE_CANVAS_KEY = 'qinghua:active-canvas-id'

let memoryId: string | null = null

function session(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function rememberActiveCanvas(projectId: string): void {
  memoryId = projectId
  try {
    session()?.setItem(ACTIVE_CANVAS_KEY, projectId)
  } catch {
    /* 隐私模式 / 存储禁用时仍保留内存值 */
  }
}

export function activeCanvasId(): string | null {
  try {
    return session()?.getItem(ACTIVE_CANVAS_KEY) || memoryId
  } catch {
    return memoryId
  }
}

export function forgetActiveCanvas(): void {
  memoryId = null
  try {
    session()?.removeItem(ACTIVE_CANVAS_KEY)
  } catch {
    /* 忽略 */
  }
}
