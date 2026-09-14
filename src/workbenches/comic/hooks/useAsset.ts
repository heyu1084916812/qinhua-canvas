import { useEffect, useState } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'

/**
 * comic 版素材读回（M6-5d）：hash → objectURL。
 *
 * 与画布 `workbenches/canvas/hooks/useAsset` 是**同一职责的两个实现**，
 * 不能共用——原因不是「层级」而是「落库路径不同」：
 *
 * | | 画布 | comic |
 * | --- | --- | --- |
 * | 写入 | `asset.put` 命令进 patch 计划，随 store 的 800ms 防抖冲刷落库 | 宿主在 `commit` 里直接 `storage.put('assets', …)` |
 * | 触发重查 | 需订阅图变更（写回先换引用，早于落库） | 换 `hash`（重生成）即重查，无需订阅 |
 *
 * 但两者都保留退避重试——`storage.put` 仍是**异步**的，从 `panel.setAsset`
 * 写回格、到组件以新 hash 重渲、再到素材真的落库，存在一个竞态窗口。
 *
 * 依赖只有 `platform.storage` 与 `hash` 两个来源，**不读任何全局 store**，
 * 因此换 hash 即自动重查，且不影响其它状态的渲染。
 */
export function useAsset(hash: string | undefined): string | null {
  const platform = usePlatform()
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!hash) {
      setUrl(null)
      return
    }
    let alive = true
    let created: string | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    const load = async (attempt: number) => {
      const rows = await platform.storage.query('assets', { id: hash })
      const row = rows[0] as { bytes?: Uint8Array | number[]; mime?: string } | undefined
      if (!row?.bytes) {
        // 素材尚未落库（异步写窗口内）：退避重试，最多约 3s
        if (alive && attempt < 12) timer = setTimeout(() => void load(attempt + 1), 250)
        return
      }
      const buf = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes as number[])
      const blob = new Blob([buf as BlobPart], { type: row.mime ?? 'image/png' })
      const u = URL.createObjectURL(blob)
      created = u
      if (alive) setUrl(u)
    }
    void load(0)

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      if (created) URL.revokeObjectURL(created)
    }
  }, [hash, platform])

  return url
}
