import { verifyAgentPlanLanding, type AgentGraphView } from '../../../domain/agent/landing'
import type { AgentPlan } from '../../../domain/agent/plan'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import { createId } from '../../../shared/id'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { buildLandingCommand } from './buildLandingCommand'

/**
 * 落一份 agent 计划到画布，**并立刻回读自检**（设计文档 §3 / §6.1）。
 *
 * 这是「计划变成画布上的图」真正发生的地方，也是用户要求的那个关口的实现：
 * 用户 2026-10-01「每次落地完，我需要你验证」。
 *
 * 为什么把「落地」与「自检」写在同一个函数里，而不是让调用方记得去验：
 * 分成两步就会有调用点漏掉自检 —— 而漏掉时**什么都不会报错**，
 * 只是「图没长对」这件事再次静默溜过去。合成一个入口，漏不掉。
 */

export interface ApplyAgentPlanResult {
  /** 自检是否通过 */
  ok: boolean
  /** 逐条问题（`ok:true` 时为空） */
  problems: string[]
  /** 本次新建的节点 id —— 界面据此高亮/选中，让你一眼看到它建了什么 */
  createdNodeIds: string[]
}

/** 图快照 → 自检要的视图（只保留它关心的字段） */
export function toGraphView(graph: GraphSnapshot): AgentGraphView {
  return {
    nodes: graph.nodes.map((n) => ({ id: n.id, type: n.type, x: n.x, y: n.y, w: n.w, h: n.h })),
    edges: graph.edges.map((e) => ({
      source: e.source,
      target: e.target,
      ...(e.sourcePort ? { sourcePort: e.sourcePort } : {}),
      ...(e.targetPort ? { targetPort: e.targetPort } : {}),
    })),
  }
}

export function applyAgentPlan(
  store: CanvasStore,
  plan: AgentPlan,
  origin: { x: number; y: number },
  /**
   * 新建节点的默认数据（渠道 + 模型 + 生成参数），由调用方从渠道 store 解好传进来。
   * 不传也能跑，但那样建出来的生成节点没渠道没模型 —— 点了生成只会得到一句
   * 「还没选择渠道」。所以这条链上**必须**由调用方传（见 buildLandingCommand 的 dataFor）。
   */
  opts?: {
    /** 第二个参数是**那个节点本身**：图片 / 视频两档模型要按 `data.mode` 选（见 buildLandingCommand） */
    dataFor?: (
      type: AgentPlan['nodes'][number]['type'],
      node: AgentPlan['nodes'][number],
    ) => Record<string, unknown>
  },
): ApplyAgentPlanResult {
  const graph = store.getSnapshot()
  const before = toGraphView(graph)

  const { command, idOf } = buildLandingCommand({
    plan,
    graph,
    origin,
    newId: () => createId('node'),
    ...(opts?.dataFor ? { dataFor: opts.dataFor } : {}),
  })

  // 一次 dispatch = 一个 standalone 事务 = 一次撤销全回退
  store.dispatch(command)

  const after = toGraphView(store.getSnapshot())
  const check = verifyAgentPlanLanding({ plan, idOf, before, after })

  return {
    ok: check.ok,
    problems: check.problems,
    createdNodeIds: command.nodes.map((n) => n.id),
  }
}
