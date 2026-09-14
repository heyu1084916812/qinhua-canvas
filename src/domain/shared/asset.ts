import { sha1Bytes } from './hash'

/** 素材引用：节点只持有内容哈希，媒体本体在 assets 表（产品文档 §8） */
export interface AssetRef {
  hash: string
  mime: string
  bytes: number
  width?: number
  height?: number
}

export function assetHashOf(bytes: Uint8Array): string {
  return sha1Bytes(bytes)
}

export function isSameAsset(a: AssetRef, b: AssetRef): boolean {
  return a.hash === b.hash
}

/** 按内容哈希去重，保留首次出现项的顺序 */
export function dedupeAssets(refs: AssetRef[]): AssetRef[] {
  const seen = new Set<string>()
  const out: AssetRef[] = []
  for (const ref of refs) {
    if (seen.has(ref.hash)) continue
    seen.add(ref.hash)
    out.push(ref)
  }
  return out
}

/**
 * 素材引用计数：只统计「画布活引用」。
 * 版本历史（runRecords）持有的 outputHashes 不计入——否则永不删除的版本历史会让计数恒不为 0，
 * 清理规则永不生效（产品文档 §12.2 修订）。
 */
export function countLiveRefs(refs: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const hash of refs) {
    counts.set(hash, (counts.get(hash) ?? 0) + 1)
  }
  return counts
}

/** 可回收 = 活引用为 0 且超过保留期。ageMs 与 retentionMs 由调用方注入（domain 不读时间） */
export function isCollectable(liveRefs: number, ageMs: number, retentionMs: number): boolean {
  return liveRefs === 0 && ageMs >= retentionMs
}
