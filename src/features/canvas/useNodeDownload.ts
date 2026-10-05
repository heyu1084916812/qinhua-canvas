import { useCallback } from 'react'
import type { PlatformKit } from '../../platform/ports'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { downloadAsset } from './downloadAsset'

/**
 * 单节点下载（节点跟随栏 / 多选浮层的「下载」共用）。
 *
 * 抽成一份实现是因为换引擎期间**两个画布表面都要用**（老画布已删，现在只有 React Flow 面）
 * （FlowSurface）。各写一遍的代价在 M6-29 那类改动里已经见过 —— 修一处、另一处照旧。
 */
export function useNodeDownload(platform: PlatformKit, store: CanvasStore) {
  return useCallback(
    (nodeId: string) => {
      const node = store.getSnapshot().nodes.find((n) => n.id === nodeId)
      const hash = (node?.data as { assetHash?: string } | undefined)?.assetHash
      if (!hash) return
      void downloadAsset({ assets: platform.assets, files: platform.files }, hash).then((r) => {
        // 如实反馈：静默失败会让用户以为「下载坏了」，而其实是素材已不在表里
        if (!r.ok) {
          store.notify(r.reason === 'missing' ? '这张素材已不在素材库里' : '下载失败')
          return
        }
        /**
         * 视频成片托管在远端、不给 CORS 头，字节进不了页面 —— 那条路是把地址
         * 交回浏览器（新标签页）。这也是**成功**，但必须说清去哪儿拿文件。
         */
        if (r.via === 'tab') store.notify('远端素材已在新标签页打开：用浏览器自带的下载保存')
      })
    },
    [platform, store],
  )
}
