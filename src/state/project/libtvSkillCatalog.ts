import {
  LIBTV_CATEGORIES,
  libtvCategoryOf,
  libtvHasBody,
  type LibtvCategory,
  type LibtvSkill,
  type LibtvSkillFile,
} from '../../domain/prompt/libtvSkill'

interface LibtvCatalogFile {
  source: string
  importedAt: string
  total: number
  bodyCount: number
  items: LibtvSkill[]
}

export const LIBTV_CATALOG_TOTAL = 764
export const LIBTV_BODY_TOTAL = 764

let catalogPromise: Promise<LibtvSkill[]> | null = null

/**
 * 目录和正文都在 `public/libtv-skills/`，不能在启动模块里 import 2MB JSON
 * 或 764 份 Markdown。开发期那样会让 Vite 把整个目录图卷进首屏转换，
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
    const items = Array.isArray(catalog.items) ? catalog.items : []
    /**
     * 目录里的案例描述不是可执行技能正文。用户要的是“能直接用于 Agent 的
     * Skill 库”，所以只在浏览层暴露带 `bodyFile` 的条目；原始目录仍保留在
     * public 资源里，避免删错正文或以后无法追溯。
     */
    return items.filter(libtvHasBody)
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
  counts.set('全部', skills.length)
  for (const skill of skills) {
    const category = libtvCategoryOf(skill)
    counts.set(category, (counts.get(category) ?? 0) + 1)
  }
  return counts
}

type LibtvBodyEntry = string | Record<string, unknown>

const fileCache = new Map<string, Promise<LibtvSkillFile[] | null>>()
const bodyShardCache = new Map<string, Promise<Record<string, LibtvBodyEntry> | null>>()

function bodyShardOf(bodyFile: string): string {
  const name = bodyFile.split('/').pop()?.toLowerCase() ?? ''
  const first = name[0]
  if (first && /^[0-9a-f]$/.test(first)) return first
  return '_'
}

function loadBodyShard(bodyFile: string): Promise<Record<string, LibtvBodyEntry> | null> {
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
    return payload && typeof payload === 'object'
      ? (payload as Record<string, LibtvBodyEntry>)
      : {}
  })()
  bodyShardCache.set(shard, request)
  request.catch(() => bodyShardCache.delete(shard))
  return request
}

function filesOfEntry(entry: LibtvBodyEntry | undefined): LibtvSkillFile[] {
  if (typeof entry === 'string') {
    const content = entry.trim()
    return content ? [{ path: 'SKILL.md', content }] : []
  }
  if (!entry || typeof entry !== 'object') return []
  return Object.entries(entry)
    .filter(([, value]) => typeof value === 'string' && value.trim())
    .map(([filePath, value]) => ({ path: filePath, content: (value as string).trim() }))
    .sort((left, right) => {
      if (left.path === 'SKILL.md') return -1
      if (right.path === 'SKILL.md') return 1
      return left.path.localeCompare(right.path, 'zh-CN')
    })
}

export async function loadLibtvSkillFiles(skill: LibtvSkill): Promise<LibtvSkillFile[] | null> {
  const bodyFile = skill.bodyFile
  if (!bodyFile) return null
  const cached = fileCache.get(bodyFile)
  if (cached) return cached
  const request = (async () => {
    const shard = await loadBodyShard(bodyFile)
    const files = filesOfEntry(shard?.[bodyFile])
    return files.length ? files : null
  })()
  fileCache.set(bodyFile, request)
  try {
    return await request
  } catch (error) {
    fileCache.delete(bodyFile)
    throw error
  }
}

export async function loadLibtvSkillBody(skill: LibtvSkill): Promise<string | null> {
  const files = await loadLibtvSkillFiles(skill)
  return files?.find((file) => file.path === 'SKILL.md')?.content ?? files?.[0]?.content ?? null
}
