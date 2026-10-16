import type { NodeSnapshot, GenerationData } from '../model/node'
import type { Rect } from '../geometry/rect'

/**
 * 缩放锁比（产品文档 §6.16「尺寸与缩放」）。
 *
 * - `'free'`：自由缩放（宽高各改各的）——提示词 / **空态**生成节点；
 * - `'current'`：锁**按下时**的比例——对比节点（spec `lockAspect: true`，
 *   但未存产物像素，拿不到「内容比例」，用拖动起点的容器比例代替）；
 *   有内容却缺 `naturalSize` 的生成节点同样走这条（model 注释「字段缺失即
 *   退回节点当前尺寸」）——仍等比，只是基准是容器而非产物；
 * - 数字：锁定该 w/h 比例——有内容的图片 / 视频节点按产物真实像素 `naturalSize`。
 *   （分组 / 批量**不再**走这条：容器贴住内容，比例交给左上角锚点 + 动态最小尺寸，见下。）
 *
 * 此前 `sizing.lockAspect` 只在 spec 里声明、没有任何消费者，`node.resize`
 * 一律自由缩放——「文档写了 = 已实现」的又一例（§6.16 表格标 ✅ 但从未兑现）。
 */
export type ResizeLock = 'free' | 'current' | number

/**
 * 缩放手柄所在的角（`se` = 右下，就是最早只有一只的那只）。
 *
 * 顺序按"先横后纵"的反向写：`sw` 是左下的那只、`ne` 右上的那只、`nw` 左上。
 * 用户 2026-10-06 第 13 批第 5 条：「组给…**四角可缩放**」（参考图二）——
 * 之前全项目只有右下角一只。
 */
export type ResizeCorner = 'se' | 'sw' | 'ne' | 'nw'

/** 四角，右下在前（缺省那只；SSR 守门断言与老探针都按"先命中右下"取） */
export const RESIZE_CORNERS: readonly ResizeCorner[] = ['se', 'sw', 'ne', 'nw']

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
    /**
     * 分组 / 批量：**自由缩放**（2026-10-06 第 13 批第 7 条后改）。
     *
     * 曾经锁 5:4 —— 但容器现在**贴住内容**（内容 + 四边等距 20px，见
     * `packContainer.ts`），锁比会在拖拽第一帧就把贴好的矩形掰成 5:4
     * （用户刚报的"下方空出很多位置"正是那个 5:4 撑出来的）。
     * 尺寸的边界改由**动态最小尺寸**守（拖到"四边等距"就停，再拖会遮住子节点）。
     */
    case 'group':
    case 'batch':
      return 'free'
    /**
     * 对比节点：**拿到素材真实像素之后按它锁**（用户 2026-10-16：「比例需要自适应，
     * 不要固定」）—— 与生成节点同一条口径。还没拿到像素（老数据 / 图没加载完）时
     * 退到 `'current'`（锁拖动起点的比例），至少不会把框拖歪。
     */
    case 'compare': {
      const d = node.data as { naturalSize?: { width: number; height: number } }
      if (d.naturalSize && d.naturalSize.width > 0 && d.naturalSize.height > 0) {
        return d.naturalSize.width / d.naturalSize.height
      }
      return 'current'
    }
    default:
      return 'free' // 提示词：自由缩放
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

/**
 * 自由缩放的**四角**数学：**对角固定**，被拖的那一角跟手。
 *
 * 与 `lockedResize` 的关系：那只负责"比例锁"（主导轴定尺寸、另一轴跟随），
 * 且只按右下角写死（左上角固定）。容器是自由缩放（不锁比例），四角各要一只，
 * 故锚点不能再写死 —— 这只函数把"哪一角不动"参数化：
 * 拖 `nw` ⇒ 右下角固定；拖 `ne` ⇒ 左下角固定；以此类推。
 *
 * 最小尺寸的夹法：**先夹尺寸、再回推坐标** —— 反过来（先算坐标再夹）会让被夹住的那一帧
 * 把对角也带偏，用户看到的是"拖到最小之后整块开始位移"。
 *
 * @param dx,dy 指针相对按下点的位移（世界单位，调用方已按 zoom 折算）
 */
export function freeResize(
  base: Rect,
  corner: ResizeCorner,
  dx: number,
  dy: number,
  min: { w: number; h: number },
): Rect {
  const right = base.x + base.w
  const bottom = base.y + base.h
  const west = corner === 'sw' || corner === 'nw'
  const north = corner === 'ne' || corner === 'nw'
  const w = Math.max(min.w, west ? base.w - dx : base.w + dx)
  const h = Math.max(min.h, north ? base.h - dy : base.h + dy)
  return {
    x: west ? right - w : base.x,
    y: north ? bottom - h : base.y,
    w,
    h,
  }
}

/**
 * 把一次自由缩放的结果**按基准比例归位**（等比锁），**锚点 = 被拖角的对角**。
 *
 * 用户第 17 批 #3：「批量节点还是不是等比例放大的」。
 *
 * 批量的内容是 3×3 **网格**（单元 200×160 + 16 间距 + 20 内边距），而框一直是自由缩放 ⇒
 * 框一旦不是网格的比例，`containerScale` 只能取 `min(宽比, 高比)`，长的那一轴就空出一大片
 * （用户给的图二：框 920×550、格子只放大 1.37 倍，下半截全是空的）。
 * 所以批量的框**永远 = 网格 × 一个等比系数**：拖四角 = 整体等比缩放，格子随时铺满。
 *
 * 与 `lockedResize` 的分工：那只锁的是"节点自己的内容比例"（图片 / 视频按产物像素），
 * 锚点写死左上；这只锁的是"**容器网格**的比例"，锚点跟着四角走（`freeResize` 已经算好
 * 被拖角跟手、对角固定，这里只把尺寸归位到网格比例、再把坐标按同一个对角回推）。
 *
 * `k` 下限取 1：网格尺寸本身就是最小尺寸（再小会遮住子节点，与 `freeResize` 的 `min` 同源）。
 */
export function aspectLockedResize(
  rect: Rect,
  corner: ResizeCorner,
  base: { w: number; h: number },
): Rect {
  if (base.w <= 0 || base.h <= 0) return rect
  const k = Math.max(1, Math.min(rect.w / base.w, rect.h / base.h))
  const w = Math.max(base.w, Math.round(base.w * k))
  const h = Math.max(base.h, Math.round(base.h * k))
  const right = rect.x + rect.w
  const bottom = rect.y + rect.h
  const west = corner === 'sw' || corner === 'nw'
  const north = corner === 'ne' || corner === 'nw'
  return { x: west ? right - w : rect.x, y: north ? bottom - h : rect.y, w, h }
}
