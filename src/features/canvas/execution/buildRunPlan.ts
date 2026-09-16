import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeData, NodeSnapshot, NodeType } from '../../../domain/canvas/model/node'
import type { RunMode, RunScope } from '../../../domain/canvas/model/runRecord'
import type { SlotPlan } from '../../../domain/canvas/layout/slotPlacement'
// 计划外壳与任务基类上移共享执行 domain（M6-5 路径 B）：画布在此**绑定出**自己的任务子类型。
import type { RunPlan as SharedRunPlan, RunTask as SharedRunTask } from '../../../domain/shared/execution/plan'
import type { ExecutionMode } from '../../../domain/shared/execution/types'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { topoSort } from '../../../domain/canvas/graph/topoSort'
import { traverseDownstream } from '../../../domain/canvas/graph/traverseDownstream'
import { planSlots } from '../../../domain/canvas/layout/slotPlacement'
import { fingerprintOf } from '../../../domain/canvas/graph/fingerprint'
import { isGeneratableType } from '../../../domain/canvas/model/node'
import { directDownstream } from '../../../domain/canvas/graph/upstreamOf'
import { indexNodes } from '../../../domain/canvas/model/graph'
import { expandInputs, expansionCount } from '../../../domain/canvas/execution/collectionExpand'
import { createId } from '../../../shared/id'

export type { ExecutionMode }

/**
 * 画布任务 = 共享任务基类 + 画布专有的**槽位计划**（`slot`）。
 *
 * 为什么保留子类型（而不是把 slot 塞进共享基类）：落位是画布专有概念，
 * 由 `CanvasPlacement` 解读（features/canvas/execution/canvasPlacement.ts）。
 * 共享引擎只认基类字段，因此画布与 comic 的任务类型互不牵制——
 * 这正是调研稿 §5.5「由第二个消费者定义接口」的落点。
 */
export interface CanvasRunTask extends SharedRunTask {
  /**
   * 结果落位计划（M0-11 扩展，架构原文 RunTask 无此字段）。
   * 落位是 plan 的职责、执行由适配器提交命令完成：
   * reuse = 写回已有节点；new = 先建节点再写回。
   */
  slot: SlotPlan
  /** 执行前冻结的参数快照（画布参数类型） */
  params: NodeData
  /**
   * 来源节点的类型（§6.16）。落位要知道「产物写在谁身上」：
   * 分组 / 批量这类容器自身不呈现单张产物，单一产物也必须进结果组；
   * 生成节点自己就能显示，于是 N=1 时不建组、直接按产物真实比例呈现。
   */
  sourceType: NodeType
  /** 该主体在本次计划里会发起**几次调用**（= 输入集合展开后的次数，未展开时恒为 1）。
   *
   * 落位要按「这个主体总共出几张」判断进不进结果组，而 `shouldCollect` 是**逐次调用**
   * 被调用的，只看得到本次的 1 张——批量上游展开 2 次时每次都只看见 1 张，
   * 于是会退化成「两张图各写回一个节点、不进结果组」（§6.12 场景 1 的回归）。
   */
  callCount: number
  /**
   * 来源节点**所在容器**的类型（§6.8 生成行为表：容器运行各自产生独立结果组）。
   *
   * 「N=1 不建结果组」只对**独立的生成节点**成立：画板 / 分组 / 批量里跑出来的产物
   * 属于那一次容器运行，写回容器内某个子节点等于把结果藏进集合里看不见。
   * 只看 `sourceType` 判断不出来——画板里的生成节点 `type` 仍然是 `generation`，
   * 必须往上追一层父节点。
   */
  containerKind: ContainerKind
}

/** 能把生成节点装起来的容器类型；`null` = 顶层节点（不在任何容器里） */
export type ContainerKind = 'board' | 'group' | 'batch' | null

/**
 * 画布执行计划：共享外壳 + 画布任务。
 * `newDownstream`（Alt+R 语义）在共享外壳里为可选字段，这里恒由 buildRunPlan 给出。
 */
