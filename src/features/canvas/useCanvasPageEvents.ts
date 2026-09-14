import { useCallback } from 'react'
import { createId } from '../../shared/id'
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
          // 离散提交（画板落笔画字、改背景）传 transient:false 以进入撤销栈。
          store.dispatch({
            kind: 'node.updateData',
            id: nodeId,
            patch: event.patch,
            transient: event.transient ?? true,
          })
          break
        case 'rename':
          store.dispatch({ kind: 'node.rename', id: nodeId, title: event.title })
          break
        case 'createChild': {
          // 在容器（画板）内新建子节点：网格瀑布式布局，避免与已有子节点重叠
          // （同位叠放会让后建节点盖住先建节点的端点，端点拖线永远点不到——G21 冒烟教训）
          const board = store.getSnapshot().nodes.find((n) => n.id === nodeId)
          if (!board || board.type !== 'board') break
          const cellW = 220
          const cellH = 160
          const cols = Math.max(1, Math.floor((board.w - 24) / cellW))
          const idx = store
            .getSnapshot()
            .nodes.filter((n) => n.parentId === board.id).length
          const id = createId('node')
          store.dispatch({
            kind: 'node.create',
            projectId: board.projectId,
            type: event.nodeType,
            at: {
              x: 24 + (idx % cols) * cellW,
              y: 24 + Math.floor(idx / cols) * cellH,
            },
            parentId: board.id,
            id,
          })
          store.setSelection([id])
          // 画板随子节点自动扩容：容器始终完整容纳子图（§6.13），
          // 否则子节点超出部分被 overflow:clip 裁掉，不可见也不可点
          const snap = store.getSnapshot()
          const child = snap.nodes.find((n) => n.id === id)
          const boardNow = snap.nodes.find((n) => n.id === board.id)
          if (child && boardNow) {
            const needW = child.x + child.w + 24
            const needH = child.y + child.h + 24
            if (needW > boardNow.w || needH > boardNow.h) {
              store.dispatch({
                kind: 'node.resize',
                id: board.id,
                rect: {
                  x: boardNow.x,
                  y: boardNow.y,
                  w: Math.max(boardNow.w, needW),
                  h: Math.max(boardNow.h, needH),
                },
                phase: 'end',
              })
            }
          }
          break
        }
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
