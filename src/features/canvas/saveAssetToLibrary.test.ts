import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import type { StoragePort } from '../../platform/ports'
import { saveAssetToLibrary } from './saveAssetToLibrary'

const nodes = [
  {
    id: 'n1',
    projectId: 'p1',
    data: {
      assetHash: 'h1',
      channelId: 'node-channel',
      model: 'node-model',
      prompt: 'node prompt',
      ratio: '1:1',
      quality: 'low',
      naturalSize: { width: 32, height: 32 },
    },
  },
]

const store = { getSnapshot: () => ({ nodes }) }

describe('saveAssetToLibrary', () => {
  it('把节点素材写进 assetLibrary，并冻结成功记录里的真实元数据', async () => {
    const storage = createMemoryStorage({
      rows: {
        assets: [
          {
            id: 'h1',
            hash: 'h1',
            mime: 'image/png',
            bytes: new Uint8Array(8),
            width: 32,
            height: 32,
          },
        ],
        runRecords: [
          {
            id: 'r1',
            status: 'succeeded',
            createdAt: 10,
            outputHashes: ['h1'],
            sentChannelId: 'sent-channel',
            sentModel: 'sent-model',
            outputWidth: 64,
            outputHeight: 64,
            params: { prompt: 'sent prompt', ratio: '16:9', quality: 'high' },
          },
        ],
      },
    })

    expect(await saveAssetToLibrary({ platform: { storage }, store }, 'n1')).toEqual({ ok: true })
    const [row] = await storage.query('assetLibrary', { id: 'h1' })
    expect(row).toMatchObject({
      mime: 'image/png',
      width: 64,
      height: 64,
      projectId: 'p1',
      prompt: 'sent prompt',
      model: 'sent-model',
      ratio: '16:9',
      quality: 'high',
      channelId: 'sent-channel',
    })
  })

  it('素材行不存在时返回 missing，不写入空收藏', async () => {
    const storage = createMemoryStorage({})
    expect(await saveAssetToLibrary({ platform: { storage }, store }, 'n1')).toEqual({
      ok: false,
      reason: 'missing',
    })
    expect(await storage.query('assetLibrary', {})).toHaveLength(0)
  })

  it('运行记录读取失败不阻断最基本收藏', async () => {
    const base = createMemoryStorage({
      rows: {
        assets: [
          {
            id: 'h1',
            hash: 'h1',
            mime: 'image/png',
            bytes: new Uint8Array(8),
            width: 32,
            height: 32,
          },
        ],
      },
    })
    const storage = {
      ...base,
      query: async (table: Parameters<typeof base.query>[0], filter: Parameters<typeof base.query>[1]) => {
        if (table === 'runRecords') throw new Error('runRecords unavailable')
        return base.query(table, filter)
      },
    } as StoragePort

    expect(await saveAssetToLibrary({ platform: { storage }, store }, 'n1')).toEqual({ ok: true })
    expect(await storage.query('assetLibrary', {})).toHaveLength(1)
  })
})
