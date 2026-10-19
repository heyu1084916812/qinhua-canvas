import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import type { PlatformKit } from '../../platform/ports'
import { createAssetNode } from '../canvas/importAsset'
import { activeCanvasId } from '../../state/project/activeCanvas'
import { rememberCanvasCover } from '../../state/project/cover'
import { createStore } from '../../state/createStore'

export class NoActiveCanvasError extends Error {
  constructor() {
    super('先打开一个画布，再发送素材')
    this.name = 'NoActiveCanvasError'
  }
}

export interface SendToActiveCanvasResult {
  projectId: string
  projectName: string
  nodeId: string
}

/**
 * 把素材复制成一个新的画布生成节点。
 *
 * 不借用画布页的 store 缓存：离开画布时那一个实例已经 dispose，且它可能正在
 * 执行别的写入。这里按项目新建一个短生命周期 store，水合、追加节点、flush、
 * dispose，语义与“导入一张图到画布”一致。
 */
export async function sendAssetToActiveCanvas(
  platform: PlatformKit,
  asset: LibraryAsset,
): Promise<SendToActiveCanvasResult> {
  const projectId = activeCanvasId()
  if (!projectId) throw new NoActiveCanvasError()

  await platform.storage.open()
  const projectRows = await platform.storage.query('projects', { id: projectId })
  const project = projectRows[0]
  if (!project) throw new Error('当前画布项目已经不存在')
  const assetRows = await platform.storage.query('assets', { id: asset.hash })
  if (!assetRows[0]) throw new Error('素材内容不存在，可能已经被清理')

  const nodeRows = await platform.storage.query('nodes', { projectId })
  const edgeRows = await platform.storage.query('edges', { projectId })
  const store = createStore({ workbench: 'canvas', platform, projectId })
  store.hydrate({
    projectId,
    nodes: nodeRows as never,
    edges: edgeRows as never,
  })

  const nodes = store.getSnapshot().nodes
  const maxX = nodes.reduce((max, node) => Math.max(max, node.x + node.w), 0)
  const minY = nodes.length > 0 ? Math.min(...nodes.map((node) => node.y)) : 0
  const nodeId = createAssetNode(
    { platform, store, projectId },
    {
      hash: asset.hash,
      mime: asset.mime,
      width: asset.width,
      height: asset.height,
      name: asset.prompt?.trim().slice(0, 24) || `素材-${asset.hash.slice(0, 6)}`,
    },
    { x: nodes.length > 0 ? maxX + 64 : 80, y: minY },
  )
  if (!nodeId) {
    store.dispose()
    throw new Error('画布没有建立素材节点')
  }

  await store.flush()
  store.dispose()
  void rememberCanvasCover(platform.storage, projectId, asset.hash)
  return {
    projectId,
    projectName: String(project.name ?? '画布'),
    nodeId,
  }
}
