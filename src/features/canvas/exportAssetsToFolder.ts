import type { PlatformKit, Row } from '../../platform/ports'
import { writeAssetRow } from '../../platform/assetMirror'

/**
 * 「把内置库的素材一次性导出到文件夹」（对账 #196 · 增量 5）。
 *
 * 为什么单独做这一步：桌面壳是**另一个 origin / 另一个用户目录**，浏览器里 `assets` 表的字节不会
 * 自己跟过去；而现有导出默认不含素材字节 ⇒ 直接搬会"节点在、图全丢"。
 * 「从文件夹加载」能反向把素材读回来，所以**在这台机器上把字节落到一个目录**，
 * 就是迁移里最小、也最必要的一步（《轻画-桌面封装方案.md》§3）。
 *
 * 复用 `writeAssetRow`（与"新素材自动镜像"同一份写盘实现 + 同一套 `<hash>.<ext>` 命名），
 * 因此这里**天然幂等**：再点一次只是把已在盘上的标成 `exists`，不会产生重复文件。
 */

export interface ExportAssetsReport {
  /** 内置库里的素材行数（含只有远端地址的那些） */
  total: number
  written: number
  /** 盘上已经有了（内容寻址：同名即同 hash） */
  exists: number
  /**
   * 只有远端地址、没有本地字节 ⇒ **搬不动**。
   *
   * 必须单独报出来：迁移时这类素材（视频成片）不会跟着文件夹走，
   * 混进"跳过 N 个"里用户就会以为素材都搬完了。
   */
  noBytes: number
  failed: number
  failures: { name: string; reason: string }[]
}

export async function exportAssetsToFolder(
  platform: PlatformKit,
  onProgress?: (done: number, total: number) => void,
): Promise<ExportAssetsReport> {
  const report: ExportAssetsReport = {
    total: 0,
    written: 0,
    exists: 0,
    noBytes: 0,
    failed: 0,
    failures: [],
  }
  const folder = platform.assetFolder
  if (!folder?.current()) return report

  let rows: Row[]
  try {
    rows = (await platform.storage.query('assets', {})) as unknown as Row[]
  } catch (err) {
    // 读库失败也如实报（同 `describeError` 的口径：不许静默）
    report.failed += 1
    report.failures.push({
      name: '内置库',
      reason: err instanceof Error ? err.message : String(err),
    })
    return report
  }

  report.total = rows.length
  let done = 0
  for (const row of rows) {
    const result = await writeAssetRow(folder, row)
    if (result.status === 'written') report.written += 1
    else if (result.status === 'exists') report.exists += 1
    else if (result.status === 'no-bytes') report.noBytes += 1
    else {
      report.failed += 1
      report.failures.push({ name: result.name, reason: result.reason ?? '未知原因' })
    }
    done += 1
    onProgress?.(done, report.total)
  }
  return report
}

/** 给用户一句话（界面只需要一句能读懂的结果，与 `describeLoadResult` 同一副面孔） */
export function describeExportReport(report: ExportAssetsReport, folderName: string): string {
  if (report.total === 0 && report.failed === 0) return '内置库里还没有素材'
  const parts = [`已导出 ${report.written} 个素材到「${folderName}」`]
  if (report.exists > 0) parts.push(`${report.exists} 个盘上已有`)
  if (report.noBytes > 0) parts.push(`${report.noBytes} 个只有远端地址、没有本地字节（搬不动）`)
  if (report.failed > 0) {
    const first = report.failures[0]
    parts.push(`${report.failed} 个失败${first ? `（如「${first.name}」：${first.reason}）` : ''}`)
  }
  return parts.join('，')
}
