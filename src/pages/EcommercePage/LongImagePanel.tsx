import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { loadAssetUrl } from '../../workbenches/canvas/hooks/useAsset'
import { planLongImage } from '../../domain/ecommerce/longImage'
import styles from './LongImagePanel.module.css'

/**
 * **详情页长图面板**（对账 #420；#380b 的"长图结果区"第一块）。
 *
 * 做三件事：按 1920 宽**等比纵向拼合**这一批已完成的产物 → 画进一张 canvas（所见即所得）
 * → 导出 PNG。
 *
 * 为什么面板在**页面层**而不是电商工作台里：它要读素材字节（`loadAssetUrl`）与落盘
 * （`files.saveFile`）—— 那是装配层的活。工作台之间不互引（depcruise 的
 * no-workbench-cross-talk 守卫），页面认识两边（与电商页把结果节点接进画布同一个道理）。
 *
 * 三条如实：
 * - **尺寸未知的不拼**（素材还没落库 / 破图）：跳过并在面板上写清有几张没拼进去，
 *   绝不按"大概比例"塞一个占位高度 —— 那会让长图与真实产物对不上；
 * - **拼不出来就说拼不出来**：读不到字节的那张画不出来，面板状态行如实说；
 * - **导出是纯本地动作**：不调任何渠道、不消耗用量。
 */

export interface LongImageTileSource {
  id: string
  hash: string
  width: number
  height: number
}

export function LongImagePanel({
  tiles,
  onClose,
}: {
  /** 参与拼合的结果（页面已按"已完成 + 有 hash"过滤并用 useMemo 稳定引用） */
  tiles: readonly LongImageTileSource[]
  onClose: () => void
}) {
  const platform = usePlatform()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const plan = useMemo(() => planLongImage(tiles), [tiles])
  const [ready, setReady] = useState(false)
  const [drawn, setDrawn] = useState(0)
  const [status, setStatus] = useState('')

  useEffect(() => {
    let alive = true
    const created: string[] = []
    setReady(false)
    setDrawn(0)
    setStatus('')
    void (async () => {
      const canvas = canvasRef.current
      if (!canvas || plan.height <= 0) {
        if (alive) setReady(true)
        return
      }
      canvas.width = plan.width
      canvas.height = plan.height
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      let ok = 0
      for (const tile of plan.tiles) {
        const source = tiles.find((t) => t.id === tile.id)
        if (!source) continue
        const meta = await loadAssetUrl(platform, source.hash)
        if (!alive) {
          if (meta.url) URL.revokeObjectURL(meta.url)
          return
        }
        if (!meta.url) continue
        created.push(meta.url)
        const img = new Image()
        img.src = meta.url
        await img.decode().catch(() => {})
        if (!alive) return
        ctx.drawImage(img, tile.x, tile.y, tile.w, tile.h)
        ok += 1
        setDrawn(ok)
      }
      if (!alive) return
      setReady(true)
      if (ok < plan.tiles.length) {
        setStatus(`有 ${plan.tiles.length - ok} 张读不到字节，画布上留了空位`)
      }
    })()
    return () => {
      alive = false
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [plan, tiles, platform])

  const onDownload = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    setStatus('正在导出…')
    void (async () => {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob((b) => resolve(b), 'image/png'),
      )
      if (!blob) {
        setStatus('导出失败：画布还没有内容')
        return
      }
      await platform.files.saveFile(`长图-${plan.width}x${plan.height}.png`, blob)
      setStatus('已导出长图')
    })().catch((e: unknown) => {
      setStatus(e instanceof Error ? e.message : String(e))
    })
  }

  return (
    <section className={styles.panel} data-ecommerce-longimage data-ready={ready ? 'true' : 'false'}>
      <header className={styles.head}>
        <span className={styles.title}>详情页长图</span>
        <span className={styles.meta} data-ecommerce-longimage-size>
          {plan.width} × {plan.height}
        </span>
        <span className={styles.meta} data-ecommerce-longimage-tiles={plan.tiles.length}>
          {plan.tiles.length} 张
        </span>
        <button
          type="button"
          className={styles.ghost}
          data-ecommerce-longimage-download
          disabled={!ready || plan.height <= 0 || drawn === 0}
          onClick={onDownload}
        >
          下载长图
        </button>
        <button type="button" className={styles.ghost} data-ecommerce-longimage-close onClick={onClose}>
          关闭
        </button>
      </header>
      {plan.skipped.length > 0 ? (
        <p className={styles.warn} data-ecommerce-longimage-skipped={plan.skipped.length}>
          有 {plan.skipped.length} 张尺寸未知，没有拼进去（多半是还没出图成功）
        </p>
      ) : null}
      {plan.height <= 0 ? (
        <p className={styles.empty} data-ecommerce-longimage-empty>
          还没有可拼的结果：先出一批图，再回来拼长图。
        </p>
      ) : (
        <div className={styles.canvasWrap}>
          <canvas ref={canvasRef} className={styles.canvas} data-ecommerce-longimage-canvas />
        </div>
      )}
      <p className={styles.status} role="status" data-ecommerce-longimage-status>
        {status || (ready ? '已按 1920 宽等比拼好（首尾相接）' : '正在拼…')}
      </p>
    </section>
  )
}
