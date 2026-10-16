import type { PlatformKit } from '../../platform/ports'
import {
  describeExportReport,
  exportAssetsToFolder,
  type ExportAssetsReport,
} from './exportAssetsToFolder'

/**
 * 「选择素材文件夹并同步现有素材」。
 *
 * 用户 2026-10-15 提的场景：换到新目录后，只记住位置还不够 ——
 * 旧素材仍只在内置库里，得再去找一次「导出素材到文件夹」。这条把两步合成一步，
 * 但**不改变数据所有权**：`assets` 表仍是主副本，文件夹只是镜像，
 * 所以这里只复制，不做 move / delete。
 *
 * 取消系统目录选择时必须停在这里，不能拿上一次的目录继续导出：用户按了取消，
 * 却看到 "已同步" 是最难排查的一类假成功。
 */
export interface PickAndSyncResult {
  picked: boolean
  folderName: string | null
  report: ExportAssetsReport | null
  message: string
}

export async function pickAndSyncAssets(
  platform: PlatformKit,
  onProgress?: (done: number, total: number) => void,
): Promise<PickAndSyncResult> {
  const folder = platform.assetFolder
  if (!folder) {
    return {
      picked: false,
      folderName: null,
      report: null,
      message: '当前环境不支持选择文件夹',
    }
  }

  try {
    const picked = await folder.pick()
    if (!picked) {
      return {
        picked: false,
        folderName: folder.current()?.name ?? null,
        report: null,
        message: '没有选择文件夹',
      }
    }

    const folderName = picked.name || folder.current()?.name || ''
    const report = await exportAssetsToFolder(platform, onProgress)
    const exportMessage = describeExportReport(report, folderName)
    return {
      picked: true,
      folderName: folderName || null,
      report,
      message: `素材文件夹已设为「${folderName}」；${exportMessage}`,
    }
  } catch (err) {
    return {
      picked: false,
      folderName: folder.current()?.name ?? null,
      report: null,
      message: `选择并同步素材失败：${err instanceof Error ? err.message : String(err)}`,
    }
  }
}
