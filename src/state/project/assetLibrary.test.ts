import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import type { Row, TableName } from '../../platform/ports'
import type { LibraryAsset } from '../../domain/shared/assetLibrary'
import { createAssetLibraryRepository } from './assetLibraryRepository'
import { createAssetLibraryStore } from './assetLibraryStore'

function seedStorage(rows: Partial<Record<TableName, Row[]>>) {
  const storage = createMemoryStorage({ rows })
  return { storage, repo: createAssetLibraryRepository(storage) }
}

const saved = (over: Partial<LibraryAsset> = {}): LibraryAsset => ({
  hash: 'h1',
  mime: 'image/png',
  bytes: 12,
  width: 512,
  height: 512,
  savedAt: 10,
  projectId: 'p1',
  prompt: '猫咪',
  model: 'image-pro',
  quality: 'high',
  ratio: '1:1',
  channelId: 'ch1',
  ...over,
})

describe('素材库仓储', () => {
  it('只列 assetLibrary，普通 assets 没有被收藏就不出现', async () => {
    const { repo } = seedStorage({
      assets: [
        { id: 'not-saved', hash: 'not-saved', mime: 'image/png', bytes: 9 },
      ],
      assetLibrary: [
        {
          id: 'saved',
          hash: 'saved',
          mime: 'image/png',
          bytes: 5,
          savedAt: 20,
          prompt: '收藏图',
        },
      ],
    })
    const list = await repo.list()
    expect(list.map((item) => item.hash)).toEqual(['saved'])
    expect(list[0]!.prompt).toBe('收藏图')
  })

  it('save 只写收藏关系到 assetLibrary，不改 assets 字节行', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'h1', hash: 'h1', mime: 'image/png', bytes: new Uint8Array(4) }],
    })
    await repo.save(saved())
    expect(await storage.query('assetLibrary', {})).toHaveLength(1)
    expect((await storage.query('assets', { id: 'h1' }))[0]).toMatchObject({
      bytes: expect.any(Uint8Array),
    })
  })

  it('同 hash 再次保存是覆盖，不新增第二条收藏', async () => {
    const { repo } = seedStorage({})
    await repo.save(saved({ prompt: '第一版', savedAt: 1 }))
    await repo.save(saved({ prompt: '第二版', savedAt: 2 }))
    const list = await repo.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.prompt).toBe('第二版')
  })

  it('remove 只删收藏关系，assets 与节点原样保留', async () => {
    const { storage, repo } = seedStorage({
      assets: [{ id: 'a1', hash: 'a1', mime: 'image/png', bytes: new Uint8Array(4) }],
      assetLibrary: [{ id: 'a1', hash: 'a1', mime: 'image/png', bytes: 4, savedAt: 1 }],
      nodes: [{ id: 'n1', projectId: 'p1', data: { assetHash: 'a1' } }],
    })
    await repo.remove('a1')
    expect(await storage.query('assetLibrary', {})).toHaveLength(0)
    expect(await storage.query('assets', {})).toHaveLength(1)
    expect(await storage.query('nodes', {})).toHaveLength(1)
  })
})

describe('素材库 store', () => {
  const setup = async () => {
    const { storage, repo } = seedStorage({
      assetLibrary: [
        {
          id: 'i1',
          hash: 'i1',
          mime: 'image/png',
          bytes: 2048,
          width: 512,
          height: 512,
          savedAt: 10,
          prompt: '猫咪',
          model: 'image-pro',
        },
        {
          id: 'v1',
          hash: 'v1',
          mime: 'video/mp4',
          bytes: 4096,
          savedAt: 20,
          prompt: '狗狗奔跑',
        },
      ],
    })
    const store = createAssetLibraryStore(repo)
    await store.load()
    return { store, repo, storage }
  }

  it('load 后按保存时间倒序，loaded 为真', async () => {
    const { store } = await setup()
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['v1', 'i1'])
    expect(store.getState().loaded).toBe(true)
  })

  it('类型与关键字筛选叠加是「与」关系', async () => {
    const { store } = await setup()
    store.setFilter('image')
    store.setQuery('猫咪')
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['i1'])
    store.setFilter('video')
    expect(store.getState().visible).toHaveLength(0)
  })

  it('save 同 hash 覆盖、重新排序，并同步 visible', async () => {
    const { store, repo } = await setup()
    await store.save(saved({ hash: 'i1', savedAt: 30, prompt: '新提示词' }))
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['i1', 'v1'])
    expect(store.getState().visible[0]!.prompt).toBe('新提示词')
    expect(await repo.list()).toHaveLength(2)
  })

  it('取消收藏后卡片消失，但资产字节与其它表保留', async () => {
    const { store, storage } = await setup()
    await storage.put('assets', { id: 'v1', hash: 'v1', mime: 'video/mp4', bytes: 4096 })
    await store.remove('v1')
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['i1'])
    expect(await storage.query('assetLibrary', { id: 'v1' })).toHaveLength(0)
    expect(await storage.query('assets', { id: 'v1' })).toHaveLength(1)
  })

  it('删除失败时按库恢复', async () => {
    const { repo } = await setup()
    const failing = {
      ...repo,
      remove: async () => {
        throw new Error('存储挂了')
      },
    }
    const store = createAssetLibraryStore(failing)
    await store.load()
    await expect(store.remove('v1')).rejects.toThrow('删除素材失败')
    expect(store.getState().visible.map((item) => item.hash)).toEqual(['v1', 'i1'])
  })
})