export type RunPlan = SharedRunPlan<CanvasRunTask>

/**
 * 计划起点。`originNodeId: null` 表示**没有触发节点**，只对
 * `rerunAll` / `refreshStale` 两种「按范围跑」的模式有意义（顶栏按钮 = 全图）。
 */
export type RunOrigin =
  | { originNodeId: string | null }
  | {
      subgraph: GraphSnapshot
      /**
       * 这次运行**所在容器**的类型（画板运行必填）。
       *
       * 子图里只有容器内的节点、**不含容器自己**（`boardSubgraph` 就是这么切的），
       * 所以「这是不是一次容器运行」没法从子图推断 —— 只能由调用方声明。
       */
      containerKind?: ContainerKind
    }

/**
 * 可执行的节点：类型可生成，且规格提供了构造请求的能力。
 *
 * 导出给 UI 用（右键菜单判断「触发节点下游还有没有可执行的节点」，决定是否列出
 * 「整条流程重新运行 / 仅刷新陈旧节点」）：菜单与引擎必须同一口径，
 * 否则会出现「菜单里有、点了什么都不发生」的死项。
 */
export function canBuildRequest(node: NodeSnapshot): boolean {
  if (!isGeneratableType(node.type)) return false
  const spec = getSpec(node.type)
  return !!spec && (!!spec.toRunRequest || !!spec.generate)
}

function collectDownstream(nodeId: string, graph: GraphSnapshot): string[] {
  const ids: string[] = []
  traverseDownstream(nodeId, graph, (n) => {
    ids.push(n.id)
  })
  return ids
}

/**
 * 执行计划（架构 §5.5）。纯函数：不读时间、不产生副作用、可脱离 React 单测。
 *
 * single-alt 在这里被解析掉：executionMode 变回 single，newDownstream = true（§5.5 修订）。
 */
