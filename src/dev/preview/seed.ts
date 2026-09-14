import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import { previewChild } from './fixtures'
import { PREVIEW_ASSET_HASHES } from './assets'

/** 陈列室内置渠道 id：面板「平台」下拉与生成请求都用它 */
export const PREVIEW_CHANNEL_ID = 'ch-preview'
export const PREVIEW_CHANNEL_NAME = '陈列室渠道'
export const PREVIEW_MODEL_ID = 'mock-image-1'

/**
 * 把内置渠道写进渠道 store（陈列室专用，架构 §5.7）。
 *
 * 走的是应用真实入口 `create` + `setEnabled`，不是造假的只读快照——
 * 这样创作参数面板的下拉、生成节点的渠道校验都与生产路径一致。
 * 协议用 'mock'（本地适配器，不依赖 mockNetwork 的 HTTP 拦截），
 * 因此陈列室里点「生成」可以真的产出素材。
 */
export async function seedPreviewChannels(store: ChannelStore): Promise<void> {
  await store.load()
  if (store.getState().channels.some((c) => c.id === PREVIEW_CHANNEL_ID)) return
  const created = await store.create({
    name: PREVIEW_CHANNEL_NAME,
    protocol: 'mock',
    baseUrl: 'https://preview.local',
  })
  // mock 适配器自带模型清单，验证一次即可把 modelCache 填上（与设置页行为一致）
  await store.verify(created.id)
  // 但 §7.4 起「验证地址」**只**填 modelCache（拉回来的全部），画布下拉读的是 `models`（用户勾选的）。
  // 陈列室必须自己把这步勾选补上，否则预览里的模型下拉是空的——
  // 这里取全部生图模型（与「用户把能用的都勾上」同义）。
  const fresh = store.getState().channels.find((c) => c.id === created.id)
  const imageModels = fresh?.modelCache.filter((m) => m.category === 'image') ?? []
  await store.setModels(created.id, imageModels)
  await store.setEnabled(created.id, true)
}

/**
 * 陈列室图种子（架构 §5.7）。
 *
 * 节点视图默认只接受 `node` prop，但容器类节点（分组 / 批量）需要读整张图才能
 * 拿到自己的子节点。陈列室因此把「容器 + 子节点」真实写进画布 store，
 * 由视图自己按 parentId 组网——与生产路径完全一致，不做特例。
 */
export interface SeedContainer {
  /** 容器节点 id，视图按它取子节点 */
  containerId: string
  /** 容器类型（分组 / 批量共用同一套容器本体） */
  type?: 'group' | 'batch'
  children: NodeSnapshot[]
}

export function seedPreviewGraph(store: CanvasStore, seeds: SeedContainer[] = defaultSeeds()): void {
  for (const seed of seeds) {
    for (const child of seed.children) {
      store.dispatch({
        kind: 'node.create',
        projectId: 'preview',
        type: child.type,
        at: { x: 0, y: 0 },
        id: child.id,
        title: child.title,
        parentId: seed.containerId,
        size: { w: child.w, h: child.h },
        data: child.data,
      })
    }
    // 容器自身必须存在，视图才能读到它
    store.dispatch({
      kind: 'node.create',
      projectId: 'preview',
      type: seed.type ?? 'group',
      at: { x: 0, y: 0 },
      id: seed.containerId,
      parentId: null,
    })
  }
}

/**
 * 与 PreviewPage 的分组卡片一一对应的子节点：
 * c-1 / c-2 / c-4 三个网格态 + c-p（含提示词）。
 * 容器 id 与卡片里的 data.childIds 保持一致。
 */
function defaultSeeds(): SeedContainer[] {
  const [a, b] = PREVIEW_ASSET_HASHES
  // 子节点 id 必须带容器前缀：多个容器共处一张图，裸 c1 会互相顶掉
  const c = (containerId: string, n: number) => `${containerId}-c${n}`
  return [
    { containerId: 'gp-1', children: [previewChild(c('gp-1', 1), 'generation', a)] },
    {
      containerId: 'gp-2',
      children: [previewChild(c('gp-2', 1), 'generation', a), previewChild(c('gp-2', 2), 'generation', b)],
    },
    {
      containerId: 'gp-4',
      children: [
        previewChild(c('gp-4', 1), 'generation', a),
        previewChild(c('gp-4', 2), 'generation', b),
        previewChild(c('gp-4', 3), 'generation', a),
        previewChild(c('gp-4', 4), 'generation', b),
      ],
    },
    {
      containerId: 'gp-p',
      children: [
        previewChild(c('gp-p', 1), 'generation', a),
        previewChild(c('gp-p', 2), 'prompt', undefined, '一只戴帽子的猫，赛博朋克风格，霓虹灯背景'),
      ],
    },
    // 批量节点（§6.12）：素材集合与提示词集合各取一态，验证空态文案按 contentType 分流
    {
      containerId: 'bp-2',
      type: 'batch',
      children: [previewChild(c('bp-2', 1), 'generation', a), previewChild(c('bp-2', 2), 'generation', b)],
    },
    {
      containerId: 'bp-4',
      type: 'batch',
      children: [
        previewChild(c('bp-4', 1), 'generation', a),
        previewChild(c('bp-4', 2), 'generation', b),
        previewChild(c('bp-4', 3), 'generation', a),
        previewChild(c('bp-4', 4), 'generation', b),
      ],
    },
    {
      containerId: 'bp-p',
      type: 'batch',
      children: [
        previewChild(c('bp-p', 1), 'prompt', undefined, '清晨的咖啡馆，暖色调'),
        previewChild(c('bp-p', 2), 'prompt', undefined, '雨夜的霓虹街道，赛博朋克'),
        previewChild(c('bp-p', 3), 'prompt', undefined, '两个人的夏天，胶片质感'),
      ],
    },
  ]
}
