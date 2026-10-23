import type { EcommerceResultRecord, EcommerceTaskRecord } from './tasks'
import { ecommerceAspectRatio } from './types'

/**
 * 电商无限工作台里的一个可编辑对象。
 *
 * 这不是画布节点：它不参与 DAG、没有输入输出端口，也不进入执行引擎。
 * 图片 / 视频只引用内容寻址的 assetHash，任务事实仍存放在 ecommerceResults。
 */
export interface EcommerceCanvasItem {
  id: string
  projectId: string
  kind: 'image' | 'video' | 'text'
  taskId?: string
  resultId?: string
  assetHash?: string
  text?: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  aspectLocked: boolean
  /** 生成结果默认参与纵向自动排版；用户手动移动或缩放后关闭。 */
  autoLayout: boolean
  createdAt: number
  updatedAt: number
}

export type NewEcommerceCanvasItem = Omit<
  EcommerceCanvasItem,
  'id' | 'createdAt' | 'updatedAt'
>

export const WORKBENCH_ITEM_GAP = 0
export const WORKBENCH_TASK_GAP = 96
export const WORKBENCH_LEFT = 96
export const WORKBENCH_TOP = 72
export const WORKBENCH_MIN_WIDTH = 280
export const WORKBENCH_MAX_DEFAULT_WIDTH = 960

function validSize(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

export function resultAspectOf(result: Pick<EcommerceResultRecord, 'width' | 'height'>): number {
  const width = validSize(result.width)
  const height = validSize(result.height)
  return width && height ? width / height : 1
}

export function ratioAspectOf(ratio: string | undefined): number {
  if (!ratio) return 1
  const [width, height] = ecommerceAspectRatio(ratio)
    .split(':')
    .map((part) => Number(part))
  return width && height && width > 0 && height > 0 ? width / height : 1
}

export function defaultWorkbenchWidth(viewportWidth: number): number {
  return Math.max(
    WORKBENCH_MIN_WIDTH,
    Math.min(WORKBENCH_MAX_DEFAULT_WIDTH, Math.round(viewportWidth * 0.72)),
  )
}

/**
 * 旧结果 / 新结果的确定性排列。
 *
 * **一个任务一列**：同一任务内按 position 纵向排；下一任务向右开新列，
 * 不再把所有批次一直往页面底部堆。这里只生成“还没有布局”的对象；已有对象的
 * 坐标由 `mergeWorkbenchItems` 原样保留。
 */
export function layoutEcommerceResults(
  projectId: string,
  tasks: readonly Pick<EcommerceTaskRecord, 'id' | 'createdAt' | 'request'>[],
  results: readonly EcommerceResultRecord[],
  viewportWidth = 1280,
): NewEcommerceCanvasItem[] {
  const taskOrder = new Map(
    [...tasks]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      .map((task, index) => [task.id, index] as const),
  )
  const taskById = new Map(tasks.map((task) => [task.id, task] as const))
  const laidOut = [...results]
    .filter((result) => !result.hiddenAt)
    .sort((a, b) => {
      const taskA = taskOrder.get(a.taskId) ?? Number.MAX_SAFE_INTEGER
      const taskB = taskOrder.get(b.taskId) ?? Number.MAX_SAFE_INTEGER
      return (
        taskA - taskB ||
        a.taskId.localeCompare(b.taskId) ||
        a.position - b.position ||
        a.createdAt - b.createdAt
      )
    })

  const width = defaultWorkbenchWidth(viewportWidth)
  let y = WORKBENCH_TOP
  let column = -1
  let previousTask = ''
  let maxZ = 1
  return laidOut.map((result) => {
    if (previousTask !== result.taskId) {
      column += 1
      y = WORKBENCH_TOP
    }
    previousTask = result.taskId
    const task = taskById.get(result.taskId)
    const aspect =
      result.width && result.height
        ? resultAspectOf(result)
        : ratioAspectOf(result.ratio ?? task?.request.ratio)
    const height = Math.max(120, Math.round(width / aspect))
    const kind =
      result.mime?.startsWith('video/') || task?.request.mediaKind === 'video'
        ? 'video'
        : 'image'
    const item: NewEcommerceCanvasItem = {
      projectId,
      kind,
      taskId: result.taskId,
      resultId: result.id,
      assetHash: result.assetHash,
      x: WORKBENCH_LEFT + column * (width + WORKBENCH_TASK_GAP),
      y,
      width,
      height,
      rotation: 0,
      zIndex: maxZ++,
      aspectLocked: kind === 'image',
      autoLayout: true,
    }
    y += height + WORKBENCH_ITEM_GAP
    return item
  })
}

/**
 * 合并已有布局与最新结果。
 *
 * 规则：结果对象以 resultId 认领，已有坐标绝不覆盖；文本 / 上传等非结果对象原样保留；
 * 已不存在的 result 对象移除。这样重新生成、切换历史批次都不会把用户摆好的图弹回去。
 */
export function mergeWorkbenchItems(
  existing: readonly EcommerceCanvasItem[],
  desired: readonly NewEcommerceCanvasItem[],
): { items: EcommerceCanvasItem[]; added: NewEcommerceCanvasItem[]; removedIds: string[] } {
  const byResult = new Map(
    existing
      .filter((item) => item.resultId)
      .map((item) => [item.resultId as string, item] as const),
  )
  const desiredIds = new Set(desired.map((item) => item.resultId).filter(Boolean) as string[])
  const added = desired.filter((item) => !item.resultId || !byResult.has(item.resultId))
  const kept = existing.filter((item) => !item.resultId || desiredIds.has(item.resultId))
  return {
    items: [
      ...kept,
      ...added.map((item, index) => ({
        ...item,
        id: `pending:${item.resultId ?? index}`,
        createdAt: 0,
        updatedAt: 0,
      })),
    ],
    added,
    removedIds: existing
      .filter((item) => item.resultId && !desiredIds.has(item.resultId))
      .map((item) => item.id),
  }
}

export interface RectLike {
  x: number
  y: number
  width: number
  height: number
}

export interface PointLike {
  x: number
  y: number
}

export function rectsOverlap(a: RectLike, b: RectLike): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  )
}

