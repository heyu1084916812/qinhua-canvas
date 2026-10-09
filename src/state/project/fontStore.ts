/**
 * 自定义字体的落库（用户 2026-10-09）。
 *
 * 分工与技能库一致：**规则在 domain**（`domain/ui/fonts.ts` 校验扩展名 / 体积 / 字族名），
 * 这里只做"把字节与元数据存进 `fonts` 表、再读回来"。
 *
 * 两条口径：
 * 1. **元数据与字节同表**（`fonts` 一行 = 一个字体）：字体规模很小（最多 20 个），
 *    拆两张表只多一处要同步的存储；而素材那种"几万个、几百 MB"才值得分开。
 * 2. **读不到就是没有**：字段不全 / 字节不是 ArrayBuffer 的行直接丢掉，
 *    不让一条坏行把整个字体列表带崩（与技能库同一套容错口径）。
 */
import { createId } from '../../shared/id'
import type { StoragePort } from '../../platform/ports'
import {
  FONT_COUNT_MAX,
  canAddFont,
  detectVariableFont,
  defaultFontName,
  describeFontError,
  fontFamilyOf,
  sanitizeFamily,
  validateFontFile,
  type FontFormat,
  type FontWeight,
  type UserFont,
} from '../../domain/ui/fonts'

/** 导入结果：成功给字体；失败给一句能直接显示的话 */
export type AddFontResult =
  | { ok: true; font: UserFont }
  | { ok: false; reason: string }

export interface FontStore {
  /** 全部字体元数据（不含字节），按导入时间正序 */
  list: () => Promise<UserFont[]>
  /** 取字节用于注册 `FontFace`；行不在 / 字节坏掉都返回 null */
  readBytes: (id: string) => Promise<ArrayBuffer | null>
  /**
   * 导入一个字体文件；校验失败返回可读原因。
   *
   * `weight` / `family` 是"给已有字族补一份粗体"那条路用的（用户 2026-10-09）：
   * 不传 = 新建一个字族、按常规体导入。
   */
  add: (file: {
    name: string
    size: number
    bytes: ArrayBuffer
    weight?: FontWeight
    family?: string
  }) => Promise<AddFontResult>
  /** 重命名（只改显示名，不动内部字族名 —— 已注册的字体不会因此失效） */
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

function asFormat(value: unknown): FontFormat | null {
  return value === 'ttf' || value === 'otf' || value === 'woff' || value === 'woff2' ? value : null
}

/** `fonts` 表的一行 → 元数据；字段不全的行返回 null（丢弃而不是抛错） */
function fontFromRow(row: unknown): UserFont | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = typeof r.id === 'string' ? r.id : ''
  const name = typeof r.name === 'string' ? r.name : ''
  const format = asFormat(r.format)
  const size = typeof r.size === 'number' && Number.isFinite(r.size) ? r.size : 0
  if (!id || !name || !format || size <= 0) return null
  return {
    /**
     * 字族名：表里存着就用（粗体行要与常规体**共用同一个字族名**），
     * 但要过一遍 `sanitizeFamily` —— 老数据 / 手改过的行都不许把脏字符带进 CSS。
     * 认不出时回落到按 id 推导（老行的行为不变）。
     */
    id,
    name,
    family: sanitizeFamily(r.family) ?? fontFamilyOf(id),
    format,
    size,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0,
    /* 老行没有这两个字段：按"常规体 + 认不出可变性"读回，行为与升级前一致 */
    weight: r.weight === 700 ? 700 : 400,
    variable: typeof r.variable === 'boolean' ? r.variable : null,
  }
}

/** 字节列可能是 ArrayBuffer / Uint8Array / 普通对象；能还原就还原 */
function asArrayBuffer(value: unknown): ArrayBuffer | null {
  if (value instanceof ArrayBuffer) return value
  if (value instanceof Uint8Array) {
    // 复制一份，避免把 IndexedDB 的视图直接交出去（调用方可能被 revoke / 复用）
    const copy = new Uint8Array(value.byteLength)
    copy.set(value)
    return copy.buffer
  }
  return null
}

export function createFontStore(storage: StoragePort): FontStore {
  return {
    async list() {
      const rows = await storage.query('fonts', {})
      return rows
        .map(fontFromRow)
        .filter((f): f is UserFont => f !== null)
        .sort((a, b) => a.createdAt - b.createdAt)
    },

    async readBytes(id) {
      const rows = await storage.query('fonts', { id })
      return asArrayBuffer(rows[0]?.bytes)
    },

    async add(file) {
      const existing = await this.list()
      if (!canAddFont(existing.length)) {
        return { ok: false, reason: `最多只能保存 ${FONT_COUNT_MAX} 个自定义字体` }
      }
      const checked = validateFontFile({ name: file.name, size: file.size })
      if (!checked.ok) {
        // 校验文案在 domain 层统一维护（避免两处各写一份"不支持"）
        return { ok: false, reason: describeFontError(checked.error) }
      }
      const id = createId('font')
      const family = sanitizeFamily(file.family) ?? fontFamilyOf(id)
      const font: UserFont = {
        id,
        name: defaultFontName(file.name),
        family,
        format: checked.format,
        size: file.size,
        createdAt: Date.now(),
        weight: file.weight === 700 ? 700 : 400,
        /* 只有 ttf/otf 能这样看；woff/woff2 返回 null（认不出，按静态处理） */
        variable: detectVariableFont(file.bytes, checked.format),
      }
      await storage.put('fonts', {
        ...font,
        bytes: file.bytes,
      } as never)
      return { ok: true, font }
    },

    async rename(id, name) {
      const trimmed = String(name ?? '').trim()
      if (!trimmed) return
      const rows = await storage.query('fonts', { id })
      const row = rows[0]
      if (!row) return
      await storage.put('fonts', { ...row, name: trimmed } as never)
    },

    async remove(id) {
      await storage.delete('fonts', id)
    },
  }
}
