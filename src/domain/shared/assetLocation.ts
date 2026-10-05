/**
 * 素材存储位置（对账 #196 / 《轻画-画布引擎替换方案.md》§7）。
 *
 * 解决的是用户 2026-10-05 提的那件事：「把素材放在什么位置上，加载什么文件夹的内容」。
 *
 * 现状：素材唯一躺在 `assets` 表（IndexedDB，`id = 内容哈希`）⇒ 换浏览器即丢、也没法备份。
 * 这个模块只管**规则**（纯函数）：文件名怎么起、mime 怎么互推、哪些文件算素材、配置怎么归一。
 * 真正的读写是平台层的事（浏览器 = File System Access；桌面壳 = 原生目录）——同一端口两个实现。
 */

export type AssetLocationMode =
  /** 内置库：现状，全部躺在 IndexedDB */
  | 'library'
  /** 本地文件夹：用户选一个目录，素材按 `<hash>.<ext>` 落盘 */
  | 'folder'

export interface AssetLocationConfig {
  mode: AssetLocationMode
  /** 已选目录的名字（**仅用于显示**；目录句柄只在内存里，刷新后要重新授权） */
  folderName?: string | null
}

export const DEFAULT_ASSET_LOCATION: AssetLocationConfig = { mode: 'library', folderName: null }

/**
 * 文件名用 `<hash>.<ext>`，**不用原名**：
 * `id 即内容哈希` 是本项目既有约定，同一张图重复导入天然幂等、不会堆出 `图 1(1).png`；
 * 代价是文件名不可读 —— 可读性交给应用内的节点名与素材库，不交给文件系统。
 */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
}

/** 认不出的类型落这个扩展名：宁可存下来，也不要因为类型不认识就把素材丢了 */
export const ASSET_EXT_FALLBACK = 'bin'

function extOf(mime: string): string {
  // MIME 可以带参数（`image/png;charset=binary`）——先把参数切掉再查表
  const key = String(mime ?? '').split(';')[0].trim().toLowerCase()
  return EXT_BY_MIME[key] ?? ASSET_EXT_FALLBACK
}

export function assetFileName(hash: string, mime: string): string {
  return `${hash}.${extOf(mime)}`
}

/**
 * 素材**本该在哪**的可读路径（对账 #196 · 增量 4）：`<目录名>/<hash>.<ext>`。
 *
 * 只在**素材缺失**时给用户看（"文件被外部删掉了"要如实说，并告诉他去哪儿找）。
 * 两条刻意的规矩：
 * - **没选目录就返回 `null`**：没有目录的语境下"原路径"是编出来的，不如只说"缺失"；
 * - **mime 未知时写 `<hash>.*`**，不猜扩展名 —— 猜错等于让用户去找一个不存在的文件。
 */
export function expectedAssetPath(
  folderName: string | null | undefined,
  hash: string,
  mime: string | null,
): string | null {
  const dir = String(folderName ?? '').trim()
  if (!dir) return null
  return `${dir}/${mime ? assetFileName(hash, mime) : `${hash}.*`}`
}

/** 从文件名反推 mime（"加载外部文件夹"时要靠它决定渲染 `<img>` 还是 `<video>`） */
export function assetMimeOfName(name: string): string | null {
  const ext = String(name ?? '').trim().toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXT[ext] ?? null
}

/** 这个文件是不是本应用认的素材（扫描外部文件夹时用它过滤掉 Readme、.DS_Store 之类） */
export function isAssetFileName(name: string): boolean {
  return assetMimeOfName(name) !== null
}

/**
 * 配置归一化：任何来路不明的值都回落成"内置库"。
 *
 * 为什么需要：这个配置会从存储里读回来（可能是旧版本写的、也可能被手改过），
 * 而一个非法的 `mode` 会让素材读写静默落到错误的一档 —— 宁可如实退回默认档。
 */
export function normalizeAssetLocationConfig(raw: unknown): AssetLocationConfig {
  const input = (raw ?? {}) as Partial<AssetLocationConfig>
  const mode: AssetLocationMode = input.mode === 'folder' ? 'folder' : 'library'
  const name = typeof input.folderName === 'string' && input.folderName.trim() ? input.folderName.trim() : null
  return { mode, folderName: mode === 'folder' ? name : null }
}