export function buildRunPlan(
  scope: RunScope,
  origin: RunOrigin,
  graph: GraphSnapshot,
  mode: Exclude<RunMode, 'idle'>,
  staleNodeIds: ReadonlySet<string> = new Set(),
): RunPlan {
  const newDownstream = mode === 'single-alt'
  const executionMode: ExecutionMode = newDownstream ? 'single' : (mode as ExecutionMode)

  const originNodeId = 'originNodeId' in origin ? origin.originNodeId : null
  const working: GraphSnapshot = 'subgraph' in origin ? origin.subgraph : graph
  const subContainer: ContainerKind = 'subgraph' in origin ? origin.containerKind ?? null : null
  const index = indexNodes(working.nodes)

  // 1. 选出候选节点
  let candidateIds: string[]
  if (mode === 'rerunAll') {
    candidateIds = working.nodes.map((n) => n.id)
  } else if (mode === 'refreshStale' && !originNodeId) {
    // 顶栏「仅刷新陈旧」= 全图范围（§6.19.1：顶栏 = 全图，右键 = 触发节点下游）
    candidateIds = working.nodes.map((n) => n.id)
  } else if (!originNodeId) {
    candidateIds = []
  } else if (mode === 'single' || mode === 'single-alt') {
    const self = index.get(originNodeId)
    // 提示词节点自己不能发请求：它的语义是「让下游生成节点出图」
    candidateIds =
      self && canBuildRequest(self)
        ? [originNodeId]
        : directDownstream(originNodeId, working.edges)
  } else {
    // rerun / refreshStale：origin + 全部下游
    candidateIds = collectDownstream(originNodeId, working)
  }

  let selected = candidateIds
    .map((id) => index.get(id))
    .filter((n): n is NodeSnapshot => !!n && canBuildRequest(n))

  if (mode === 'refreshStale') {
    // 只有落在 staleNodeIds 里的节点才入 plan（§5.5）
    selected = selected.filter((n) => staleNodeIds.has(n.id))
  }

  // 2. 拓扑排序：保证上游先跑
  const selectedIds = new Set(selected.map((n) => n.id))
  const { order } = topoSort(
    selected,
    working.edges.filter((e) => selectedIds.has(e.source) && selectedIds.has(e.target)),
  )
  const ordered = order
    .map((id) => index.get(id))
    .filter((n): n is NodeSnapshot => !!n)

  // 3. 单点生成的结果落位：空槽位 BFS（§6.19.3）。
  //    槽位数 = 实际要发起的调用数（集合展开后），否则批量场景会「槽位不够铺新节点」。
  //
  //    **不论触发节点是提示词还是生成节点，都要走空槽位规划**：
  //      - 从提示词发起（提示词 → 下游生成节点）：老路径；
  //      - 从生成节点自己发起（用户 2026-09-16 报的图生图）：同样要按「空槽」判据落位。
  //        此前这里只在「提示词发起」时规划槽位，生成节点自跑时 `slots` 恒为空、
  //        落位写死 `reuse` 自己 —— 于是源节点已有的图被新产物覆盖，
  //        用户看到「用节点自己的素材生图时没有新建右侧节点」。
  const singleRun = mode === 'single' || mode === 'single-alt'
  const plannedCalls =
    singleRun && originNodeId
      ? ordered.reduce((sum, n) => sum + callCountOf(n, working), 0)
      : 0
  const slots =
    singleRun && originNodeId
      ? planSlots({
          startNodeId: originNodeId,
          graph: working,
          count: Math.max(1, plannedCalls),
          newDownstream,
        })
      : []

  // 4. 冻结请求、指纹与参数。
  //    批量上游（集合卡）在这里展开：一个节点可能产出 N 个 task（§6.12「各生成一次」）。
  const tasks: CanvasRunTask[] = []
  let previousId: string | null = null
  let slotCursor = 0
  ordered.forEach((node) => {
    const spec = getSpec(node.type)!
    const inputs = spec.collectInputs({ node, graph: working })
    const expansions = expandInputs(inputs)

    expansions.forEach((expansion, seq) => {
      const request = spec.toRunRequest?.({
        node,
        inputs: expansion.inputs,
        params: node.data,
        graph: working,
      })
      if (!request) return // 渠道或模型未配置 → 不入 plan

      const slot: SlotPlan =
        slots.length > 0
          ? slots[Math.min(slotCursor, slots.length - 1)]!
          : { kind: 'reuse', nodeId: node.id }

      const task: CanvasRunTask = {
        id: createId('task'),
        nodeId: node.id,
        request,
        dependsOn: previousId ? [previousId] : [],
        slot,
        // 指纹包含完整集合（未展开）：集合内容变了才算输入变了，
        // 逐项 task 共用同一指纹，陈旧判定与「一次生成」语义一致。
        fingerprint: fingerprintOf(node, inputs),
        params: node.data,
        sourceType: node.type,
        callCount: expansions.length,
        containerKind: containerKindOf(node, index) ?? subContainer,
        // 集合项来源（用于结果溯源）；非批量场景为 null
        collectionItemId: expansion.itemNodeId,
        seq,
      }
      tasks.push(task)
      previousId = task.id
      slotCursor += 1
    })
  })

  return { id: createId('plan'), tasks, scope, mode: executionMode, newDownstream }
}

/** 来源节点的父容器类型：只有能把生成节点装进去的三种容器才算，其余一律视为顶层 */
function containerKindOf(node: NodeSnapshot, index: ReturnType<typeof indexNodes>): ContainerKind {
  const parent = node.parentId ? index.get(node.parentId) : undefined
  if (!parent) return null
  return parent.type === 'board' || parent.type === 'group' || parent.type === 'batch' ? parent.type : null
}

/** 某个节点会发起多少次调用（= 其输入里集合的展开尺寸） */
function callCountOf(node: NodeSnapshot, graph: GraphSnapshot): number {
  const spec = getSpec(node.type)
  if (!spec) return 1
  return expansionCount(spec.collectInputs({ node, graph }))
}
