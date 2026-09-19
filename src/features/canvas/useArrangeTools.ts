import { useMemo } from 'react'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { Rect } from '../../domain/canvas/geometry/rect'
import { toWorldRect } from '../../domain/canvas/geometry/coords'
import { indexNodes } from '../../domain/canvas/model/graph'
import { computeArrange, canArrange } from '../../domain/canvas/layout/arrange'
import { computeArrangeMode, type ArrangeMode } from '../../domain/canvas/layout/arrangeModes'
import { createId } from '../../shared/id'

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
export interface ArrangeOutcome {
  kind: 'ok' | 'too-few' | 'cycle'
  /** 有环时的提示文案（§6.5「存在循环依赖，无法整理」） */
  reason?: string
  moved: number
}

export interface ArrangeTools {
  arrange(): ArrangeOutcome
  /** 宫格 / 水平 / 垂直排列（§6.5 ②）。与 arrange() 的区别：它不看连线，纯按位置重排 */
  arrangeMode(mode: ArrangeMode): ArrangeOutcome
}

export function createArrangeTools(store: CanvasStore): ArrangeTools {
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
   *
   * node.move 对集合施加**同一**位移，而排列 / 对齐后各节点位移量各不相同，
   * 故按位移量分组下发——但**必须共用同一个事务 key**（见下）。
   *
   * 为什么不能让各组各走默认事务：node.move 自带的 key 是 `move:${ids.join(',')}`，
   * 分组后每组 id 集合都不同 ⇒ key 不同 ⇒ 每次 dispatch 新开一个撤销单元。
   * 表现就是「一次排列要按好几次撤销才退回去」，用户按一次只退回了一部分
   * （实测：宫格排列 4 个节点，一次撤销只回去 1 个）。
   *
   * 解法：显式传事务边界（txOverride），本次操作的所有位移共用同一个 multi-step
   * planId ⇒ 合并成一个撤销单元，一次撤销完整退回。
   */
  function applyTargets(
    targets: Map<string, { x: number; y: number }>,
    label: string,
  ): number {
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
    /** 本次操作 = 一个撤销单元：所有分组共享同一个 planId */
    const planId = createId('arrange')
    for (const g of groups.values()) {
      store.dispatch(
        { kind: 'node.move', ids: g.ids, dx: g.dx, dy: g.dy, phase: 'end' },
        { mode: 'multi-step', planId, label },
      )
    }
    return count
  }

  function arrange(): ArrangeOutcome {
    const nodes = selectedNodes()
    if (!canArrange(nodes.length)) return { kind: 'too-few', moved: 0 }
    const result = computeArrange(
      nodes.map((n) => ({ id: n.id, rect: worldRectOf(n) })),
      store.getSnapshot().edges,
    )
    if (result.cycles.length > 0) {
      return { kind: 'cycle', reason: '存在循环依赖，无法整理', moved: 0 }
    }
    return { kind: 'ok', moved: applyTargets(result.targets, '整理节点') }
  }

  function arrangeMode(mode: ArrangeMode): ArrangeOutcome {
    const nodes = selectedNodes()
    /** ≥ 2 才可用，与对齐 / 整理同一门槛（§6.5） */
    if (nodes.length < 2) return { kind: 'too-few', moved: 0 }
    const targets = computeArrangeMode(
      nodes.map((n) => ({ id: n.id, rect: worldRectOf(n) })),
      mode,
    )
    return { kind: 'ok', moved: applyTargets(targets, '排列节点') }
  }

  return { arrange, arrangeMode }
}

/** hook 包装：把工具挂到组件生命周期上 */
export function useArrangeTools(store: CanvasStore): ArrangeTools {
  return useMemo(() => createArrangeTools(store), [store])
}

