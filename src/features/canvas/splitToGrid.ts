import type { PlatformKit } from '../../platform/ports'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { GenerationData } from '../../domain/canvas/model/node'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import { fingerprintBytes } from '../../domain/shared/hash'
import { createId } from '../../shared/id'

/**
 * 「宫格切分」（用户 2026-10-05 第 9 条：「节点的功能栏需要加上宫格切分的功能，
 * 参考截图做，还有自定义宫格的功能，选择对应的宫格切分后把节点本身右边复制一个节点进行切分」）。
 *
 * 做法与「提取选区」（`extractSelection.ts`）同一条路数，只是切 N 刀而不是一刀：
 * 1. **切**：按 R×C 把原图切成互不重叠的整块（边界取整，不重不漏），每块存成**新素材**，
 *    **绝不覆盖原图**；
 * 2. **建**：在原图**右侧**按同样的 R×C 网格排出一批新节点（每块一个），原图不动；
 * 3. **一步撤销**：所有 `asset.put` + `node.create` 走同一个 plan。
 *
 * 为什么不做成一个「容器节点」把 N 块装起来：容器（分组节点）的格位是固定 3×3 的，
 * 4×4 / 5×5 / 自定义（比如 2×3）都装不下 —— 硬塞进去会得到「格位对不上切分」的假象。
 * 铺成 N 个并列节点则任何 R×C 都成立；要成组时用户再按 `Ctrl+G`（那条链路已经有了）。
 */

export interface SplitDeps {
  platform: PlatformKit
  store: CanvasStore
}

export interface SplitInput {
  nodeId: string
  rows: number
  cols: number
}

export type SplitOutcome =
  | { ok: true; nodeIds: string[] }
  | { ok: false; reason: string }

/** 宫格档位（参考截图那四个 + 自定义） */
export const GRID_PRESETS: readonly { id: string; label: string; rows: number; cols: number }[] = [
  { id: '2x2', label: '4宫格 (2×2)', rows: 2, cols: 2 },
  { id: '3x3', label: '9宫格 (3×3)', rows: 3, cols: 3 },
  { id: '4x4', label: '16宫格 (4×4)', rows: 4, cols: 4 },
  { id: '5x5', label: '25宫格 (5×5)', rows: 5, cols: 5 },
]

/** 自定义宫格的上下限（截图里那个点选网格是 4×4，这里放宽到 6×6 够用且不会切出碎渣） */
export const GRID_CUSTOM_MAX = 6

/** 与源图的间距、块与块之间的间距（世界坐标 px） */
const GAP_X = 48
const GAP_Y = 28

