import type { CompareData, CropContext, GenerationData, NodeSnapshot } from '../model/node'
import { resultImagesOf } from './resultImages'

/**
 * 一个节点**持久化在 `data` 里**引用的全部素材 hash（对账 #222）。
 *
 * 为什么要有这个函数：素材表 `assets.id` 就是**内容哈希**，而 `assets.projectId`
 * 只记「最后一个导入它的项目」——复制项目后同一张图被两个项目共用，
 * 导出原件时按 `projectId` 去取就会漏图（对账 #221 记的已知未解）。
 * 按**节点真正引用到的 hash** 取，才与画面上看到的图一致。
 *
 * 口径（多收会把历史垃圾图打进包里，少收会丢图）：
 * - `data.assetHash`：节点自己的产物图 —— 走 `resultImagesOf`，与渲染同一个口径
 * - `data.compareWith`：融合产物「跟哪张原图对比」
 * - `data.leftAssetHash` / `data.rightAssetHash`：对比节点在上游断线时的兜底图
 * - `data.cropContext.source.assetHash`：这张图所属的原图（局部选区，融合要用）
 *
 * **不收 `thumbOrder`**：它只是「上次跑出来的一串缩略图顺序」，当前没有任何渲染读它，
 * 收进来会把**已经不在画布上**的旧产物一并打包（含素材导出本来就要控体积）。
 */
export function assetHashesOfNode(node: NodeSnapshot): string[] {
  const out = new Set<string>()
  const add = (hash: unknown): void => {
    if (typeof hash === 'string' && hash.length > 0) out.add(hash)
  }

  for (const hash of resultImagesOf(node)) add(hash)

  const data = node.data as Partial<GenerationData> & Partial<CompareData>
  add(data.assetHash)
  add(data.compareWith)
  add(data.leftAssetHash)
  add(data.rightAssetHash)

  const crop = data.cropContext as CropContext | undefined
  // `{ full: true }` 是「完整图边界」标记，不带素材
  if (crop && !('full' in crop)) add(crop.source?.assetHash)

  return [...out]
}

/** 一组节点引用的素材 hash（去重，保持首次出现的顺序） */
export function assetHashesOf(nodes: readonly NodeSnapshot[]): string[] {
  const out = new Set<string>()
  for (const node of nodes) {
    for (const hash of assetHashesOfNode(node)) out.add(hash)
  }
  return [...out]
}