export function itemById(
  items: readonly EcommerceCanvasItem[],
  id: string | null,
): EcommerceCanvasItem | null {
  if (!id) return null
  return items.find((item) => item.id === id) ?? null
}

/**
 * 拖动吸附：对象左 / 中 / 右与上 / 中 / 下靠近其它对象时，返回吸附后的坐标和参考线。
 * 阈值按屏幕 8px 换算到世界坐标，因此缩放后手感一致。
 */
export function snapWorkbenchMove(
  item: EcommerceCanvasItem,
  nextX: number,
  nextY: number,
  others: readonly EcommerceCanvasItem[],
  scale: number,
): { x: number; y: number; guides: { x: number | null; y: number | null } } {
  const threshold = 8 / Math.max(scale, 0.1)
  const itemXs = [nextX, nextX + item.width / 2, nextX + item.width]
  const itemYs = [nextY, nextY + item.height / 2, nextY + item.height]
  let bestX: { delta: number; line: number } | null = null
  let bestY: { delta: number; line: number } | null = null
  for (const other of others) {
    const otherXs = [other.x, other.x + other.width / 2, other.x + other.width]
    const otherYs = [other.y, other.y + other.height / 2, other.y + other.height]
    for (const a of itemXs) {
      for (const b of otherXs) {
        const delta = b - a
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, line: b }
        }
      }
    }
    for (const a of itemYs) {
      for (const b of otherYs) {
        const delta = b - a
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, line: b }
        }
      }
    }
  }
  return {
    x: nextX + (bestX?.delta ?? 0),
    y: nextY + (bestY?.delta ?? 0),
    guides: { x: bestX?.line ?? null, y: bestY?.line ?? null },
  }
}

/** 在可见区域中心附近找一个不与现有对象重叠的落点。 */
export function findFreeWorkbenchPosition(
  items: readonly EcommerceCanvasItem[],
  width: number,
  height: number,
  start: PointLike,
  step = 32,
): PointLike {
  const candidate = { x: start.x, y: start.y }
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rect = { x: candidate.x, y: candidate.y, width, height }
    if (!items.some((item) => rectsOverlap(rect, item))) return { ...candidate }
    candidate.x += step
    candidate.y += step
  }
  return { x: start.x + items.length * step, y: start.y + items.length * step }
}
