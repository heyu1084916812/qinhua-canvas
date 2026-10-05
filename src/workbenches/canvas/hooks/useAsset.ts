import { useEffect, useState } from 'react'
import { usePlatform } from '../../../app/providers/PlatformProvider'
import type { PlatformKit } from '../../../platform/ports'
import { assetFileName, expectedAssetPath } from '../../../domain/shared/assetLocation'

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
  /**
   * 素材**确实找不到了**（对账 #196 · 增量 4）——不是"还在读"。
   *
   * 判定：库里的字节没有、远端地址没有、已授权目录里也没有，且**退避重试窗口已经用尽**。
   * 界面据此如实显示「素材缺失 + 原路径」，而不是留一块永远转圈的骨架屏
   * （那会让用户以为"再等等就出来了"，实际等到的是永久空白）。
   */
  missing?: boolean
  /** 缺失时"它本该在的位置"（`<目录名>/<hash>.<ext>`）；没选目录时为 null */
  expectedPath?: string | null
}

/**
 * **按 hash 取一次素材**（非 hook 版）：读 `assets` 行 → Blob → objectURL。
 *
 * 存在的理由：`useAsset` 是 hook，只能在 React 组件里用；而有一种消费方拿不到
 * hook —— 比如 `MentionEditor` 里那些**命令式建的 chip**（`contenteditable` 的
 * 子节点不是 React 渲染的）。用户 2026-10-03 要的「@ 引用图片时 chip 上要有缩略图」
 * 正卡在这条缝上。
 *
 * **只取一次，不重试**：退避重试是 `useAssetMeta` 那层的事（它服务的是画布上
 * 刚生成、字节还没落库的图）。调用方自己决定要不要重试。
 * 调用方负责在不用时 `URL.revokeObjectURL`。
 */
export async function loadAssetUrl(platform: PlatformKit, hash: string): Promise<AssetMeta> {
  const rows = await platform.storage.query('assets', { id: hash })
  const row = rows[0] as
    | { bytes?: Uint8Array | number[]; mime?: string; url?: string }
    | undefined
  const mime = row?.mime ?? null
  /**
   * 缺失时给界面一个"去哪儿找"的落点。**mime 只认库里的那一份**：库行没了就写 `<hash>.*`，
   * 不按"大概是个图"猜扩展名（猜错会让用户去找一个根本不存在的文件名）。
   */
  const expectedPath = expectedAssetPath(platform.assetFolder?.current()?.name, hash, mime)
  /**
   * **远程产物**（视频成片）：直接用它的地址 —— 字节那一路在浏览器里会被 CORS 挡掉
   * （`cos-platform-outputs.agnes-ai.cn` 实测 `net::ERR_FAILED`），而 `<video src>`
   * 播放不受 CORS 限制。有 url 就用 url，没有才走原来的「bytes → objectURL」。
   */
  if (row?.url) return { url: row.url, mime, expectedPath }
  /**
   * **素材文件夹优先**（对账 #196 · 增量 2）：用户把素材托管到自己的文件夹后，以磁盘上那份为准。
   * 命中条件 = 已授权目录 + 该 hash 的文件确实在目录里；否则回落内置库（IndexedDB）。
   *
   * 为什么先查 `assets` 行再去问磁盘：**DB 行是索引** —— 文件名要 mime 才拼得出来、
   * 界面也要靠 mime 决定渲染 `<img>` 还是 `<video>`。没有行就没有类型，也就无从找文件。
   */
  const folder = platform.assetFolder
  if (folder?.current()) {
    const onDisk = await folder.read(assetFileName(hash, mime ?? 'image/png'))
    if (onDisk) return { url: URL.createObjectURL(onDisk), mime, expectedPath }
  }
  if (!row?.bytes) return { url: null, mime, expectedPath }
  const buf = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes as number[])
  const blob = new Blob([buf as BlobPart], { type: mime ?? 'image/png' })
  return { url: URL.createObjectURL(blob), mime, expectedPath }
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
      const meta = await loadAssetUrl(platform, hash)
      if (!alive) return
      if (!meta.url) {
        if (attempt < MAX_ATTEMPTS) {
          // 素材尚未落库：退避重试，最多约 20s
          timer = setTimeout(() => void load(attempt + 1), backoffOf(attempt))
        } else {
          /**
           * 重试用尽还读不到 ⇒ **如实标记缺失**（对账 #196 · 增量 4）。
           * 这条**不能省**：界面拿不到这个标记就只能一直显示骨架屏，
           * 而真相是"文件没了"——用户会一直等一张永远不会出现的图。
           */
          setMeta({ url: null, mime: meta.mime, missing: true, expectedPath: meta.expectedPath })
        }
        return
      }
      created = meta.url
      setMeta(meta)
    }
    void load(0)

    return () => {
      alive = false
      if (timer) clearTimeout(timer)
      if (created) URL.revokeObjectURL(created)
    }
    // 只依赖 hash：拖动 / 缩放每帧都会换图快照引用，把 graph 放进依赖会让
    // effect 每帧重跑 —— 旧 URL 被 revoke、重查库建新 URL，<img> 每帧换 src
    // 触发重新解码，用户看到的就是「拖动时图片一闪一闪」。
    // 素材落库的时差由上面的退避重试兜住，不需要借 graph 变更来触发。
  }, [hash, platform])

  return meta
}

export function useAsset(hash: string | undefined): string | null {
  return useAssetMeta(hash).url
}
