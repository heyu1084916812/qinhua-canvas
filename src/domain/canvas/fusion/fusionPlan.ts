import type { FusionContext, FusionRect } from '../model/node'

/**
 * 图像融合的**纯几何与校验**（产品文档 §6.23，2026-09-29）。
 *
 * 这一层只回答「该把哪块像素搬到哪、这个请求合不合法」——不碰 canvas、
 * 不碰存储、不碰 React。真正的像素合成在 `features/canvas/execution/fuseNode`
 * （它需要 DOM canvas 与素材字节），本层因此可以逐条单测。
 *
 * 值全部对齐大雄无限画布 `local-patch` 插件里已验过的口径（抄概念，不抄实现）。
 */

/** 补丁数量上限（与大雄一致：多选集同步融合的最坏情况） */
export const FUSION_MAX_PATCHES = 16
/** 选区短边下限：太小的块缩放到补丁尺寸时会糊成一片 */
export const FUSION_MIN_EDGE = 32
/** 选区总像素上限：超过它一张图就要几百 MB 位图，浏览器直接崩 */
export const FUSION_MAX_PIXELS = 100_000_000
/**
 * 外扩比例，给羽化留余量。
 *
 * ⚠️ 外扩**必须等比**（宽高各乘 `1 + 2p`），不能只按短边加一圈。
 *
 * 首版按短边加：一个 16:9 的选区外扩后变成 `(w+2p) : (h+2p)`，比例被改成约
 * 1.67 —— 而模型按用户选的 16:9 出图，回来一比就超 1% 容差，**每一张补丁都会
 * 被比例校验拒掉**，功能等于不可用。等比外扩则 `paddedRect` 与 `rect` 比例完全
 * 相同，补丁既能通过校验、也不用被拉伸。
 *
 * 后来对照大雄无限画布 `local-patch` 插件的 `compute_padded_rect`，
 * 发现**它踩过同一个坑并留下了同一句结论**（源码注释原文：
 * 「A simple boundary clamp removes padding from only one axis/side and changes
 * the ratio whenever the selection is close to an image edge. Instead, size the
 * context window uniformly and slide it back inside the image.」）。
 * 数值也一并对齐它：默认 `0.1`（见下）。
 */
export const FUSION_PADDING_RATIO = 0.1
/** 长宽比失配阈值：超过即拒绝，避免把补丁拉伸变形 */
export const FUSION_RATIO_TOLERANCE = 0.01

/** 口径定死的错误文案（产品文档 §6.23「缺失输入的错误文案」） */
export const FUSION_MISSING_INPUT = '请连接一张完整原图和至少一张局部修改图'

