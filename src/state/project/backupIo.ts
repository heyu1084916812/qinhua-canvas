/**
 * 全库备份的读库 / 落盘（用户 2026-10-09，对账 #378 A1/A2）。
 *
 * 分工：`domain/project/backup.ts` 管格式（纯函数），这里管"从 storage 取行、
 * 交给 FilePort 落盘"与反向的"读文件、写回 storage"。
 *
 * ## 表名从哪来
 *
 * 一律从 `BACKUP_TABLES`（domain 的白名单）读，**不在这里再列一遍表名** ——
 * 两份名单早晚会分叉，而分叉的表现是"某张表静默不进备份"。
 *
 * ## 为什么导出走字符串拼接而不是 JSON.stringify(整对象)
 *
 * 见 `backup.ts` 的注释：大库一次性 stringify 会同时存在对象 + 字符串 + 中间副本。
 * 这里逐表取、逐表拼，最后一次性交给 `Blob`（浏览器负责后续落盘，不占 JS 堆）。
 */
import type { PlatformKit, PickedFile } from '../../platform/ports'
import {
  BACKUP_TABLES,
  decodeRow,
  parseBackup,
  serializeBackup,
  type BackupManifest,
  type BackupRow,
  type BackupTable,
} from '../../domain/project/backup'
import { createId } from '../../shared/id'

export interface BackupProgress {
  /** 当前步骤的描述，直接显示给用户 */
  label: string
  done: number
  total: number
}

export interface ExportBackupOptions {
  includeFonts?: boolean
  appVersion?: string
  onProgress?: (p: BackupProgress) => void
}

export interface ExportBackupResult {
  fileName: string
  manifest: BackupManifest
  bytes: number
}

/** 导出文件名：带日期，方便用户自己排版本 */
export function backupFileName(at = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `轻画备份-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}-${p(at.getHours())}${p(at.getMinutes())}.qinghua-backup.json`
}

/**
 * 全库导出。
 *
 * 实现取舍（如实记下来）：
 * 当前是一次性把各表读进内存再拼字符串。对"几百 MB 素材库"这一档，
 * 峰值 ≈ 数据 + 文本两份；常规规模（几十 MB）完全够用。
 * 真正要压到流式（逐条读 + 边读边落盘）需要给 `FilePort` 加流式写入口，
 * 那是独立的一步，已在《开发计划》A 步的验收里标为后续项。
 */
export async function exportFullBackup(
  platform: PlatformKit,
  opts: ExportBackupOptions = {},
): Promise<ExportBackupResult> {
  await platform.storage.open()
  const includeFonts = opts.includeFonts ?? true
  const tables = BACKUP_TABLES.filter((t) => includeFonts || t !== 'fonts')
  const rowsByTable: Partial<Record<BackupTable, BackupRow[]>> = {}

  for (let i = 0; i < tables.length; i += 1) {
    const table = tables[i]!
    opts.onProgress?.({ label: `读取 ${table}`, done: i, total: tables.length })
    rowsByTable[table] = (await platform.storage.query(table, {})) as unknown as BackupRow[]
  }
  opts.onProgress?.({ label: '生成备份文件', done: tables.length, total: tables.length })

  const { text, manifest } = serializeBackup(rowsByTable, {
    includeFonts,
    appVersion: opts.appVersion,
  })
  const fileName = backupFileName()
  const blob = new Blob([text], { type: 'application/json' })
  await platform.files.saveFile(fileName, blob)
  return { fileName, manifest, bytes: blob.size }
}

export interface ImportBackupOptions {
  /** 导入前的冲突策略：合并（同 id 覆盖）或跳过已存在的行 */
  strategy?: 'merge' | 'skip'
  onProgress?: (p: BackupProgress) => void
}

export interface ImportBackupResult {
  manifest: BackupManifest
  /** 实际写入的行数 */
  written: number
  /** 因为已存在而跳过的行数（strategy = skip 时可能 > 0） */
  skipped: number
}

