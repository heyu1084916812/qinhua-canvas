import type { PlatformKit } from '../../platform/ports'
import {
  buildLibraryAssetSnapshot,
  type LibraryAssetRowLike,
  type SnapshotNodeLike,
  type SnapshotRunRecordLike,
} from '../../domain/shared/assetLibrary'
import { createAssetLibraryRepository } from '../../state/project/assetLibraryRepository'

export type SaveAssetToLibraryResult =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'failed' }

export interface SaveAssetToLibraryDeps {
  platform: Pick<PlatformKit, 'storage'>
  store: {
    getSnapshot: () => {
      nodes: { id: string; projectId: string; data?: unknown }[]
    }
  }
}

/**
 * 把节点当前素材主动保存到手动收藏库。
 *
 * 节点事件与右键菜单共用这一份实现，避免两个入口在“渠道取 sent 还是节点值、
 * 像素怎么回落、失败时保存什么”上各写一套。
 */
export async function saveAssetToLibrary(
  deps: SaveAssetToLibraryDeps,
  nodeId: string,
): Promise<SaveAssetToLibraryResult> {
  const node = deps.store.getSnapshot().nodes.find((n) => n.id === nodeId)
  const hash = (node?.data as { assetHash?: string } | undefined)?.assetHash
  if (!node || !hash) return { ok: false, reason: 'missing' }

  try {
    const [asset] = await deps.platform.storage.query('assets', { id: hash })
    if (!asset) return { ok: false, reason: 'missing' }

    const runRecords = await deps.platform.storage
      .query('runRecords', {})
      .catch(() => [])
    const snapshot = buildLibraryAssetSnapshot({
      hash,
      asset: asset as LibraryAssetRowLike,
      node: node as SnapshotNodeLike,
      runRecords: runRecords as SnapshotRunRecordLike[],
      savedAt: Date.now(),
    })
    if (!snapshot) return { ok: false, reason: 'missing' }

    await createAssetLibraryRepository(deps.platform.storage).save(snapshot)
    return { ok: true }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}
