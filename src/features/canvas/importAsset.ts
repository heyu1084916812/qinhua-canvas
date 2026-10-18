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
import { rememberCanvasCover } from '../../state/project/cover'
import { ensureFreshDisplayThumb, rememberFreshAsset } from '../../platform/freshAssets'

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
  /**
   * **把"手里这份字节"直接交给显示层**（对账 #408）：
   * 5.5MB 的图实测要 540ms 才落完库、再 500ms 读回来，而字节早在算完哈希时（约 30ms）
   * 就在内存里了。记进 `freshAssets` 之后，节点不必等 IndexedDB 那一趟就能显示。
   * 落库这条路**一行没改** —— 缓存只是让"看得见"不再排队等 IO。
   */
  const freshBlob = new Blob([bytes as unknown as BlobPart], { type: mime })
  rememberFreshAsset(hash, freshBlob)
  const freshImageSize = mime.startsWith('image/') ? imageSizeFromHeader(bytes) : null
  void ensureFreshDisplayThumb(hash, freshImageSize)
  /**
   * 表 naturalSize（供「有内容锁原始比例」与节点初始尺寸）。
   *
   * ⚠️ **视频也要读**（对账 #266）：旧实现这里只处理图片，注释写着「视频尺寸交给解码时再取」，
   * 而 `assetNodeSize(null)` 的规则是「没有尺寸就别猜，用最小框」⇒ 视频节点一律建成长方 / 方框，
   * 用户看到的就是「导入视频不按原视频比例」。视频读的是**元数据**（`<video>` 的
   * `videoWidth/videoHeight`，只解 moov、不解整段），几十毫秒的事。
   * 读不出来（罕见容器 / 编码）也不会卡住导入：超时即放弃，交给节点显示层的
   * `assetBoxCorrection` 去补（那条路对图片和视频都成立）。
   */
  const size = mime.startsWith('image/')
    ? await readImageSize(blob, bytes)
    : mime.startsWith('video/')
      ? await readVideoSize(blob)
      : null
  /**
   * 素材库的两个字段在这里带上：`createdAt` 是「这张图什么时候进的库」，
   * `projectId` 是「它属于当前这个项目」。
   *
   * 上传是最直接的一次归属 —— 用户正站在某个画布里，来源不存在歧义。
   * 生成产物那边的 projectId 由争议的挂载点决定（见 canvasPlacement）。
   */
  const now = Date.now()
  deps.store.dispatch({
    kind: 'asset.put',
    asset: { hash, mime, bytes, ...(size ?? {}), createdAt: now, projectId: deps.projectId },
  })
  /**
   * 顺手把"这一张刚进了这个项目的画布"记到项目行上（对账 #289：项目卡封面）。
   *
   * 为什么在这里：`importAssetFile` 是**所有导入路径的唯一咽喉**
   * （点选 / 拖入 / 从文件夹加载 / Agent 面板都汇到它），记一处就等于全覆盖 ——
   * 分散到各个调用点迟早漏一个（本项目在"三个新建入口"上栽过同一个跟头）。
   *
   * 只记图片与视频：`asset.put` 也承接旋转 / 切格 / 融合这类**派生**产物，
   * 那些走的是别的入口；而导入进来的只可能是媒体。
   *
   * ⚠️ **刻意不 `await`**（2026-10-06 改）：这是**记账**，不是用户等的那件事 ——
   * 挡在这里就是一次多余的 IndexedDB 读 + 写，而"图什么时候出现"正是冒烟 G55
   * 在量的那条路径（用户也实测过"上传进去很卡，等好几秒都没显示"）。
   * 安全性由 `rememberCanvasCover` 自己给：读 + 改 + 写在一个事务里
   * （不会覆盖并发的改名 / 删除），内部已 catch ⇒ 不会漏出未处理的拒绝。
   */
  if (isImportableMedia(mime)) {
    void rememberCanvasCover(deps.platform.storage, deps.projectId, hash, now)
  }
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


/** 读视频元数据的超时：读不出来就放弃，别让「导入」卡在文件选择之后 */
const VIDEO_META_TIMEOUT_MS = 4000

/**
 * 取视频的真实像素：挂一个**离屏 `<video>`**，只等 `loadedmetadata`。
 *
 * 为什么不自己解析 mp4 盒子：`moov` 可能在文件尾部（未 faststart 的录制文件），
 * 还得自己处理 webm / mov 三种容器 —— 那等于手写一个解析器，而浏览器本来就带着。
 * 为什么不是解码：`preload: 'metadata'` 只取头部，不取整段。
 *
 * 失败（超时 / 浏览器不吃这个容器）返回 `null` —— 调用方照旧建节点，
 * 尺寸由节点显示层的纠错补上（对账 #266）。
 */
async function readVideoSize(blob: Blob): Promise<ImageSize | null> {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return null
  const url = URL.createObjectURL(blob)
  try {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true
    video.src = url
    return await new Promise<ImageSize | null>((resolve) => {
      let settled = false
      const finish = (size: ImageSize | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        video.onloadedmetadata = null
        video.onerror = null
        resolve(size)
      }
      const timer = setTimeout(() => finish(null), VIDEO_META_TIMEOUT_MS)
      video.onloadedmetadata = () => {
        const width = video.videoWidth
        const height = video.videoHeight
        finish(width > 0 && height > 0 ? { width, height } : null)
      }
      video.onerror = () => finish(null)
    })
  } finally {
    // 元数据已经取到（或已放弃）⇒ objectURL 可以放了，`<video>` 不再需要它
    URL.revokeObjectURL(url)
  }
}
