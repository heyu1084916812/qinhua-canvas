import type { PlatformKit, Row } from './ports'
import { imageSizeFromHeader, type ImageSize } from '../domain/shared/imageSize'

/**
 * **节点缩略图**（对账 #231 —— 收口 #195 里"应用侧放大"那一条）。
 *
 * 问题：`useAsset` 把**全分辨率字节**直接变成 objectURL，而节点只显示 240×192；
 * 浏览器仍然**按原图解码** —— 一张 3840×2160 解码后 ≈ 33MB（宽 × 高 × 4），
 * 可见几十张就是 GB 级内存。这正是 #195 那次崩溃里"应用侧放大"的那一层。
 *
 * 两条设计选择（都不是随手定的）：
 *
 * 1. **生成一次就落库**（`assets.thumb`），不进内存 LRU：存下来之后**每次**打开项目都直接命中，
 *    不必每开一次项目把几十张图重新解码、重编码一遍；
 * 2. **本来就小就不动它**：原图最长边 ≤ `THUMB_MAX_PX` 时直接复用原图 ——
 *    省一次重编码，也省一份重复字节（缩略图只对"大图"有意义）。
 *
 * 缩略图存 **WebP**：同样的观感下体积最小，而 Chromium 系（浏览器 / WebView2）都认。
 */
export const THUMB_MAX_PX = 640
export const THUMB_MIME = 'image/webp'

/**
 * 要不要缩、缩成多大（**纯函数**，可单测）。
 *
 * 返回 `null` 有两种含义，对调用方是同一件事：**别动这张图** ——
 * ① 尺寸读不出来（格式不认 / 文件截断）；② 本来就不大。
 * 读不出来时**不猜**：宁可继续用原图，也不生成一张尺寸错误的缩略图。
 */
