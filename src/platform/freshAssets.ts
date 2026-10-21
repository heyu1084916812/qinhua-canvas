import { makeThumbBytes, THUMB_MAX_PX, THUMB_MIME } from './assetThumb'
import type { ImageSize } from '../domain/shared/imageSize'

/**
 * **刚导入的素材本体，在内存里留一小会儿**（对账 #408 的优化，2026-10-10）。
 *
 * 为什么要它 —— 探针把 5.5MB 大图这条路逐段量了一遍（相对"开始读文件"）：
 *
 * | 位置 | 耗时 | 发生了什么 |
 * | --- | --- | --- |
 * | 27ms | 读字节 | `blob.arrayBuffer()` |
 * | 32ms | 算哈希 | `crypto.subtle.digest`（原生异步，5ms） |
 * | **589ms** | **落库** | `assets` 那一行（5.5MB）写进 IndexedDB |
 * | 625ms | 读回 | 节点按 hash 去库里读回**同一份**字节 |
 * | 886ms | 可见 | 原图解码完成，`<img>` 出来 |
 *
 * 也就是说：**图早在 32ms 就已经在手里了，用户却要等到 589ms 落库 + 读回之后才看得到。**
 * 落库当然是必须的（刷新、导出、换设备都靠它），但**"看得见"不必等它** ——
 * 这份缓存把"刚拿到的那份字节"直接交给显示层，落库照旧在后台跑完。
 *
 * 三条边界：
 * 1. **只放刚导入的**：内容寻址（hash 是内容哈希）⇒ 同一 hash 的字节必然相同，缓存不会给出错的内容；
 * 2. **有上限**：最多 6 份、合计 48MB（按最近使用淘汰）—— 不设上限就是慢性内存泄漏；
 * 3. **不进导出、不进备份**：它只是"这几秒内的直通车"，进程一退就没了（那时库里早写好了）。
 */

/** 最多留几份（一次拖入十几张时，只有最近这几张还需要"立刻显示"） */
const MAX_ENTRIES = 6
/** 合计字节上限（一张 5.5MB、一张 4K 图约 8–12MB ⇒ 48MB 够覆盖"刚导的那几张"） */
const MAX_TOTAL_BYTES = 48 * 1024 * 1024

interface Entry {
  blob: Blob
  bytes: number
  thumb?: Blob
  thumbJob?: Promise<Blob | null>
}

const entries = new Map<string, Entry>()
let totalBytes = 0

/** 记下一份刚导入的素材（`importAssetFile` 在算完哈希后立刻调用） */
export function rememberFreshAsset(hash: string, blob: Blob): void {
  if (!hash || !blob.size) return
  /** 单份就超过总上限的（比如 100MB 的视频）：别占着缓存坑位，让库里那条路去服务 */
  if (blob.size > MAX_TOTAL_BYTES) return
  const previous = entries.get(hash)
  if (previous) {
    totalBytes -= previous.bytes
    entries.delete(hash)
  }
  entries.set(hash, {
    blob,
    bytes: blob.size + (previous?.thumb?.size ?? 0),
    ...(previous?.thumb ? { thumb: previous.thumb } : {}),
    ...(previous?.thumbJob ? { thumbJob: previous.thumbJob } : {}),
  })
  totalBytes += blob.size
  evict()
}

/**
 * 预热 / 复用一份 fresh 显示缩略图。同 hash 的并发消费者拿到同一个 Promise，
 * 不会各自解码一遍大图。
 */
export function ensureFreshThumb(
  hash: string,
  build: (blob: Blob) => Promise<Blob | null>,
): Promise<Blob | null> {
  const entry = entries.get(hash)
  if (!entry) return Promise.resolve(null)
  if (entry.thumb) return Promise.resolve(entry.thumb)
  if (entry.thumbJob) return entry.thumbJob
  entry.thumbJob = build(entry.blob)
    .then((thumb) => {
      if (thumb && entries.get(hash) === entry) {
        entry.thumb = thumb
        entry.bytes += thumb.size
        totalBytes += thumb.size
        evict()
      }
      return thumb
    })
    .catch(() => null)
    .finally(() => {
      entry.thumbJob = undefined
    })
  return entry.thumbJob
}

export function freshThumbOf(hash: string): Blob | null {
  return entries.get(hash)?.thumb ?? null
}

/**
 * 新素材首帧与落库共用同一份 640px 缩略图。
 *
 * 以前首帧用 320px、落库后用 640px，导致同一张上传图刚进画布时明显更糊，
 * 重开项目才变清楚。首帧和解码上限必须一致，用户看到的不能取决于素材是否刚导入。
 */
export function ensureFreshDisplayThumb(
  hash: string,
  knownSize?: ImageSize | null,
): Promise<Blob | null> {
  return ensureFreshThumb(hash, (source) =>
    makeThumbBytes(source, THUMB_MAX_PX, knownSize).then((bytes) =>
      bytes ? new Blob([bytes as unknown as BlobPart], { type: THUMB_MIME }) : null,
    ),
  )
}

/** 取一份刚导入的素材；没有就是 `null`（调用方回落去库里读） */
export function freshAssetOf(hash: string): Blob | null {
  const entry = entries.get(hash)
  if (!entry) return null
  /** 命中就挪到队尾：Map 保序，队首即"最久没用"的那个 */
  entries.delete(hash)
  entries.set(hash, entry)
  return entry.blob
}

/** 主动丢弃（导出、切项目这类"这批已经不需要直通车了"的时机可以用） */
export function forgetFreshAsset(hash: string): void {
  const entry = entries.get(hash)
  if (!entry) return
  totalBytes -= entry.bytes
  entries.delete(hash)
}

/** 清空（单测用；也留给"切换账号 / 退出"这类场景） */
export function clearFreshAssets(): void {
  entries.clear()
  totalBytes = 0
}

/** 当前留了几份 / 共多少字节（单测与诊断用） */
export function freshAssetStats(): { count: number; bytes: number } {
  return { count: entries.size, bytes: totalBytes }
}

function evict(): void {
  while (entries.size > MAX_ENTRIES || totalBytes > MAX_TOTAL_BYTES) {
    const oldest = entries.keys().next()
    if (oldest.done) return
    const entry = entries.get(oldest.value)
    entries.delete(oldest.value)
    if (entry) totalBytes -= entry.bytes
  }
}
