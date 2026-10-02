import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import {
  SKILL_LIMITS,
  validateSkill,
  type BuiltinSkill,
  type SkillInputMode,
  type UserSkill,
} from '../../domain/prompt/skill'
import { BUNDLED_BUILTIN_SKILLS } from './builtinSkillCatalog'

/**
 * 技能库读写。
 *
 * - `builtinSkills`：随包内置、只读。每次启动按 Markdown 清单幂等同步。
 * - `skills`：用户技能。新建、导入、从内置复制都落这里。
 * - `presets`：只保留旧版本的 `skill:` 行作迁移来源，读一次就搬到 `skills`。
 */
const LEGACY_SKILL_ROW_PREFIX = 'skill:'

function asInputMode(value: unknown): SkillInputMode {
  return value === 'image' || value === 'any' ? value : 'text'
}

function asTags(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((t): t is string => typeof t === 'string') : []
}

/** `skills` 表的一行 → 用户技能；字段不全的行直接丢弃。 */
function userSkillFromRow(row: unknown): UserSkill | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id =
    typeof r.id === 'string' && !r.id.startsWith(LEGACY_SKILL_ROW_PREFIX)
      ? r.id
      : typeof r.skillId === 'string'
        ? r.skillId
        : ''
  const name = typeof r.name === 'string' ? r.name : ''
  const content = typeof r.content === 'string' ? r.content : ''
  if (!id || !name || !content) return null
  return {
    id,
    source: 'user',
    builtinId: typeof r.builtinId === 'string' && r.builtinId ? r.builtinId : undefined,
    name,
    content,
    description: typeof r.description === 'string' ? r.description : '',
    inputMode: asInputMode(r.inputMode),
    tags: asTags(r.tags),
    ...(typeof r.image === 'string' && r.image ? { image: r.image } : {}),
    updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0,
  }
}

function userSkillToRow(skill: UserSkill): Record<string, unknown> {
  return {
    id: skill.id,
    builtinId: skill.builtinId,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    inputMode: skill.inputMode,
    tags: skill.tags,
    ...(skill.image ? { image: skill.image } : {}),
    updatedAt: skill.updatedAt,
  }
}

function builtinSkillFromRow(row: Record<string, unknown>): BuiltinSkill | null {
  const id = typeof row.id === 'string' ? row.id : ''
  const name = typeof row.name === 'string' ? row.name : ''
  const content = typeof row.content === 'string' ? row.content : ''
  if (!id || !name || !content) return null
  return {
    id,
    source: 'builtin',
    name,
    content,
    description: typeof row.description === 'string' ? row.description : '',
    inputMode: asInputMode(row.inputMode),
    tags: asTags(row.tags),
    ...(typeof row.image === 'string' && row.image ? { image: row.image } : {}),
    updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : 0,
  }
}

function builtinSkillToRow(skill: BuiltinSkill): Record<string, unknown> {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    inputMode: skill.inputMode,
    tags: skill.tags,
    ...(skill.image ? { image: skill.image } : {}),
    updatedAt: skill.updatedAt,
  }
}

export interface SkillStore {
  /** 用户技能；保留旧调用名，便于渐进迁移。 */
  loadAll(): Promise<UserSkill[]>
  loadUser(): Promise<UserSkill[]>
  loadBuiltin(): Promise<BuiltinSkill[]>
  create(input: {
    name: string
    content: string
    description?: string
    inputMode?: SkillInputMode
    tags?: string[]
    image?: string
  }): Promise<UserSkill>
  save(skill: UserSkill): Promise<void>
  remove(id: string): Promise<void>
  /** 同一条内置只允许一个用户副本；重复调用返回已有副本。 */
  copyBuiltin(builtin: BuiltinSkill): Promise<UserSkill>
  /** 把用户副本恢复成当前内置正文；没有副本时等价于复制。 */
  restoreBuiltin(builtin: BuiltinSkill): Promise<UserSkill>
}

