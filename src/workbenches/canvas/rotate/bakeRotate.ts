import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { toWorldRectInGraph } from '../../../domain/canvas/geometry/coords'
import { assetNodeSize } from '../../../domain/canvas/layout/assetNodeSize'
import { fingerprintBytes } from '../../../domain/shared/hash'
import type { CanvasStore } from '../../../state/workbenches/canvas/store'

/**
 * 把「旋转 + 镜像」**真画进像素**并写回节点（一步撤销）。
 *
 * 从 `RotateLayer` 里搬出来的（2026-10-16）：旋转现在住在**灯箱**里，
 * 而这段「把结果算出来 + 落成新素材 + 写回节点 + 节点框跟着新比例走」
 * 与 UI 无关 —— 留在组件里会让灯箱那侧再抄一份，迟早漂移（这个仓库的老毛病）。
 */
export interface RotateSaveInput {
  store: CanvasStore
  graph: GraphSnapshot
  node: NodeSnapshot
  /** 原图的 url（`useAssetMeta` 给的那份） */
  url: string
  angle: number
  mirrorH: boolean
  mirrorV: boolean
}

export async function saveRotatedAsset(input: RotateSaveInput): Promise<void> {
  const { store, graph, node, url, angle, mirrorH, mirrorV } = input

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error('load'))
    el.src = url
  })

  const rad = (angle * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  const w = Math.max(1, Math.round(img.naturalWidth * cos + img.naturalHeight * sin))
  const h = Math.max(1, Math.round(img.naturalWidth * sin + img.naturalHeight * cos))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g2 = canvas.getContext('2d')
  if (!g2) return
  g2.translate(w / 2, h / 2)
  g2.rotate(rad)
  g2.scale(mirrorH ? -1 : 1, mirrorV ? -1 : 1)
  g2.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) return
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const newHash = await fingerprintBytes(bytes)

  /** 字节与哈希都算完了才开事务（plan 之间不得 await） */
  const size = assetNodeSize({ width: w, height: h })
  const rect = toWorldRectInGraph(node, graph)
  store.beginPlan(`rotate-save:${node.id}`, '保存旋转结果')
  store.dispatch({
    kind: 'asset.put',
    asset: {
      hash: newHash,
      mime: 'image/png',
      bytes,
      width: w,
      height: h,
      createdAt: Date.now(),
      projectId: graph.projectId,
    },
  })
  store.dispatch({
    kind: 'node.updateData',
    id: node.id,
    patch: { assetHash: newHash, naturalSize: { width: w, height: h }, thumbOrder: [newHash] },
  })
  /** 节点框跟着新比例走（居中缩放，别让图从框里跳出去） */
  store.dispatch({
    kind: 'node.resize',
    id: node.id,
    rect: {
      x: rect.x + (rect.w - size.w) / 2,
      y: rect.y + (rect.h - size.h) / 2,
      w: size.w,
      h: size.h,
    },
    phase: 'end',
  })
  store.endPlan()
  await store.flush()
  store.showUndoBar('已保存旋转结果')
}
