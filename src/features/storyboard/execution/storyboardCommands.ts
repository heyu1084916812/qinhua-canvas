import type { RunRecord } from '../../../domain/shared/execution/runRecord'
import type {
  StoryboardRunAction,
  StoryboardRunSubject,
} from '../../../domain/storyboard/runTypes'
import type { GeneratedAsset } from '../../../platform/channels/types'

export interface StoryboardCommitMetadata {
  prompt: string
  model: string
  params: unknown
}

/**
 * 漫剧执行命令只描述业务真相的变更与记录落库，不认识画布节点。
 *
 * `storyboard.commit` 的落点由 `subject` 决定；素材字节也随命令一起交给
 * 漫剧自己的写回执行器，后续可选择再显式投影到画布。
 */
export type StoryboardExecutionCommand =
  | {
      kind: 'storyboard.commit'
      planId: string
      taskId: string
      projectId: string
      action: StoryboardRunAction
      subject: StoryboardRunSubject
      assets: readonly GeneratedAsset[]
      metadata: StoryboardCommitMetadata
    }
  | {
      kind: 'runRecord.finalize'
      planId: string
      taskId: string
      record: RunRecord
    }
  | {
      kind: 'storyboard.projection.sync'
      planId: string
      taskId: string
      projectId: string
    }
