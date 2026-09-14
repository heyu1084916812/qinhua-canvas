import type { NodeData } from './node'
import type { RunRecord as SharedRunRecord } from '../../shared/execution/runRecord'

/**
 * 画布工作台对共享执行词的**绑定层**（M6-5 路径 B）。
 *
 * 拆分理由（调研稿 §5.5）：`RunRecord` / `NodeInput` / `RunScope` / `RunMode` /
 * 生成记录相关的纯函数没有一丝画布专有结构，已上移到 `domain/shared/execution`，
 * 好让共享执行引擎同时服务 canvas 与 comic。本文件只做一件事——
 * 把泛型的 `RunRecord<TParams>` **特化**成画布的 `RunRecord = RunRecord<NodeData>`，
 * 使画布侧 10 余处调用点零改动（版本历史 / 时间轴 / 命令层 / 执行宿主皆从本路径取）。
 *
 * 若将来画布不再需要这个特化名，可直接改 import 路径到 shared，本文件即删。
 */
export type { RunScope, RunMode, ExecutionMode, RunStatus, NodeInput } from '../../shared/execution/types'

/** 画布侧生成记录：参数快照固定为 `NodeData`（提示词 / 生成 / 分组 / 批量 / 画板数据） */
export type RunRecord = SharedRunRecord<NodeData>

export {
  createRunRecord,
  liveFingerprintOf,
  nextVersion,
  inputsSummaryOf,
  filterRunRecords,
} from '../../shared/execution/runRecord'
