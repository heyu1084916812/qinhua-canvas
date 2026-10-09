/**
 * 全库备份（用户 2026-10-09，对账 #378 的 A1/A2 步）。
 *
 * ## 与"导出项目"的区别（这是两件事，别混）
 *
 * | | 导出项目（`flowIo.ts`） | 全库备份（本文） |
 * | --- | --- | --- |
 * | 范围 | **一个项目**的节点 / 连线 / 素材 | **整个本地库** |
 * | 内容 | 项目数据 | 项目 + 素材库收藏 + 技能 + 自定义协议 + 预设 + 字体（可选） |
 * | 用途 | 分享 / 单个项目搬家 | **换机器、重装、真出事时的兜底** |
 *
 * ## 为什么之前不够
 *
 * `flowIo` 的导出只碰「projects / nodes / edges / assets」四张表 ——
 * 素材库收藏（`assetLibrary`）、技能（`skills`）、用户自建协议（`customProtocols`）、
 * 选路策略与预设（`presets`）**都不在任何导出里**，换机等于重配。
 * 备份要解决的就是这一段。
 *
 * ## 凭据默认不导出
 *
 * `credentials` 表在 Web 侧是**用设备密钥加密**的（`webCryptoCredentials`），
 * 密文拷到另一台机器解不开 —— 带出去只会让人误以为"密钥也搬过去了"。
 * 因此默认排除，并在界面文案里如实说明：换机要重新填一次令牌。
 *
 * 本文件是**纯函数层**：不认识 Dexie、不认识 Blob、不读 DOM，可单测。
 * 落盘与读库在 `state/project/backupIo.ts`。
 */

/** 备份文件格式标识与版本（与 `qinghua.flow` 同一族命名） */
export const BACKUP_FORMAT = 'qinghua.backup' as const
export const BACKUP_VERSION = 1 as const

/**
 * 参与备份的表（**白名单**，不是"除某某之外全部"）。
 *
 * 白名单的意义：将来新增业务表时，作者必须**主动**把它加进来 ——
 * 用黑名单的话，新表会静默地不进备份，而用户以为"备份是全的"。
 */
export const BACKUP_TABLES = [
  'projects',
  'nodes',
  'edges',
  'tasks',
  'runRecords',
  'assets',
  'presets',
  'customProtocols',
  'assetLibrary',
  'channels',
  'skills',
  // 字体是本机界面偏好；体积不小，所以**可选**（见 BackupOptions.includeFonts）
  'fonts',
] as const

export type BackupTable = (typeof BACKUP_TABLES)[number]

/** 内置技能由应用自带、启动时幂等同步，**不进备份**（带了反而会和包内版本打架） */
export const BACKUP_EXCLUDED = ['credentials', 'builtinSkills', 'agentSessions'] as const

export interface BackupOptions {
  /** 是否带上自定义字体（用户自己导入的界面字体） */
  includeFonts?: boolean
  /** 导出时间（测试用；不传取当前时间） */
  exportedAt?: number
  /** 应用版本号（写进清单，导入时用于提示版本差异） */
  appVersion?: string
}

/** 一行数据的"备份形态"：绝大多数是原样，只有字节类字段要转 */
export type BackupRow = Record<string, unknown>

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  exportedAt: number
  appVersion: string
  /** 实际包含的表与行数（导入前给用户看的清单） */
  tables: Partial<Record<BackupTable, number>>
  /** 是否包含凭据 —— 恒为 false，留字段是为了将来显式改口径 */
  includesCredentials: boolean
}

export interface BackupCounts {
  /** 素材字节总量（字节），用于界面提示"这个大" */
  assetBytes: number
  /** 素材条目数 */
  assetCount: number
}

/**
 * 备份行的编码：把不能再过 JSON 的字节字段转成 base64。
 *
 * 为什么要动它：`Uint8Array` 过 `JSON.stringify` 会变成 `{"0":137,…}` ——
 * 体积反而更大，而且**导入时还原不回字节**（对账 #221 栽过同一个坑）。
 */
function encodeRow(table: BackupTable, row: BackupRow): BackupRow {
  if (table === 'assets') {
    const { bytes, thumb: _thumb, ...rest } = row
    const encoded = encodeBytes(bytes)
    // 缩略图是本机缓存（可重建），不进备份 —— 与项目导出的口径一致
    return encoded ? { ...rest, bytesBase64: encoded } : { ...rest }
  }
  return { ...row }
}

