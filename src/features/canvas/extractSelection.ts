import type { PlatformKit } from '../../platform/ports'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { FusionRect, GenerationData } from '../../domain/canvas/model/node'
import {
  FUSION_MIN_EDGE,
  contextFromSelection,
  ratioValueOf,
} from '../../domain/canvas/fusion/fusionPlan'
import { cropContextFor } from '../../domain/canvas/fusion/cropContext'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import { generationSpec } from '../../domain/canvas/nodeSpecs/generation'
import { fingerprintBytes } from '../../domain/shared/hash'
import { createId } from '../../shared/id'

/**
 * 「提取选区」（产品文档 §6.23，2026-09-29）。
 *
 * 用户口径：「图片素材，点击提取选取后，在素材的灯箱预览界面框选局部图……
 * 框选后的局部图带持久性的上下文，通过模型进行改图后也有上下文，能支持多轮改图」。
 *
 * 所以这一步做三件事，一件都不能少：
 * 1. **裁**：按外扩矩形把原图裁下来（比用户框的那块大一圈 —— 给模型一点周边上下文，
 *    也给羽化留余量），存成**新素材**，**绝不覆盖原图**；
 * 2. **建**：在原图**右侧**新建一个局部图节点，原图不动；
 * 3. **记上下文**：在新节点上写 `cropContext`（属于哪张原图、哪个矩形、外扩矩形）。
 *    此后它跟着这张图走 —— 中间套几个生成节点改图都不丢（`resolveCropContext` 沿上游找）。
 *
 * 放在 features 而不是视图里：视图不认识存储、也拿不到 `AssetPort`（架构 §4.7），
 * 而这里既要读素材字节又要落库。
 */

export interface ExtractDeps {
  platform: PlatformKit
  store: CanvasStore
}

export interface ExtractInput {
  /** 源节点 id（拿它的 `assetHash`） */
  nodeId: string
  /** 用户框的矩形（**原图像素**坐标） */
  rect: FusionRect
  /** 比例档（`''` / 未给 = 自由）；给了就先把框吸附到该比例 */
  ratio?: string
}

export type ExtractOutcome =
  | { ok: true; nodeId: string }
  | { ok: false; reason: string }

/** 新建的产物与源图之间的水平间距（放右侧、不重叠） */
const GAP_X = 40

/**
 * 框选的两个用途（用户 2026-10-17，对账 #553）：
 *
 * - `extract` = **提取选区**：按**外扩框**裁（多留一圈给模型当上下文、给羽化留余量），
 *   并把选区写进新节点的 `cropContext` ⇒ 这张图能**融回原图**；
 * - `crop` = **裁剪**：按**用户框的原样**裁，并写 `{ full: true }`（完整图边界）
 *   ⇒ 它是一张自成一体的图，**不带选区上下文、融不回去**。
 *
 * 两者共用同一套框选交互与落库路径（读素材 → 裁 → 哈希 → 落库 → 建节点 → 一步撤销），
 * 差别只有「切哪个矩形」与「写不写选区」。
 */
export type PieceKind = 'extract' | 'crop'

/** 提取选区：带上下文、可融合回原图 */
export function extractSelection(
  deps: ExtractDeps,
  input: ExtractInput,
): Promise<ExtractOutcome> {
  return createPiece(deps, input, 'extract')
}

/** 裁剪：按框原样切一块、不带选区上下文（当参考图 / 单独用，不能作融合补丁） */
export function cropAsset(deps: ExtractDeps, input: ExtractInput): Promise<ExtractOutcome> {
  return createPiece(deps, input, 'crop')
}

