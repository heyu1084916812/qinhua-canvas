import { useEffect, useState } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import { useCanvasStore } from '../storeContext'

/**
 * 按 hash 从 assets 表读回媒体本体并生成 objectURL（产品文档 §8：hash 即主键）。
 * 组件卸载时回收 URL，避免内存泄漏。
 *
 * 关键点：节点拿到 `assetHash` 与素材真的进了 IndexedDB 之间有时差，
 * 这里在未命中时按退避重试，并订阅图变更（写回会先换引用）以尽早取到。
 */
export interface AssetMeta {
  url: string | null
  /** 素材的 mime；未落库时为空（灯箱靠它决定渲染 `<img>` 还是 `<video>`） */
  mime: string | null
}

/**
 * 同 `useAsset`，但把 mime 一并返回。
 *
 * mime 只存在于 assets 行里，**猜不出来**：objectURL 是 `blob:`，扩展名没有，
 * 而「该用 `<img>` 还是 `<video>`」完全由它决定（猜错就是黑屏）。
 */
export function useAssetMeta(hash: string | undefined): AssetMeta {
  const platform = usePlatform()
  const [meta, setMeta] = useState<AssetMeta>({ url: null, mime: null })
  const graph = useSyncGraph()

  useEffect(() => {
    if (!hash) {
      setMeta({ url: null, mime: null })
      return
    }
    let alive = true
    let created: string | null = null
    let timer: ReturnType<typeof setTimeout> | null = null

    /**
     * 退避窗口：前 3s 每 250ms 一次，其后每 500ms，总计约 20s。
     *
     * 素材在 store 里已**插队立即落库**（不等 800ms 防抖），正常几十毫秒内就命中；
     * 这里只是兜住「首屏装载 / 超大图 / 慢设备」这类长尾。更关键的是：
     * 图一变（tick）effect 会整个重跑、计数归零，所以不存在
     * 「重试次数用完 → 这张图从此永久空白」——那才是真正的断连。
     */
    const MAX_ATTEMPTS = 48
    const backoffOf = (attempt: number) => (attempt < 12 ? 250 : 500)

    const load = async (attempt: number) => {
      const rows = await platform.storage.query('assets', { id: hash })
      const row = rows[0] as { bytes?: Uint8Array | number[]; mime?: string } | undefined
      if (!row?.bytes) {
        // 素材尚未落库：退避重试，最多约 20s
        if (alive && attempt < MAX_ATTEMPTS) {
          timer = setTimeout(() => void load(attempt + 1), backoffOf(attempt))
        }
        return
      }
      const buf = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes as number[])
      const blob = new Blob([buf as BlobPart], { type: row.mime ?? 'image/png' })
      const u = URL.createObjectURL(blob)
      created = u
      if (alive) setMeta({ url: u, mime: row.mime ?? null })
    }
    void load(0)

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      if (created) URL.revokeObjectURL(created)
    }
    // graph 变化（生成写回换引用）时重跑一次，尽早取到刚落的素材
  }, [hash, platform, graph])

  return meta
}

export function useAsset(hash: string | undefined): string | null {
  return useAssetMeta(hash).url
}

/** 图快照变更计数（仅为触发 useAsset 重查询，不读取内容） */
function useSyncGraph(): number {
  const store = useCanvasStore()
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let last = store.getSnapshot()
    return store.subscribe(() => {
      const g = store.getSnapshot()
      if (g === last) return
      last = g
      setTick((t) => t + 1)
    })
  }, [store])
  return tick
}