export function createSkillStore(storage: StoragePort): SkillStore {
  /**
   * 把旧版 `presets` 里的 `skill:` 行搬到 `skills`。
   *
   * 旧数据没有内置来源字段，统一按用户技能处理；复制关系无法可靠反推，
   * 因此不猜 `builtinId`，只保证内容不丢。
   */
  async function migrateLegacySkills(): Promise<void> {
    let rows: Awaited<ReturnType<StoragePort['query']>>
    try {
      rows = await storage.query('presets', {})
    } catch {
      return
    }
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id.startsWith(LEGACY_SKILL_ROW_PREFIX)) continue
      const legacy = userSkillFromRow(row)
      if (legacy) {
        const current = await storage.query('skills', { id: legacy.id })
        if (current.length === 0) await storage.put('skills', userSkillToRow(legacy) as never)
      }
      await storage.delete('presets', row.id)
    }
  }

  async function loadUser(): Promise<UserSkill[]> {
    await migrateLegacySkills()
    const rows = await storage.query('skills', {})
    return rows
      .map(userSkillFromRow)
      .filter((s): s is UserSkill => !!s)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async function loadBuiltin(): Promise<BuiltinSkill[]> {
    await storage.bulkPut('builtinSkills', BUNDLED_BUILTIN_SKILLS.map(builtinSkillToRow) as never)
    const bundledIds = new Set(BUNDLED_BUILTIN_SKILLS.map((s) => s.id))
    const existing = await storage.query('builtinSkills', {})
    for (const row of existing) {
      if (typeof row.id === 'string' && !bundledIds.has(row.id)) {
        await storage.delete('builtinSkills', row.id)
      }
    }
    return BUNDLED_BUILTIN_SKILLS
      .map((s) => builtinSkillFromRow(builtinSkillToRow(s)))
      .filter((s): s is BuiltinSkill => !!s)
  }

  async function copyBuiltin(builtin: BuiltinSkill): Promise<UserSkill> {
    const current = await loadUser()
    const existing = current.find((s) => s.builtinId === builtin.id)
    if (existing) return existing

    const skill: UserSkill = {
      id: createId('skill'),
      source: 'user',
      builtinId: builtin.id,
      name: builtin.name,
      description: builtin.description,
      content: builtin.content,
      inputMode: builtin.inputMode,
      tags: [...builtin.tags],
      updatedAt: Date.now(),
    }
    await storage.put('skills', userSkillToRow(skill) as never)
    return skill
  }

  async function restoreBuiltin(builtin: BuiltinSkill): Promise<UserSkill> {
    const current = await loadUser()
    const existing = current.find((s) => s.builtinId === builtin.id)
    if (!existing) return copyBuiltin(builtin)

    const next: UserSkill = {
      ...existing,
      source: 'user',
      builtinId: builtin.id,
      name: builtin.name,
      description: builtin.description,
      content: builtin.content,
      inputMode: builtin.inputMode,
      tags: [...builtin.tags],
      updatedAt: Date.now(),
    }
    await storage.put('skills', userSkillToRow(next) as never)
    return next
  }

  return {
    loadAll: loadUser,
    loadUser,
    loadBuiltin,

    async create(input) {
      const err = validateSkill({
        name: input.name,
        content: input.content,
        description: input.description,
      })
      if (err) throw new Error(err)
      const skill: UserSkill = {
        id: createId('skill'),
        source: 'user',
        name: input.name.trim().slice(0, SKILL_LIMITS.nameMax),
        content: input.content,
        description: (input.description ?? '').slice(0, SKILL_LIMITS.descriptionMax),
        inputMode: input.inputMode ?? 'text',
        tags: (input.tags ?? []).slice(0, 8),
        ...(input.image ? { image: input.image.slice(0, SKILL_LIMITS.imageMax) } : {}),
        updatedAt: Date.now(),
      }
      await storage.put('skills', userSkillToRow(skill) as never)
      return skill
    },

    async save(skill) {
      const err = validateSkill(skill)
      if (err) throw new Error(err)
      await storage.put(
        'skills',
        userSkillToRow({ ...skill, source: 'user', updatedAt: Date.now() }) as never,
      )
    },

    async remove(id) {
      try {
        await storage.delete('skills', id)
      } catch {
        // 删不掉就当已删：与配方存储同口径，不让一次删除打断主流程。
      }
    },

    copyBuiltin,
    restoreBuiltin,
  }
}
