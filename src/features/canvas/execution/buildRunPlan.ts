import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { GenerationData, NodeData, NodeSnapshot, NodeType } from '../../../domain/canvas/model/node'
import { GENERATION_ASSET_MIME } from '../../../domain/canvas/model/node'
import type { NodeInput } from '../../../domain/shared/execution/types'
import type { RunMode, RunScope } from '../../../domain/canvas/model/runRecord'
import type { SlotPlan } from '../../../domain/canvas/layout/slotPlacement'
// 计划外壳与任务基类上移共享执行 domain（M6-5 路径 B）：画布在此**绑定出**自己的任务子类型。
import type { RunPlan as SharedRunPlan, RunTask as SharedRunTask } from '../../../domain/shared/execution/plan'
import type { ExecutionMode } from '../../../domain/shared/execution/types'
import { getSpec } from '../../../domain/canvas/nodeSpecs/registry'
import { topoSort } from '../../../domain/canvas/graph/topoSort'
import { traverseDownstream } from '../../../domain/canvas/graph/traverseDownstream'
import { planSlots } from '../../../domain/canvas/layout/slotPlacement'
import { RATIO_FOLLOW_SOURCE } from '../../../domain/canvas/layout/constants'
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
  /**
   * 产物承载节点该挂在**哪个容器下**（容器运行时 = 那个容器的 id，其余为 null）。
   *
   * 为什么需要它：容器运行的产物若建在容器**外**，那条「源节点 → 承载节点」的
   * 连线就跨越了画板边界，而 §6.14 定死「画板内外不建立边」——连线会被拒
   * （实测 G21 抛 `[command edge.connect] 画板内外不建立边`）。
   * 挂在容器内则两端同属一个画板，连线成立，语义也对：
   * 「运行这个工作区」的结果本就该留在工作区里。
   */
  containerId: string | null
  /**
   * 源节点在画布上的矩形（世界坐标）。
   *
   * 为什么冻结进 task：落位适配器要按「源节点右侧」摆放新建的承载节点，
   * 而它是**执行期**才跑的命令构造（placement.begin），拿不到"此刻"的图快照。
   * 在计划期把源节点矩形一并冻结，落位就能脱离 store 算出位置。
   */
  sourceRect: { x: number; y: number; w: number; h: number }
  /**
   * 源节点的数据快照（平台 / 模型 / 提示词 / 参数）。
   * 新建承载节点时带上它，新节点即可独立重跑，而不是一个空壳。
   */
  sourceData: NodeData
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
 * `rerunAll` 这种「按范围跑」的模式有意义（顶栏按钮 = 全图）。
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
    // rerun：origin + 全部下游
    candidateIds = collectDownstream(originNodeId, working)
  }

  const selected = candidateIds
    .map((id) => index.get(id))
    .filter((n): n is NodeSnapshot => !!n && canBuildRequest(n))

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
      ? ordered.reduce((sum, n) => sum + callCountOf(n, working) * callsPerRunOf(n), 0)
      : 0
  /**
   * N>1 时结果**一律铺新下游节点**（用户 2026-09-17）。
   *
   * 复用已有空槽会让「N张」的结果数目与用户预期对不上：
   * 空槽只有 1 个时，第 1 张落进它、其余才新建 —— 用户看到「选了两张，下游只有一个」。
   * 触发节点与其现有下游都是**输入方**，N 张的结果应当全部并列新建，
   * 与 Alt+R（single-alt）同一条落位规则。
   */
  const multiShot = plannedCalls > 1
  const slots =
    singleRun && originNodeId
      ? planSlots({
          startNodeId: originNodeId,
          graph: working,
          count: Math.max(1, plannedCalls),
          newDownstream: newDownstream || multiShot,
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

      /**
       * 「N张」= N 次独立调用（用户 2026-09-17）。
       *
       * 面板选 2张 / 4张 / 9张，此前是**一次调用 n=N**：渠道一次吐 N 张，
       * 挤进一个结果组，下游只铺 1 个承载节点——用户看到的就是
       * 「选了两张，下游只有一个，后面冒出个结果组」。
       * 更糟的是图生图时一次调用只带一份参考图，中转对 n>1 的参考处理
       * 不可控，出现了「有一张没吃到参考图」。
       *
       * 现在按 `callsPerRunOf` 把 N 拆成 N 次调用，每次 params.count 强制为 1
       * （n=1），各自带参考图、各自按空槽规则落一个节点。
       * 批量集合的展开（expansions）语义不变，两者相乘。
       */
      for (let c = 0; c < callsPerRunOf(node); c += 1) {
        /**
         * 容器运行（画板 / 分组 / 批量的「运行整个容器」）的产物**一律铺新节点**。
         *
         * 此前它们靠结果组装产物；结果组下线后若退回 `reuse` 自己，产物就会被
         * 写回容器内那个节点——而容器运行是新的一次生成，旧产物属于上一版，
         * 覆盖掉等于「重跑把历史抹了」。与节点生成同一条规则：
         * **新的一次生成 = 一个新的承载节点**，挂在自己的右侧。
         */
        const inContainer = (containerKindOf(node, index) ?? subContainer) !== null
        const slot: SlotPlan =
          slots.length > 0
            ? slots[Math.min(slotCursor, slots.length - 1)]!
            : inContainer
              ? { kind: 'new', title: `${node.title}的输出`, connectFrom: node.id }
              : { kind: 'reuse', nodeId: node.id }
        /**
         * 容器运行 → 承载节点挂进**源节点所在的那个容器**（与源节点做兄弟）。
         *
         * 画板运行比较特殊：plan 的 `working` 是 `boardSubgraph` 切出来的子图，
         * 里面**不含画板自己**，所以容器运行时要从 `origin.containerKind` 这一侧
         * 知道「这是容器运行」；而容器 id 仍取源节点的 `parentId`
         * （子节点一定带 parentId，这是 boardSubgraph 的切法保证的）。
         */
        const hostId = inContainer && node.parentId ? node.parentId : null

        /**
         * 图生图：把源节点的图作为**图像输入**带进这次请求。
         *
         * 顺序问题（用户 2026-09-16 指出「新建节点 → 连线 → 结果落新节点」）：
         * `inputs` 在**本函数**（buildRunPlan）里按图上已有连线收集，而承载节点与
         * 那条「源节点 → 承载节点」的连线要等后续 `begin` 的命令才建出来。
         * 于是收集时看不到这条线 → 请求里没有源节点的图 → 走的是文生图路径。
         *
         * 实测证据（mock 的「有图=品红 / 无图=灰度」标记）：
         *   不补 → 灰度；补上 → 品红。故这一步是必需的，不是防御性代码。
         *
         * **落点不是源节点自己就带**（用户 2026-09-17）：此前只给 `slot.kind === 'new'`
         * 带，复用下游空节点时不带——用户复用已有空输出节点跑图生图，
         * 那一张就退化成了文生图（「有一张没参考」的另一半根因）。
         *
         * 基于 `expansion.inputs`（已按集合项展开），避免把整个批量集合项塞进去。
         */
        const sourceAsset = (node.data as GenerationData).assetHash
        const targetIsSelf = slot.kind === 'reuse' && slot.nodeId === node.id
        const withSourceImage: NodeInput[] =
          !targetIsSelf && sourceAsset && !expansion.inputs.some((i) => i.kind === 'asset')
            ? [
                ...expansion.inputs,
                { kind: 'asset', nodeId: node.id, assetHash: sourceAsset, mime: GENERATION_ASSET_MIME },
              ]
            : expansion.inputs

        /**
         * 「跟随素材」比例（批量节点专属，用户 2026-09-17）：
         * 本次调用的出图比例 = **这一项素材自己的原始比例**。
         *
         * 放在展开之后、按本次那一项单独覆盖，正是因为集合展开出的 N 次调用
         * 共用同一份 params——统一比例没问题，但「各随各的」必须逐次算。
         * 素材没有尺寸信息（老数据 / 未解码）时退回不指定，不猜一个比例。
         */
        const source = request.params as { ratio?: unknown }
        const followSource = source.ratio === RATIO_FOLLOW_SOURCE
        const picked = expansion.inputs.find(
          (i): i is Extract<NodeInput, { kind: 'asset' }> => i.kind === 'asset' && !!i.naturalSize,
        )
        const followed = followSource && picked?.naturalSize ? picked.naturalSize : null
        const singleRequest = {
          ...request,
          params: {
            ...request.params,
            count: 1,
            ...(followSource
              ? {
                  ratio: followed
                    ? `${Math.round(followed.width)}:${Math.round(followed.height)}`
                    : null,
                  // 供落位侧把承载节点也按这个比例建（与请求一致，避免建完再跳尺寸）
                  followSourceSize: followed ?? null,
                }
              : {}),
          },
        }

        const task: CanvasRunTask = {
          id: createId('task'),
          nodeId: node.id,
          // 指纹仍按**真实收集到的输入**计算，避免刚生成完就把自己标陈旧
          request: { ...singleRequest, inputs: withSourceImage },
          dependsOn: previousId ? [previousId] : [],
          slot,
          // 指纹包含完整集合（未展开）：集合内容变了才算输入变了，
          // 逐项 task 共用同一指纹，陈旧判定与「一次生成」语义一致。
          fingerprint: fingerprintOf(node, inputs),
          params: node.data,
          sourceType: node.type,
          callCount: expansions.length,
          containerKind: containerKindOf(node, index) ?? subContainer,
          containerId: hostId,
          // 落位要用「源节点在画布上的位置」把新建节点摆在它右侧（用户 2026-09-16）
          sourceRect: { x: node.x, y: node.y, w: node.w, h: node.h },
          sourceData: node.data,
          // 集合项来源（用于结果溯源）；非批量场景为 null
          collectionItemId: expansion.itemNodeId,
          // 跨「集合展开 × 张数」连续编号：applyCallOrdinal 用它给 prompt
          // 加「第 n 次/项」后缀，保证多次调用的产物 hash 互不相同
          seq: seq * callsPerRunOf(node) + c,
        }
        tasks.push(task)
        previousId = task.id
        slotCursor += 1
      }
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

/**
 * 该节点一次「生成」要发起的调用数（面板「N张」）。
 *
 * 只对图片模式的生成节点生效：`2张` 的语义是**两次独立调用**（每次 n=1），
 * 而不是一次调用 n=2——后者会让下游只铺一个节点、产物挤进结果组，
 * 且图生图时参考图的生效与否取决于中转对 n>1 的实现（用户 2026-09-17 实测翻车）。
 * 视频 / 其他类型没有「张数」概念，恒为 1。
 */
function callsPerRunOf(node: NodeSnapshot): number {
  if (node.type !== 'generation') return 1
  const data = node.data as Partial<GenerationData>
  if (data.mode === 'video') return 1
  const n = Math.floor(data.count ?? 1)
  return Number.isFinite(n) && n > 1 ? n : 1
}
