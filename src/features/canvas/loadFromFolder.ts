import { assetMimeOfName, isAssetFileName } from '../../domain/shared/assetLocation'
import type { Point } from '../../domain/canvas/geometry/rect'
import { createId } from '../../shared/id'
import { createAssetNode, importAssetFile, type ImportDeps } from './importAsset'

/**
 * 「从文件夹加载」（对账 #196 · 增量 3）：把用户指定目录里的图片 / 视频批量建成素材与节点。
 *
 * 复用既有导入链路（`importAssetFile` → `asset.put` → `createAssetNode`），因此天然继承三件事：
 * ① **内容寻址去重**（同一张图再导入不会产生第二份素材）；
 * ② 素材走同一条落库漏斗（因此也会**被镜像回文件夹**，而 `has` 命中即跳过 ⇒ 不会自我复制）；
 * ③ 一次加载整体包在**一个 plan** 里 ⇒ 撤销一次就全撤（与"一次导入 = 一次撤销"同一口径）。
 */

export interface LoadFromFolderResult {
  imported: number
  /** 目录里不是素材的文件（`.DS_Store` / README / 其它格式） */
  skipped: number
  /** 读不出来 / 落库失败的文件 */
  failed: number
  /**
   * 失败明细（文件名 + 原因）。
   *
   * 为什么必须带上原因：只报"3 个失败"等于没报 —— 用户既不知道是哪三个、也不知道该不该重试。
   * 这是本项目反复踩过的「静默失败」同类问题（见 `describeError` 那条口径）。
   */
  failures: { name: string; reason: string }[]
}

/** 每排几个、间距多少：与既有"多文件导入横向依次排开（间距 24）"同一套落位口径的网格版 */
export const FOLDER_IMPORT_PER_ROW = 4
export const FOLDER_IMPORT_STEP = 260

/** 第 index 个素材的落点（纯函数，可单测） */
export function gridPoint(base: Point, index: number): Point {
  return {
    x: base.x + (index % FOLDER_IMPORT_PER_ROW) * FOLDER_IMPORT_STEP,
    y: base.y + Math.floor(index / FOLDER_IMPORT_PER_ROW) * FOLDER_IMPORT_STEP,
  }
}

/**
 * @param onProgress 每处理完**一个素材文件**报一次（读失败也算走了一步）。
 *   为什么要它：几千张图的目录点下去是**长时间没反应**——用户分不清"在干活"还是"卡死了"。
 *   分母刻意用**要处理的素材文件数**：
 *   - 不用"成功导入数"——非素材多、失败多时进度会停住不动，比没有进度更吓人；
 *   - 也不用"目录条目数"——`readme.md` / 缩略图缓存这类条目会让分母虚高，进度白白少一截。
 */
export async function loadAssetsFromFolder(
  deps: ImportDeps,
  at: Point,
  onProgress?: (done: number, total: number) => void,
): Promise<LoadFromFolderResult> {
  const result: LoadFromFolderResult = { imported: 0, skipped: 0, failed: 0, failures: [] }
  const folder = deps.platform.assetFolder
  if (!folder?.current()) return result

  const names = await folder.list()
  /** 先过一遍扩展名：非素材文件**不占进度**（它们的数量在这里一次性记进 `skipped`） */
  const files = names.filter(isAssetFileName)
  result.skipped = names.length - files.length
  let done = 0
  deps.store.beginPlan(`folder:${createId('plan')}`, '从文件夹加载素材')
  try {
    for (const name of files) {
      try {
        const blob = await folder.read(name)
        if (!blob) {
          result.failed += 1
          result.failures.push({ name, reason: '读不到文件（可能已被移动或删除）' })
          continue
        }
        const mime = blob.type || assetMimeOfName(name) || 'application/octet-stream'
        const asset = await importAssetFile(deps, new File([blob], name, { type: mime }))
        if (!asset) {
          result.failed += 1
          result.failures.push({ name, reason: '空文件或读取失败' })
          continue
        }
        createAssetNode(deps, asset, gridPoint(at, result.imported), false)
        result.imported += 1
      } catch (err) {
        // 单个文件失败不该中断整批（与"批量导入逐个独立成败"同一口径）
        result.failed += 1
        result.failures.push({ name, reason: err instanceof Error ? err.message : String(err) })
      } finally {
        // 三条出口（跳过 / 失败 / 成功）都走这里 ⇒ 进度不会因为 `continue` 而漏报
        done += 1
        onProgress?.(done, files.length)
      }
    }
  } finally {
    deps.store.endPlan()
  }
  return result
}

/** 给用户一句话（界面只需要一句能读懂的结果） */
export function describeLoadResult(result: LoadFromFolderResult): string {
  if (result.imported === 0 && result.skipped === 0 && result.failed === 0) return '这个文件夹里没有可用的图片 / 视频'
  const parts = [`从文件夹加载 ${result.imported} 张`]
  if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 个非素材文件`)
  if (result.failed > 0) {
    const first = result.failures[0]
    parts.push(`${result.failed} 个失败${first ? `（如「${first.name}」：${first.reason}）` : ''}`)
  }
  return parts.join('，')
}
