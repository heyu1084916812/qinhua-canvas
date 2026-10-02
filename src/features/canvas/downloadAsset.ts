/**
 * 下载节点自身的素材（用户 2026-09-18）。
 *
 * 单独成文件的理由与 `importAsset` 对称：**上传与下载是同一条素材通道的两端**，
 * 各自的「读字节 / 定文件名 / 落盘」都应该只有一份实现。塞进页面容器会让
 * 跟随栏、右键菜单、将来的批量导出各写一遍，文件名规则立刻分叉。
 *
 * 依赖注入两个端口（`assets.read` / `files.saveFile`），因此可以在 node 下单测，
 * 不需要真浏览器。
 */
import type { AssetPort, FilePort } from '../../platform/ports'

/** 扩展名表：与上传侧 `fileSystemAccessFiles` 的 mime 表同源（只取常用几种） */
const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
}

/**
 * 由素材内容推一个文件名。
 *
 * `hash` 取前 8 位做后缀：同一节点多次生成的产物 hash 不同，
 * 不带它的话「下载两次」会在系统里变成 `xxx (1).png`——用户分不清哪张是哪张。
 */
export function assetFileName(hash: string, mime: string, prefix = '轻画'): string {
  const ext = EXT_BY_MIME[mime] ?? 'bin'
  return `${prefix}-${hash.slice(0, 8)}.${ext}`
}

export interface DownloadAssetDeps {
  assets: AssetPort
  files: FilePort
}

/**
 * `via`：这次到底怎么存下来的（用户 2026-10-03，视频成片下载不了）。
 * - `file`：字节到手，真落盘（本地素材走这条，远端托管域放行 CORS 时也走这条）；
 * - `tab`：托管域不给 CORS 头，字节进不了页面，只能把地址交回浏览器
 *   —— 调用方要说一句「已在新标签页打开」，不能默默当成功。
 */
export type DownloadAssetResult =
  | { ok: true; via: 'file' | 'tab' }
  | { ok: false; reason: 'missing' | 'failed' }

/**
 * 读字节 → 落盘。
 *
 * 三种结局都要**如实区分**，不能一律静默返回：
 * - `missing`：素材不在表里（已被清理 / 尚未落库）——要让用户知道「这张图没了」，
 *   否则点了下载没反应，会怀疑是功能坏了；
 * - `failed`：`saveFile` 抛错（用户取消保存**不算错**，那条路径平台层已 resolve）；
 * - `ok`。
 */
export async function downloadAsset(
  deps: DownloadAssetDeps,
  hash: string,
  namePrefix?: string,
): Promise<DownloadAssetResult> {
  const payload = await deps.assets.read(hash).catch(() => null)
  /**
   * 本地没字节**不等于**这张素材不存在：视频成片托管在远端，`assets` 行里
   * 只有一条 `url`（见 `AssetPort.readUrl`）。此前这里直接判 `missing`，
   * 于是用户看到的提示是「素材不在素材库」——而它明明就在。
   */
  if (!payload) {
    const remote = await deps.assets.readUrl(hash).catch(() => null)
    if (!remote) return { ok: false, reason: 'missing' }
    try {
      const via = await deps.files.saveFromUrl(
        remote.url,
        assetFileName(hash, remote.mime, namePrefix),
      )
      return { ok: true, via: via === 'opened' ? 'tab' : 'file' }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }
  try {
    const blob = new Blob([payload.bytes as unknown as BlobPart], { type: payload.mime })
    await deps.files.saveFile(assetFileName(hash, payload.mime, namePrefix), blob)
    return { ok: true, via: 'file' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
