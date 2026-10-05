import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'
import type { Point } from '../../domain/canvas/geometry/rect'
import {
  createAssetNode,
  importAssetFile,
  isImportableMedia,
  type ImportDeps,
  type ImportedAsset,
} from './importAsset'

/** 拖入多个文件时，相邻节点的水平间距（产品文档 §6.3） */
export const IMPORT_GAP = 24

/** dataTransfer 里带的是文件（而不是画布内的节点拖拽） */
export function draggedFiles(e: { dataTransfer: DataTransfer }): File[] {
  const types = Array.from(e.dataTransfer.types ?? [])
  if (!types.includes('Files')) return []
  return Array.from(e.dataTransfer.files ?? [])
}

export interface DropImportResult {
  /** 建成并选中了的节点 id */
  ids: string[]
  /** 类型不支持被跳过的文件数（调用方据此给一句提示） */
  rejected: number
}

/**
 * 把拖入的文件批量导成素材节点（**两个画布表面共用一份实现**）。
 *
 * 两条必须保持的约定：
 * 1. 先取齐素材（异步），再**同步**建节点 —— 计划区间内不夹 `await`，
 *    这样整批导入才真的合成一个撤销单元（§6.3「一次导入 = 一次撤销步骤」）；
 * 2. 横向依次排开（间距 24、各按自己的宽度）—— 叠成一摞等于只导进了一张。
 *
 * 抽出来的理由与「下载」同一条：两个表面各写一遍，迟早在其中一处漏掉修好的行为。
 */
export async function importDroppedFiles(
  deps: ImportDeps,
  files: readonly File[],
  at: Point,
): Promise<DropImportResult> {
  const assets: ImportedAsset[] = []
  let rejected = 0
  for (const file of files) {
    // 类型未知（空 type）时不拦，交给后续按字节判断
    if (file.type && !isImportableMedia(file.type)) {
      rejected += 1
      continue
    }
    const asset = await importAssetFile(deps, file)
    if (asset) assets.push(asset)
  }
  if (assets.length === 0) return { ids: [], rejected }

  const ids: string[] = []
  // `activePlan` 是单个变量 ⇒ 计划不可嵌套，故整批只开一次、createAssetNode 传 ownPlan=false
  deps.store.beginPlan(`import:${assets.map((a) => a.hash.slice(0, 8)).join('-')}`, '导入素材')
  let offsetX = 0
  for (const asset of assets) {
    const size = assetNodeSize({ width: asset.width, height: asset.height })
    const id = createAssetNode(
      deps,
      asset,
      { x: Math.round(at.x + offsetX - size.w / 2), y: Math.round(at.y - size.h / 2) },
      false,
    )
    if (id) ids.push(id)
    offsetX += size.w + IMPORT_GAP
  }
  deps.store.endPlan()
  return { ids, rejected }
}
