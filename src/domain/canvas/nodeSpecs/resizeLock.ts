import type { NodeSnapshot, GenerationData } from '../model/node'
import type { Rect } from '../geometry/rect'

/**
 * 缩放锁比（产品文档 §6.16「尺寸与缩放」）。
 *
 * - `'free'`：自由缩放（宽高各改各的）——提示词 / 画板 / **空态**生成节点；
 * - `'current'`：锁**按下时**的比例——对比节点（spec `lockAspect: true`，
 *   但未存产物像素，拿不到「内容比例」，用拖动起点的容器比例代替）；
 *   有内容却缺 `naturalSize` 的生成节点同样走这条（model 注释「字段缺失即
 *   退回节点当前尺寸」）——仍等比，只是基准是容器而非产物；
 * - 数字：锁定该 w/h 比例——分组 / 批量 5:4（spec `lockAspect`）、
 *   有内容的图片 / 视频节点按产物真实像素 `naturalSize`。
 *
 * 此前 `sizing.lockAspect` 只在 spec 里声明、没有任何消费者，`node.resize`
 * 一律自由缩放——「文档写了 = 已实现」的又一例（§6.16 表格标 ✅ 但从未兑现）。
 */
export type ResizeLock = 'free' | 'current' | number

/** 按节点类型与内容解析缩放锁（§6.16 表格的代码化） */
export function resizeLockOf(node: NodeSnapshot): ResizeLock {
  switch (node.type) {
    case 'generation': {
      const d = node.data as GenerationData
      // 「有内容按原始比例锁定」：比例只来自产物真实像素（naturalSize），
      // 不从当前容器反推——容器可能被用户在无内容时拖成任意比例。
      if (d.assetHash && d.naturalSize && d.naturalSize.width > 0 && d.naturalSize.height > 0) {
        return d.naturalSize.width / d.naturalSize.height
      }
      return d.assetHash ? 'current' : 'free' // 有内容退当前比例；空态自由缩放（§6.16）
    }
    case 'group':
    case 'batch':
      return 5 / 4 // §6.16「5:4 固定比例」（sizing.lockAspect 的落地值）
    case 'compare':
      return 'current'
    default:
      return 'free' // 提示词 / 画板：自由缩放
  }
}

/**
 * 这个节点的高度是否**由内容决定**（参数卡），而不是由用户拖出来。
 *
 * 目前只有**循环节点**：它的高度 = 内容高度（面板开合、提示词条数都会改内容），
 * 那是用户 2026-09-24 明确要的「上下的距离完全自适应」。融合卡与生成卡相反 ——
 * 它们是「内容跟节点」（预览区吃掉剩余空间），高度就归用户拖。
 *
 * 为什么要在**缩放交互**里也知道这件事（2026-09-30 实修）：高度归内容的节点，
 * 若同时允许拖拽改高度，就会出现两条规则互相顶 —— 拖拽每帧写一个 h、内容同步再写一个 h，
 * 谁后落谁赢；实测表现为「拖到 332、松手跳到 380，而且再也回不来」。
 * 所以这类节点的缩放**只取横向位移**，高度交给内容同步。
 */
export function heightFromContentOf(node: NodeSnapshot): boolean {
  return node.type === 'loop'
}

/**
 * 等比缩放的纯数学：**主导轴定尺寸、另一轴按 ratio 跟随**。
 *
 * 主导轴 = 相对位移更大的那轴（拖宽就按宽算、拖高就按高算），另一轴严格等于
 * `along / ratio`——所以结果恒满足锁定比例，而不只是「保持拖动起点的比例」：
 * 起手矩形万一已经偏离锁定比（旧工程里自由缩放过的分组），第一帧就会归位。
 *
 * 最小尺寸优先但**不破坏比例**：任一轴不足时整体按比例抬升（同乘一个 ≥1 的因子），
 * 不做逐轴 `Math.max`——那会在贴近最小尺寸时把比例掰歪。
 *
 * 返回矩形锚定 base 的左上角（x/y 不变），与自由缩放的锚点语义一致。
 */
export function lockedResize(
  base: Rect,
  dx: number,
  dy: number,
  min: { w: number; h: number },
  ratio: number,
): Rect {
  const byWidth = Math.abs(dx / base.w) >= Math.abs(dy / base.h)
  // 主导轴先夹住自己的最小值：拖到越过左上时 along 可能 ≤ 0，会让除比例后的另一轴变负
  const driveMin = byWidth ? min.w : min.h
  const along = Math.max(byWidth ? base.w + dx : base.h + dy, driveMin)
  const w = byWidth ? along : along * ratio
  const h = byWidth ? along / ratio : along
  const f = Math.max(1, min.w / w, min.h / h)
  return { x: base.x, y: base.y, w: w * f, h: h * f }
}
