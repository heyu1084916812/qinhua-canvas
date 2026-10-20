import { useEffect, useMemo, useRef, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { EcommerceLongImageTools } from '../../workbenches/ecommerce/EcommerceStudio'
import { loadAssetUrl } from '../../workbenches/canvas/hooks/useAsset'
import { addTile, moveTile, planLongImage, removeTile } from '../../domain/ecommerce/longImage'
import styles from './LongImagePanel.module.css'

/**
 * **详情页长图面板**（对账 #420；#380b 的"长图结果区"第一块）。
 *
 * 做四件事：**编排**（哪几张、按什么顺序）→ 按 1920 宽**等比纵向拼合** → 画进一张 canvas
 * （所见即所得）→ 导出 PNG。
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
 *
 * ## 编排（对账 #426）
 *
 * 详情页的段落顺序是**要交出去给人看的东西**，而"这一段先不要""把卖点挪到第二段"
 * 是这套流程里最常见的两个修改。编排是**纯 UI 态**：只影响这一张长图，
 * **不动作布节点、不落库**（关掉面板再开就回到默认顺序 —— 如实，不假装记住了）。
 */

export interface LongImageTileSource {
  id: string
  hash: string
  width: number
  height: number
}

export function LongImagePanel({
  tiles,
  tools,
  onClose,
}: {
  /** 参与拼合的结果（页面已按"已完成 + 有 hash"过滤并用 useMemo 稳定引用） */
  tiles: readonly LongImageTileSource[]
  tools?: EcommerceLongImageTools
  onClose: () => void
}) {
  const platform = usePlatform()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  /** 结果集（自然序）—— 编排的默认值就是它 */
  const tileIds = useMemo(() => tiles.map((t) => t.id), [tiles])
  /**
   * 编排与"它是对着哪一版结果编的"一起存。
   *
   * 用**带签名的 state** 而不是 `useEffect` 同步：结果集换了（又出了一批）时
   * 签名对不上，派生出来的就是默认顺序 —— 不需要额外一轮渲染，
   * 也不会出现"effect 还没跑、先拿旧编排拼了一次"的中间态。
   */
  const [edit, setEdit] = useState<{ sig: string; order: readonly string[] } | null>(null)
  const signature = tileIds.join('\u0001')
  const order = edit && edit.sig === signature ? edit.order : tileIds
  const orderedTiles = useMemo(
    () =>
      order.flatMap((id) => {
        const hit = tiles.find((t) => t.id === id)
        return hit ? [hit] : []
      }),
    [order, tiles],
  )
  const plan = useMemo(() => planLongImage(orderedTiles), [orderedTiles])
  const notShown = useMemo(() => {
    const shown = new Set(plan.tiles.map((t) => t.id))
    return tileIds.filter((id) => !shown.has(id))
  }, [plan, tileIds])
  const dirty = order.length !== tileIds.length || order.some((id, i) => id !== tileIds[i])
  /** 一步编排：没变化就不落 state（`moveTile` 到头了会原样返回同一个引用） */
  const apply = (next: readonly string[]) => {
    if (next === order) return
    setEdit({ sig: signature, order: next })
  }
  const [ready, setReady] = useState(false)
  const [drawn, setDrawn] = useState(0)
  const [status, setStatus] = useState('')
  const [editId, setEditId] = useState<string | null>(null)

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
      {/*
        编排（对账 #426）：这一段就是"编辑态"里**不需要任何新模型能力**的那一半 ——
        选谁进长图、按什么顺序。段内只保留电商自己的 AI 编辑 / AI 超清，
        复用结果卡的同一套付费确认弹窗（对账 #622）；不从这里跳到无限画布。

        ⚠️ **放在预览之前**：预览是一张几千像素高的长条（`max-height: 520px` 自己也滚），
        编排压在它下面就会被顶到折叠线以下 —— 用户打开面板根本看不见有这个功能
        （第一版就是这么排的，截图里编排区全在屏幕外）。
      */}
      {tileIds.length > 0 ? (
        <div className={styles.arrange} data-ecommerce-longimage-arrange>
          <div className={styles.arrangeHead}>
            <span className={styles.arrangeTitle}>编排 · 段落顺序</span>
            {dirty ? (
              <button
                type="button"
                className={styles.ghost}
                data-ecommerce-longimage-reset
                onClick={() => setEdit(null)}
              >
                恢复默认
              </button>
            ) : null}
          </div>
          <ol className={styles.rows}>
            {plan.tiles.map((tile, i) => (
              <li
                key={tile.id}
                className={styles.row}
                data-ecommerce-longimage-row={tile.id}
                /* 这一段在长图里的**真实起点**（就是拼合用的那个 y）—— 顺序改没改，看它 */
                data-ecommerce-longimage-row-y={tile.y}
              >
                <span className={styles.rowNo}>{i + 1}</span>
                <span className={styles.rowMeta}>
                  {tile.w} × {tile.h}
                </span>
                <span className={styles.rowTools}>
                  {tools?.editResult || tools?.upscaleResult ? (
                    <button
                      type="button"
                      className={styles.iconBtn}
                      aria-label="编辑这一张"
                      title="编辑这一张"
                      aria-expanded={editId === tile.id}
                      data-ecommerce-longimage-edit={tile.id}
                      data-open={editId === tile.id ? 'true' : 'false'}
                      onClick={() => setEditId((id) => (id === tile.id ? null : tile.id))}
                    >
                      <IconEdit />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="上移一段"
                    title="上移一段"
                    data-ecommerce-longimage-up={tile.id}
                    disabled={i === 0}
                    onClick={() => apply(moveTile(order, tile.id, -1))}
                  >
                    <IconArrowUp />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="下移一段"
                    title="下移一段"
                    data-ecommerce-longimage-down={tile.id}
                    disabled={i === plan.tiles.length - 1}
                    onClick={() => apply(moveTile(order, tile.id, 1))}
                  >
                    <IconArrowDown />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="这一段不进长图"
                    title="这一段不进长图"
                    data-ecommerce-longimage-out={tile.id}
                    onClick={() => apply(removeTile(order, tile.id))}
                  >
                    <IconCross />
                  </button>
                </span>
                {editId === tile.id ? (
                  <div
                    className={styles.editBar}
                    role="group"
                    aria-label={`编辑第 ${i + 1} 张`}
                    data-ecommerce-longimage-edit-menu={tile.id}
                  >
                    {tools?.editResult ? (
                      <button
                        type="button"
                        className={styles.ghost}
                        data-ecommerce-longimage-ai-edit={tile.id}
                        disabled={tools.busy}
                        onClick={() => tools.editResult?.(tile.id)}
                      >
                        AI 编辑
                      </button>
                    ) : null}
                    {tools?.upscaleResult ? (
                      <button
                        type="button"
                        className={styles.ghost}
                        data-ecommerce-longimage-upscale={tile.id}
                        disabled={tools.busy}
                        onClick={() => tools.upscaleResult?.(tile.id)}
                      >
                        AI 超清
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
          {notShown.length > 0 ? (
            <div className={styles.excluded} data-ecommerce-longimage-excluded={notShown.length}>
              <span className={styles.arrangeTitle}>没进长图</span>
              {notShown.map((id) =>
                order.includes(id) ? (
                  /* 还在编排里却没拼进来 = 尺寸未知（拼不了），不是用户移出的 —— 不许给"加回来" */
                  <span
                    key={id}
                    className={styles.arrangeTitle}
                    data-ecommerce-longimage-unavailable={id}
                  >
                    第 {tileIds.indexOf(id) + 1} 张 · 尺寸未知，拼不进来
                  </span>
                ) : (
                  <button
                    key={id}
                    type="button"
                    className={styles.ghost}
                    data-ecommerce-longimage-in={id}
                    onClick={() => apply(addTile(order, id, tileIds))}
                  >
                    第 {tileIds.indexOf(id) + 1} 张 · 加回来
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>
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

/**
 * 三个小图标：与项目里其它图标同一套写法（16px / stroke 1.6 / `currentColor`）。
 * 按钮的语义落在 `aria-label` + `title` 上，图标本身 `aria-hidden`。
 */
function IconArrowUp() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  )
}

function IconArrowDown() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M18 13l-6 6-6-6" />
    </svg>
  )
}

function IconCross() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  )
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}
