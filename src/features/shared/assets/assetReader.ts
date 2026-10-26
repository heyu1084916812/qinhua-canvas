import type { PlatformKit } from '../../../platform/ports'
import { assetFileName, expectedAssetPath } from '../../../domain/shared/assetLocation'
import {
  ensureAssetThumb,
  ensureAssetPreview,
  makePreviewBytes,
  PREVIEW_MIME,
  THUMB_MIME,
  thumbBytesOf,
} from '../../../platform/assetThumb'
import {
  ensureFreshDisplayThumb,
  freshAssetOf,
  freshThumbOf,
} from '../../../platform/freshAssets'
import { toBytes } from '../../../platform/assets'

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
  /**
   * 这条 URL 是**缩略图**（`assets.thumb`），不是原图 —— 对账 #231。
   * 要原图的地方（灯箱、旋转 / 标注要拿像素的那两层）**别**用带这个标记的 URL。
   */
  thumb?: boolean
  /** 这条 URL 是 1600px 工作台预览，不是原图。 */
  preview?: boolean
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
export async function loadAssetUrl(
  platform: PlatformKit,
  hash: string,
  opts: { preferThumb?: boolean; preferPreview?: boolean } = {},
): Promise<AssetMeta> {
  /**
   * **刚导入的那一份直接在内存里命中**（对账 #408 的优化；判据与数据见 `freshAssets.ts` 的表）。
   *
   * 为什么把它放在**查库之前**：查库要等 5.5MB 那一行写完（实测 540ms）再整行读回来
   * （结构化克隆又一趟）。而内容寻址保证同一 hash 的字节一模一样，内存里这份就是"最终答案"，
   * 不必先问库。落库照旧在后台跑完 —— 这里只是不再让"看得见"排在它后面。
   *
   * 取的是**原图**（与库里第一次读到的一样，缩略图那条后台路径随后会补上）：
   * 节点首屏的观感不变，`naturalWidth` 也仍然是真实像素（冒烟 G55 就按这条量）。
   */
  const fresh = freshAssetOf(hash)
  if (fresh) {
    const mime = fresh.type || null
    /**
     * 画布节点优先走缩略图。刚导入时若 640px 缩略图还没编好，先立即返回
     * 手里已有的原图 objectURL，后台缩略图继续生成；下一次图变更 / 重挂载
     * 就切到 640px。不能在这里等重编码 —— 用户会先把上传看成“卡了”。
     * 灯箱等要真实像素的调用方不开 `preferThumb`，始终拿原图。
     */
    if (opts.preferThumb === true && (mime ?? '').startsWith('image/')) {
      const thumb = freshThumbOf(hash)
      if (thumb) {
        return {
          url: URL.createObjectURL(thumb),
          mime,
          expectedPath: expectedAssetPath(platform.assetFolder?.current()?.name, hash, mime),
          thumb: true,
        }
      }
      void ensureFreshDisplayThumb(hash)
    }
    if (opts.preferPreview === true && (mime ?? '').startsWith('image/')) {
      const preview = await makePreviewBytes(fresh)
      if (preview) {
        return {
          url: URL.createObjectURL(
            new Blob([preview as unknown as BlobPart], { type: PREVIEW_MIME }),
          ),
          mime,
          expectedPath: expectedAssetPath(platform.assetFolder?.current()?.name, hash, mime),
          preview: true,
        }
      }
    }
    return {
      url: URL.createObjectURL(fresh),
      mime,
      expectedPath: expectedAssetPath(platform.assetFolder?.current()?.name, hash, mime),
    }
  }
  const preferThumb = opts.preferThumb === true
  const preferPreview = opts.preferPreview === true
  const directThumbUrl = preferThumb ? platform.assets.thumbUrl?.(hash) : null
  if (directThumbUrl) {
    const [metadata] = await platform.storage.query('assets', { id: hash }, {
      includePayload: false,
      fields: ['id', 'mime', 'thumbLength'],
    })
    if (Number((metadata as { thumbLength?: unknown } | undefined)?.thumbLength) > 0) {
      return {
        url: directThumbUrl,
        mime: (metadata as { mime?: string } | undefined)?.mime ?? null,
        expectedPath: expectedAssetPath(
          platform.assetFolder?.current()?.name,
          hash,
          (metadata as { mime?: string } | undefined)?.mime ?? null,
        ),
        thumb: true,
      }
    }
  }
  const directPreviewUrl = preferPreview ? platform.assets.previewUrl?.(hash) : null
  if (directPreviewUrl) {
    const [metadata] = await platform.storage.query('assets', { id: hash }, {
      includePayload: false,
      fields: ['id', 'mime', 'previewLength'],
    })
    if (Number((metadata as { previewLength?: unknown } | undefined)?.previewLength) > 0) {
      return {
        url: directPreviewUrl,
        mime: (metadata as { mime?: string } | undefined)?.mime ?? null,
        expectedPath: expectedAssetPath(
          platform.assetFolder?.current()?.name,
          hash,
          (metadata as { mime?: string } | undefined)?.mime ?? null,
        ),
        preview: true,
      }
    }
  }
  const rows = await platform.storage.query('assets', { id: hash }, {
    includePayload: !preferThumb && !preferPreview,
    fields:
      preferThumb || preferPreview
        ? ['id', 'mime', 'thumb', 'preview', 'url']
        : undefined,
  })
  let row = rows[0] as
    | {
        bytes?: Uint8Array | number[]
        mime?: string
        url?: string
        thumb?: Uint8Array | number[]
        preview?: Uint8Array | number[]
      }
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
   * **缩略图优先**（对账 #231）：画布节点只显示 240×192，拿原图解码是白烧内存 ——
   * 一张 3840×2160 解码后 ≈ 33MB（宽 × 高 × 4），可见几十张就是 GB 级。
   *
   * `preferThumb` 由"小尺寸显示"那一类调用方打开；**灯箱 / 旋转 / 标注要原图，不要打开它**。
   */
  const isImage = (mime ?? '').startsWith('image/')
  const thumbBytes = preferThumb ? thumbBytesOf(row?.thumb) : null
  if (thumbBytes) {
    return {
      url: URL.createObjectURL(new Blob([thumbBytes as unknown as BlobPart], { type: THUMB_MIME })),
      mime,
      expectedPath,
      thumb: true,
    }
  }
  const previewBytes = preferPreview ? thumbBytesOf(row?.preview) : null
  if (previewBytes) {
    return {
      url: URL.createObjectURL(
        new Blob([previewBytes as unknown as BlobPart], { type: PREVIEW_MIME }),
      ),
      mime,
      expectedPath,
      preview: true,
    }
  }
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
    if (onDisk) {
      scheduleThumb(platform, row, onDisk, preferThumb && isImage)
      schedulePreview(platform, row, onDisk, preferPreview && isImage)
      return { url: URL.createObjectURL(onDisk), mime, expectedPath }
    }
  }
  if ((preferThumb || preferPreview) && !toBytes(row?.bytes)) {
    row = (await platform.storage.query('assets', { id: hash }))[0] as typeof row
  }
  const buf = toBytes(row?.bytes)
  if (!buf || buf.length === 0) return { url: null, mime, expectedPath }
  const blob = new Blob([buf as BlobPart], { type: mime ?? 'image/png' })
  scheduleThumb(platform, row, blob, preferThumb && isImage)
  schedulePreview(platform, row, blob, preferPreview && isImage)
  return { url: URL.createObjectURL(blob), mime, expectedPath }
}

/**
 * 后台补一张缩略图并落库（**不 await、不报错**）。
 *
 * 这一轮**仍然先用原图显示**（不闪空、观感不变），补好之后**下次挂载**就走小图 ——
 * 于是"开过几次之后，整个项目的图都是小图"，日常使用不再压着几十张全分辨率解码。
 * 真正的解码 / 重编码在**限流槽**里排队（见 `features/canvas/assetThumb.ts`），
 * 不会因为"一屏几十个节点同时挂载"而几十张一起解码。
 */
function scheduleThumb(
  platform: PlatformKit,
  row: { thumb?: unknown } | undefined,
  source: Blob,
  want: boolean,
): void {
  if (!want || !row || thumbBytesOf(row.thumb)) return
  void ensureAssetThumb(platform, row as never, source)
}

function schedulePreview(
  platform: PlatformKit,
  row: { preview?: unknown } | undefined,
  source: Blob,
  want: boolean,
): void {
  if (!want || !row || thumbBytesOf(row.preview)) return
  void ensureAssetPreview(platform, row as never, source)
}
