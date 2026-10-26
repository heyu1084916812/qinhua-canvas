import { assetMimeOfName } from '../../domain/shared/assetLocation'
import { fingerprintBytes } from '../../domain/shared/hash'
import type { PlatformKit } from '../../platform/ports'
import type { StoragePort } from '../../platform/ports'
import { putGeneratedAssets } from '../../platform/assets'

export const AUDIO_ACCEPT =
  'audio/mpeg,audio/wav,audio/ogg,audio/mp4,audio/aac,audio/flac'

/**
 * 50MB 是本地 BGM 的保守上限：再大通常已经是整段无损母带，
 * 不适合塞进 IndexedDB，也不该让一次选择卡住界面。
 */
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024

export interface ImportedAudioAsset {
  hash: string
  mime: string
  name: string
  size: number
}

export interface ImportAudioDeps {
  platform: Pick<PlatformKit, 'files' | 'assets'>
  storage: StoragePort
  projectId: string
}

/**
 * 漫剧 BGM 的独立导入链。
 *
 * 画布素材仍只接受图片 / 视频；音频只落公共 `assets`，不建节点。
 * 因此这里不复用 `importAssetFile`，否则必须放宽 `isImportableMedia`，
 * 会让音频从画布的拖放 / 粘贴入口混进来。
 */
export async function importAudioAsset(
  deps: ImportAudioDeps,
  file?: File,
): Promise<ImportedAudioAsset | null> {
  const picked = file
    ? { name: file.name, size: file.size, mime: file.type, blob: file }
    : await deps.platform.files.pickFile(AUDIO_ACCEPT)
  if (!picked) return null
  if (picked.size > MAX_AUDIO_BYTES) {
    throw new Error('音频超过 50MB，请先压缩后再导入')
  }
  const bytes = new Uint8Array(await picked.blob.arrayBuffer())
  if (bytes.length === 0) throw new Error('这个音频文件是空的')
  const mime = normalizeAudioMime(picked.mime, picked.name)
  if (!mime) throw new Error('只支持 MP3 / WAV / OGG / M4A / AAC / FLAC 音频')
  const hash = await fingerprintBytes(bytes)
  await putGeneratedAssets(
    deps.storage,
    deps.platform.assets,
    deps.projectId,
    [{ hash, mime, bytes }],
  )
  return { hash, mime, name: picked.name, size: picked.size }
}

/**
 * 有些系统文件选择器给的 `File.type` 是空串。
 * 只从扩展名补“确实是音频”的类型；不认识就返回 null，不猜成 audio/mpeg。
 */
export function normalizeAudioMime(mime: string, name: string): string | null {
  const normalized = String(mime ?? '').split(';')[0].trim().toLowerCase()
  if (normalized.startsWith('audio/')) return normalized
  const fromName = assetMimeOfName(name)
  return fromName?.startsWith('audio/') ? fromName : null
}
