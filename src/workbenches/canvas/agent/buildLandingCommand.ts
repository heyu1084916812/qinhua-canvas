import { isAttached, layoutAgentPlan, type AgentGraphView } from '../../../domain/agent/landing'
import type { AgentNodeType, AgentPlan } from '../../../domain/agent/plan'
import type { NodeData, NodeSnapshot } from '../../../domain/canvas/model/node'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import type { Command } from '../../../state/commands'

/**
 * 计划 → 落地命令（设计文档 §3 / §5 / §6）。
 *
 * ## 为什么住在画布层而不是 `features/shared/agent/`
 *
 * 它要把计划变成**画布的节点快照**，绕不开 `nodeSpecs`（尺寸、默认数据、名称）
 * 与 `NodeSnapshot` 类型 —— 这两样都是画布私有层。依赖规则 `no-shared-to-workbench`
 * 明确禁止共享层反向依赖工作台，所以它归画布层。
 *
 * 纯的那部分（布局算法、自检对账）留在 `domain/agent/landing.ts`：
 * 那是与画布实现无关的几何与比对逻辑，**画布知识由参数传进去**（`sizeOf` 回调）。
 * 这条分界的判据是：需要知道「轻画有哪些节点」的住在这里，
 * 只需要「给我一个尺寸函数」的住在 domain。
 *
 * 纯函数：给一份已验证的计划、当前图、原点，产出一条 `agent.applyPlan` 命令
 * 与 `localId → 真实 id` 的映射表。**不碰 store** —— 这样「计划会变成什么图」
 * 能在 node 下单测，而它正是最该被钉死的一环。
 */

export type ApplyPlanCommand = Extract<Command, { kind: 'agent.applyPlan' }>

export interface BuildLandingInput {
  plan: AgentPlan
  /** 当前图（只为拿 projectId、已有节点做避让、以及 attach 的目标） */
  graph: { projectId: string } & AgentGraphView & { nodes: NodeSnapshot[] }
  /** 新节点落哪（§6：优先视口中心偏左；有选中节点则落在它右侧） */
  origin: { x: number; y: number }
  /** 新 id 由调用方给（reducer 必须纯函数，测试也好断言） */
  newId: (kind: 'node') => string
  /**
   * 「新建节点的默认数据」，按类型给。
   *
   * 为什么必须有这一项：别的建节点入口（`+` 菜单 / 右键 / 拖线到空白）都走
   * `createNodeWithDefaults`，那里会从渠道 store 解出**默认渠道 + 模型**再落节点。
   * agent 这条要是漏了它，建出来的生成节点 `channelId` / `model` 就是空的 ——
   * `toRunRequest` 见到空渠道直接返回 null ⇒ 节点不进执行计划 ⇒
   * 用户点「生成」只看到一句「还没选择渠道」。表现上像按钮坏了，
   * 而 agent 的承诺正是「给需求 → 建工作流 → 出图」，那一步断了整件事就断了。
   *
   * 传函数而不是传值：解析默认值要读库（异步），而这支是纯函数。
   */
  /**
   * 第二个参数给**那个节点本身**：图片模型与视频模型是两个档（用户 2026-10-03），
   * 而「用哪个」取决于该节点是文生图还是图生视频（`node.data.mode`）——
   * 只知道类型就选不出该用哪一个。
   */
  dataFor?: (
    type: AgentNodeType,
    node: AgentPlan['nodes'][number],
  ) => Record<string, unknown>
}

export interface LandingPayload {
  command: ApplyPlanCommand
  /** localId → 真实节点 id；复用的那条指向既有节点自己的 id */
  idOf: Record<string, string>
}

/** 每种节点的默认尺寸 —— 从 `nodeSpecs` 取，不写第二份（词表同理，见 §5.2） */
function sizeOf(type: AgentNodeType): { w: number; h: number } {
  const spec = getSpec(type)
  return { w: spec?.sizing.min.w ?? 200, h: spec?.sizing.min.h ?? 120 }
}

