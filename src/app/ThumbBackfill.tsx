import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { usePlatform } from './providers/PlatformProvider'
import { backfillAssetThumbs } from '../platform/assetThumb'

/**
 * **存量素材的一次性补图**（对账 #232）—— 没有界面，只在后台跑一趟。
 *
 * 为什么是"一次性"而不是每次启动都扫：扫一遍要**把 assets 表读一遍**（每行都带字节），
 * 几 GB 的库每次启动都重扫是不可接受的。所以补完之后在 `presets` 里留一行标记，
 * 之后启动只读这一行就结束。新素材不依赖它 —— 它们在**落库那一刻**就补好了
 * （见 store 的 `writeOnce`）；这一趟只为**这次改动之前就存在的老素材**。
 *
 * 三条克制：
 * - **只在非画布页面跑**：用户一进画布就中断（`AbortController`）—— 编辑时的每一帧都比补图重要；
 * - 没跑完**不打标记**，下次接着补（缩略图本身是落库的，天然可续）；
 * - 全静默，只在日志里留一行（它不是功能，是整理）。
 */
const MARKER_ID = 'job:assetThumbBackfill'

export function ThumbBackfill() {
  const platform = usePlatform()
  const location = useLocation()
  const inCanvas = location.pathname.startsWith('/canvas')

  useEffect(() => {
    if (inCanvas) return
    const controller = new AbortController()
    let alive = true
    void (async () => {
      const marked = await platform.storage.query('presets', { id: MARKER_ID })
      if (!alive || marked[0]) return
      const result = await backfillAssetThumbs(platform, { signal: controller.signal })
      if (!alive || result.aborted) return
      await platform.storage.put('presets', { id: MARKER_ID, version: 1, doneAt: Date.now() })
      platform.logger.log('info', '[assetThumb] 存量素材缩略图补完', {
        scanned: result.scanned,
        generated: result.generated,
      })
    })().catch((err) => {
      // 补图失败不该打扰任何人：缩略图是优化，界面照旧用原图
      platform.logger.log('warn', '[assetThumb] 补图未完成', { error: String(err) })
    })
    return () => {
      alive = false
      controller.abort()
    }
  }, [platform, inCanvas])

  return null
}