export function thumbPlan(
  size: ImageSize | null,
  maxPx = THUMB_MAX_PX,
): { width: number; height: number } | null {
  if (!size || size.width <= 0 || size.height <= 0) return null
  const longest = Math.max(size.width, size.height)
  if (longest <= maxPx) return null
  const scale = maxPx / longest
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

/**
 * 把一张图**降采样**成缩略图字节；做不到就返回 `null`（调用方继续用原图）。
 *
 * 为什么先读文件头而不是 `createImageBitmap(blob)` 拿尺寸：后者会把整张图**完整解码**
 * （一张 4K 图几百毫秒、33MB）—— 我们只是要"目标尺寸"两个数字，头里就有。
 * `resizeWidth/Height` 一起给，是因为只给一边时另一边按比例推出去，长边可能仍然超过上限。
 */
export async function makeThumbBytes(blob: Blob, maxPx = THUMB_MAX_PX): Promise<Uint8Array | null> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') return null
  const head = new Uint8Array(await blob.slice(0, 65536).arrayBuffer())
  const plan = thumbPlan(imageSizeFromHeader(head), maxPx)
  if (!plan) return null
  const bitmap = await createImageBitmap(blob, {
    resizeWidth: plan.width,
    resizeHeight: plan.height,
    resizeQuality: 'medium',
  })
  try {
    const canvas = new OffscreenCanvas(plan.width, plan.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const out = await canvas.convertToBlob({ type: THUMB_MIME, quality: 0.82 })
    return new Uint8Array(await out.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

/**
 * 补一张缩略图并落库（**后台跑，不 await**）。
 *
 * 落库时要**读改写整行**：`storage.put` 是整行覆盖，而这一行同时带着原图字节 ——
 * 所以必须 `{...row, thumb}`，只写 `{id, thumb}` 会把原图抹掉。
 * 失败一律吞掉（缩略图是**优化**，不是功能：它挂了顶多继续用原图，不该让界面报错）。
 */
export async function ensureAssetThumb(platform: PlatformKit, row: Row, source: Blob): Promise<boolean> {
  try {
    if (thumbBytesOf(row.thumb)) return false // 已经补过（重挂载 / 并发常见）——别重复解码
    return await inThumbSlot(async () => {
      // 排队期间可能已经被另一次挂载补上了，进槽后再确认一次
      if (thumbBytesOf(row.thumb)) return false
      const thumb = await makeThumbBytes(source)
      if (!thumb) return false
      await platform.storage.put('assets', { ...row, thumb } as never)
      return true
    })
  } catch {
    return false
  }
}

/**
 * 缩略图的生成**限流**（同时最多 2 张）。
 *
 * 为什么必须限：生成一张要真解码 + 重编码，而项目一打开是**几十个节点同时挂载** ——
 * 不限流就变成"几十张 4K 图同时解码"，恰好复现我们要修的这件事（背景任务不该把前台搞崩）。
 */
const THUMB_CONCURRENCY = 2
let running = 0
const waiting: (() => void)[] = []

/**
 * 这一行**该不该补缩略图**（纯函数，可单测）。三种情况都不补：
 * ① 已经有 `thumb`（补过了 —— 重挂载 / 重扫很常见）；② 不是图（视频走自己的路）；
 * ③ 没有本地字节（只有远端地址的那种行，"搬不动"）。
 */
export function needsThumb(row: Row): boolean {
  const mime = typeof row.mime === 'string' ? row.mime : ''
  return !thumbBytesOf(row.thumb) && mime.startsWith('image/') && !!row.bytes
}

/**
 * 把行里的 `thumb` 读成字节；**认不出来就当作没有**（返回 `null`）。
 *
 * ⚠️ 为什么必须这么严（对账 #234）：修好之前导出的 `.flow.json` 里可能带着一份被
 * `JSON.stringify` 的缩略图（`{"0":82,…}` 这种**普通对象**）。若照着 `new Uint8Array(obj)` 去读，
 * 会得到一个**空数组** ⇒ 节点显示一张 0 字节的破图 —— 比"没有缩略图、继续用原图"糟糕得多。
 * 这里只认三种真字节形态（`Uint8Array` / `ArrayBuffer` / 数字数组），其余一律 `null`。
 *
 * 顺带带来一个**自愈**：那种坏 thumb 会被判成"没有"，于是补图逻辑会重新生成并覆盖它。
 */
export function thumbBytesOf(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value.length > 0 ? value : null
  if (value instanceof ArrayBuffer) return value.byteLength > 0 ? new Uint8Array(value) : null
  if (Array.isArray(value) && value.length > 0) return new Uint8Array(value as number[])
  return null
}

/** 行里的字节（两种克隆形态都要认）→ Blob */
export function rowBytesBlob(row: Row): Blob | null {
  if (!row.bytes) return null
  const bytes = row.bytes instanceof Uint8Array ? row.bytes : new Uint8Array(row.bytes as number[])
  const mime = typeof row.mime === 'string' ? row.mime : 'application/octet-stream'
  return new Blob([bytes as unknown as BlobPart], { type: mime })
}

/**
 * **一次性补图**（对账 #232）：把库里**还没有缩略图**的素材过一遍。
 *
 * 为什么必须有：懒生成只覆盖"用户看过的图"。**老项目第一次打开**时，可见的那几张仍按原图解码 ——
 * 那正是 #195 那次崩溃的窗口。存量素材必须先被补上，第一次打开才是便宜的
 * （新素材不用等它：落库那一刻就已经顺手补了，见 store 的 `writeOnce`）。
 *
 * 三条边界：
 * - 用 `storage.scan` **分批**读（每批 4 行）——复用 #228 那条"别把整库拿在手里"；
 * - 生成走**同一个限流槽**（同时最多 2 张），所以它和前台不会互相抢；
 * - **可中断**（`signal`）：进画布 / 卸载就停，剩下的下次继续（缩略图是落库的，天然可续）。
 */
export async function backfillAssetThumbs(
  platform: PlatformKit,
  opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<{ scanned: number; generated: number; aborted: boolean }> {
  const { signal, onProgress } = opts
  let scanned = 0
  let generated = 0
  let aborted = false

  /** 中断哨兵：`scan` 的回调没有"别读了"这个出口，只能靠抛（抛出去的不会进 DB） */
  const ABORT = Symbol('thumb-backfill-abort')

  const handle = async (rows: Row[]): Promise<void> => {
    for (const row of rows) {
      if (signal?.aborted) {
        aborted = true
        throw ABORT
      }
      scanned += 1
      if (!needsThumb(row)) continue
      const blob = rowBytesBlob(row)
      if (!blob) continue
      const made = await ensureAssetThumb(platform, row, blob)
      if (made) generated += 1
    }
  }

  const storage = platform.storage
  try {
    if (storage.scan) {
      await storage.scan('assets', 4, async (rows, meta) => {
        await handle(rows)
        onProgress?.(scanned, meta.total)
      })
    } else {
      // 没有 `scan` 的后端（少见）：整表 —— 小库两条路等价
      const rows = (await storage.query('assets', {})) as unknown as Row[]
      await handle(rows)
      onProgress?.(scanned, rows.length)
    }
  } catch (err) {
    if (err !== ABORT) throw err
  }
  return { scanned, generated, aborted }
}

async function inThumbSlot<T>(job: () => Promise<T>): Promise<T> {
  if (running >= THUMB_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve))
  running += 1
  try {
    return await job()
  } finally {
    running -= 1
    waiting.shift()?.()
  }
}
