import type { StoragePort } from '../../platform/ports'
import {
  DEFAULT_INSPIRATION_SOURCES,
  customInspirationSource,
  type InspirationMediaKind,
  type InspirationSource,
} from '../../domain/inspiration/sources'

/** 来源配置是用户资产：放 `presets`，跟全库备份 / 导入导出一起走。 */
export const INSPIRATION_SOURCES_KEY = 'inspiration:sources:v1'

export interface StoredInspirationSource extends InspirationSource {
  enabled: boolean
  /** 上次成功拉到案例的时间；管理面板用它显示“同步于”。 */
  syncedAt?: number
}

function defaults(): StoredInspirationSource[] {
  return DEFAULT_INSPIRATION_SOURCES.map((source) => ({ ...source, enabled: true }))
}

function asStoredSource(value: unknown): StoredInspirationSource | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id.trim() : ''
  const name = typeof row.name === 'string' ? row.name.trim() : ''
  const repo = typeof row.repo === 'string' ? row.repo.trim() : ''
  const dataUrl = typeof row.dataUrl === 'string' ? row.dataUrl.trim() : ''
  if (!id || !name || !repo || !dataUrl) return null
  const format = row.format === 'json' ? 'json' : 'readme'
  const readmeStyle =
    row.readmeStyle === 'pico' || row.readmeStyle === 'youmind' || row.readmeStyle === 'youmindAll'
      ? row.readmeStyle
      : undefined
  const modelCategory =
    typeof row.modelCategory === 'string' && row.modelCategory.trim()
      ? row.modelCategory.trim()
      : '其他'
  const kind: InspirationMediaKind = row.kind === 'video' ? 'video' : 'image'
  return {
    id,
    name,
    repo,
    dataUrl,
    imageBase: typeof row.imageBase === 'string' ? row.imageBase : '',
    note: typeof row.note === 'string' ? row.note : '',
    format,
    ...(readmeStyle ? { readmeStyle } : {}),
    modelCategory,
    kind,
    builtin: row.builtin === true,
    ...(typeof row.fallbackDataUrl === 'string' && row.fallbackDataUrl
      ? { fallbackDataUrl: row.fallbackDataUrl }
      : {}),
    enabled: row.enabled !== false,
    ...(typeof row.syncedAt === 'number' && Number.isFinite(row.syncedAt)
      ? { syncedAt: row.syncedAt }
      : {}),
  }
}

export async function loadInspirationSources(
  storage: StoragePort,
): Promise<StoredInspirationSource[]> {
  const rows = (await storage.query('presets', { id: INSPIRATION_SOURCES_KEY })) as unknown as {
    sources?: unknown
  }[]
  const stored = rows[0]?.sources
  if (Array.isArray(stored)) {
    const normalized = stored.map(asStoredSource).filter((x): x is StoredInspirationSource => !!x)
    return normalized
  }
  const seeded = defaults()
  await saveInspirationSources(storage, seeded)
  return seeded
}

export async function saveInspirationSources(
  storage: StoragePort,
  sources: readonly StoredInspirationSource[],
): Promise<void> {
  await storage.put('presets', {
    id: INSPIRATION_SOURCES_KEY,
    sources: [...sources],
    updatedAt: Date.now(),
  })
}

export function addCustomInspirationSource(
  sources: readonly StoredInspirationSource[],
  input: {
    name: string
    repo: string
    modelCategory: string
    kind: InspirationMediaKind
  },
): { sources: StoredInspirationSource[]; added: StoredInspirationSource } | null {
  const source = customInspirationSource(input)
  if (!source) return null
  const withoutSame = sources.filter((item) => item.id !== source.id)
  const added: StoredInspirationSource = { ...source, enabled: true }
  return { sources: [...withoutSame, added], added }
}

export function updateInspirationSource(
  sources: readonly StoredInspirationSource[],
  id: string,
  patch: Partial<Pick<StoredInspirationSource, 'enabled' | 'syncedAt'>>,
): StoredInspirationSource[] {
  return sources.map((source) => (source.id === id ? { ...source, ...patch } : source))
}

export function removeInspirationSource(
  sources: readonly StoredInspirationSource[],
  id: string,
): StoredInspirationSource[] {
  return sources.filter((source) => source.id !== id)
}

export function moveInspirationSource(
  sources: readonly StoredInspirationSource[],
  id: string,
  delta: -1 | 1,
): StoredInspirationSource[] {
  const index = sources.findIndex((source) => source.id === id)
  const nextIndex = index + delta
  if (index < 0 || nextIndex < 0 || nextIndex >= sources.length) return [...sources]
  const next = [...sources]
  const [item] = next.splice(index, 1)
  if (!item) return next
  next.splice(nextIndex, 0, item)
  return next
}
