import rawCatalog from '../../assets/libtv-skills/catalog.json'
import {
  LIBTV_CATEGORIES,
  libtvCategoryOf,
  type LibtvCategory,
  type LibtvSkill,
} from '../../domain/prompt/libtvSkill'

interface LibtvCatalogFile {
  source: string
  importedAt: string
  total: number
  bodyCount: number
  items: LibtvSkill[]
}

const catalog = rawCatalog as LibtvCatalogFile

export const LIBTV_SKILLS: readonly LibtvSkill[] = catalog.items
export const LIBTV_CATALOG_TOTAL = catalog.total
export const LIBTV_BODY_TOTAL = catalog.bodyCount

export const LIBTV_BY_ID = new Map(LIBTV_SKILLS.map((skill) => [skill.id, skill]))

export const LIBTV_CATEGORY_COUNTS = (() => {
  const counts = new Map<LibtvCategory, number>(LIBTV_CATEGORIES.map((category) => [category, 0]))
  for (const skill of LIBTV_SKILLS) {
    const category = libtvCategoryOf(skill)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return counts
})()

/**
 * 正文按详情打开时再加载。`catalog.json` 只保留索引，避免首屏背着全部 Markdown。
 */
const bodyLoaders = import.meta.glob('../../assets/libtv-skills/bodies/*.md', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export async function loadLibtvSkillBody(skill: LibtvSkill): Promise<string | null> {
  if (!skill.bodyFile) return null
  const key = `../../assets/libtv-skills/${skill.bodyFile}`
  const loader = bodyLoaders[key]
  if (!loader) return null
  const body = await loader()
  return body.trim() || null
}
