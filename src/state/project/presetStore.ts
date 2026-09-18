/**
 * 生成配方的读写（用户 2026-09-17 提，2026-09-18 改为按项目一份）。
 *
 * 只做两件事：把配方存进 `presets` 表、按项目读回来。
 * 「什么时候记」「失效了怎么兜底」都在 domain/project/generationPreset，
 * 这里不重复那份规则——它只是那个纯函数的存储适配器。
 */
import type { StoragePort } from '../../platform/ports'
import {
  NO_RECIPE,
  presetRowId,
  recipeFromRow,
  recipeToRow,
  type GenerationRecipe,
} from '../../domain/project/generationPreset'

export interface PresetStore {
  /** 读取该项目的配方；没有 / 数据不可信时返回空配方 */
  load(projectId: string): Promise<GenerationRecipe>
  /** 写入该项目的配方 */
  save(projectId: string, recipe: GenerationRecipe): Promise<void>
}

export function createPresetStore(storage: StoragePort): PresetStore {
  return {
    async load(projectId) {
      // 表可能还不存在（老库未升级到 v2）；读失败一律当「没配方」，不阻塞建节点
      try {
        const rows = await storage.query('presets', { id: presetRowId(projectId) })
        return recipeFromRow(rows[0])
      } catch {
        return NO_RECIPE
      }
    },
    async save(projectId, recipe) {
      try {
        await storage.put('presets', recipeToRow(projectId, recipe) as never)
      } catch {
        // 偏好写不进去不该打断生成流程：最坏情况只是下次还得手选
      }
    },
  }
}
