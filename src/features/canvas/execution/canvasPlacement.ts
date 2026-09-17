/**
 * 画布落位适配器（架构 §5.5，M6-5 路径 B）。
 *
 * 它承载了原先**硬编码在 runEngine 里**的全部画布专有落位/写回逻辑，一字不改地搬过来：
 *  - `begin`   ：槽位计划 → 复用已有节点 / 新建承载节点（`node.create`）
 *  - `commit`  ：成功产物 → `node.updateData`（assetHash + 缩略图顺序 + 产物真实像素；
 *                单一产物顺带把节点改成产物比例，§6.16）
 *  - `record`  ：RunRecord → `node.runRecord.append`
 *  - `finalize`：聚合产物 → `resultGroup.create` + `asset.put` + 逐张结果子节点
 *                （`generationSpec.createDefaultData()` + `RESULT_CELL`）
 *
 * 这样共享引擎就彻底不认识画布命令了。
 */
import type { RunRecord as CanvasRunRecord } from '../../../domain/canvas/model/runRecord'
import type { Command } from '../../../state/commands'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import { RESULT_CELL } from '../../../domain/canvas/layout/constants'
import { assetNodeSize, ratioNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import type { GenerationData } from '../../../domain/canvas/model/node'
/**
 * 多结果的排布**复用结果组的格位规则**（§6.9 第 638–645 行）：
 * N=2 单行、N=3 单行、N=4 为 2×2、5–8 每排最多 4 个、>8 每排 4 个自动扩展。
 *
 * 不另写一套：结果组落位（`layoutResultGroup`）内部就是调 `resultGroupCells`，
 * 两者共用同一个纯函数，排布口径天然一致。
 */
import { resultGroupCells } from '../../../domain/canvas/layout/resultGroupLayout'
import { createId } from '../../../shared/id'
import type { CollectedAsset, ExecutionPlacement } from '../../shared/execution/placement'
import type { CanvasRunTask } from './buildRunPlan'

/** 新建承载节点与源节点的水平间距（用户 2026-09-16：新节点落在源节点右侧） */
const NEW_NODE_GAP_X = 72

/**
 * 是否把本次产物计入「计划末尾的聚合落位」（结果组）。
 *
 * 规则（§6.16，2026-09-13 用户拍板）：
 * - **一次调用出 N ≥ 2 张**：进结果组，组内一律用统一格位 `RESULT_CELL`（容器语义 = 版面整齐）；
 * - **同一主体展开多次调用**（批量上游 / 批量自身）：合计也是多张，同样进组；
 *   （`shouldCollect` 是逐次调用的，只看得见本次这 1 张，故要另看 `callCount`）
 * - **单一产物**：生成节点**自己**就能呈现产物，不建组——此时节点按产物真实比例，
 *   这正是「结果组里的那张拖出来就恢复比例」的同一条规则（进了容器才让渡比例）；
 * - **容器类来源例外**：分组 / 批量本体是 3×3 集合、画板是被收纳的工作区，
 *   它们自身不呈现单张产物（画板里的生成节点产物属于那次**容器运行**），
 *   N=1 也照旧进结果组，否则产物会写到一个看不见它的节点上；
 * - 视频 / 文本产物照旧不入组（与既有行为一致）。
 */
function shouldCollect(task: CanvasRunTask, assets: readonly unknown[]): boolean {
  if (task.request.kind !== 'image' || assets.length === 0) return false
  if (assets.length > 1 || task.callCount > 1) return true
  if (task.containerKind) return true
  return task.sourceType === 'group' || task.sourceType === 'batch'
}

export function createCanvasPlacement(getProjectId: () => string): ExecutionPlacement<CanvasRunTask, Command> {
  return {
    begin(task, ctx) {
      const { isRepeat } = ctx
      if (task.slot.kind === 'reuse' && !isRepeat) {
        return { targetId: task.slot.nodeId, commands: [] }
      }
      /**
       * 新建承载节点（用户 2026-09-16 定的顺序）：
       *
       *   ① 先**建节点**（落在源节点右侧）
       *   ② 再**连一条线**（源节点 → 新节点，标明这一版产物的来源）
       *   ③ 之后结果落到这个新节点上（由 `commit` 写 `assetHash`）
       *
       * 之前这里只发了 `node.create`、`at` 写死原点、不建连线，
       * 于是新节点孤零零落在左上角且没有来源关系。
       */
      const connectFrom = task.slot.kind === 'new' ? task.slot.connectFrom : undefined
      const source = task.sourceRect
      /**
       * 位置与尺寸都按 §6.9 格位规则算：以源节点右侧的虚拟容器为基准取第 slotIndex 格。
       * 格位尺寸 = 按**请求比例**算出的节点尺寸，于是
       * 「选的比例和像素多大，新建的节点就多大」（用户 2026-09-17 要求）。
       */
      const requestedRatio = (task.sourceData as GenerationData | undefined)?.ratio
      const cell = connectFrom
        ? carrierCellAt(source, ctx.slotIndex, ctx.slotCount, requestedRatio)
        : null
      const at = cell ? { x: cell.x, y: cell.y } : { x: 0, y: 0 }
      // 新节点按请求比例定尺寸（未取到比例时由 node.create 用默认最小尺寸）
      const nodeSize = cell ? { w: cell.w, h: cell.h } : undefined
      const targetId = createId('node')
      const title = task.slot.kind === 'new' ? task.slot.title : `结果 ${(task.seq ?? 0) + 1}`
      /**
       * 新节点的数据必须是**自己的拷贝**：
       *  - 不能与源节点共享同一个 data 对象引用 —— reducer 会原样入库，
       *    两个节点在状态里持有同一份对象，渲染层的引用比较会把
       *    「给新节点写的产物」误判成「源节点也变了」；
       *  - `assetHash` / `naturalSize` / `thumbOrder` 是**上一版的产物**，
       *    新节点应回到「等待生成」的空态，而不是一开始就顶着旧图。
       */
      const data = structuredClone(task.sourceData) as unknown as Record<string, unknown>
      delete data.assetHash
      delete data.naturalSize
      data.thumbOrder = []

      return {
        targetId,
        commands: [
          // ① 建节点
          {
            kind: 'node.create',
            projectId: getProjectId(),
            type: 'generation',
            at,
            id: targetId,
            title,
            data,
            // 按请求比例定尺寸（§6.16「有内容锁原始比例」的落位侧同样适用）
            ...(nodeSize ? { size: nodeSize } : {}),
          },
          // ② 连线：源节点 → 新节点
          ...(connectFrom
            ? [{ kind: 'edge.connect' as const, source: connectFrom, target: targetId }]
            : []),
        ],
      }
    },

    /**
     * 成功写回：产物挂到目标上（assetHash + 缩略图顺序 + 产物真实像素）。
     *
     * 单一产物（不进结果组）时**顺带把节点尺寸改成产物比例**（§6.16）：
     * 不建组意味着这个节点就是用户看到的那张图，留着 240×240 的方框
     * 会在图两侧糊上两条白边——这正是本次要修的表观。
     *
     * 尺寸与 data 走**同一条命令**：分成两条会留下「data 已是新产物、框还是旧比例」
     * 的中间态；而 `node.resize` 需要完整 rect（会顺手移动节点），不适合落位场景。
     */
    commit(task, targetId, assets) {
      const first = assets[0]
      const natural =
        first && first.width && first.height ? { width: first.width, height: first.height } : undefined
      const patch: Record<string, unknown> = {
        assetHash: first?.hash ?? null,
        thumbOrder: assets.map((a) => a.hash),
        naturalSize: natural,
      }
      const size = natural && !shouldCollect(task, assets) ? assetNodeSize(natural) : null
      /**
       * 素材本体**必须在 commit 里落库**，不能等地一步的 `finalize`：
       * 单一产物根本不走 finalize（不建结果组），若只在那里 `asset.put`，
       * 节点会持有一个 assets 表里查不到的 hash —— 图永远渲染不出来。
       * 进了结果组的产物同样先经 commit，故这是**唯一**的落库点（finalize 不再重复写）。
       */
      const stored: Command[] = assets.map((a) => ({
        kind: 'asset.put',
        asset: { hash: a.hash, mime: a.mime, bytes: a.bytes, width: a.width, height: a.height },
      }))
      return [
        ...stored,
        {
          kind: 'node.updateData',
          id: targetId,
          patch,
          ...(size ? { size } : {}),
        },
      ]
    },

    /** 生图成功才入结果组；N=1 的生成节点自己显示产物（§6.16） */
    shouldCollect,

    record(_task, targetId, record) {
      /**
       * 记录挂到**真正收到产物的节点**上，而不是触发节点。
       *
       * 用户 2026-09-16 报「生成状态仍在原始节点」：源节点已有内容时会另建承载节点，
       * 若记录仍写回 `task.nodeId`（源节点），日志里那条就指向一个**并不持有这张图**
       * 的节点，而真正拿到图的新节点在日志里查不到。
       */
      return {
        kind: 'node.runRecord.append',
        nodeId: targetId,
        record: record as CanvasRunRecord,
      }
    },

    finalize(plan, collected) {
      const bySource = groupBySource(collected)
      const cmds: Command[] = []
      for (const [sourceId, entries] of bySource) {
        if (entries.length === 0) continue
        // 与旧实现一致：taskId 取该来源在 plan 里的**首个** task（无论其成败）
        const first = plan.tasks.find((t) => t.nodeId === sourceId)
        const rgId = createId('rg')
        cmds.push({
          kind: 'resultGroup.create',
          sourceNodeId: sourceId,
          taskId: first?.id ?? plan.id,
          count: entries.length,
          id: rgId,
        })
        entries.forEach((entry, i) => {
          const a = entry.asset
          cmds.push({
            kind: 'node.create',
            projectId: getProjectId(),
            type: 'generation',
            at: { x: 0, y: 0 },
            // 组内统一格位（N≥2 才走到这里）；naturalSize 仍如实记下产物真实像素，
            // 供「拖出 / 复制出结果组」时恢复比例（§6.16）——进了容器只是让渡呈现比例，
            // 不是把原始比例忘掉。
            size: RESULT_CELL,
            id: createId('node'),
            title: `结果 ${i + 1}`,
            parentId: rgId,
            data: {
              ...generationSpec.createDefaultData(),
              mode: 'image',
              assetHash: a.hash,
              naturalSize: a.width && a.height ? { width: a.width, height: a.height } : undefined,
              thumbOrder: [a.hash],
              channelId: first?.request.channelId ?? '',
              model: first?.request.model ?? '',
              prompt: first?.request.prompt ?? '',
            },
          })
        })
      }
      return cmds
    },
  }
}

/** 按来源主体分组，保持 collected 的插入顺序（= 各来源首次成功的顺序） */
function groupBySource(collected: readonly CollectedAsset[]): Map<string, CollectedAsset[]> {
  const bySource = new Map<string, CollectedAsset[]>()
  for (const c of collected) {
    const list = bySource.get(c.sourceId)
    if (list) list.push(c)
    else bySource.set(c.sourceId, [c])
  }
  return bySource
}

/**
 * 第 index 个新建承载节点的世界坐标（§6.9 格位规则）。
 *
 * 做法：以「源节点右侧 32px 起、能放下 count 个格位」的虚拟容器为基准，
 * 直接复用 `resultGroupCells` 取第 index 格 —— 于是 N=4 是 2×2、5–8 每排最多 4 个，
 * 与结果组的排布完全同源，不会再出现 N 个节点叠在同一点。
 */
export function carrierCellAt(
  sourceRect: { x: number; y: number; w: number; h: number },
  index: number,
  count: number,
  ratio?: string | null,
): { x: number; y: number; w: number; h: number } {
  const n = Math.max(1, Math.floor(count))
  const i = Math.max(0, Math.min(n - 1, Math.floor(index)))
  /**
   * 格位取**节点实际尺寸**（按请求比例算），而非固定的 RESULT_CELL —— 这就是「轻微重叠」的根因：
   * 格位固定 200×200，而节点按产物比例可能更高（16:9 会算成 427×240）；
   * 行距 = 200 + 16 = 216 < 240，于是相邻两行吃掉间距而叠在一起（用户 2026-09-17 报）。
   * 按实际边界排布后，步长 = 实际高 + 16，天然留出可见间隔。
   */
  const cell = ratioNodeSize(ratio)
  const columns = columnsForCarrier(n)
  const rows = Math.ceil(n / columns)
  const containerW = PAD * 2 + columns * cell.w + (columns - 1) * GAP
  const containerH = PAD * 2 + rows * cell.h + (rows - 1) * GAP
  const containerRect = {
    x: sourceRect.x + sourceRect.w + NEW_NODE_GAP_X,
    y: sourceRect.y + sourceRect.h / 2 - containerH / 2,
    w: containerW,
    h: containerH,
  }
  const cells = resultGroupCells({ containerRect, count: n, cell })
  const c = cells[i]!
  return { x: c.x, y: c.y, w: cell.w, h: cell.h }
}

/** 与 resultGroupLayout.columnsFor 同口径：≤3 一行、4 为 2 列、其余最多 4 列 */
function columnsForCarrier(count: number): number {
  if (count <= 3) return count
  if (count === 4) return 2
  return 4
}

/** §6.9 组内间距 / 内边距（与 resultGroupLayout 的常量同源） */
const GAP = 16
const PAD = 16

/** 画布落位适配器类型别名（供宿主与测试显式标注） */
export type CanvasPlacement = ExecutionPlacement<CanvasRunTask, Command>
