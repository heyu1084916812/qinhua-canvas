import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { fingerprintBytes } from '../../domain/shared/hash'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import type { ImageSize } from '../../domain/shared/imageSize'
import { createId } from '../../shared/id'
import type { PlatformKit } from '../../platform/ports'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { Point } from '../../domain/canvas/geometry/rect'
import type { GenerationData } from '../../domain/canvas/model/node'

/** 导入可接受的类型（§6.8 状态 A：图片 png/jpg/webp；视频 mp4/webm/mov） */
export const IMPORT_ACCEPT = 'image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime'

/** 落库后的一份素材：足以建出一个「装着它的节点」 */
export interface ImportedAsset {
  hash: string
  mime: string
  name?: string
  width?: number
  height?: number
}

export interface ImportDeps {
  platform: PlatformKit
  store: CanvasStore
  projectId: string
}

/** 这个 mime 是不是画布能吃的素材（图片 / 视频） */
export function isImportableMedia(mime: string): boolean {
  return mime.startsWith('image/') || mime.startsWith('video/')
}

/**
 * 取一个文件并落库（架构 §4.7：视图不认识存储，取文件 / 算哈希 / 落库都在宿主侧）。
 *
 * `file` 有值（拖放）时直接用，没有（点击 `+`）才开文件选择器——两条路径
 * 汇到同一段落库逻辑，不会出现「拖进来的图有尺寸、点选的没有」这类分叉。
 */
export async function importAssetFile(deps: ImportDeps, file?: File): Promise<ImportedAsset | null> {
  const blob: Blob | undefined = file ?? (await deps.platform.files.pickFile(IMPORT_ACCEPT))?.blob
  const name = file?.name
  if (!blob) return null
  const bytes = new Uint8Array(await blob.arrayBuffer())
  if (bytes.length === 0) return null
  const mime = blob.type || 'application/octet-stream'
  // 哈希走 crypto.subtle（异步）：同步 SHA-1 会在几 MB 的图上阻塞主线程几百毫秒
  const hash = await fingerprintBytes(bytes)
  // 图片补 naturalSize（供「有内容锁原始比例」与节点初始尺寸）；视频尺寸交给解码时再取
  const size = mime.startsWith('image/') ? await readImageSize(blob, bytes) : null
  deps.store.dispatch({ kind: 'asset.put', asset: { hash, mime, bytes, ...(size ?? {}) } })
  return { hash, mime, name, ...(size ?? {}) }
}

/**
 * 把已落库的素材建成一个**新的**生成节点（画布导入的唯一落点）。
 *
 * 与「上传到已有节点」的区别只在最后一步：那里是 `node.updateData` 写回
 * 现有节点，这里是 `node.create`。素材的取 / 哈希 / 落库两段完全共用。
 *
 * @param ownPlan 是否自己开一次 `beginPlan/endPlan`（默认开）。拖入多个文件时
 *   由调用方**整批**包一次并传 `false`——store 的 `activePlan` 是**单个变量**，
 *   嵌套 begin 会让内层 endPlan 提前把外层计划关掉（后面的节点就各占一步撤销了）。
 *   整批包一次才是「一次导入 = 一步撤销」。
 */
export function createAssetNode(
  deps: ImportDeps,
  asset: ImportedAsset,
  at?: Point,
  ownPlan = true,
): string | null {
  const mode: 'image' | 'video' = asset.mime.startsWith('video/') ? 'video' : 'image'
  const size = assetNodeSize({ width: asset.width, height: asset.height })
  const id = createId('node')
  const data = {
    ...generationSpec.createDefaultData(),
    mode,
    assetHash: asset.hash,
    // 记下真实像素：日后拖进 / 拖出容器、复制粘贴都靠它恢复比例（§6.16）
    naturalSize: asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined,
    thumbOrder: [asset.hash],
  } as GenerationData

  // 素材落库与节点创建对**用户**是一次「导入」，撤一步就该全撤，否则会留下
  // 一个没有素材的空节点（或一条用不上的素材）
  if (ownPlan) deps.store.beginPlan(`import:${id}`, '导入素材')
  deps.store.dispatch({
    kind: 'node.create',
    projectId: deps.projectId,
    type: 'generation',
    at: at ?? { x: 0, y: 0 },
    id,
    size,
    title: titleFromName(asset.name),
    data,
  })
  if (ownPlan) deps.store.endPlan()
  return id
}

/** 文件名当节点名（去掉扩展名）；空名不设 title，让 store 用默认名 */
function titleFromName(name?: string): string | undefined {
  const base = name?.replace(/\.[^.]+$/, '').trim()
  return base ? base.slice(0, 24) : undefined
}

/**
 * 取图片真实像素：**先读文件头**（零解码，微秒级），读不出来才回落完整解码。
 *
 * 全量 `createImageBitmap` 对一张 7MB 的图要几百毫秒，而我们只要两个数字；
 * 浏览器能显示的格式里 PNG / JPEG / GIF / WebP 的文件头都直接带宽高，
 * 剩下的（罕见变体、截断文件）才值得付解码的钱。
 */
async function readImageSize(blob: Blob, bytes: Uint8Array): Promise<ImageSize | null> {
  const fromHeader = imageSizeFromHeader(bytes)
  if (fromHeader) return fromHeader
  if (typeof createImageBitmap !== 'function') return null
  try {
    const bmp = await createImageBitmap(blob)
    const size = { width: bmp.width, height: bmp.height }
    bmp.close()
    return size
  } catch {
    return null
  }
}