export interface Size {
  w: number
  h: number
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

/** 选区长宽比（宽 / 高）；高度为 0 时按 1 处理，避免除零 */
export function rectRatio(rect: FusionRect): number {
  return rect.h > 0 ? rect.w / rect.h : 1
}

/** 两个长宽比是否在容差内一致（比较的是比值本身，不是差值） */
export function ratioMatches(a: number, b: number, tolerance = FUSION_RATIO_TOLERANCE): boolean {
  if (a <= 0 || b <= 0) return false
  return Math.abs(a - b) / b <= tolerance
}

/** `'16:9'` → `16 / 9`；解析不出来返回 null（自由框选） */
export function ratioValueOf(label: string | undefined): number | null {
  if (!label) return null
  const m = /^\s*(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)\s*$/.exec(label)
  if (!m) return null
  const w = Number(m[1])
  const h = Number(m[2])
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null
  return w / h
}

/** 把矩形夹进 `[0,bounds]`（尺寸不放大，位置平移） */
export function clampRect(rect: FusionRect, bounds: Size): FusionRect {
  const w = Math.max(1, Math.min(Math.round(rect.w), Math.round(bounds.w)))
  const h = Math.max(1, Math.min(Math.round(rect.h), Math.round(bounds.h)))
  return {
    w,
    h,
    x: Math.round(clamp(Math.round(rect.x), 0, Math.max(0, bounds.w - w))),
    y: Math.round(clamp(Math.round(rect.y), 0, Math.max(0, bounds.h - h))),
  }
}

/**
 * 把矩形**收缩**到指定长宽比，中心不动。
 *
 * 只缩不放：框选时用户已经表达了他想要的取景范围，为了凑比例把它放大
 * 会框进他没选的内容。宁可结果小一点，也不要悄悄改变语义。
 */
export function fitRectToRatio(rect: FusionRect, ratio: number): FusionRect {
  if (!(ratio > 0) || !(rect.h > 0) || !(rect.w > 0)) return rect
  const current = rect.w / rect.h
  if (Math.abs(current - ratio) < 1e-6) return rect
  let w = rect.w
  let h = rect.h
  if (current > ratio) {
    w = rect.h * ratio
  } else {
    h = rect.w / ratio
  }
  return {
    w: Math.round(w),
    h: Math.round(h),
    x: Math.round(rect.x + (rect.w - w) / 2),
    y: Math.round(rect.y + (rect.h - h) / 2),
  }
}

/**
 * 外扩矩形（产品文档 §6.23「边缘选区」）。
 *
 * 三步，顺序不能换：
 * 1. 按短边比例向外扩一圈；
 * 2. 若扩完比原图还大，**等比缩回去**（缩的时候保长宽比，不能只压一个方向）；
 * 3. 最后整体**平移**回图内 —— 注意是平移不是裁剪。
 *
 * 第 3 步是「贴边选区」的关键：靠边框选时外扩必然出界，直接裁掉会让羽化边
 * 缺一条，接缝就成了硬边。平移保住矩形完整，代价只是合成位置整体内移几像素。
 */
export function paddedRectOf(rect: FusionRect, bounds: Size, paddingRatio = FUSION_PADDING_RATIO): FusionRect {
  /**
   * 这一段是**逐行对齐大雄无限画布 `local-patch` 的 `compute_padded_rect`**
   * （数值与夹取顺序都照抄），因为它把三条不变量都钉住了，而自己写一版很容易漏掉第三条：
   *
   *  ① 比例不变：宽高乘**同一个** `scale`；
   *  ② 窗口不越界：整体**平移**回图内（不是裁掉一边）；
   *  ③ **窗口完整包含选区**：`max(rect.w, ...)` 那一下是关键 ——
   *     选区已经顶满图宽时，`round(rect.w * scale)` 可能取整到比选区**窄 1px**，
   *     于是羽化剖面里「选区右边界」跑到窗口外面，水平方向直接退化成不羽化。
   */
  const p = Math.max(0, Math.min(0.5, paddingRatio))
  if (!(rect.w > 0) || !(rect.h > 0)) return clampRect({ ...rect, w: 1, h: 1 }, bounds)

  const desired = 1 + 2 * p
  const available = Math.min(bounds.w / rect.w, bounds.h / rect.h)
  const scale = Math.min(desired, available)
  const w = Math.min(bounds.w, Math.max(rect.w, Math.round(rect.w * scale)))
  const h = Math.min(bounds.h, Math.max(rect.h, Math.round(rect.h * scale)))

  /** 居中安放后滑回图内，且不许滑到「装不下选区」的位置 */
  const placeAxis = (start: number, length: number, target: number, imageLength: number): number => {
    const ideal = start - Math.floor((target - length) / 2)
    const minimum = Math.max(0, start + length - target)
    const maximum = Math.min(start, imageLength - target)
    return Math.min(Math.max(ideal, minimum), maximum)
  }

  return {
    w,
    h,
    x: placeAxis(rect.x, rect.w, w, bounds.w),
    y: placeAxis(rect.y, rect.h, h, bounds.h),
  }
}

/**
 * 由一次框选产出一条选区上下文。
 *
 * `contextId` 由调用方给（视图层用 `shared/id` 生成）——本层是纯函数，
 * 不产生随机的 id。`ratio` 非空时先把框吸附到该比例，再算外扩矩形。
 */
export function contextFromSelection(input: {
  contextId: string
  source: { assetHash: string; width: number; height: number }
  rect: FusionRect
  ratio?: number | null
  paddingRatio?: number
}): FusionContext {
  const bounds: Size = { w: input.source.width, h: input.source.height }
  const locked = input.ratio ? fitRectToRatio(input.rect, input.ratio) : input.rect
  const rect = clampRect(locked, bounds)
  const paddingRatio = input.paddingRatio ?? FUSION_PADDING_RATIO
  return {
    id: input.contextId,
    source: input.source,
    rect,
    paddedRect: paddedRectOf(rect, bounds, paddingRatio),
    paddingRatio,
  }
}

/** 一条待合成的补丁：来自哪条入边、像素多大 */
export interface FusionPatchInput {
  nodeId: string
  assetHash: string
  width: number
  height: number
}

export interface FusionStep {
  contextId: string
  patchNodeId: string
  patchAssetHash: string
  /** 补丁要落到原图上的矩形（= 上下文的外扩矩形） */
  target: FusionRect
  /** 补丁自身像素尺寸（重采样到 target 的尺寸） */
  patch: Size
}

export interface FusionPlan {
  /** 输出画布尺寸 = 原图尺寸；产物是一张与原图同尺寸的整图 */
  output: Size
  /** 按连线顺序合成，后者覆盖前者 */
  steps: FusionStep[]
}

export type FusionPlanResult =
  | { ok: true; plan: FusionPlan }
  | { ok: false; reason: string }

/**
 * 组织一次融合（产品文档 §6.23「合成顺序与算法口径」）。
 *
 * 映射规则（V1 定稿）：**第 i 条补丁入边 ↔ 第 i 条选区上下文**，按连线顺序。
 *
 * 为什么是位置映射而不是「每条上下文记住自己的补丁节点」：后者在换线 /
 * 复制粘贴 / 删掉重建节点之后会留下指向不存在节点的悬空引用，而位置映射
 * 天然跟着图走 —— 用户重连一条线就换了一条补丁，符合直觉。
 *
 * 校验顺序刻意是「先缺输入 → 后参数」：节点上什么都没接时，
 * 用户最该看到的是「请接一张原图和一张局部图」，而不是「选区短边不足 32px」。
 */
export function planFusion(input: {
  original: { assetHash: string; width: number; height: number } | null
  contexts: readonly FusionContext[]
  patches: readonly FusionPatchInput[]
}): FusionPlanResult {
  const { original, contexts, patches } = input
  if (!original || patches.length === 0 || contexts.length === 0) {
    return { ok: false, reason: FUSION_MISSING_INPUT }
  }
  if (patches.length > FUSION_MAX_PATCHES) {
    return { ok: false, reason: `局部修改图最多 ${FUSION_MAX_PATCHES} 张，当前 ${patches.length} 张` }
  }
  if (contexts.length !== patches.length) {
    return {
      ok: false,
      reason: `选区有 ${contexts.length} 个、局部修改图有 ${patches.length} 张，数量必须一一对应`,
    }
  }

  let totalPixels = 0
  const steps: FusionStep[] = []
  for (let i = 0; i < patches.length; i += 1) {
    const ctx = contexts[i]
    const patch = patches[i]
    const padded = ctx.paddedRect
    if (Math.min(padded.w, padded.h) < FUSION_MIN_EDGE) {
      return { ok: false, reason: `第 ${i + 1} 个选区太小（短边不足 ${FUSION_MIN_EDGE}px），请重新框选` }
    }
    if (patch.width <= 0 || patch.height <= 0) {
      return { ok: false, reason: `第 ${i + 1} 张局部修改图读不出像素尺寸` }
    }
    if (!ratioMatches(rectRatio(padded), patch.width / patch.height)) {
      return {
        ok: false,
        reason: `第 ${i + 1} 张局部修改图与选区比例不一致，无法融合（请让修改图按选区的比例生成）`,
      }
    }
    totalPixels += padded.w * padded.h
    if (totalPixels > FUSION_MAX_PIXELS) {
      return { ok: false, reason: '选区总面积超出上限，请缩小选区或减少数量' }
    }
    steps.push({
      contextId: ctx.id,
      patchNodeId: patch.nodeId,
      patchAssetHash: patch.assetHash,
      target: padded,
      patch: { w: patch.width, h: patch.height },
    })
  }

  return {
    ok: true,
    plan: { output: { w: original.width, h: original.height }, steps },
  }
}

/**
 * 选区上下文是否还认得当前的原图。
 *
 * 原图被换掉（上游换成另一张图）后，旧的选区坐标落在新图上就是**错的位置**——
 * 与其默默把补丁融到不相干的地方，不如识别出来、让视图提示用户重新框选。
 */
export function contextMatchesSource(
  ctx: FusionContext,
  source: { assetHash: string; width: number; height: number } | null,
): boolean {
  if (!source) return false
  return (
    ctx.source.assetHash === source.assetHash &&
    ctx.source.width === source.width &&
    ctx.source.height === source.height
  )
}

/** 筛出仍然匹配当前原图的选区（顺序不变） */
export function contextsForSource(
  contexts: readonly FusionContext[],
  source: { assetHash: string; width: number; height: number } | null,
): FusionContext[] {
  return contexts.filter((c) => contextMatchesSource(c, source))
}

/**
 * 图片以 `contain` 方式放进一个框之后的**实际显示矩形**（框内坐标）。
 *
 * 预览框是定高的，图片比例五花八门 —— 直接把百分比套在框上，上下（或左右）
 * 的留白会被算成图像内容，选区框就整体偏了。把「图像真正落在框里的哪一块」
 * 算出来是转换的前提，所以它是一个纯函数、有单测。
 */
export function fitInside(box: Size, image: Size): FusionRect {
  if (!(box.w > 0) || !(box.h > 0) || !(image.w > 0) || !(image.h > 0)) {
    return { x: 0, y: 0, w: Math.max(0, box.w), h: Math.max(0, box.h) }
  }
  const boxRatio = box.w / box.h
  const imageRatio = image.w / image.h
  if (boxRatio > imageRatio) {
    const h = box.h
    const w = h * imageRatio
    return { x: (box.w - w) / 2, y: 0, w, h }
  }
  const w = box.w
  const h = w / imageRatio
  return { x: 0, y: (box.h - h) / 2, w, h }
}
