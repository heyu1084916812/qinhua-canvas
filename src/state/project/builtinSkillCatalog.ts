import {
  parseSkillMarkdown,
  type BuiltinSkill,
} from '../../domain/prompt/skill'

const modules = import.meta.glob('../../assets/builtin-skills/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

/**
 * 随包内置技能的**唯一来源**。
 *
 * 新增 / 修改内置技能时只改 `src/assets/builtin-skills/*.md`；
 * 启动时 `skillStore` 会把这份清单幂等同步到只读的 `builtinSkills` 表。
 */
export const BUNDLED_BUILTIN_SKILLS: readonly BuiltinSkill[] = Object.entries(modules)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([path, raw]) => {
    const fileId = path.split('/').pop()!.replace(/\.md$/i, '')
    const parsed = parseSkillMarkdown(raw, fileId)
    if (!parsed.ok) {
      throw new Error(`[builtinSkills] ${fileId} 解析失败：${parsed.error}`)
    }
    return {
      id: `builtin:${fileId}`,
      ...parsed.skill,
      updatedAt: 0,
      source: 'builtin',
    } satisfies BuiltinSkill
  })
