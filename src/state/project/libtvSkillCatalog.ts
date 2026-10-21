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

export const LIBTV_CATALOG_TOTAL = 1472
export const LIBTV_BODY_TOTAL = 704

let catalogPromise: Promise<LibtvSkill[]> | null = null

/**
 * 目录和正文都在 `public/libtv-skills/`，不能在启动模块里 import 2MB JSON
 * 或 704 份 Markdown。开发期那样会让 Vite 把整个目录图卷进首屏转换，
 * 表现为技能页打开很慢、CPU 满载；桌面壳随后可能被连带拖死。
 */
export async function loadLibtvCatalog(): Promise<LibtvSkill[]> {
  if (catalogPromise) return catalogPromise
  catalogPromise = (async () => {
    const response = await fetch(`${import.meta.env.BASE_URL}libtv-skills/catalog.json`, {
      cache: 'force-cache',
    })
    if (!response.ok) throw new Error(`LibTV 技能目录读取失败（HTTP ${response.status}）`)
    const catalog = (await response.json()) as LibtvCatalogFile
    return Array.isArray(catalog.items) ? catalog.items : []
  })()
  try {
    return await catalogPromise
  } catch (error) {
    catalogPromise = null
    throw error
  }
}

export function libtvCategoryCounts(
  skills: readonly LibtvSkill[],
): Map<LibtvCategory, number> {
  const counts = new Map<LibtvCategory, number>(LIBTV_CATEGORIES.map((category) => [category, 0]))
  for (const skill of skills) {
    const category = libtvCategoryOf(skill)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return counts
}

const bodyCache = new Map<string, Promise<string | null>>()
const bodyShardCache = new Map<string, Promise<Record<string, string> | null>>()

function bodyShardOf(bodyFile: string): string {
  const name = bodyFile.split('/').pop()?.toLowerCase() ?? ''
  const first = name[0]
  if (first && /^[0-9a-f]$/.test(first)) return first
  return '_'
}

function loadBodyShard(bodyFile: string): Promise<Record<string, string> | null> {
  const shard = bodyShardOf(bodyFile)
  const cached = bodyShardCache.get(shard)
  if (cached) return cached
  const request = (async () => {
    const response = await fetch(
      `${import.meta.env.BASE_URL}libtv-skills/bodies/${shard}.json`,
      { cache: 'force-cache' },
    )
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`Skill 正文分片读取失败（HTTP ${response.status}）`)
    const payload = (await response.json()) as unknown
    return payload && typeof payload === 'object' ? (payload as Record<string, string>) : {}
  })()
  bodyShardCache.set(shard, request)
  request.catch(() => bodyShardCache.delete(shard))
  return request
}

export async function loadLibtvSkillBody(skill: LibtvSkill): Promise<string | null> {
  const bodyFile = skill.bodyFile
  if (!bodyFile) return null
  const cached = bodyCache.get(bodyFile)
  if (cached) return cached
  const request = (async () => {
    const shard = await loadBodyShard(bodyFile)
    const value = shard?.[bodyFile]
    return typeof value === 'string' && value.trim() ? value.trim() : null
  })()
  bodyCache.set(bodyFile, request)
  try {
    return await request
  } catch (error) {
    bodyCache.delete(bodyFile)
    throw error
  }
}
