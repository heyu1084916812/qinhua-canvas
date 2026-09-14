import { registerSpec, resetSpecs } from './registry'
import { promptSpec } from './prompt'
import { generationSpec } from './generation'
import { compareSpec } from './compare'
import { groupSpec } from './group'
import { batchSpec } from './batch'
import { boardSpec } from './board'

/**
 * 注册全部节点行为规格。
 * 与 workbenches 侧的 registerAllViews() 配对，两者数量不一致时启动报错（架构 §4.5）。
 */
export function registerAllSpecs(): void {
  resetSpecs()
  registerSpec(promptSpec)
  registerSpec(generationSpec)
  registerSpec(compareSpec)
  registerSpec(groupSpec)
  registerSpec(batchSpec)
  registerSpec(boardSpec)
}

export { getSpec, allSpecs, registeredTypes, resetSpecs } from './registry'
export type { NodeSpec } from './types'
