import { panelRunFromRecord } from '../../../domain/comic/panel/panelRunRecord'
import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import type { RunTask } from '../../../domain/shared/execution/plan'
import type { GeneratedAsset } from '../../../platform/channels/types'
import type { ComicCommand } from '../../../state/workbenches/comic/reducer'
import type { ExecutionPlacement } from '../../shared/execution/placement'

/**
 * comic 落位适配器（M6-5 路径 B 的**第二个实现**）。
 *
 * 它的存在就是调研稿 §5.5 所等待的那件事：只有画布一个消费者时，
 * `ExecutionPlacement` 的接口是猜的；comic 这个真实消费者给出了边界——
 *
 * | 回调 | canvas（CanvasPlacement） | comic（本文件） |
 * | --- | --- | --- |
 * | begin | 按槽位 reuse / 新建承载节点（要写命令） | 格本身就是落点（零命令） |
 * | commit | node.updateData（assetHash + 缩略图） | panel.setAsset（+ 素材字节落库） |
 * | shouldCollect | 生图入结果组 | 不聚合（无结果组概念） |
 * | record | node.runRecord.append（落 runRecords 表） | panel.runRecord.append（M6-15，留在格内） |
 * | finalize | 结果组 + 逐张子节点 + 素材本体 | 无（返回空） |
 *
 * 两个实现的差异恰好证明「落位/写回是工作台专有的」，把它们留在引擎里就会
 * 逼引擎同时说两种方言——这正是路径 A（如实归位）无法兑现文档意图的原因。
 *
 * **对白不丢**：`commit` 只发 `panel.setAsset`，绝不触碰 `balloons`，
 * 所以重生成画面只会换掉 `assetHash`，对白贴纸原样保留。
 *
 * **M6-15 起 `record` 不再返回 null**：comic 有了自己的版本历史。差别在**住哪儿**——
 * 画布是「图 + 补丁流」双存储，留痕必须另落 `runRecords` 表；comic 是单聚合对象、
 * 单写通道（整对象落一行），留痕天然属于格的内部字段 `ComicPanel.runs`，
 * 随项目一起读回 / 导出 / 归一化。代价是文档变大，但生成是低频操作，交换划算。
 * 版本号**由 reducer 从格自身历史推出**（`appendPanelRun`），适配器只负责把
 * 引擎记录翻译成载荷——`RunRecord` 里没有 version 这个概念。
 */
export interface ComicPlacementOptions {
  /**
   * 素材字节落库（写 `assets` 表，hash 主键——与画布**共用同一张表**）。
   *
   * 为什么不像画布那样做成命令：comic 的 store 是「整对象防抖写一行文档」，
   * 不适合把大体量二进制塞进 `ComicProject`；素材与项目文档分开写更干净。
   * 由宿主注入并负责在其 `onFinish` 前冲刷。
   */
  putAsset: (asset: GeneratedAsset) => void
}

export function createComicPlacement(
  opts: ComicPlacementOptions,
): ExecutionPlacement<RunTask, ComicCommand> {
  return {
    begin(task) {
      // 格自身就是落点：不需要预备命令
      return { targetId: task.nodeId, commands: [] }
    },

    commit(_task, targetId, assets) {
      for (const a of assets) opts.putAsset(a)
      return [{ kind: 'panel.setAsset', panelId: targetId, assetHash: assets[0]?.hash ?? null }]
    },

    shouldCollect() {
      // 产物已由 commit 直接写回格，不做计划末尾聚合（comic 没有结果组概念）
      return false
    },

    record(_task: RunTask, targetId: string, record: RunRecord) {
      // M6-15：把引擎记录翻译成格内的留痕载荷（版本号由 reducer 从历史推出，
      // `panelRunFromRecord` 刻意不产出 version —— 见 PanelRunInput）
      // comic 的 targetId 恒为格自身，故与 task.nodeId 相同。
      return {
        kind: 'panel.runRecord.append',
        panelId: targetId,
        run: panelRunFromRecord(record),
      }
    },

    finalize() {
      return []
    },
  }
}