async function createPiece(
  deps: ExtractDeps,
  input: ExtractInput,
  kind: PieceKind,
): Promise<ExtractOutcome> {
  const graph = deps.store.getSnapshot()
  const node = graph.nodes.find((n) => n.id === input.nodeId)
  if (!node) return { ok: false, reason: '节点不存在' }
  const data = node.data as GenerationData
  const sourceHash = data.assetHash
  if (!sourceHash) return { ok: false, reason: '这个节点还没有图片' }

  const payload = await deps.platform.assets.read(sourceHash)
  if (!payload) return { ok: false, reason: '读不到原图素材' }
  const bitmap = await createImageBitmap(
    new Blob([payload.bytes as unknown as BlobPart], { type: payload.mime || 'image/png' }),
  )

  try {
    /**
     * 原图尺寸**以真实位图为准**，不信节点上的 `naturalSize`。
     *
     * 上下文里记的矩形是要拿去做像素运算的，差 1px 都会让「局部图对不回去」；
     * 而 `naturalSize` 是写进数据、可能被历史版本或手工改过的字段。
     */
    const source = { assetHash: sourceHash, width: bitmap.width, height: bitmap.height }
    const ctx = contextFromSelection({
      contextId: createId('fctx'),
      source,
      rect: input.rect,
      ratio: ratioValueOf(input.ratio),
      /** 裁剪**不外扩**：它就是用户框住的那一块，多留一圈反而看不懂 */
      ...(kind === 'crop' ? { paddingRatio: 0 } : {}),
    })
    /** 提取选区切的是**外扩框**（给模型上下文、给羽化留余量）；裁剪切的是**原框** */
    const p = kind === 'crop' ? ctx.rect : ctx.paddedRect
    if (Math.min(p.w, p.h) < FUSION_MIN_EDGE) {
      const what = kind === 'crop' ? '裁剪区' : '选区'
      return { ok: false, reason: `${what}太小（边长至少 ${FUSION_MIN_EDGE}px），请重新框选` }
    }

    // ① 裁下这一块（原图不动）
    const canvas = document.createElement('canvas')
    canvas.width = p.w
    canvas.height = p.h
    const g2 = canvas.getContext('2d')
    if (!g2) return { ok: false, reason: '当前浏览器不支持画布裁剪' }
    g2.imageSmoothingEnabled = true
    g2.imageSmoothingQuality = 'high'
    g2.drawImage(bitmap, p.x, p.y, p.w, p.h, 0, 0, p.w, p.h)
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) return { ok: false, reason: '裁剪结果导出失败' }
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const hash = await fingerprintBytes(bytes)

    /**
     * ②③ 落库 + 新建局部图 + 写上下文，**一步撤销**。
     * `beginPlan` / `endPlan` 之间不得 await（`activePlan` 是单个变量），故字节与哈希都先算完。
     */
    const id = createId('node')
    deps.store.beginPlan(`${kind}:${id}`, kind === 'crop' ? '裁剪' : '提取选区')
    deps.store.dispatch({
      kind: 'asset.put',
      asset: {
        hash,
        mime: 'image/png',
        bytes,
        width: p.w,
        height: p.h,
        createdAt: Date.now(),
        projectId: graph.projectId,
      },
    })
    deps.store.dispatch({
      kind: 'node.create',
      projectId: graph.projectId,
      type: 'generation',
      at: { x: node.x + node.w + GAP_X, y: node.y },
      id,
      size: assetNodeSize({ width: p.w, height: p.h }),
      title: kind === 'crop' ? '裁剪图' : '局部图',
      data: {
        ...generationSpec.createDefaultData(),
        assetHash: hash,
        naturalSize: { width: p.w, height: p.h },
        thumbOrder: [hash],
        /**
         * 提取选区：写真正的选区（去掉 id —— 这是「这张图自己的属性」，
         * 不是某个融合节点里的一条记录）。
         *
         * 裁剪：写 **`{ full: true }`（完整图边界）**，而不是"不写字段"。
         * 这点很关键 —— `resolveCropContext` 是**沿上游 BFS** 找上下文的，
         * 字段缺席会一路往上穿：从一张局部图上再裁剪，就会莫名继承上一层的选区。
         * 边界标记才会让它**当场停住**（`cropContext.ts` 规则 1）。
         */
        cropContext:
          /** 写这一侧的唯一入口：裁剪 = 完整图边界，提取选区 = 真选区（见 `cropContextFor`） */
          cropContextFor(kind, ctx),
      } as GenerationData,
    })
    deps.store.endPlan()
    deps.store.setSelection([id])
    await deps.store.flush()
    return { ok: true, nodeId: id }
  } finally {
    bitmap.close()
  }
}
