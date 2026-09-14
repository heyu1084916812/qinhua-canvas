import { describe, it, expect } from 'vitest'
import { createStorageAssetPort } from './assets'
import { createMemoryStorage } from './memory'

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
})
