import type { StoragePort } from '../../platform/ports'
import type { ExtensionPack, PackPlatform } from '../../domain/pack/pack'
import { createSkillStore } from './skillStore'

/**
 * 扩展包的安装 / 卸载（对账 #386 阶段一）。
 *
 * ## 装进来的东西落在哪
 *
 * - **技能** → `skills` 表；行 id 带包前缀 `pack.<包 id>.<包内 id>`，
 *   于是「两个包用了同一个内部 id」不会互相踩，卸载也能按名单精确删除；
 * - **平台规则** → `presets` 表的一行（`pack:platforms`），与生成配方 / 选路策略
 *   同一张表同一套「按 id 存一条 JSON」的口径 —— 不为它开新表（新表要动 Dexie schema）；
 * - **已装清单** → `presets` 表的一行（`pack:installed`），记着每个包装了哪些 id。
 *   卸载**只按这份名单删**，绝不全表扫 —— "卸载只删包内内容"是硬要求。
 *
 * ## 三条冲突策略必须显式（跳过 / 覆盖 / 另存为副本）
 *
 * 重装同一个包（或装了带同名 id 的包）时不许悄悄决定：用户选哪个就走哪个，
 * 结果里如实报"装了几个、跳过几个、哪几个改了名"。
 */

const INSTALLED_ROW_ID = 'pack:installed'
const PLATFORMS_ROW_ID = 'pack:platforms'

export type PackConflictStrategy = 'skip' | 'overwrite' | 'copy'

export interface InstalledPack {
  id: string
  displayName: string
  version: number
  publisher?: string
  installedAt: number
  /** 这个包装进来（或复用了）的技能行 id —— 卸载按这份名单删 */
  skillIds: string[]
  /** 这个包带进来的平台 id */
  platformIds: string[]
}

export interface PackInstallOutcome {
  installedSkills: number
  /** 命中冲突且策略是"跳过"的（包内 id） */
  skipped: string[]
  /** 被覆盖的既有行 id */
  replaced: string[]
  /** 另存为副本的改名记录（从 → 到） */
  copied: { from: string; to: string }[]
  installedPlatforms: number
}

export interface PackPreview {
  adds: string[]
  replaces: string[]
  skips: string[]
}

export interface PackStore {
  listInstalled(): Promise<InstalledPack[]>
  /** 扩展包带进来的平台规则（调用方与内置那份合并） */
  platforms(): Promise<PackPlatform[]>
  /** 安装前预览：哪些会新增 / 覆盖 / 跳过（界面拿它显示内容清单） */
  preview(pack: ExtensionPack, strategy: PackConflictStrategy): Promise<PackPreview>
  install(pack: ExtensionPack, strategy: PackConflictStrategy): Promise<PackInstallOutcome>
  /** 卸载：只删这个包装进来的技能与平台规则；返回是否真的卸了一个 */
  uninstall(packId: string): Promise<boolean>
}

function installedFromRow(row: unknown): InstalledPack[] {
  if (!row || typeof row !== 'object') return []
  const raw = (row as { packs?: unknown }).packs
  if (!Array.isArray(raw)) return []
  const out: InstalledPack[] = []
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue
    const r = p as Record<string, unknown>
    if (typeof r.id !== 'string' || !r.id) continue
    out.push({
      id: r.id,
      displayName: typeof r.displayName === 'string' ? r.displayName : r.id,
      version: typeof r.version === 'number' ? r.version : 1,
      ...(typeof r.publisher === 'string' && r.publisher ? { publisher: r.publisher } : {}),
      installedAt: typeof r.installedAt === 'number' ? r.installedAt : 0,
      skillIds: Array.isArray(r.skillIds)
        ? r.skillIds.filter((x): x is string => typeof x === 'string')
        : [],
      platformIds: Array.isArray(r.platformIds)
        ? r.platformIds.filter((x): x is string => typeof x === 'string')
        : [],
    })
  }
  return out
}

function platformsFromRow(row: unknown): PackPlatform[] {
  if (!row || typeof row !== 'object') return []
  const raw = (row as { platforms?: unknown }).platforms
  return Array.isArray(raw) ? (raw as PackPlatform[]) : []
}

/** 包内技能 → 库里那一行的 id（包前缀 = 来源可追溯，也避免跨包撞车） */
export function packSkillRowId(packId: string, skillId: string): string {
  return `pack.${packId}.${skillId}`
}

