import type { StoragePort } from '../../platform/ports'
import {
  PRESET_TEXT_ACTIONS,
  validatePresetText,
  type PromptToolAction,
} from '../../domain/prompt/presetText'

/**
 * 功能预设词的读写（后台中枢，用户 2026-09-25）。
 *
 * ## 为什么复用 `presets` 表
 *
 * `presets` 就是「按 id 存一条 JSON」，与预设词结构同构。
 * 新建表要动 Dexie schema，而 schema 升级是**不可逆**的一步 —— 为一张同构的表
 * 付这个代价不值得。用 id 前缀区分三类行：
 *
 *  - `recipe:|channelId` → 生成配方（既有）
 *  - `skill:|skillId`    → 旧技能行（2026-10-01 后由 skillStore 迁移到 `skills`）
 *  - `presetText:|action` → 功能预设词（本文件）
 *
 * ## 为什么一处只存一条、整体覆盖
 *
 * 只有三个固定动作，数量恒定。整份存一行（而不是每个动作一行）让「读」只有一次查询、
 * 「写」天然原子 —— 不会出现「优化存进去了、翻译没存进去」的半份状态。
 */

const PRESET_TEXT_ROW_ID = 'presetText:tools'

/** 表里一行 → 覆盖表；任何不合规格的值一律**丢弃**（回落默认） */
function overridesFromRow(row: unknown): Partial<Record<PromptToolAction, string>> {
  if (!row || typeof row !== 'object') return {}
  const raw = (row as { values?: unknown }).values
  if (!raw || typeof raw !== 'object') return {}
  const src = raw as Record<string, unknown>
  const out: Partial<Record<PromptToolAction, string>> = {}
  for (const action of PRESET_TEXT_ACTIONS) {
    const v = src[action]
    // 空串与超限都不收：宁可回落默认，也不要让一段坏指令进请求
    if (typeof v === 'string' && v.trim() && !validatePresetText(v)) out[action] = v
  }
  return out
}

export interface PresetTextStore {
  /** 读回全部覆盖值（缺项 = 用默认） */
  load(): Promise<Partial<Record<PromptToolAction, string>>>
  /** 写入一个动作的预设词；传 null = 清除覆盖（恢复默认） */
  save(action: PromptToolAction, content: string | null): Promise<void>
}

export function createPresetTextStore(storage: StoragePort): PresetTextStore {
  return {
    async load() {
      try {
        const rows = await storage.query('presets', { id: PRESET_TEXT_ROW_ID })
        return overridesFromRow(rows[0])
      } catch {
        // 表可能不存在（极老的库）；读失败一律当「全是默认」，不阻塞后台设置页
        return {}
      }
    },

    async save(action, content) {
      // 先把现有覆盖读出来：只有三个动作、数量恒定，整行覆盖比逐字段更新简单可靠
      const current = await this.load()
      const next: Partial<Record<PromptToolAction, string>> = { ...current }
      if (content === null) {
        delete next[action]
      } else {
        const err = validatePresetText(content)
        if (err) throw new Error(err)
        next[action] = content
      }
      try {
        await storage.put('presets', { id: PRESET_TEXT_ROW_ID, values: next } as never)
      } catch {
        // 与配方 / 技能同一口径：偏好写不进不该打断主流程
      }
    },
  }
}
