import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  SKILL_LIMITS,
  validateSkill,
  type Skill,
  type SkillInputMode,
} from '../../domain/prompt/skill'

/**
 * 技能库的读写（用户 2026-09-24）。
 *
 * ## 为什么复用 `presets` 表而不是新建一张
 *
 * `presets` 与技能**结构完全同构**：都是「按 id 存一条 JSON」。
 * 新建表要动 Dexie schema（升到 v3），而数据迁移是**不可逆**的一步 ——
 * 老库升级出问题就是打不开。为一张同构的表付这个代价不值得。
 *
 * 用 id 前缀区分两类行：
 *  - `recipe:|channelId` → 生成配方（既有）
 *  - `skill:|skillId`    → 技能（本文件）
 *
 * 读的时候按前缀过滤，两边互不干扰。
 */

/** 技能行的主键前缀（与 presets 里既有的 `recipe:` 并列） */
const SKILL_ROW_PREFIX = 'skill:'

function skillRowId(id: string): string {
  return `${SKILL_ROW_PREFIX}${id}`
}

/** 表里的一行 → 技能；字段缺失 / 类型不对时**丢弃**（返回 null），不产出半份数据 */
function skillFromRow(row: unknown): Skill | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.skillId === 'string' ? r.skillId : ''
  const name = typeof r.name === 'string' ? r.name : ''
  const content = typeof r.content === 'string' ? r.content : ''
  // 名称与正文是技能的身份，缺任何一个这行都没有意义
  if (!id || !name || !content) return null
  const mode = r.inputMode
  return {
    id,
    name,
    content,
    description: typeof r.description === 'string' ? r.description : '',
    inputMode: (mode === 'image' || mode === 'any' ? mode : 'text') as SkillInputMode,
    tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === 'string') : [],
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
}

function skillToRow(skill: Skill): Record<string, unknown> {
  return {
    id: skillRowId(skill.id),
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    inputMode: skill.inputMode,
    tags: skill.tags,
    updatedAt: skill.updatedAt,
  }
}

export interface SkillStore {
  /** 一次读回全部技能，按更新时间倒序（最近改的在前面） */
  loadAll(): Promise<Skill[]>
  /** 新建；名称与正文经过校验，不合规直接抛错（由调用方转成界面提示） */
  create(input: {
    name: string
    content: string
    description?: string
    inputMode?: SkillInputMode
    tags?: string[]
  }): Promise<Skill>
  /** 整体覆盖保存（编辑走这条） */
  save(skill: Skill): Promise<void>
  remove(id: string): Promise<void>
}

export function createSkillStore(storage: StoragePort): SkillStore {
  return {
    async loadAll() {
      try {
        const rows = await storage.query('presets', {})
        return rows
          .filter((r) => typeof (r as { id?: unknown }).id === 'string')
          .filter((r) => String((r as { id: string }).id).startsWith(SKILL_ROW_PREFIX))
          .map(skillFromRow)
          .filter((s): s is Skill => !!s)
          .sort((a, b) => b.updatedAt - a.updatedAt)
      } catch {
        // 表可能还不存在（老库未升级到 v2）；读失败一律当「还没有技能」，不阻塞画布
        return []
      }
    },

    async create(input) {
      const err = validateSkill({
        name: input.name,
        content: input.content,
        description: input.description,
      })
      if (err) throw new Error(err)
      const skill: Skill = {
        id: createId('skill'),
        name: input.name.trim().slice(0, SKILL_LIMITS.nameMax),
        content: input.content,
        description: (input.description ?? '').slice(0, SKILL_LIMITS.descriptionMax),
        inputMode: input.inputMode ?? 'text',
        tags: (input.tags ?? []).slice(0, 8),
        updatedAt: Date.now(),
      }
      await storage.put('presets', skillToRow(skill) as never)
      return skill
    },

    async save(skill) {
      const err = validateSkill(skill)
      if (err) throw new Error(err)
      await storage.put(
        'presets',
        skillToRow({ ...skill, updatedAt: Date.now() }) as never,
      )
    },

    async remove(id) {
      try {
        await storage.delete('presets', skillRowId(id))
      } catch {
        // 删不掉就当已删（与配方存储同一口径：偏好写不进不该打断主流程）
      }
    },
  }
}