export function createPackStore(storage: StoragePort): PackStore {
  const skills = createSkillStore(storage)

  const readInstalled = async (): Promise<InstalledPack[]> => {
    try {
      const rows = await storage.query('presets', { id: INSTALLED_ROW_ID })
      return installedFromRow(rows[0])
    } catch {
      return []
    }
  }

  const readPlatforms = async (): Promise<PackPlatform[]> => {
    try {
      const rows = await storage.query('presets', { id: PLATFORMS_ROW_ID })
      return platformsFromRow(rows[0])
    } catch {
      return []
    }
  }

  const writeInstalled = async (packs: InstalledPack[]): Promise<void> => {
    await storage.put('presets', { id: INSTALLED_ROW_ID, packs } as never)
  }

  const writePlatforms = async (platforms: PackPlatform[]): Promise<void> => {
    await storage.put('presets', { id: PLATFORMS_ROW_ID, platforms } as never)
  }

  return {
    listInstalled: readInstalled,
    platforms: readPlatforms,

    async preview(pack, strategy) {
      const existing = new Set((await skills.loadUser()).map((s) => s.id))
      const adds: string[] = []
      const replaces: string[] = []
      const skips: string[] = []
      for (const skill of pack.contents.skills) {
        const baseId = packSkillRowId(pack.id, skill.id)
        if (!existing.has(baseId)) adds.push(baseId)
        else if (strategy === 'skip') skips.push(baseId)
        else if (strategy === 'copy') adds.push(`${baseId}.copy2`)
        else replaces.push(baseId)
      }
      return { adds, replaces, skips }
    },

    async install(pack, strategy) {
      const now = Date.now()
      const existing = new Set((await skills.loadUser()).map((s) => s.id))
      const outcome: PackInstallOutcome = {
        installedSkills: 0,
        skipped: [],
        replaced: [],
        copied: [],
        installedPlatforms: 0,
      }
      const skillIds: string[] = []

      for (const skill of pack.contents.skills) {
        const baseId = packSkillRowId(pack.id, skill.id)
        let targetId = baseId
        if (existing.has(baseId)) {
          if (strategy === 'skip') {
            /* 跳过写入，但**仍记进名单** —— 它本来就是这个包装的，卸载要能删掉 */
            outcome.skipped.push(baseId)
            skillIds.push(baseId)
            continue
          }
          if (strategy === 'copy') {
            let n = 2
            while (existing.has(`${baseId}.copy${n}`)) n += 1
            targetId = `${baseId}.copy${n}`
            outcome.copied.push({ from: baseId, to: targetId })
          } else {
            outcome.replaced.push(baseId)
          }
        }
        await skills.save({
          id: targetId,
          source: 'user',
          name: skill.name,
          content: skill.content,
          description: skill.description ?? '',
          inputMode: skill.inputMode ?? 'text',
          tags: skill.tags ?? [],
          updatedAt: now,
        })
        existing.add(targetId)
        skillIds.push(targetId)
        outcome.installedSkills += 1
      }

      /* 平台规则：同 id 覆盖（规则更新就该覆盖），并记下这个包"拥有"哪些 id */
      const platformIds = pack.contents.ecommercePlatforms.map((p) => p.id)
      if (platformIds.length > 0) {
        const current = await readPlatforms()
        const byId = new Map(current.map((p) => [p.id, p]))
        for (const p of pack.contents.ecommercePlatforms) byId.set(p.id, p)
        await writePlatforms([...byId.values()])
        outcome.installedPlatforms = platformIds.length
      }

      const installed = await readInstalled()
      const next: InstalledPack[] = installed.filter((p) => p.id !== pack.id)
      next.push({
        id: pack.id,
        displayName: pack.displayName,
        version: pack.version,
        ...(pack.publisher ? { publisher: pack.publisher } : {}),
        installedAt: now,
        skillIds,
        platformIds,
      })
      await writeInstalled(next)
      return outcome
    },

    async uninstall(packId) {
      const installed = await readInstalled()
      const target = installed.find((p) => p.id === packId)
      if (!target) return false
      for (const id of target.skillIds) {
        await skills.remove(id)
      }
      /* 平台规则：只有当**没有别的包**也声明同一个 id 时才摘掉 */
      if (target.platformIds.length > 0) {
        const others = installed.filter((p) => p.id !== packId)
        const stillOwned = new Set(others.flatMap((p) => p.platformIds))
        const keep = (await readPlatforms()).filter(
          (p) => !target.platformIds.includes(p.id) || stillOwned.has(p.id),
        )
        await writePlatforms(keep)
      }
      await writeInstalled(installed.filter((p) => p.id !== packId))
      return true
    },
  }
}
