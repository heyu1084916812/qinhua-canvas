import type { PlatformKit } from '../../../platform/ports'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import type { FusionData, FusionRect, NodeSnapshot } from '../../../domain/canvas/model/node'
import { fusionInputsOf } from '../../../domain/canvas/nodeSpecs/fusion'
import {
  FUSION_MISSING_INPUT,
  contextsForSource,
  planFusion,
  type FusionPatchInput,
} from '../../../domain/canvas/fusion/fusionPlan'
import { fingerprintBytes } from '../../../domain/shared/hash'
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

/** 一次合成的结果：成功给 hash，失败给可显示的原因 */
export type FuseOutcome = { ok: true; assetHash: string } | { ok: false; reason: string }

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
 * 羽化遮罩的透明度剖面（smoothstep）。
 *
 * `t` = 距外扩边界的归一化距离（0 = 最外圈、1 = 选区本体）。
 * `t²(3-2t)` 在两端导数为 0，接缝处不会留下一条可见的硬边 —— 这是
 * 线性渐变做不到的（线性渐变的两端有折角，缩放到 100% 看就是一圈浅痕）。
 */
function smoothstep(t: number): number {
  const x = Math.max(0, Math.min(1, t))
  return x * x * (3 - 2 * x)
}

/**
 * 造一张「外圈透明、内圈实心」的羽化遮罩。
 *
 * 做法是四条边各来一次 `destination-in` 的线性渐变：最终 alpha 是四条剖面的
 * **乘积**，于是越靠角越淡 —— 正是我们要的形状，且不需要逐像素循环。
 * 每条渐变的色标按 `smoothstep` 采样（而不是只有首尾两档），否则乘积出来仍是折线。
 */
function featherMask(w: number, h: number, padX: number, padY: number): HTMLCanvasElement {
  const mask = document.createElement('canvas')
  mask.width = w
  mask.height = h
  const ctx = mask.getContext('2d')
  if (!ctx) return mask
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, w, h)

  const STEPS = 8
  const ramp = (from: [number, number], to: [number, number]) => {
    const g = ctx.createLinearGradient(from[0], from[1], to[0], to[1])
    for (let i = 0; i <= STEPS; i += 1) {
      const t = i / STEPS
      g.addColorStop(t, `rgba(255,255,255,${smoothstep(t)})`)
    }
    return g
  }

  ctx.globalCompositeOperation = 'destination-in'
  /**
   * 四条边各一条渐变，羽化带宽**按边分开**给。
   *
   * 外扩是等比的（横向 `w×p`、纵向 `h×p`），16:9 的选区这两者差近一倍；
   * 只给一个 `pad` 会让某个方向的羽化带过宽，接缝处看着「糊了一块」。
   */
  const edges: [number, number, number, number][] = [
    [0, 0, padX, 0], // 左
    [w, 0, w - padX, 0], // 右
    [0, 0, 0, padY], // 上
    [0, h, 0, h - padY], // 下
  ]
  for (const [x0, y0, x1, y1] of edges) {
    ctx.fillStyle = ramp([x0, y0], [x1, y1])
    ctx.fillRect(0, 0, w, h)
  }
  ctx.globalCompositeOperation = 'source-over'
  return mask
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
  if ((data.contexts ?? []).length === 0) {
    return { ok: false, reason: '还没有框选任何区域：先在原图上拖一个框' }
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
  const contexts = contextsForSource(data.contexts ?? [], source)

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
      const layer = document.createElement('canvas')
      layer.width = step.target.w
      layer.height = step.target.h
      const lctx = layer.getContext('2d')
      if (!lctx) continue
      drawScaled(lctx, patch, { x: 0, y: 0, w: step.target.w, h: step.target.h })

      /**
       * 羽化带宽 = 外扩矩形比原选区多出来的那一圈，**两个方向分开算**。
       * 直接用矩形尺寸差，而不是再乘一遍 `paddingRatio` ——
       * 重复算一次就会在「贴边被缩回」的情形下与真实外扩量对不上。
       */
      const padX = Math.max(1, Math.round((step.target.w - contexts[i].rect.w) / 2))
      const padY = Math.max(1, Math.round((step.target.h - contexts[i].rect.h) / 2))
      lctx.globalCompositeOperation = 'destination-in'
      lctx.drawImage(featherMask(step.target.w, step.target.h, padX, padY), 0, 0)
      lctx.globalCompositeOperation = 'source-over'

      ctx.drawImage(layer, step.target.x, step.target.y)
    }

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return { ok: false, reason: '合成结果导出失败' }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const hash = await fingerprintBytes(bytes)

    /**
     * 落库 + 写回合成**一步撤销**：`beginPlan` / `endPlan` 之间不得 await
     * （`activePlan` 是单个变量，中间让出会把它拆成两步），故字节与哈希都在此之前算完。
     */
    deps.store.beginPlan(`fuse:${createId('fuse')}`, '图像融合')
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
      kind: 'node.updateData',
      id: nodeId,
      patch: {
        assetHash: hash,
        naturalSize: { width: canvas.width, height: canvas.height },
      } as never,
      transient: false,
    })
    deps.store.endPlan()
    await deps.store.flush()
    return { ok: true, assetHash: hash }
  } finally {
    for (const d of decoded) d.close()
    originalBitmap.close()
  }
}
