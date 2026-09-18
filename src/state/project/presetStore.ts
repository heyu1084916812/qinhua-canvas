/**
 * 生成配方的读写（用户 2026-09-17 提，2026-09-18 收口为**按渠道一份**）。
 *
 * 只做两件事：把配方存进 `presets` 表、按渠道读回来。
 * 「什么时候记」「失效了怎么兜底」都在 domain/project/generationPreset，
 * 这里不重复那份规则——它只是那个纯函数的存储适配器。
 *
 * 键为什么是 `channelId` 而不是 `projectId`：见 generationPreset 的模块注释——
 * 本项目统一走渠道，参考项目按执行模式分桶的那一层在这里天然等价于渠道这一层。
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
  /** 读取该渠道的配方；没有 / 数据不可信时返回空配方 */
  load(channelId: string): Promise<GenerationRecipe>
  /** 写入该渠道的配方 */
  save(recipe: GenerationRecipe): Promise<void>
  /** 一次读回全部配方，供面板兜底时同步查表（避免逐个 await） */
  loadAll(): Promise<Map<string, GenerationRecipe>>
}

export function createPresetStore(storage: StoragePort): PresetStore {
  return {
    async load(channelId) {
      // 表可能还不存在（老库未升级）；读失败一律当「没配方」，不阻塞建节点
      try {
        const rows = await storage.query('presets', { id: presetRowId(channelId) })
        return recipeFromRow(rows[0])
      } catch {
        return NO_RECIPE
      }
    },
    async save(recipe) {
      try {
        await storage.put('presets', recipeToRow(recipe) as never)
      } catch {
        // 偏好写不进去不该打断生成流程：最坏情况只是下次还得手选
      }
    },
    async loadAll() {
      const out = new Map<string, GenerationRecipe>()
      try {
        const rows = await storage.query('presets', {})
        for (const row of rows) {
          const recipe = recipeFromRow(row)
          if (recipe.channelId) out.set(recipe.channelId, recipe)
        }
      } catch {
        // 同上：读不到就退化为「谁都没记过」，由解析链兜底
      }
      return out
    },
  }
}
