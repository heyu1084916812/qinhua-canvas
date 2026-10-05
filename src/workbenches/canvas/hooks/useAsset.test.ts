import { describe, expect, it } from 'vitest'
import { loadAssetUrl } from './useAsset'
import { createMemoryAssetFolder } from '../../../platform/memory/index'
import type { PlatformKit } from '../../../platform/ports'

/**
 * 素材读回的两条来源（对账 #196 · 增量 2）：
 * `assets` 表是**索引**（有 mime 才知道文件叫什么），素材文件夹是**字节**的优先来源。
 *
 * 这里不去解码返回的 blob（`blob:` URL 在 node 里取不回内容），而是断言
 * **查了哪一边、拿文件名怎么拼** —— 那才是这段逻辑真正决定的事。
 */
function kitWithFolder(folder: ReturnType<typeof createMemoryAssetFolder>): PlatformKit {
  return {
    storage: {
      async open() {},
      async transaction(_t, fn) {
        return fn()
      },
      async put() {},
      async bulkPut() {},
      async delete() {},
      async query(table, filter) {
        if (table !== 'assets') return []
        return filter.id === 'h1'
          ? [{ id: 'h1', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) }]
          : filter.id === 'remote'
            ? [{ id: 'remote', mime: 'video/mp4', url: 'https://example.com/a.mp4' }]
            : []
      },
      async estimateUsage() {
        return { used: 0, quota: 0 }
      },
    },
    network: { request: async () => ({}) as never, async *stream() {} },
    assets: { read: async () => null, readUrl: async () => null },
    assetFolder: folder,
    hosting: { upload: async () => null },
    credentials: { save: async () => {}, load: async () => null, remove: async () => {}, mask: (s) => s },
    files: { pickFile: async () => null, saveFile: async () => {}, saveFromUrl: async () => 'saved' },
    logger: { log: () => {} },
  }
}

describe('素材读回：文件夹优先、内置库回落', () => {
  it('没授权文件夹（内置库模式）→ 不碰磁盘，走 IndexedDB', async () => {
    const folder = createMemoryAssetFolder()
    let reads = 0
    const spy = { ...folder, read: async (n: string) => (reads += 1, folder.read(n)) }
    const meta = await loadAssetUrl(kitWithFolder(spy), 'h1')
    expect(reads).toBe(0)
    expect(meta.url).toMatch(/^blob:/)
    expect(meta.mime).toBe('image/png')
  })

  it('授权了文件夹且文件在 → 用磁盘那份，文件名按 <hash>.<ext> 拼', async () => {
    const folder = createMemoryAssetFolder({ assetFolderFiles: { 'h1.png': new Blob(['disk']) } })
    await folder.pick()
    const asked: string[] = []
    const spy = { ...folder, read: async (n: string) => (asked.push(n), folder.read(n)) }
    const meta = await loadAssetUrl(kitWithFolder(spy), 'h1')
    expect(asked).toEqual(['h1.png'])
    expect(meta.url).toMatch(/^blob:/)
  })

  it('授权了文件夹但文件不在 → 回落内置库（不假装素材缺失）', async () => {
    const folder = createMemoryAssetFolder()
    await folder.pick()
    const meta = await loadAssetUrl(kitWithFolder(folder), 'h1')
    expect(meta.url).toMatch(/^blob:/)
    expect(meta.mime).toBe('image/png')
  })

  it('远端产物（只有 url）→ 直接用地址，不去问磁盘', async () => {
    const folder = createMemoryAssetFolder()
    await folder.pick()
    const meta = await loadAssetUrl(kitWithFolder(folder), 'remote')
    expect(meta.url).toBe('https://example.com/a.mp4')
    expect(meta.mime).toBe('video/mp4')
  })
})
