import { createId } from '../../shared/id'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { isContainerType } from '../../domain/canvas/model/node'
import { CONTAINER_PADDING } from '../../domain/canvas/layout/constants'
import { containerMinSize } from '../../domain/canvas/layout/packContainer'

/**
 * 容器包装框在选中内容四周留的边距。
 *
 * ⚠️ 现在与"贴内容尺寸"（内容 + `CONTAINER_PADDING` = 20）**同一个值**：
 * 2026-10-06 第 14 批第 1 条之后，**打组 = 一块背景板**（子节点保持原位、不排网格），
 * 框就是"孩子的包围盒 + 四边等距"，多余的呼吸感会被紧接着的贴合逻辑抹掉 ——
 * 与其先给一个 40/68 的大框再缩回，不如一开始就按贴合值建。
 */
const PAD = CONTAINER_PADDING
const PAD_TOP = CONTAINER_PADDING

export type WrapOutcome = { ok: true; containerId: string } | { ok: false; reason: string }

/**
 * 把选中的节点**收进一个新容器**（分组 / 批量共用这一份实现）。
 *
 * 四条口径：
 * ① **只收顶层、非容器的节点**：已经在别的容器里的不再套一层、容器也不能装容器
 *    （`node.reparent` 本身也拒绝「容器收容器」）；
 * ② **一次事务**：建容器 + 逐个 reparent 之间 `beginPlan/endPlan`，撤销一步全回去；
 * ③ 包装框**包住选中的内容**（坐标由内容算，不写死尺寸）；
 * ④ 批量多一条**二选一**（`canAcceptIntoBatch`）：提示词与素材不能混装 ——
 *    混装时**整批拒绝**并给出原因（而不是收一半留一半）。
 *
 * 拒绝用返回值表达（`{ ok: false, reason }`）而不是 `notify`：本层不认识"提示"，
 * 由调用方（多选工具栏 / 快捷键）决定怎么说。
 */
export function wrapSelection(
  store: CanvasStore,
  ids: readonly string[],
  type: 'group' | 'batch',
  label: string,
): WrapOutcome {
  const graph = store.getSnapshot()
  const wanted = new Set(ids)
  const tops = graph.nodes.filter(
    (n) => wanted.has(n.id) && !n.parentId && !isContainerType(n.type),
  )
  if (tops.length === 0) {
    return {
      ok: false,
      reason: type === 'batch' ? '选中的都是容器，容器不能收进批量节点' : '没有可打组的节点',
    }
  }
  if (type === 'batch') {
    const prompts = tops.filter((n) => n.type === 'prompt').length
    if (prompts !== 0 && prompts !== tops.length) {
      return { ok: false, reason: '批量节点只能收纳同类内容：提示词或素材，不能混装' }
    }
  }

  const minX = Math.min(...tops.map((n) => n.x)) - PAD
  const minY = Math.min(...tops.map((n) => n.y)) - PAD_TOP
  const maxX = Math.max(...tops.map((n) => n.x + n.w)) + PAD
  const maxY = Math.max(...tops.map((n) => n.y + n.h)) + PAD

  /**
   * 包装框的尺寸**按类型分流**（第 15 批 #335-① 的关键一环）：
   * - **分组**：子节点保持画布位置 ⇒ 框 = 内容包围盒（`maxX/minX`）；
   * - **批量**：位置语义是 3×3 格位 ⇒ 框就该**等于网格尺寸**（`containerMinSize`）。
   *   以前批量也用包围盒建框（比网格大得多），于是"进批量下方空一片"（对账 #325），
   *   而"自动尺寸才跟着子节点数变"那条判据（`batchFitPatches`）也就永远不成立
   *   —— 手工放大过的框会被下一次增删按回网格。两处一起改才闭环。
   */
  const size =
    type === 'batch'
      ? containerMinSize('batch', tops.length)
      : { w: maxX - minX, h: maxY - minY }

  const containerId = createId('node')
  store.beginPlan(containerId, label)
  try {
    store.dispatch({
      kind: 'node.create',
      projectId: graph.projectId,
      type,
      id: containerId,
      at: { x: minX, y: minY },
      size,
    })
    for (const n of tops) store.dispatch({ kind: 'node.reparent', id: n.id, toParent: containerId })
    /** 选中的是**新容器**：紧接着的拖动 / 删除都作用在它上，而不是里面某个节点 */
    store.setSelection([containerId])
  } finally {
    store.endPlan()
  }
  return { ok: true, containerId }
}

/**
 * 打组（用户 2026-10-05 第 10 条：`Ctrl+G`；第 11 条多选功能栏里的「打组」也走这一条）。
 *
 * @returns 新分组的节点 id；没有可收的节点时返回 null（兼容既有调用方）
 */
export function groupNodes(store: CanvasStore, ids: readonly string[]): string | null {
  const r = wrapSelection(store, ids, 'group', '打组')
  return r.ok ? r.containerId : null
}

/**
 * 收进**批量节点**（用户 2026-10-06 第 13 批第 5 条：多选工具栏新增「批量」，
 * 「点了把这些变成批量节点」）。
 *
 * 与打组的差别只在语义与那条二选一：批量是"每个素材各来一次"的迭代容器，
 * 故提示词与素材不能混装（`canAcceptIntoBatch` 同一条口径）。
 */
export function batchNodes(store: CanvasStore, ids: readonly string[]): WrapOutcome {
  return wrapSelection(store, ids, 'batch', '收进批量节点')
}
