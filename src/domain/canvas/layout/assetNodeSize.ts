import type { Size } from '../geometry/rect'
import { NODE_MINIMUMS } from './constants'

/** 导入素材落成的节点默认「长边」上限：太大占满画布、太小看不清 */
export const ASSET_NODE_MAX_SIDE = 320

/**
 * 导入素材时节点的尺寸：**按素材原始比例**，且不小于该类节点的最小尺寸。
 *
 * 为什么不能在落库后交给「有内容锁比例」去算：节点一创建就要带上 `size`，
 * 若先按最小尺寸建、再等视图层按内容比例重算，导入的那一帧会先闪一个方图再变比例；
 * 更糟的是视图层的比例修正未必与这里的取整一致，两处各算一遍必然漂移。
 *
 * - 没有尺寸信息（视频未解码 / 读取失败）→ 直接用最小尺寸（退化成空态，不猜）
 * - 有尺寸 → 先等比缩到长边 ≤ `maxSide`，再等比放大到能盖住最小框
 *
 * **放大必须封顶**：极细长的图（50:1）若硬要「高不小于 240」，宽度会算出一万多像素、
 * 比整块画布还大。故放大后长边超过 `maxSide * 3` 时不再放大，直接退回最小方框——
 * 极端比例下宁可让节点按 `object-fit: cover` 裁切，也不要一个横向失控的巨物。
 *
 * 纯函数：不读时间、不碰 DOM，可单测。
 */
export function assetNodeSize(
  natural: { width?: number; height?: number } | null | undefined,
  type: keyof typeof NODE_MINIMUMS = 'generation',
  maxSide: number = ASSET_NODE_MAX_SIDE,
): Size {
  const min = NODE_MINIMUMS[type]
  const w0 = natural?.width
  const h0 = natural?.height
  if (!w0 || !h0 || w0 <= 0 || h0 <= 0) return { ...min }

  const shrink = Math.min(maxSide / w0, maxSide / h0, 1)
  const w = w0 * shrink
  const h = h0 * shrink

  // 等比放大到能盖住最小框（240×240）
  const grow = Math.max(min.w / w, min.h / h, 1)
  if (Math.max(w, h) * grow > maxSide * 3) return { ...min }

  return { w: Math.round(w * grow), h: Math.round(h * grow) }
}

/**
 * 节点**脱离结果容器** / 被复制出来时，按产物真实比例定尺寸（§6.16）。
 *
 * 与 `assetNodeSize` 唯一的差别在「没有 naturalSize 时」：
 * 那里退回最小尺寸（新建节点总得有个尺寸），这里返回 `null` 让调用方**保持原样**——
 * 凭空把节点按最小尺寸拍扁，等于毁掉用户手动调过的尺寸。
 *
 * 纯函数：不读时间、不碰 DOM、不查库（尺寸就长在 data 上），可单测。
 */
export function naturalNodeSize(
  data: { naturalSize?: { width: number; height: number } } | null | undefined,
  type: keyof typeof NODE_MINIMUMS = 'generation',
  maxSide: number = ASSET_NODE_MAX_SIDE,
): Size | null {
  const n = data?.naturalSize
  if (!n || !(n.width > 0) || !(n.height > 0)) return null
  return assetNodeSize({ width: n.width, height: n.height }, type, maxSide)
}

/**
 * 按**请求的比例**预估节点尺寸（`w:h` → Size）。
 *
 * 用途：生成前要先建出承载节点，此时还没有产物、拿不到 `naturalSize`，
 * 但用户已选了比例（如 16:9）——节点应当**按这个比例**建，
 * 于是「选的比例和像素多大，新建的节点就多大」（用户 2026-09-17 要求）。
 *
 * 做法：把比例当成一份「虚拟 natural」喂给 `assetNodeSize`，
 * 复用同一套「缩到长边上限 → 放大盖住最小框」的规则，避免两处各算一遍而漂移。
 * 比例解析失败 → 退回最小尺寸（不猜）。
 */
export function ratioNodeSize(
  ratio: string | null | undefined,
  type: keyof typeof NODE_MINIMUMS = 'generation',
  maxSide: number = ASSET_NODE_MAX_SIDE,
): Size {
  if (!ratio) return { ...NODE_MINIMUMS[type] }
  const [rawW, rawH] = ratio.replace(/\s+/g, '').split(':').map((s) => Number.parseFloat(s))
  if (!Number.isFinite(rawW) || !Number.isFinite(rawH) || rawW <= 0 || rawH <= 0) {
    return { ...NODE_MINIMUMS[type] }
  }
  // 用长边 1024 的比例样本即可：assetNodeSize 只关心**比例**，会再统一缩到 maxSide
  const scale = 1024 / Math.max(rawW, rawH)
  return assetNodeSize({ width: Math.round(rawW * scale), height: Math.round(rawH * scale) }, type, maxSide)
}