/**
 * 从已经拿到的文件导入（项目页拖入与"选择文件"两条入口共用这一份实现）。
 *
 * ## 导入策略
 *
 * - `merge`（默认）：按 id `put`，同 id 覆盖。项目 id / 素材 hash 本来就是全局唯一，
 *   所以"再导一次同一份备份"是幂等的，不会生成重复项目；
 * - `skip`：库里已有同 id 的行就跳过 —— 适合"只补缺失的数据"。
 *
 * **不做覆盖式清库**：删库再导入中途失败会留下半截库，风险远大于收益。
 * 需要"回到某个备份"时，正确做法是导入后手动删掉不要的项目（或走回收站）。
 */
export async function importFullBackup(
  platform: PlatformKit,
  picked: PickedFile,
  opts: ImportBackupOptions = {},
): Promise<ImportBackupResult> {
  const strategy = opts.strategy ?? 'merge'
  const text = await picked.blob.text()
  const parsed = parseBackup(text)
  if (!parsed.ok) throw new Error(parsed.error)

  await platform.storage.open()
  const tables = BACKUP_TABLES.filter((t) => parsed.rowsByTable[t] !== undefined)
  let written = 0
  let skipped = 0

  for (let i = 0; i < tables.length; i += 1) {
    const table = tables[i]!
    const rows = parsed.rowsByTable[table] ?? []
    opts.onProgress?.({ label: `写入 ${table}`, done: i, total: tables.length })

    const decoded = rows.map((row) => decodeRow(table, row))
    if (strategy === 'skip') {
      for (const row of decoded) {
        const id = typeof row.id === 'string' ? row.id : ''
        if (!id) continue
        const existing = await platform.storage.query(table, { id })
        if (existing.length > 0) {
          skipped += 1
          continue
        }
        await platform.storage.put(table, row as never)
        written += 1
      }
      continue
    }

    // merge：一次性批量写，避免逐行事务开销
    if (decoded.length > 0) {
      await platform.storage.bulkPut(table, decoded as never)
      written += decoded.length
    }
  }

  opts.onProgress?.({ label: '完成', done: tables.length, total: tables.length })
  return { manifest: parsed.manifest, written, skipped }
}

/** 走系统文件框选一个备份文件并导入 */
export async function importBackupFromPicker(
  platform: PlatformKit,
  opts: ImportBackupOptions = {},
): Promise<ImportBackupResult | null> {
  const picked = await platform.files.pickFile('.json,application/json')
  if (!picked) return null
  return importFullBackup(platform, picked, opts)
}

/** 给界面用的一句话摘要：备份里有什么 */
export function describeBackup(manifest: BackupManifest): string {
  const t = manifest.tables
  const parts: string[] = []
  if (t.projects) parts.push(`${t.projects} 个项目`)
  if (t.assets) parts.push(`${t.assets} 个素材`)
  if (t.assetLibrary) parts.push(`${t.assetLibrary} 条收藏`)
  if (t.skills) parts.push(`${t.skills} 个技能`)
  if (t.fonts) parts.push(`${t.fonts} 个字体`)
  if (t.customProtocols) parts.push(`${t.customProtocols} 个自建协议`)
  if (t.ecommerceTasks) parts.push(`${t.ecommerceTasks} 个电商任务`)
  if (t.ecommerceResults) parts.push(`${t.ecommerceResults} 张电商结果`)
  const when = manifest.exportedAt ? new Date(manifest.exportedAt).toLocaleString() : '时间未知'
  const version = manifest.appVersion ? ` · 版本 ${manifest.appVersion}` : ''
  return `${parts.join(' · ') || '空备份'}（导出于 ${when}${version}）`
}

/** 生成一个不重复的备份内项目名后缀（预留给后续的"导入为副本"） */
export function backupCopySuffix(): string {
  return `（导入 ${createId('copy')}）`
}
