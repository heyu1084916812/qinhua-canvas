/**
 * 整套导出（M6-8）：把计划里的每一张图，从「素材 + 版式」渲染成 PNG，打成一个 ZIP 存盘。
 *
 * 分工（架构 §2.2 / §5.10）：
 *   - 「打几张、叫什么名字」→ `domain/comic/export/exportPlan`（纯函数）；
 *   - 「一张图长什么样」→ `domain/comic/export/sheetSvg`（纯函数，产出 SVG 字符串）；
 *   - 本文件只做**有副作用的接线**：读素材 → 光栅化 → 组 ZIP → 落盘。
 *
 * 三点取舍：
 *   1. **素材一次性批查**，不为几十个格各挂一个 hook——导出是一次性动作，不订阅变更。
 *   2. 缺失 / 未落库的素材**跳过该格底图**（保留白底 + 描边），不让整包导出失败——
 *      「有 3 张图还没生成完」不该阻塞「把这 12 页导出来」。
 *   3. 走 `platform.files.saveFile`（FilePort），与画布 `.flow.json` 出口同一条通道，
 *      组件不直接碰 File / Blob 下载。
 */

import type { PlatformKit } from '../../../platform/ports'
import type { ComicPage, ComicProject } from '../../../domain/comic/model/comicProject'
import {
  planExport,
  type ExportLayout,
  type ExportScope,
} from '../../../domain/comic/export/exportPlan'
import { renderSheetSvg, sheetDimensions } from '../../../domain/comic/export/sheetSvg'
import { pageBadgeText } from '../../../domain/comic/model/pageNumber'
import { buildZipStore, type ZipEntry } from '../../../shared/zip'

export interface ComicExportOptions {
  scope: ExportScope
  layout: ExportLayout
  /** `scope === 'episode'` 时导哪一话（0 起；越界夹回） */
  episodeIndex?: number
  /**
   * 是否在每张图的页脚带里打页码（**默认关**）。
   *
   * 默认关的理由：导出的 PNG 常直接投稿 / 印刷，页码属「阅读辅助」而非画面内容，
   * 误开会让整批成品带上一串去不掉的号——**错了要重导，代价不可逆**。
   * 想要时显式勾选即可。
   *
   * 页码是**每话内**从 1 起（与总览缩略角标同源，都用 `pageBadgeText`），
   * 不会跨话累加——单行本也是分话编号的。
   */
  pageNumbers?: boolean
}

export interface ComicExportResult {
  /** 实际写出的文件名 */
  fileName: string
  /** 写出的图张数（一张 = 一页或一跨页） */
  sheetCount: number
  pageTotal: number
  emptyPages: number
}

/**
 * 导出一话 / 整个项目为 ZIP（每张图一张 PNG）。
 * 没有可导出的页时抛错——UI 本应在此之前禁用按钮，这里做最后一道防线。
 */
export async function exportComicProject(
  platform: PlatformKit,
  project: ComicProject,
  opts: ComicExportOptions,
): Promise<ComicExportResult> {
  const plan = planExport(project, opts)
  if (plan.sheets.length === 0) {
    throw new Error('[comicExport] 没有可导出的页')
  }

  await platform.storage.open()
  const images = await loadPanelImages(platform, project)

  const entries: ZipEntry[] = []
  for (const sheet of plan.sheets) {
    const episode = project.episodes[sheet.episodeIndex]
    if (!episode) continue
    // 页码与页**绑在一起**取，保证两者长度永远一致（长度不等时 sheetSvg 会整体不打）
    const picked = sheet.pageIndices
      .map((i) => ({ page: episode.pages[i], number: pageBadgeText(i) }))
      .filter((x): x is { page: ComicPage; number: string } => x.page !== undefined)
    if (picked.length === 0) continue

    const pages = picked.map((x) => x.page)
    const numbers = opts.pageNumbers ? picked.map((x) => x.number) : undefined

    const svg = renderSheetSvg({
      pages,
      direction: project.readingDirection,
      images,
      pageNumbers: numbers,
    })
    const { width, height } = sheetDimensions(pages.length, { pageNumbers: numbers !== undefined })
    const png = await rasterizeSvg(svg, width, height)
    entries.push({ path: sheet.path, bytes: new Uint8Array(await png.arrayBuffer()) })
  }

  const zipBlob = new Blob([buildZipStore(entries) as BlobPart], { type: 'application/zip' })
  await platform.files.saveFile(plan.fileName, zipBlob)

  return {
    fileName: plan.fileName,
    sheetCount: entries.length,
    pageTotal: plan.pageTotal,
    emptyPages: plan.emptyPages,
  }
}

/**
 * SVG 字符串 → PNG Blob。
 *
 * 走 `data:` URL 而非 blob URL：SVG 由 `Image` 加载时不加载任何外部资源，
 * 内联的 `data:` 底图是唯一的图像来源，于是 canvas **不被污染**、`toBlob` 可用。
 */
function rasterizeSvg(svg: string, width: number, height: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('[comicExport] 无法创建 2D 上下文'))
          return
        }
        ctx.drawImage(image, 0, 0, width, height)
        canvas.toBlob(
          (blob) =>
            blob ? resolve(blob) : reject(new Error('[comicExport] canvas.toBlob 返回空')),
          'image/png',
        )
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }
    image.onerror = () => reject(new Error('[comicExport] SVG 光栅化失败'))
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  })
}

/**
 * 把所有会出图的格子读成 `panelId → dataURL`。
 *
 * 先按 `assetHash` 去重批查（同一张素材可能被多格复用），再回填到 panel 维度——
 * 避免同一素材被查多次，也避免为每个格各写一次数据 URL。
 */
async function loadPanelImages(
  platform: PlatformKit,
  project: ComicProject,
): Promise<Map<string, string>> {
  const hashes = new Set<string>()
  for (const episode of project.episodes) {
    for (const page of episode.pages) {
      for (const panel of page.panels) {
        if (panel.assetHash) hashes.add(panel.assetHash)
      }
    }
  }

  const byHash = new Map<string, string>()
  for (const hash of hashes) {
    const rows = await platform.storage.query('assets', { id: hash })
    const row = rows[0] as { bytes?: Uint8Array | number[]; mime?: string } | undefined
    if (!row?.bytes) continue
    const bytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes)
    byHash.set(hash, `data:${row.mime ?? 'image/png'};base64,${bytesToBase64(bytes)}`)
  }

  const byPanel = new Map<string, string>()
  for (const episode of project.episodes) {
    for (const page of episode.pages) {
      for (const panel of page.panels) {
        const url = panel.assetHash ? byHash.get(panel.assetHash) : undefined
        if (url) byPanel.set(panel.id, url)
      }
    }
  }
  return byPanel
}

/** Uint8Array → base64；分块避免 `String.fromCharCode(...)` 撑爆参数上限 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
