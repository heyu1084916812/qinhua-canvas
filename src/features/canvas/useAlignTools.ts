import { useMemo } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { Rect } from '../../domain/canvas/geometry/rect'
import { toWorldRect } from '../../domain/canvas/geometry/coords'
import { indexNodes } from '../../domain/canvas/model/graph'
import { computeAlign, canAlign, type AlignMode } from '../../domain/canvas/layout/align'
import { computeArrange, canArrange } from '../../domain/canvas/layout/arrange'

/**
 * 对齐与整理的执行入口（产品文档 §6.5 ②③）。
 *
 * 命令层只有 node.move（增量），而对齐是**绝对坐标**，因此这里先算出当前值到目标值的
 * 增量再下发 —— 复用已有命令，不新增与 move 重复的「设置坐标」命令。
 *
 * 坐标一律换算成 world：容器内子节点存的是 local，直接拿 n.x/n.y 比会算到错误位置。
 *
 * 与 React 解耦（工厂 + hook 包装）：单测可不装 testing-library 直接驱动。
 */
export interface AlignOutcome {
  kind: 'ok' | 'too-few' | 'cycle'
  /** 有环时的提示文案（§6.5「存在循环依赖，无法整理」） */
  reason?: string
  moved: number
}

export interface AlignTools {
  align(mode: AlignMode): AlignOutcome
  arrange(): AlignOutcome
}

export function createAlignTools(store: CanvasStore): AlignTools {
  /** 节点的世界矩形（容器内存的是 local，要加父容器偏移 —— 架构 §5.3） */
  function worldRectOf(node: NodeSnapshot): Rect {
    const parent = node.parentId
      ? indexNodes(store.getSnapshot().nodes).get(node.parentId) ?? null
      : null
    return toWorldRect(node, parent)
  }

  function selectedNodes(): NodeSnapshot[] {
    const index = indexNodes(store.getSnapshot().nodes)
    return store
      .getSelection()
      .map((id) => index.get(id))
      .filter((n): n is NodeSnapshot => !!n)
  }

  /**
   * 把目标坐标落成 node.move。
   * node.move 对集合施加**同一**位移，各节点位移量不同 → 按位移量分组下发。
   */
  function applyTargets(targets: Map<string, { x: number; y: number }>): number {
    if (targets.size === 0) return 0
    const index = indexNodes(store.getSnapshot().nodes)
    const groups = new Map<string, { ids: string[]; dx: number; dy: number }>()
    let count = 0

    for (const [id, target] of targets) {
      const node = index.get(id)
      if (!node) continue
      const world = worldRectOf(node)
      const dx = target.x - world.x
      const dy = target.y - world.y
      if (dx === 0 && dy === 0) continue
      const key = `${dx},${dy}`
      const g = groups.get(key) ?? { ids: [], dx, dy }
      g.ids.push(id)
      groups.set(key, g)
      count += 1
    }
    for (const g of groups.values()) {
      store.dispatch({ kind: 'node.move', ids: g.ids, dx: g.dx, dy: g.dy, phase: 'end' })
    }
    return count
  }

  function align(mode: AlignMode): AlignOutcome {
    const nodes = selectedNodes()
    if (!canAlign(nodes.length, mode)) return { kind: 'too-few', moved: 0 }
    const targets = computeAlign(
      nodes.map((n) => ({ id: n.id, rect: worldRectOf(n) })),
      mode,
    )
    return { kind: 'ok', moved: applyTargets(targets) }
  }

  function arrange(): AlignOutcome {
    const nodes = selectedNodes()
    if (!canArrange(nodes.length)) return { kind: 'too-few', moved: 0 }
    const result = computeArrange(
      nodes.map((n) => ({ id: n.id, rect: worldRectOf(n) })),
      store.getSnapshot().edges,
    )
    if (result.cycles.length > 0) {
      return { kind: 'cycle', reason: '存在循环依赖，无法整理', moved: 0 }
    }
    return { kind: 'ok', moved: applyTargets(result.targets) }
  }

  return { align, arrange }
}

/** hook 包装：把工具挂到组件生命周期上 */
export function useAlignTools(store: CanvasStore): AlignTools {
  return useMemo(() => createAlignTools(store), [store])
}
