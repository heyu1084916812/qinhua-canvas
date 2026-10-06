import type { Size } from '../geometry/rect'
import { ASSET_NODE_MAX_SIDE, assetNodeSize } from './assetNodeSize'
import { NODE_MINIMUMS } from './constants'

/** 比例一致到这一档就不再动（`assetNodeSize` 会把像素四舍五入，比像素更严会反复纠正） */
const RATIO_TOLERANCE = 0.005

export interface LearnedSize {
  width: number
  height: number
}

export interface AssetBoxCorrection {
  /** 记下来的真实像素（`<img>` 的 naturalWidth / `<video>` 的 videoWidth） */
  naturalSize: LearnedSize
  /** 需要换框时才给 —— 只有"框还是默认框"（= 没人手动调过）时才换 */
  size?: Size
}

/**
 * 媒体**真实像素到手之后**，这个节点的框要不要跟着纠正（对账 #266）。
 *
 * ## 为什么需要它
 *
 * 节点框该按素材原始比例。但"原始比例"来自**读尺寸**，而读尺寸有三条会失败的路：
 * ① 视频（导入时只写 `assets` 行，尺寸要等解码才知道 —— 旧实现干脆不读）；
 * ② 图片文件头认不出的格式；③ 老素材（当年落库时就没带宽高）。
 * 任何一条踩中，节点就会拿到**最小方框**（`NODE_MINIMUMS.generation` = 240×240），
 * 于是一张 16:9 的图缩在方框中间、**上下各留一条白边** —— 用户报的正是这个。
 *
 * 与其在每条导入路径上各修一遍（那正是漏掉视频那条的原因），不如在**显示这一层**
 * 补一次：图/视频在节点上把元数据读出来后，谁发现框不对谁纠正。所有路径一次性覆盖。
 *
 * ## 两条克制
 *
 * - **比例已经对了就什么都不做**（返回 `null`）：否则每次挂载都会派发一次写库 +
 *   一条撤销步，用户按 Ctrl+Z 时莫名其妙地"撤销了尺寸"。
 * - **框被手动调过就不碰**（只记 `naturalSize`）：用户把框拉成什么样是他的决定，
 *   纠正只服务于"系统自己搞错了"那一种情况。判据是"框恰好等于该类型的默认框"——
 *   默认框意味着它从没被手动调过（导入/生成时若拿得到尺寸，框就不是默认值了）。
 *
 * 纯函数：不读时间、不碰 DOM，可单测。
 */
export function assetBoxCorrection(
  box: Size,
  learned: LearnedSize | null | undefined,
  type: keyof typeof NODE_MINIMUMS = 'generation',
  maxSide: number = ASSET_NODE_MAX_SIDE,
): AssetBoxCorrection | null {
  const w = learned?.width
  const h = learned?.height
  if (!w || !h || w <= 0 || h <= 0) return null
  const naturalSize = { width: Math.round(w), height: Math.round(h) }

  const target = assetNodeSize(naturalSize, type, maxSide)

  /**
   * 判据取**框的比例**（而不是"记着的 naturalSize 比例"）——
   * 有白边与否只取决于框的比例跟图的比例如不一致，跟记录是否写入无关。
   *
   * ⚠️ 第一版拿 `data.naturalSize` 比，于是漏掉一整档真实现象：
   * **记录是对的、框是错的**（例如渠道没回报宽高时，`commit` 只能用**请求比例**
   * 定框、`naturalSize` 留空；图回来后框仍是请求比例，`contain` 就露出白边）。
   */
  if (Math.abs(box.w / box.h - w / h) <= RATIO_TOLERANCE) return null

  /**
   * **一律纠正**，不再区分"机器给的框 / 用户手拉的框"（2026-10-06 第三版修正）。
   *
   * 上一版只纠"机器形状"的框（默认框 / 请求比例框 / 宽度恰为 240），理由是"别碰用户的决定"。
   * 但用户实测「长图仍然上下游漏白」——复现出来正是**框宽不是 240** 的那一种
   * （260×470 的框配 944×1665 的图 ⇒ 上下各 6.5px 白边）。
   *
   * 而那类框**不可能来自用户**：§6.16 的 `resizeLockOf` 对有内容的图片 / 视频节点
   * 一律按产物真实像素锁比（拖手柄也只能等比缩放），所以错误比例只可能来自旧版本或某条创建路径。
   * 换句话说这里的"纠正"**没有对手** —— 它不是推翻用户的决定，而是补齐 §6.16 已经承诺、
   * 却只有"拖动"那一条路兑现了的规则。用户的原话也点得很准：
   * 「长图漏白是在画布节点内部漏白，灯箱是正常展示整张图」——灯箱按真实比例，节点就该一样。
   */
  return { naturalSize, size: target }
}
