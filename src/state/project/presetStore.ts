/**
 * 生成预设的读写（用户 2026-09-17）。
 *
 * 只做两件事：把预设存进 `presets` 表、从表里读回来。
 * 「什么时候记」「失效了怎么兜底」都在 domain/project/generationPreset，
 * 这里不重复那份规则——它只是那个纯函数的存储适配器。
 */
import type { StoragePort } from '../../platform/ports'
import {
  NO_PRESET,
  PRESET_ROW_ID,
  presetFromRow,
  presetToRow,
  type GenerationPreset,
} from '../../domain/project/generationPreset'

export interface PresetStore {
  /** 读取当前预设；没有 / 数据不可信时返回空预设 */
  load(): Promise<GenerationPreset>
  /** 写入预设 */
  save(preset: GenerationPreset): Promise<void>
}

export function createPresetStore(storage: StoragePort): PresetStore {
  return {
    async load() {
      // 表可能还不存在（老库未升级到 v2）；读失败一律当「没预设」，不阻塞建节点
      try {
        const rows = await storage.query('presets', { id: PRESET_ROW_ID })
        return presetFromRow(rows[0])
      } catch {
        return NO_PRESET
      }
    },
    async save(preset) {
      try {
        await storage.put('presets', presetToRow(preset) as never)
      } catch {
        // 偏好写不进去不该打断生成流程：最坏情况只是下次还得手选
      }
    },
  }
}
