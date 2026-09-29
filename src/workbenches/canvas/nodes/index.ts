import { registerView, resetViews, assertRegistryConsistent } from './registry'
import { PromptNodeView } from './prompt/PromptNodeView'
import { GenerationNodeView } from './generation/GenerationNodeView'
import { CompareNodeView } from './compare/CompareNodeView'
import { GroupNodeView } from './group/GroupNodeView'
import { BatchNodeView } from './batch/BatchNodeView'
import { BoardNodeView } from './board/BoardNodeView'
import { LoopNodeView } from './loop/LoopNodeView'
import { FusionNodeView } from './fusion/FusionNodeView'

/**
 * 注册全部节点渲染绑定。
 * 与 domain 侧 registerAllSpecs() 配对：注册完成后会校验「规格类型集合 == 视图类型集合」，
 * 不一致直接抛错（架构 §4.5，避免半成品类型上线）。
 *
 * 启动顺序：务必先 registerAllSpecs() 再 registerAllViews()。
 */
export function registerAllViews(): void {
  resetViews()
  registerView('prompt', { View: PromptNodeView })
  registerView('generation', { View: GenerationNodeView })
  registerView('compare', { View: CompareNodeView })
  registerView('group', { View: GroupNodeView })
  registerView('batch', { View: BatchNodeView })
  registerView('board', { View: BoardNodeView })
  registerView('loop', { View: LoopNodeView })
  registerView('fusion', { View: FusionNodeView })
  assertRegistryConsistent()
}

export {
  registerView,
  getViewBinding,
  getNodeDefinition,
  allViewBindings,
  registeredViewTypes,
  resetViews,
  assertRegistryConsistent,
} from './registry'
export type {
  NodeViewProps,
  NodePanelProps,
  NodeViewEvent,
  NodeViewBinding,
  NodeDefinition,
} from './registry'