export function buildLandingCommand(input: BuildLandingInput): LandingPayload {
  const { plan, graph, origin, newId } = input

  // ① 先把 localId → 真实 id 定下来（复用的指向既有节点，其余发新 id）
  const idOf: Record<string, string> = {}
  for (const node of plan.nodes) {
    if (isAttached(plan, node.localId)) {
      idOf[node.localId] = plan.attach!.find((a) => a.localId === node.localId)!.existingNodeId
    } else {
      idOf[node.localId] = newId('node')
    }
  }

  /**
   * ② 布局：agent 只给 order，坐标我们算（并避开已有节点）。
   *
   * ⚠️ 避让必须用**世界坐标**：容器（分组 / 批量）里的子节点 `x/y` 是**局部坐标**，
   * 直接拿去比，等于把它当成「以原点为左上角的一个独立节点」——新节点算着「没撞」，
   * 落到画布上却正压在那张图上（用户 2026-10-05 第五批第 3 条：
   * 「生成的节点覆盖了第二张图片原有的位置」）。
   */
  const existingWorld = graph.nodes.map((n) => {
    /**
     * `graph` 的类型是 `AgentGraphView & { nodes: NodeSnapshot[] }` —— 交叉后
     * 编译器把元素推成 `GraphNodeView`（没有 `parentId`）。这里实打实是 store 的
     * 节点快照（调用方就是拿 `store.getSnapshot()` 传进来的），所以显式收窄。
     */
    const r = toWorldRectInGraph(
      n as NodeSnapshot,
      graph as unknown as { nodes: readonly NodeSnapshot[] },
    )
    return { id: n.id, type: n.type, x: r.x, y: r.y, w: r.w, h: r.h }
  })
  const rects = layoutAgentPlan(plan, existingWorld, sizeOf, origin)

  // ③ 建节点快照。**复用节点不在这里** —— 它已经在画布上，这里只建新的
  const nodes: NodeSnapshot[] = []
  for (const node of plan.nodes) {
    if (isAttached(plan, node.localId)) continue
    const rect = rects[node.localId]
    if (!rect) continue // 布局给不出坐标就是计划本身有问题，交给校验器拦
    const spec = getSpec(node.type)
    nodes.push({
      id: idOf[node.localId]!,
      projectId: graph.projectId,
      type: node.type,
      parentId: null,
      x: rect.x,
      y: rect.y,
      w: rect.w,
      h: rect.h,
      title: node.title ?? spec?.label ?? node.type,
      disabled: false,
      /**
       * 三层打底：spec 默认 → 渠道解出来的默认（渠道 + 模型 + 生成参数）→ 计划数据。
       *
       * 与 `node.create` 同口径（有 data 用 data、没有用 createDefaultData），
       * 但这里**合并**而不是二选一：模型通常只给几个关键字段（比例、张数），
       * 其余（比如 generation 的 mode/count）由默认值补齐才是一份合法的节点数据。
       *
       * 顺序不能反：计划数据最后压上去 —— 用户在对话里点名要某条渠道 / 某个模型时，
       * 它得盖过默认值。
       */
      data: {
        ...(spec?.createDefaultData() ?? {}),
        ...(input.dataFor?.(node.type, node) ?? {}),
        ...node.data,
      } as NodeData,
    })
  }

  // ④ 连线换成真实 id。**允许一端指向已有节点**（这正是与 node.paste 的差别）
  const edges = plan.edges.map((e) => ({
    source: idOf[e.source]!,
    target: idOf[e.target]!,
    ...(e.sourcePort ? { sourcePort: e.sourcePort } : {}),
    ...(e.targetPort ? { targetPort: e.targetPort } : {}),
  }))

  return { command: { kind: 'agent.applyPlan', nodes, edges }, idOf }
}
