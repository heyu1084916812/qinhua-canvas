import type { PlatformKit } from '../../../platform/ports'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type {
  FusionContext,
  FusionData,
  FusionRect,
  GenerationData,
  NodeSnapshot,
} from '../../../domain/canvas/model/node'
import { FUSION_PATCH_PORT, fusionInputsOf } from '../../../domain/canvas/nodeSpecs/fusion'
import {
  FUSION_MISSING_INPUT,
  contextMatchesSource,
  planFusion,
  type FusionPatchInput,
} from '../../../domain/canvas/fusion/fusionPlan'
import { resolveCropContext } from '../../../domain/canvas/fusion/cropContext'
import {
  FUSION_FEATHER_BLUR_PX,
  applyColorOffset,
  featherMaskAlpha,
  innerRectOf,
  isZeroOffset,
  limitedColorOffset,
  type Rgb,
} from '../../../domain/canvas/fusion/fusionBlend'
import { fingerprintBytes } from '../../../domain/shared/hash'
import { assetNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import { createId } from '../../../shared/id'

/**
 * 融合节点的**本地像素合成**（产品文档 §6.23，2026-09-29）。
 *
 * 它不走渠道、不构造 RunRequest，因此**不属于执行引擎的 task**：`runEngine` 的
 * 每一步都在等一个网络往返，而这里只是几张位图叠一叠。硬塞进去只会给引擎
 * 加一条「这个 task 不调渠道」的特殊分支，而那条分支对别的节点毫无意义。
 *
 * 于是它是一段**独立的宿主侧流程**：读素材 → 合成 → 落库 → 写回节点数据。
 * 界面侧只认「点了融合按钮」这一个语义事件。
 *
 * 纯几何与校验全在 `domain/canvas/fusion/fusionPlan`（可单测），本文件只负责
 * 位图与落库这两件必须碰 DOM / 存储的事。
 */

export interface FuseDeps {
  platform: PlatformKit
  store: CanvasStore
}

/** 一次合成的结果：成功给**右侧新建的结果节点 id**，失败给可显示的原因 */
export type FuseOutcome = { ok: true; resultNodeId: string } | { ok: false; reason: string }

/** 解码一张素材；素材不在库里 / 不是图 → null（调用方据 null 报缺失） */
async function bitmapOf(deps: FuseDeps, hash: string): Promise<ImageBitmap | null> {
  const payload = await deps.platform.assets.read(hash)
  if (!payload) return null
  const blob = new Blob([payload.bytes as unknown as BlobPart], {
    type: payload.mime || 'image/png',
  })
  try {
    return await createImageBitmap(blob)
  } catch {
    return null
  }
}

/**
 * 造羽化遮罩：`featherMaskAlpha` 出解析剖面 → **0.8px 模糊** → 选区内补回不透明。
 *
 * 三步的顺序与大雄插件的 `build_feather_mask` 一一对应（见 `fusionBlend` 的说明）：
 * 剖面负责「渐变」，模糊抹掉解析剖面上仍能看出的折线，最后把选区内部补成纯不透明
 * ——**少了最后这步，模糊会从选区边界往里啃一圈**，选区自己的像素被啃淡。
 */
function featherMask(w: number, h: number, inner: FusionRect): HTMLCanvasElement {
  const flat = document.createElement('canvas')
  flat.width = w
  flat.height = h
  const fctx = flat.getContext('2d')
  if (!fctx) return flat

  const alpha = featherMaskAlpha({ w, h }, inner)
  const data = fctx.createImageData(w, h)
  for (let i = 0; i < alpha.length; i += 1) {
    data.data[i * 4] = 255
    data.data[i * 4 + 1] = 255
    data.data[i * 4 + 2] = 255
    data.data[i * 4 + 3] = alpha[i]
  }
  fctx.putImageData(data, 0, 0)

  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const octx = out.getContext('2d')
  if (!octx) return flat
  octx.filter = `blur(${FUSION_FEATHER_BLUR_PX}px)`
  octx.drawImage(flat, 0, 0)
  octx.filter = 'none'
  // 选区内 = 完全不透明（模糊会把这里啃掉一圈，补回来）
  octx.fillStyle = 'rgba(255,255,255,1)'
  octx.fillRect(inner.x, inner.y, inner.w, inner.h)
  return out
}

/**
 * 外扩框里「挖掉选区」那一圈的平均色。
 *
 * 这一圈既属于补丁的覆盖范围、又紧贴原图未改动的内容，是两者色差的唯一可比之处
 * （大雄的 `_ring_mask` 口径）。
 */
function ringMean(image: ImageData, inner: FusionRect): Rgb {
  const { width, height, data } = image
  let r = 0
  let g = 0
  let b = 0
  let n = 0
  for (let y = 0; y < height; y += 1) {
    const insideY = y >= inner.y && y < inner.y + inner.h
    for (let x = 0; x < width; x += 1) {
      if (insideY && x >= inner.x && x < inner.x + inner.w) continue
      const i = (y * width + x) * 4
      r += data[i]
      g += data[i + 1]
      b += data[i + 2]
      n += 1
    }
  }
  if (n === 0) return [0, 0, 0]
  return [r / n, g / n, b / n]
}

/** 把受限色偏逐像素加到补丁上（只动 RGB，不动 alpha） */
function applyOffsetInPlace(image: ImageData, offset: Rgb): void {
  const d = image.data
  for (let i = 0; i < d.length; i += 4) {
    const next = applyColorOffset([d[i], d[i + 1], d[i + 2]], offset)
    d[i] = next[0]
    d[i + 1] = next[1]
    d[i + 2] = next[2]
  }
}

/**
 * 把一张位图画进画布。
 *
 * `imageSmoothingQuality = 'high'`：补丁与被缩到的目标尺寸之间通常不是整数倍，
 * 默认的 low 会在细节上出现明显的锯齿（大雄用 Lanczos，浏览器没有开放那档，
 * high 是能拿到的最接近的一档）。
 */
function drawScaled(
  ctx: CanvasRenderingContext2D,
  bitmap: ImageBitmap,
  target: FusionRect,
): void {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, target.x, target.y, target.w, target.h)
}

