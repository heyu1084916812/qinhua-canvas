import { describe, it, expect } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { createAssetLibraryRepository } from './assetLibraryRepository'
import { createAssetLibraryStore } from './assetLibraryStore'
import type { Row, TableName } from '../../platform/ports'

/**
 * 素材库仓储 + store 的集成单测（memory 平台，node 下可跑）。
 *
 * 重点不在 CRUD 本身，而在两条**回落口径**：老素材没有 createdAt / projectId 时
 * 时间与来源怎么来。那两条一旦写错，界面会静默显示「—」或指到错的项目上，
 * 而 UI 层没有任何东西会发现。
 */

function seedStorage(rows: Partial<Record<TableName, Row[]>>) {
  const storage = createMemoryStorage({ rows })
  return { storage, repo: createAssetLibraryRepository(storage) }
}

describe('素材库仓储：来源于时间的回落', () => {
  it('新素材自带 createdAt / projectId 时直接用（不与回落冲突）', async () => {
    const { repo } = seedStorage({
      assets: [
        { id: 'a1', hash: 'a1', mime: 'image/png', bytes: new Uint8Array(4), createdAt: 555, projectId: 'p1' },
      ],
      projects: [{ id: 'p1', name: '猫咪' }],
    })
    const [asset] = await repo.list()
    expect(asset!.createdAt).toBe(555)
    expect(asset!.projectId).toBe('p1')
    expect((await repo.projectNames()).get('p1')).toBe('猫咪')
  })

  it('★ 老素材（无时间无项目）→ 时间取最早那条生成记录，来源取当前持有它的节点', async () => {
    const { repo } = seedStorage({
      assets: [{ id: 'a1', hash: 'a1', mime: 'image/png', bytes: new Uint8Array(4) }],
      runRecords: [
        { id: 'r2', createdAt: 900, outputHashes: ['a1'] },
        { id: 'r1', createdAt: 400, outputHashes: ['a1'] },
      ],
      nodes: [
        {
          id: 'n1',
          projectId: 'p-current',
          data: { assetHash: 'a1', thumbOrder: ['a1'] },
        },
      ],
      projects: [
        { id: 'p-current', name: '当前项目' },
        { id: 'p-old', name: '历史项目' },
      ],
    })
    const [asset] = await repo.list()
    expect(asset!.createdAt).toBe(400)
    expect(asset!.projectId).toBe('p-current')
  })

  it('对比节点左右两张图也算子素材来源（否则它们的来源永远是「—」）', async () => {
    const { repo } = seedStorage({
      assets: [{ id: 'x', hash: 'x', mime: 'image/png', bytes: new Uint8Array(4) }],
      nodes: [{ id: 'n1', projectId: 'p9', data: { leftAssetHash: 'x' } }],
      projects: [{ id: 'p9', name: 'P9' }],
    })
    const out = await repo.list()
    expect(out[0]!.projectId).toBe('p9')
  })

  it('排序：新的在前（界面不再自己排）', async () => {
    const { repo } = seedStorage({
      assets: [
        { id: 'a', hash: 'a', mime: 'image/png', createdAt: 1 },
        { id: 'b', hash: 'b', mime: 'image/png', createdAt: 2 },
      ],
    })
    expect((await repo.list()).map((a) => a.hash)).toEqual(['b', 'a'])
  })

  it('删除只动 assets 表那一行（不级联改节点，那是画布的事）', async () => {
    const storage = createMemoryStorage({
      rows: {
        assets: [{ id: 'a1', hash: 'a1', mime: 'image/png', bytes: new Uint8Array(4) }],
        nodes: [{ id: 'n1', projectId: 'p1', data: { assetHash: 'a1' } }],
      },
    })
    const repo = createAssetLibraryRepository(storage)
    await repo.remove('a1')
    expect(await storage.query('assets', {})).toHaveLength(0)
    expect(await storage.query('nodes', {})).toHaveLength(1)
  })
})

describe('素材库 store', () => {
  const setup = async () => {
    const { repo } = seedStorage({
      assets: [
        { id: 'i1', hash: 'i1', mime: 'image/png', bytes: 2048, createdAt: 10, projectId: 'p1', width: 512, height: 512 },
        { id: 'v1', hash: 'v1', mime: 'video/mp4', bytes: 4096, createdAt: 20, projectId: 'p1' },
        { id: 'i2', hash: 'i2', mime: 'image/png', bytes: 1024, createdAt: 30, projectId: 'p2' },
      ],
      projects: [
        { id: 'p1', name: '猫咪项目' },
        { id: 'p2', name: '狗狗项目' },
      ],
    })
    const store = createAssetLibraryStore(repo)
    await store.load()
    return { store, repo }
  }

  it('load 后可见列表即全部，且按时间倒序', async () => {
    const { store } = await setup()
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['i2', 'v1', 'i1'])
    expect(store.getState().loaded).toBe(true)
  })

  it('★ 类型筛选：只要图片时不出现视频（回声_sort 视频卡片与图片长得一样）', async () => {
    const { store } = await setup()
    store.setFilter('image')
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['i2', 'i1'])
    store.setFilter('video')
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['v1'])
    store.setFilter('all')
    expect(store.getState().visible).toHaveLength(3)
  })

  it('关键字按项目名筛选', async () => {
    const { store } = await setup()
    store.setQuery('猫咪')
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['v1', 'i1'])
    store.setQuery('')
    expect(store.getState().visible).toHaveLength(3)
  })

  it('★ 类型与关键字叠加是「与」不是「或」', async () => {
    const { store } = await setup()
    store.setFilter('image')
    store.setQuery('狗狗')
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['i2'])
  })

  it('删除后从列表消失，且库中真的没了', async () => {
    const { store, repo } = await setup()
    await store.remove('v1')
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['i2', 'i1'])
    expect(await repo.list()).toHaveLength(2)
  })

  it('删失败时按库恢复（不留「看起来删了其实还在」）', async () => {
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
    expect(store.getState().visible.map((a) => a.hash)).toEqual(['i2', 'v1', 'i1'])
  })
})