export async function splitNodeToGrid(deps: SplitDeps, input: SplitInput): Promise<SplitOutcome> {
  const rows = Math.floor(input.rows)
  const cols = Math.floor(input.cols)
  if (rows < 1 || cols < 1 || rows > GRID_CUSTOM_MAX || cols > GRID_CUSTOM_MAX) {
    return { ok: false, reason: `宫格范围是 1–${GRID_CUSTOM_MAX}` }
  }
  if (rows * cols === 1) return { ok: false, reason: '1×1 等于没切，换一个宫格吧' }

  const graph = deps.store.getSnapshot()
  const node = graph.nodes.find((n) => n.id === input.nodeId)
  if (!node) return { ok: false, reason: '节点不存在' }
  const sourceHash = (node.data as GenerationData).assetHash
  if (!sourceHash) return { ok: false, reason: '这个节点还没有图片' }

  const payload = await deps.platform.assets.read(sourceHash)
  if (!payload) return { ok: false, reason: '读不到原图素材' }
  const bitmap = await createImageBitmap(
    new Blob([payload.bytes as unknown as BlobPart], { type: payload.mime || 'image/png' }),
  )

  try {
    const width = bitmap.width
    const height = bitmap.height
    const canvas = document.createElement('canvas')
    const g2 = canvas.getContext('2d')
    if (!g2) return { ok: false, reason: '当前浏览器不支持画布裁剪' }
    g2.imageSmoothingEnabled = true
    g2.imageSmoothingQuality = 'high'

    /**
     * 每块的像素边界**取整**：`Math.round` 会让相邻两块差 1px（出现缝或重叠），
     * 所以用「第 i 块的起点 = round(i × w / cols)」这种**共享边界**的算法 ——
     * 上一块的终点就是下一块的起点，既不重也不漏。
     */
    const edge = (i: number, total: number, n: number) => Math.round((i * total) / n)

    const tiles: {
      hash: string
      bytes: Uint8Array
      width: number
      height: number
      row: number
      col: number
    }[] = []
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x0 = edge(c, width, cols)
        const x1 = edge(c + 1, width, cols)
        const y0 = edge(r, height, rows)
        const y1 = edge(r + 1, height, rows)
        const w = x1 - x0
        const h = y1 - y0
        if (w <= 0 || h <= 0) continue
        canvas.width = w
        canvas.height = h
        g2.clearRect(0, 0, w, h)
        g2.drawImage(bitmap, x0, y0, w, h, 0, 0, w, h)
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/png'),
        )
        if (!blob) return { ok: false, reason: '切分结果导出失败' }
        const bytes = new Uint8Array(await blob.arrayBuffer())
        tiles.push({ hash: await fingerprintBytes(bytes), bytes, width: w, height: h, row: r, col: c })
      }
    }
    if (tiles.length === 0) return { ok: false, reason: '原图尺寸太小，切不出有效的块' }

    /**
     * 落库 + 建节点：`beginPlan` / `endPlan` 之间**不得 await**（`activePlan` 是单个变量），
     * 所以字节与哈希都先算完（上面那一圈），进来只 dispatch。
     */
    /**
     * 排布：先算**每块的设计尺寸**（`assetNodeSize`，与画布上其它素材节点同一口径），
     * 再取「列宽 = 该列最宽的一块、行高 = 该行最高的一块」——
     * 这样 R×C 网格的行列不会互相压到，也不会留下忽大忽小的缝。
     */
    const sizes = tiles.map((t) => assetNodeSize({ width: t.width, height: t.height }))
    const sizeOf = (index: number) => sizes[index]!
    const indexOf = (row: number, col: number) => tiles.findIndex((t) => t.row === row && t.col === col)
    const colWidths: number[] = []
    const rowHeights: number[] = []
    for (let c = 0; c < cols; c++) {
      const ws = tiles
        .map((t, i) => (t.col === c ? sizeOf(i).w : 0))
        .filter((w) => w > 0)
      colWidths[c] = ws.length ? Math.max(...ws) : 0
    }
    for (let r = 0; r < rows; r++) {
      const hs = tiles
        .map((t, i) => (t.row === r ? sizeOf(i).h : 0))
        .filter((h) => h > 0)
      rowHeights[r] = hs.length ? Math.max(...hs) : 0
    }
    const xOf = (col: number) =>
      node.x + node.w + GAP_X + colWidths.slice(0, col).reduce((sum, w) => sum + w + GAP_X, 0)
    const yOf = (row: number) =>
      node.y + rowHeights.slice(0, row).reduce((sum, h) => sum + h + GAP_Y, 0)

    const ids = tiles.map(() => createId('node'))
    deps.store.beginPlan(`split:${node.id}:${rows}x${cols}`, `宫格切分 ${rows}×${cols}`)
    tiles.forEach((tile, i) => {
      const id = ids[i]!
      deps.store.dispatch({
        kind: 'asset.put',
        asset: {
          hash: tile.hash,
          mime: 'image/png',
          bytes: tile.bytes,
          width: tile.width,
          height: tile.height,
          createdAt: Date.now(),
          projectId: graph.projectId,
        },
      })
      const size = sizeOf(indexOf(tile.row, tile.col))
      deps.store.dispatch({
        kind: 'node.create',
        projectId: graph.projectId,
        type: 'generation',
        at: { x: xOf(tile.col), y: yOf(tile.row) },
        id,
        size,
        title: `${node.title} · 宫格 ${tile.row + 1}-${tile.col + 1}`,
        data: {
          ...generationSpec.createDefaultData(),
          assetHash: tile.hash,
          naturalSize: { width: tile.width, height: tile.height },
          thumbOrder: [tile.hash],
        } as GenerationData,
      })
    })
    deps.store.endPlan()
    deps.store.setSelection(ids)
    await deps.store.flush()
    return { ok: true, nodeIds: ids }
  } finally {
    bitmap.close()
  }
}
