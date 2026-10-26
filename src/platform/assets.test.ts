import { describe, it, expect, vi } from 'vitest'
import { createStorageAssetPort } from './assets'
import { createMemoryStorage } from './memory'
import type { StoragePort } from './ports'

describe('素材读回端口（M6-12）', () => {
  it('按 hash 读回字节与 mime', async () => {
    const storage = createMemoryStorage({
      rows: { assets: [{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/jpeg' }] },
    })
    const got = await createStorageAssetPort(storage).read('h1')
    expect(got).not.toBeNull()
    expect(Array.from(got!.bytes)).toEqual([1, 2, 3])
    expect(got!.mime).toBe('image/jpeg')
  })

  it('素材不存在 → null（不抛错，渠道据此跳过该图）', async () => {
    const storage = createMemoryStorage()
    expect(await createStorageAssetPort(storage).read('missing')).toBeNull()
  })

  it('字节被存成普通数组 / ArrayBuffer 也能读回（IndexedDB 克隆形态兼容）', async () => {
    const storage = createMemoryStorage({
      rows: { assets: [{ id: 'h1', bytes: [9, 8, 7], mime: 'image/png' }] },
    })
    expect(Array.from((await createStorageAssetPort(storage).read('h1'))!.bytes)).toEqual([9, 8, 7])
  })

  it('空字节视为不存在', async () => {
    const storage = createMemoryStorage({
      rows: { assets: [{ id: 'h1', bytes: new Uint8Array(0), mime: 'image/png' }] },
    })
    expect(await createStorageAssetPort(storage).read('h1')).toBeNull()
  })

  /**
   * 远端素材（视频成片）：`bytes` 是空的、只有 `url`。
   *
   * 「读不到字节」不等于「没有这张素材」——字节那条路如实返回 null，
   * 地址由 `readUrl` 单独给，播放与下载都靠它（用户 2026-10-03）。
   */
  it('★★ 只有 url 的远端素材：read 为 null，readUrl 拿到地址与类型', async () => {
    const storage = createMemoryStorage({
      rows: {
        assets: [
          {
            id: 'v1',
            bytes: new Uint8Array(0),
            mime: 'video/mp4',
            url: ' https://cdn.example.com/v.mp4 ',
          },
        ],
      },
    })
    const port = createStorageAssetPort(storage)
    expect(await port.read('v1')).toBeNull()
    expect(await port.readUrl('v1')).toEqual({
      url: 'https://cdn.example.com/v.mp4',
      mime: 'video/mp4',
    })
  })

  it('本地素材（有字节、没地址）／不存在的素材：readUrl 都为 null', async () => {
    const storage = createMemoryStorage({
      rows: { assets: [{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }] },
    })
    const port = createStorageAssetPort(storage)
    expect(await port.readUrl('h1')).toBeNull()
    expect(await port.readUrl('nope')).toBeNull()
  })

  it('readUrl 只查元数据，不读取媒体 payload', async () => {
    const memory = createMemoryStorage()
    const query = vi.fn(async () => [
      {
        id: 'v1',
        url: 'https://cdn.example.com/v.mp4',
        mime: 'video/mp4',
      },
    ])
    const storage = { ...memory, query } as unknown as StoragePort

    await createStorageAssetPort(storage).readUrl('v1')

    expect(query).toHaveBeenCalledWith(
      'assets',
      { id: 'v1' },
      { includePayload: false, fields: ['id', 'url', 'mime'] },
    )
  })

  it('桌面本机进程用的 sourceUrl 由平台注入，不读取素材表', () => {
    const port = createStorageAssetPort(createMemoryStorage(), {
      sourceUrl: (hash) => `http://127.0.0.1:18765/asset/${hash}`,
      previewUrl: (hash) => `http://127.0.0.1:18765/preview/${hash}`,
    })
    expect(port.sourceUrl?.('h1')).toBe('http://127.0.0.1:18765/asset/h1')
    expect(port.previewUrl?.('h1')).toBe('http://127.0.0.1:18765/preview/h1')
  })
})
