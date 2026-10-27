import { describe, expect, it, vi } from 'vitest'
import { prepareVisualReviewImages } from './visualReviewRunner'

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12)
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

describe('视觉验收素材准备', () => {
  it('★★ 真实读取目标与套件图片，读出像素、去重并只把可读图片交给视觉模型', async () => {
    const readAsset = vi.fn(async (hash: string) => {
      if (hash === 'target') return { bytes: pngBytes(1600, 1200), mime: 'image/png' }
      if (hash === 'role-ref') return { bytes: pngBytes(512, 768), mime: 'image/png' }
      return null
    })
    const prepared = await prepareVisualReviewImages({
      graph: {
        nodes: [
          {
            id: 'n1',
            title: '主图',
            data: { assetHash: 'target', assetMime: 'image/png' },
          } as never,
          {
            id: 'video',
            title: '视频',
            data: { assetHash: 'video', assetMime: 'video/mp4' },
          } as never,
        ],
      },
      nodeIds: ['n1', 'video'],
      contextAssets: [
        { hash: 'role-ref', mime: 'image/png' },
        { hash: 'target', mime: 'image/png' },
        { hash: 'missing-ref', mime: 'image/png' },
      ],
      readAsset,
    })

    expect(prepared.targets).toEqual([
      {
        nodeId: 'n1',
        title: '主图',
        width: 1600,
        height: 1200,
        mime: 'image/png',
      },
    ])
    expect(prepared.targetInputs).toEqual([
      {
        kind: 'asset',
        nodeId: 'n1',
        assetHash: 'target',
        mime: 'image/png',
        naturalSize: { width: 1600, height: 1200 },
      },
    ])
    expect(prepared.contextInputs).toEqual([
      {
        kind: 'asset',
        nodeId: 'context-kit:role-ref',
        assetHash: 'role-ref',
        mime: 'image/png',
        naturalSize: { width: 512, height: 768 },
      },
    ])
    expect(prepared.referenceAssetCount).toBe(1)
    expect(prepared.limitations).toEqual([
      '「视频」不是图片，不能做视觉验收',
      '已绑定套件中的一张参考素材不可读',
    ])
  })

  it('★ 空产物不伪造成可验收图片', async () => {
    const prepared = await prepareVisualReviewImages({
      graph: {
        nodes: [{ id: 'empty', title: '空节点', data: {} } as never],
      },
      nodeIds: ['empty', 'gone'],
      readAsset: vi.fn(),
    })
    expect(prepared.targets).toEqual([])
    expect(prepared.targetInputs).toEqual([])
    expect(prepared.limitations).toEqual([
      '「空节点」还没有图片产物',
      '「目标图片 1」不存在',
    ])
  })

  it('★ 目标没有标题时用“目标图片 N”展示，不把内部 id 交给界面', async () => {
    const prepared = await prepareVisualReviewImages({
      graph: {
        nodes: [
          {
            id: 'node_internal_secret',
            data: { assetHash: 'target', assetMime: 'image/png' },
          } as never,
        ],
      },
      nodeIds: ['node_internal_secret'],
      readAsset: async () => ({ bytes: pngBytes(12, 8), mime: 'image/png' }),
    })
    expect(prepared.targets[0]?.title).toBe('目标图片 1')
    expect(prepared.limitations.join('\n')).not.toContain('node_internal_secret')
  })
})
