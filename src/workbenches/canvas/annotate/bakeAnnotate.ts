import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { GenerationData, NodeSnapshot } from '../../../domain/canvas/model/node'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { assetNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import { fingerprintBytes } from '../../../domain/shared/hash'
import { createId } from '../../../shared/id'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'
import { drawAnnotateOp, drawAnnotateText, type AnnotateOp, type AnnotateTextItem } from './annotateOps'

/**
 * 把「底图 + 全部标注」**真画进像素**，落到原图**右侧的新节点**上。
 *
 * 从老的独立标注层 `AnnotateLayer` 里搬出来的（2026-10-16：标注现在住在**灯箱**里，
 * 见 `LightboxLayer` 的标注模式）。与 `rotate/bakeRotate` 同一路数：与 UI 无关的
 * 「合成 → 落素材 → 建节点」全在这一个函数里，灯箱那侧只负责交互。
 *
 * **为什么另起一个节点而不是覆盖原图**（与「提取选区」「宫格切分」同一条约定）：
 * 标注是派生内容，覆盖掉原图就再也回不去了 —— 撤销只能回退数据、回退不了像素。
 */
export interface AnnotateSaveInput {
  store: CanvasStore
  graph: GraphSnapshot
  node: NodeSnapshot
  /** 原图的 url（`useAssetMeta` 给的那份） */
  url: string
  ops: AnnotateOp[]
  /** 可编辑文字图层；保存时画在画笔 / 矩形之后，等价于“文字图层在最上面” */
  textItems?: AnnotateTextItem[]
}

/** 返回新节点 id；合成失败（取不到图 / 编码失败）时返回 undefined，不写任何数据 */
export async function saveAnnotatedAsset(input: AnnotateSaveInput): Promise<string | undefined> {
  const { store, graph, node, url, ops, textItems = [] } = input

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('load'))
    el.src = url
  }).catch(() => null)
  if (!img || !img.naturalWidth || !img.naturalHeight) return undefined

  /** 画布 = 原图原始像素尺寸（标注坐标本来就是图片坐标，这里一格不缩） */
  const width = img.naturalWidth
  const height = img.naturalHeight
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const g2 = canvas.getContext('2d')
  if (!g2) return undefined
  g2.drawImage(img, 0, 0, width, height)
  for (const op of ops) drawAnnotateOp(g2, op)
  for (const item of textItems) drawAnnotateText(g2, item)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return undefined
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const newHash = await fingerprintBytes(bytes)

  /** 字节与哈希都算完了才开事务（plan 之间不得 await） */
  const size = assetNodeSize({ width, height })
  const rect = toWorldRectInGraph(node, graph)
  const id = createId('node')
  store.beginPlan(`annotate:${id}`, '保存标注')
  store.dispatch({
    kind: 'asset.put',
    asset: {
      hash: newHash,
      mime: 'image/png',
      bytes,
      width,
      height,
      createdAt: Date.now(),
      projectId: graph.projectId,
    },
  })
  store.dispatch({
    kind: 'node.create',
    projectId: graph.projectId,
    type: 'generation',
    at: { x: rect.x + rect.w + 48, y: rect.y },
    id,
    size,
    title: `${node.title} · 标注图`,
    data: {
      ...generationSpec.createDefaultData(),
      assetHash: newHash,
      naturalSize: { width, height },
      thumbOrder: [newHash],
    } as GenerationData,
  })
  store.endPlan()
  await store.flush()
  store.showUndoBar('已保存标注图')
  return id
}
