import { useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { CanvasStore, NoticeTone } from '../../state/workbenches/canvas/store'
import type { Point } from '../../domain/canvas/geometry/rect'
import { describeLoadResult, loadAssetsFromFolder } from './loadFromFolder'
import { describeExportReport, exportAssetsToFolder } from './exportAssetsToFolder'

/**
 * 「素材文件夹」那四个动作（对账 #196 / #293）——**抽出来是因为入口搬过家**。
 *
 * 原先它们全挤在画布左下角的状态条里（素材：内置库 / 从文件夹加载 / 导出素材到文件夹）。
 * 用户 2026-10-06 第 13 条要求状态条**只留节点数与缩放**，于是：
 *  - **选文件夹 / 打开文件夹 / 导出素材到文件夹** → 「全局设置 → 存储」（那本来就是管位置的地方）；
 *  - **从文件夹加载** → 画布空白处右键菜单（它本质是"往当前画布批量加节点"，必须在画布上做，
 *    设置浮层里根本没有 canvas store 可用）。
 *
 * 三个动作共享同一份实现（选目录 / 进度 / 话术），所以做成 hook，而不是在三个地方各写一遍。
 *
 * ⚠️ 动作**只返回给用户看的话**，不自己去通知：画布那边用 `store.notify`（浮条），
 * 设置页那边用自己的状态行 —— 让调用方决定"话怎么说、说在哪儿"。
 */
export interface AssetFolderActions {
  /** 当前素材文件夹名；没选过就是 `null`（那时素材只在内置库里） */
  folderName: string | null
  /** 这个环境支不支持选目录（浏览器 / 壳里都支持；内存平台不支持） */
  canPick: boolean
  /** 加载进度（大目录要能看见"走到第几个"） */
  loading: { done: number; total: number } | null
  exporting: { done: number; total: number } | null
  pick: () => Promise<string>
  openFolder: () => Promise<string>
  exportAll: () => Promise<string>
  /**
   * 把文件夹里的素材批量建成**当前画布**上的节点。
   *
   * 返回**话 + 语气**两张牌：措辞里带"失败/没有"，屏幕阅读器也该按 `role=alert` 念
   * （产品文档 §4.5）。语气由这里判（它才知道 `failed / imported` 各是多少），
   * 显示方式仍由调用方决定 —— 与上面那条"只返回话、不自己通知"同一条口径。
   */
  loadIntoCanvas: (args: {
    store: CanvasStore
    projectId: string
    at: Point
  }) => Promise<{ message: string; tone: NoticeTone }>
}

export function useAssetFolderActions(): AssetFolderActions {
  const platform = usePlatform()
  const folder = platform.assetFolder
  const [folderName, setFolderName] = useState<string | null>(folder?.current()?.name ?? null)
  const [loading, setLoading] = useState<{ done: number; total: number } | null>(null)
  const [exporting, setExporting] = useState<{ done: number; total: number } | null>(null)

  return {
    folderName,
    canPick: folder?.supported() ?? false,
    loading,
    exporting,

    async pick() {
      if (!folder) return '当前环境不支持选择文件夹'
      try {
        const picked = await folder.pick()
        const name = picked?.name ?? folder.current()?.name ?? null
        setFolderName(name)
        return name ? `素材文件夹已设为「${name}」` : '没有选择文件夹'
      } catch (err) {
        platform.logger.log('warn', '[assetFolder] 选目录失败', { error: String(err) })
        return '选择文件夹失败'
      }
    },

    /**
     * 在系统文件管理器里打开素材文件夹。
     *
     * 只有**桌面壳**做得到（`storageAdmin.openDir` 是 #261 加的壳命令）；
     * 浏览器里如实说一句，而不是把按钮藏起来 —— 用户 2026-10-06 第 5 条：
     * 「不管是桌面才可以用的，但是 UI 需要给我显示出来」。
     */
    async openFolder() {
      const path = folder?.path?.() ?? null
      if (!path) {
        return platform.storageAdmin
          ? '这个环境拿不到素材文件夹的路径（浏览器不允许）'
          : '「打开文件夹」只在桌面版可用'
      }
      if (!platform.storageAdmin) return '「打开文件夹」只在桌面版可用'
      try {
        await platform.storageAdmin.openDir(path)
        return '已在文件管理器里打开'
      } catch {
        return '打开文件夹失败'
      }
    },

    async exportAll() {
      if (!folder?.current() || exporting) return '先选一个素材文件夹'
      setExporting({ done: 0, total: 0 })
      try {
        const report = await exportAssetsToFolder(platform, (done, total) => setExporting({ done, total }))
        return describeExportReport(report, folder.current()?.name ?? '')
      } catch (err) {
        return `导出素材失败：${err instanceof Error ? err.message : String(err)}`
      } finally {
        setExporting(null)
      }
    },

    async loadIntoCanvas({ store, projectId, at }) {
      if (!folder?.current()) {
        return { message: '先选一个素材文件夹（全局设置 → 存储）', tone: 'error' as const }
      }
      setLoading({ done: 0, total: 0 })
      try {
        const result = await loadAssetsFromFolder({ platform, store, projectId }, at, (done, total) =>
          setLoading({ done, total }),
        )
        // 结果如实说：加载几张、跳过几个、失败几个（失败带第一个原因）
        return { message: describeLoadResult(result), tone: result.failed > 0 ? ('error' as const) : ('info' as const) }
      } catch (err) {
        return {
          message: `从文件夹加载失败：${err instanceof Error ? err.message : String(err)}`,
          tone: 'error' as const,
        }
      } finally {
        setLoading(null)
      }
    },
  }
}
