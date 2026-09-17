import type { RunPlan, RunTask } from '../../../domain/shared/execution/plan'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import type { GeneratedAsset } from '../../../platform/channels/types'

/**
 * 落位 / 写回适配器（架构 §5.5，M6-5 路径 B 的核心）。
 *
 * 背景（`轻画-comic形态调研.md` §5.4）：`runEngine` 不只是「import 了画布的类型」，
 * 它的**落位与写回逻辑本身就是画布命令形状的**——硬编码了 `node.create` /
 * `node.updateData` / `node.runRecord.append` / `resultGroup.create` / `asset.put`，
 * 还调用 `generationSpec.createDefaultData()` 与 `RESULT_CELL`。所以引擎无法简单上移。
 *
 * 解法：把这些**工作台专有的落位/写回**抽成这个注入式接口。引擎只负责
 * 「调度 → 调用渠道 → 重试 → 把产物交给适配器回答怎么落」，命令怎么做由适配器决定。
 * canvas 提供 `CanvasPlacement`（槽位 + 结果组），comic 提供 `ComicPlacement`（直接写回格）——
 * 第二个实现反过来定义了接口边界（调研稿 §5.5：只有画布一个消费者时接口是猜的）。
 */
export interface PlacementTarget<TCommand> {
  /** 结果落点句柄：引擎只在后续回调里原样传回，**不解读**其内容 */
  targetId: string
  /** 调用渠道前需先落库的准备命令（canvas：新建承载节点；comic：无需准备，返回空） */
  commands: TCommand[]
}

/** 引擎聚合的产物条目：按来源 id 分组后交给适配器做计划收尾落位 */
export interface CollectedAsset {
  /** 来源主体 id（canvas：画布节点；comic：分镜格） */
  sourceId: string
  /** 集合项来源（§6.12）；非批量场景为 null */
  itemId: string | null
  /** 同主体内第几次调用（从 0 起） */
  seq: number
  asset: GeneratedAsset
}

export interface ExecutionPlacement<TTask extends RunTask, TCommand> {
  /**
   * 调用渠道前：确定结果落点。
   *
   * `isRepeat`：同一主体展开出的**后续**调用（批量集合卡，seq > 0）。
   * canvas 据此决定「复用原节点」还是「另起承载节点」；comic 单格单调用，恒为 false。
   */
  begin(
    task: TTask,
    ctx: {
      isRepeat: boolean
      /**
       * 本计划里**第几个**槽位（从 0 起）与**总槽位数**。
       *
       * 用于把多个新建承载节点按 §6.9 的格位规则排布（N=4 为 2×2、5–8 每排 4 个），
       * 否则逐个 `begin` 时不知道总数与序号，N 个新节点会算成同一坐标而重叠。
       */
      slotIndex: number
      slotCount: number
    },
  ): PlacementTarget<TCommand>
  /** 成功写回：把产物挂到目标上（canvas：assetHash + 缩略图顺序） */
  commit(task: TTask, targetId: string, assets: GeneratedAsset[]): TCommand[]
  /**
   * 是否把本次产物计入「计划末尾的聚合落位」（`finalize`）。
   * canvas：生图成功即入结果组；comic：产物已由 commit 直接写回格，不再聚合。
   */
  shouldCollect(task: TTask, assets: GeneratedAsset[]): boolean
  /**
   * 一次调用的留痕命令（RunRecord，「从不删除」是硬性要求，产品文档 §6.21）。
   * 返回 `null` 表示该工作台暂不落留痕（如 comic 尚未引入版本历史）——
   * 引擎据此跳过写入，不强迫每个工作台都立刻具备同一能力。
   *
   * `targetId` 是 `begin` 交回的结果落点（不透明句柄）。适配器据此把记录挂到
   * **真正收到产物的那个主体**上：canvas 新建了承载节点时记录应跟到新节点，
   * 而不是一律写回触发节点（用户 2026-09-16 报「生成状态/记录仍在原始节点」）。
   */
  record(task: TTask, targetId: string, record: RunRecord): TCommand | null
  /**
   * 计划收尾：把聚合到的产物落成工作台自己的形态。
   * canvas：结果组 + 逐张子节点 + 素材本体；comic：无需收尾（返回空数组）。
   */
  finalize(plan: RunPlan<TTask>, collected: readonly CollectedAsset[]): TCommand[]
}