/** 兼容 `Uint8Array` 与 `ArrayBuffer` 两种历史形态 */
function encodeBytes(value: unknown): string | null {
  if (value instanceof Uint8Array) return bytesToBase64(value)
  if (value instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(value))
  return null
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

/** 计数：导入前告诉用户"这个备份里有什么" */
export function countTables(rowsByTable: Partial<Record<BackupTable, BackupRow[]>>): BackupManifest['tables'] {
  const out: BackupManifest['tables'] = {}
  for (const table of BACKUP_TABLES) {
    const rows = rowsByTable[table]
    if (rows && rows.length > 0) out[table] = rows.length
  }
  return out
}

/**
 * 生成完整备份的文本。
 *
 * 实现是"拼字符串"而不是 `JSON.stringify(整个对象)`：
 * 大库（几百 MB 素材)一次性 stringify 会出现**多份完整拷贝**（对象 + 字符串 + 副本），
 * 而这里逐表、逐行产出，调用方可以立刻把它交给 Blob（与 `flowIo` 的流式导出同一手法）。
 */
export function serializeBackup(
  rowsByTable: Partial<Record<BackupTable, readonly BackupRow[]>>,
  opts: BackupOptions = {},
): { text: string; manifest: BackupManifest } {
  const includeFonts = opts.includeFonts ?? true
  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: opts.exportedAt ?? Date.now(),
    appVersion: opts.appVersion ?? '',
    tables: {},
    includesCredentials: false,
  }

  /**
   * 逐表拼字符串，而不是 `JSON.stringify(整个对象)`：
   * 大库一次性 stringify 会出现多份完整拷贝（对象 + 字符串 + 中间副本），
   * 这里产出的是**一段连续文本**，调用方可以立刻交给 Blob（与 flowIo 的流式导出同一手法）。
   *
   * 表的产出顺序按 `BACKUP_TABLES` 固定，保证同一份库导出的文本可复现。
   */
  const tableParts: string[] = []
  for (const table of BACKUP_TABLES) {
    const rows = rowsByTable[table] ?? []
    if (rows.length === 0) continue
    if (table === 'fonts' && !includeFonts) continue
    manifest.tables[table] = rows.length
    const encodedRows = rows.map((r) => JSON.stringify(encodeRow(table, r))).join(',')
    tableParts.push(`${JSON.stringify(table)}:[${encodedRows}]`)
  }

  const text =
    `{"format":${JSON.stringify(BACKUP_FORMAT)},"version":${BACKUP_VERSION},` +
    `"exportedAt":${manifest.exportedAt},"appVersion":${JSON.stringify(manifest.appVersion)},` +
    `"includesCredentials":false,"tables":{${tableParts.join(',')}},` +
    `"manifest":${JSON.stringify(manifest)}}`
  return { text, manifest }
}

export type ParseBackupResult =
  | { ok: true; manifest: BackupManifest; rowsByTable: Partial<Record<BackupTable, BackupRow[]>> }
  | { ok: false; error: string }

/**
 * 解析备份文本。
 *
 * 三条判据，每条都**说清错在哪**（不能只说"文件无效"）：
 * ① 是合法 JSON；② `format` / `version` 对得上；③ 表名都在白名单里。
 */
export function parseBackup(text: string): ParseBackupResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '这个文件不是有效的 JSON，可能没下载完或者被改过' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '备份内容不是一个对象' }
  const obj = raw as Record<string, unknown>
  if (obj.format !== BACKUP_FORMAT) {
    return { ok: false, error: '这不是轻画的备份文件（格式标识对不上）' }
  }
  if (obj.version !== BACKUP_VERSION) {
    return {
      ok: false,
      error: `备份版本是 ${String(obj.version)}，当前应用只认 ${BACKUP_VERSION}（可能需要更新应用）`,
    }
  }

  const tablesRaw = obj.tables
  if (!tablesRaw || typeof tablesRaw !== 'object') return { ok: false, error: '备份里没有表数据' }

  const rowsByTable: Partial<Record<BackupTable, BackupRow[]>> = {}
  const manifestTables: BackupManifest['tables'] = {}
  for (const [name, value] of Object.entries(tablesRaw as Record<string, unknown>)) {
    if (!(BACKUP_TABLES as readonly string[]).includes(name)) {
      return { ok: false, error: `备份里有本应用不认识的表「${name}」，可能来自更新的版本` }
    }
    if (!Array.isArray(value)) return { ok: false, error: `备份里的「${name}」不是数组` }
    const table = name as BackupTable
    rowsByTable[table] = value.filter((r): r is BackupRow => !!r && typeof r === 'object')
    manifestTables[table] = rowsByTable[table]!.length
  }

  return {
    ok: true,
    manifest: {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: typeof obj.exportedAt === 'number' ? obj.exportedAt : 0,
      appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : '',
      tables: manifestTables,
      includesCredentials: obj.includesCredentials === true,
    },
    rowsByTable,
  }
}

/** 把备份行还原成可写库的形态：`bytesBase64` → `bytes` */
export function decodeRow(table: BackupTable, row: BackupRow): BackupRow {
  if (table !== 'assets') return { ...row }
  const { bytesBase64, ...rest } = row
  if (typeof bytesBase64 !== 'string' || !bytesBase64) return { ...rest }
  try {
    return { ...rest, bytes: base64ToBytes(bytesBase64) }
  } catch {
    // 单行坏掉不让整份备份失败：这行素材没字节，界面会按"素材缺失"处理
    return { ...rest }
  }
}
