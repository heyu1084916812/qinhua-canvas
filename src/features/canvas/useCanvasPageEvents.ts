import { useCallback } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { NodeViewEvent } from '../../workbenches/canvas/nodes/registry'
import { importAssetFile } from './importAsset'
import { assetNodeSize } from '../../domain/canvas/layout/assetNodeSize'

/**
 * 视图事件 → 命令 的翻译层（架构 §4.7 ①）。
 * 节点视图只 emit 语义事件，由这里翻译成 dispatch(command)。
 * 放在 features 层（而非 pages），这样 workbenches 与 pages 都能复用同一套翻译。
 *
 * M0 阶段只落地 updateData / rename；requestRun 等属于 M0-11 / M2，当前忽略。
 */
export function useCanvasPageEvents(store: CanvasStore, onOpenSettings?: () => void) {
  const platform = usePlatform()

  /**
   * 上传素材到**已有**节点（§6.8 状态 A）。
   *
   * 取文件 / 算哈希 / 落库三步统一走 `importAssetFile`（与「画布空白处导入」
   * 共用同一段）——否则两条路径迟早在「有没有 naturalSize」「哈希口径一不一致」
   * 上分叉。这里只多一步：把 hash 写回当前节点。
   */
  const handleUpload = useCallback(
    async (nodeId: string, file?: File) => {
      const asset = await importAssetFile({ platform, store, projectId: store.getSnapshot().projectId }, file)
      if (!asset) return
      const natural =
        asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined
      store.dispatch({
        kind: 'node.updateData',
        id: nodeId,
        patch: { assetHash: asset.hash, naturalSize: natural },
        // 有内容即锁原始比例（§6.16）：不换框的话，一张 2:1 的图会缩在
        // 240×240 的方框中间、上下各留一条白边。
        ...(natural ? { size: assetNodeSize(natural) } : {}),
        transient: false,
      })
    },
    [platform, store],
  )

  const emitNodeEvent = useCallback(
    (nodeId: string, event: NodeViewEvent) => {
      switch (event.type) {
        case 'updateData':
          // 默认 transient（文本编辑等连续输入）：不进撤销栈，但仍落库（架构 §4.3）。
          // 离散提交传 transient:false 以进入撤销栈。
          store.dispatch({
            kind: 'node.updateData',
            id: nodeId,
            patch: event.patch,
            transient: event.transient ?? true,
            // 尺寸联动（如循环节点展开抽屉时撑高）——与 node.updateData 命令同口径
            ...(event.size ? { size: event.size } : {}),
          })
          break
        case 'rename':
          store.dispatch({ kind: 'node.rename', id: nodeId, title: event.title })
          break
        // 上传素材（§6.8 状态 A）：取文件 / 算哈希 / 落库三件事都在宿主侧
        case 'requestUpload':
          void handleUpload(nodeId, event.file)
          break
        case 'removeOwnAsset':
          // 删掉节点自身内容（§6.6「节点自身内容 → 删除」）。
          // 置 undefined 而非删键：全站判断都走真值，且落库时 JSON 会自然丢弃。
          store.dispatch({
            kind: 'node.updateData',
            id: nodeId,
            patch: { assetHash: undefined },
            transient: false,
          })
          break
        // 素材灯箱（§6.17）：只记「要看哪个素材」，不派发命令 —— 纯展示态，
        // 本体由灯箱自己按 hash 从 assets 表读回（架构 §4.7：视图不认识存储）
        case 'openLightbox':
          store.openLightbox(event.assetHash)
          break
        // 以下属于执行引擎 / 上游开关，由各自的接线方接住（执行宿主 / NodeLayer / PanelLayer）
        case 'requestRun':
        case 'requestRunCancel':
        case 'requestPanel':
        case 'toggleUpstream':
        case 'reorderThumbs':
          break
        case 'openSettings':
          // 纯导航：不派发命令、不改图，交回页面容器（节点不知道路由，架构 §4.7）
          onOpenSettings?.()
          break
      }
    },
    [store, onOpenSettings, handleUpload],
  )

  return { emitNodeEvent }
}