/**
 * 按计划合成并落库。
 *
 * 顺序严格是「先校验、后合成」：任何一条不满足（缺原图 / 缺补丁 / 比例不符）
 * 都**整次失败**，不做部分合成 —— 部分合成会产出一张「看着像成功、其实少融了
 * 一块」的图，比直接报错难排查得多。
 */
export async function fuseNode(deps: FuseDeps, nodeId: string): Promise<FuseOutcome> {
  const graph = deps.store.getSnapshot()
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || node.type !== 'fusion') return { ok: false, reason: '节点不存在' }
  const data = node.data as FusionData

  const { original, patches } = fusionInputsOf(node as NodeSnapshot<FusionData>, graph)
  if (!original || patches.length === 0) {
    return { ok: false, reason: FUSION_MISSING_INPUT }
  }

  const originalBitmap = await bitmapOf(deps, original.assetHash)
  if (!originalBitmap) return { ok: false, reason: '读不到原图素材，请重新连接上游节点' }

  const source = {
    assetHash: original.assetHash,
    width: originalBitmap.width,
    height: originalBitmap.height,
  }
  /**
   * 只保留**与当前原图匹配**的选区。
   *
   * 原图被换掉后，旧选区的坐标落在新图上就是错的位置。这里不是「筛掉就算了」——
   * 筛完数量对不上会在 `planFusion` 里如实报出来，用户知道要重新框。
   */
  /**
   * **每条补丁对应哪个选区**：一律读**图片自己带的上下文**（「提取选区」产生、
   * 沿上游继承）。早先版本还允许「在融合节点里框选区」，那套已经删掉 ——
   * 选区属于图片，不属于融合节点（用户口径：「之前的那个东西删掉，都不对」）。
   *
   * 冲突（一张图里混了多个不同选区）**必须报错**，不许猜 —— 猜错就是把局部图
   * 融到不相干的位置，而画面上不一定看得出来。
   */
  const contexts: FusionContext[] = []
  for (let i = 0; i < patches.length; i += 1) {
    const patch = patches[i]
    const resolved = resolveCropContext(patch.nodeId, graph)
    if (resolved.kind === 'conflict') {
      return {
        ok: false,
        reason: `第 ${i + 1} 张局部修改图里混了多个不同的选区，无法确定该融回哪里（请把它们分成多张独立的局部图）`,
      }
    }
    if (resolved.kind !== 'local') {
      return {
        ok: false,
        reason: `第 ${i + 1} 张局部图没有选区上下文：请在它的原图上用「提取选区」得到局部图，再用改图结果来融合`,
      }
    }
    const carried: FusionContext = { id: `ctx:${patch.nodeId}`, ...resolved.context }
    if (!contextMatchesSource(carried, source)) {
      return {
        ok: false,
        reason: `第 ${i + 1} 张局部图的上下文不属于当前原图（请把它当初提取时的那张原图连到左侧）`,
      }
    }
    contexts.push(carried)
  }

  const decoded: ImageBitmap[] = []
  const patchInputs: FusionPatchInput[] = []
  for (const p of patches) {
    const bmp = await bitmapOf(deps, p.assetHash)
    if (!bmp) {
      for (const d of decoded) d.close()
      originalBitmap.close()
      return { ok: false, reason: '有一张局部修改图读不出来，请检查上游节点' }
    }
    decoded.push(bmp)
    patchInputs.push({
      nodeId: p.nodeId,
      assetHash: p.assetHash,
      width: bmp.width,
      height: bmp.height,
    })
  }

  const planned = planFusion({ original: source, contexts, patches: patchInputs })
  if (!planned.ok) {
    for (const d of decoded) d.close()
    originalBitmap.close()
    return planned
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = planned.plan.output.w
    canvas.height = planned.plan.output.h
    const ctx = canvas.getContext('2d')
    if (!ctx) return { ok: false, reason: '当前浏览器不支持画布合成' }

    // ① 完整原图打底：融合产物的尺寸与它一致，下游拿到的是一张「同一张图、局部变了」
    drawScaled(ctx, originalBitmap, { x: 0, y: 0, w: canvas.width, h: canvas.height })

    /**
     * ② 逐张补丁：先画进一张与目标等大的临时画布（好让羽化遮罩能作用于它），
     *    再把带羽化的结果盖到主画布上。后连的补丁覆盖先连的（§6.23 顺序口径）。
     */
    for (let i = 0; i < planned.plan.steps.length; i += 1) {
      const step = planned.plan.steps[i]
      const patch = decoded[i]
      const padded: FusionRect = step.target
      const inner = innerRectOf(contexts[i].rect, padded)
      const layer = document.createElement('canvas')
      layer.width = padded.w
      layer.height = padded.h
      const lctx = layer.getContext('2d')
      if (!lctx) continue
      drawScaled(lctx, patch, { x: 0, y: 0, w: padded.w, h: padded.h })

      /**
       * ① **受限色彩匹配**（大雄 `_apply_limited_color_match` 的口径）。
       *
       * 参考色取**当前主画布**上同一块，而不是原始原图位图：多张补丁依次合成时，
       * 后一张要匹配的是「已经被前面改过的那张图」—— 取原图会让第二张补丁
       * 把第一张的效果当不存在，色偏越叠越明显。
       *
       * 偏移夹在 ±24：不设上限就等于「把补丁刷成原图的颜色」，
       * 补丁自己的色彩信息会被抹掉。
       */
      /**
       * 关掉这一层时**连 getImageData 都不做**：逐像素读写是这里最贵的一步，
       * 用户明确不想要色彩匹配时不该还付这份钱。
       */
      if (data.colorMatch !== false) {
        try {
          const reference = ctx.getImageData(padded.x, padded.y, padded.w, padded.h)
          const patchImage = lctx.getImageData(0, 0, padded.w, padded.h)
          const offset = limitedColorOffset(ringMean(reference, inner), ringMean(patchImage, inner))
          if (!isZeroOffset(offset)) {
            applyOffsetInPlace(patchImage, offset)
            lctx.putImageData(patchImage, 0, 0)
          }
        } catch {
          /**
           * 逐像素读写失败（极少数环境的画布安全策略）时**跳过色彩匹配**继续合成，
           * 而不是整次失败：羽化仍然生效，产物依然可用，只是色偏这一层没上。
           * 这属于「增强项降级」，与「输入缺失」不同 —— 后者必须报错。
           */
        }
      }

      // ② 羽化：解析剖面 + 0.8px 模糊 + 选区内补回不透明
      lctx.globalCompositeOperation = 'destination-in'
      lctx.drawImage(featherMask(padded.w, padded.h, inner), 0, 0)
      lctx.globalCompositeOperation = 'source-over'

      ctx.drawImage(layer, padded.x, padded.y)
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return { ok: false, reason: '合成结果导出失败' }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const hash = await fingerprintBytes(bytes)

    /**
     * 结果**落成融合节点右侧的一个新节点**（参考实现：「结果会通过连线生成在
     * 融合节点右侧，不覆盖任何输入图片」）。
     *
     * 为什么不写回融合节点自己：那张卡片要同时显示「原图」与「局部修改」两块预览，
     * 它自己是**参数与输入的持有者**，不是产物；而且用户要的就是「结果在节点右侧」。
     *
     * 落库 + 建节点 + 连线**一步撤销**：`beginPlan` / `endPlan` 之间不得 await
     * （`activePlan` 是单个变量，中间让出会把它拆成两步），故字节与哈希都在此之前算完。
     */
    const resultId = createId('node')
    const size = assetNodeSize({ width: canvas.width, height: canvas.height })
    // 已经连出去的结果节点数：第 k 个往下排一格，反复融合不会叠在一起
    const placed = graph.edges.filter((e) => e.source === nodeId).length
    deps.store.beginPlan(`fuse:${resultId}`, '图像融合')
    deps.store.dispatch({
      kind: 'asset.put',
      asset: {
        hash,
        mime: 'image/png',
        bytes,
        width: canvas.width,
        height: canvas.height,
        createdAt: Date.now(),
        projectId: graph.projectId,
      },
    })
    deps.store.dispatch({
      kind: 'node.create',
      projectId: graph.projectId,
      type: 'generation',
      at: { x: node.x + node.w + 40, y: node.y + placed * (size.h + 24) },
      id: resultId,
      size,
      title: '融合结果',
      data: {
        ...generationSpec.createDefaultData(),
        assetHash: hash,
        naturalSize: { width: canvas.width, height: canvas.height },
        thumbOrder: [hash],
        /**
         * **完整图边界**：产物已经是一张完整图，从此不再继承任何局部上下文
         * （否则拿它再提取选区时会追溯到上一轮的选区）。参考实现的同名标记。
         */
        cropContext: { full: true },
      } as GenerationData,
    })
    deps.store.dispatch({
      kind: 'edge.connect',
      source: nodeId,
      target: resultId,
      sourcePort: FUSION_PATCH_PORT,
    })
    deps.store.endPlan()
    deps.store.setSelection([resultId])
    await deps.store.flush()
    return { ok: true, resultNodeId: resultId }
  } finally {
    for (const d of decoded) d.close()
    originalBitmap.close()
  }
}
