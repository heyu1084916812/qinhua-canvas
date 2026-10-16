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

/** `dataTransfer` 里带的是文件（而不是画布内的节点拖拽） */
export function hasDraggedFiles(e: { dataTransfer: DataTransfer }): boolean {
  return Array.from(e.dataTransfer.types ?? []).includes('Files')
}

/**
 * 取出拖进来的文件。**只能在 `drop` 里用** ——
 * `dragover` / `dragenter` 阶段浏览器**不给** `files`（安全限制，列表恒为空），
 * 那时要判断"这是不是文件拖拽"只能用 `hasDraggedFiles`。
 *
 * ⚠️ 这条区分是有代价的：用户 2026-10-16 报「软件外的东西拖不进画布」，
 * 病根就是 `onDragOver` 曾用本函数判断、拿到空数组就 `return`，
 * 于是**没有 `preventDefault`** ⇒ 浏览器按"这里不接收"处理 ⇒ **`drop` 根本不派发**。
 * 合成事件（`dispatchEvent('drop', { dataTransfer })`）自带文件列表，
 * 正好绕开这一点 —— 冒烟全绿、真人一次都拖不进去。对账 #551。
 */
export function draggedFiles(e: { dataTransfer: DataTransfer }): File[] {
  if (!hasDraggedFiles(e)) return []
  return Array.from(e.dataTransfer.files ?? [])
}

export interface DropImportResult {
  /** 建成并选中了的节点 id */
  ids: string[]
  /** 类型不支持被跳过的文件数（调用方据此给一句提示） */
  rejected: number
}

/**
 * 从**系统剪贴板**里取出可导入的媒体文件（图片 / 视频）。
 *
 * 用户 2026-10-16 报「软件外的内容复制不进画布」：整条链路此前**没有任何
 * `paste` 监听** —— 画布的 `Ctrl+V` 只认「应用内复制的节点快照」，
 * 从截图工具 / 浏览器复制来的图一律无人接手（对账 #551）。
 *
 * 两条来源都要读：`files` 是 Windows 截图与资源管理器复制文件的那条；
 * 某些来源只把文件挂在 `items`（`kind: 'file'`）里。
 * **没有媒体就返回空数组** —— 调用方据此放行默认行为，不能把用户粘文字、
 * 粘文件路径这类操作一并吞掉。
 */
export function clipboardMediaFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  const out: File[] = []
  const seen = new Set<string>()
  const push = (file: File | null): void => {
    if (!file) return
    // 与拖入同一口径：类型为空时不拦，交给后续按字节判断
    if (file.type && !isImportableMedia(file.type)) return
    /** 有的来源会在 `files` 与 `items` 里各报一遍同一个文件，按身份去重 */
    const key = `${file.name}:${file.size}:${file.lastModified}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(file)
  }
  for (const file of Array.from(data.files ?? [])) push(file)
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind !== 'file') continue
    push(item.getAsFile())
  }
  return out
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
