import { describe, expect, it } from 'vitest'
import { mirrorAssetsToFolder } from './assetMirror'
import { createMemoryAssetFolder } from './memory/index'

const noErrors = () => {
  throw new Error('不该有错误')
}

describe('素材镜像到文件夹', () => {
  it('没授权文件夹时什么都不做（内置库模式）', async () => {
    const folder = createMemoryAssetFolder()
    const written = await mirrorAssetsToFolder(
      folder,
      [{ id: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }],
      noErrors,
    )
    expect(written).toBe(0)
    expect(await folder.list()).toEqual([])
  })

  it('只镜像本地字节；远端产物（只有 url）与空字节跳过', async () => {
    const folder = createMemoryAssetFolder()
    await folder.pick()
    const local = { id: 'h1', mime: 'image/png', bytes: new Uint8Array([1, 2]) }
    const remote = { id: 'remote1', mime: 'video/mp4', url: 'https://example.com/a.mp4' }
    const empty = { id: 'empty', mime: 'image/png', bytes: new Uint8Array([]) }
    const written = await mirrorAssetsToFolder(folder, [local, remote, empty], noErrors)
    expect(written).toBe(1)
    expect(await folder.list()).toEqual(['h1.png'])
  })

  it('文件名是 <hash>.<ext>；重复镜像不重复写（内容寻址幂等）', async () => {
    const folder = createMemoryAssetFolder()
    await folder.pick()
    const rows = [{ id: 'abc', mime: 'image/jpeg', bytes: new Uint8Array([9]) }]
    expect(await mirrorAssetsToFolder(folder, rows, noErrors)).toBe(1)
    expect(await mirrorAssetsToFolder(folder, rows, noErrors)).toBe(0)
    expect(await folder.list()).toEqual(['abc.jpg'])
  })

  it('写盘失败不影响调用方（只上报错误，不抛）', async () => {
    const broken = {
      ...createMemoryAssetFolder(),
      supported: () => true,
      current: () => ({ name: 'broken' }),
      has: async () => false,
      write: async () => {
        throw new Error('磁盘只读')
      },
    }
    const seen: string[] = []
    const written = await mirrorAssetsToFolder(
      broken,
      [{ id: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }],
      (msg) => seen.push(msg),
    )
    expect(written).toBe(0)
    expect(seen).toContain('[assetMirror] 写素材文件夹失败')
  })
})
