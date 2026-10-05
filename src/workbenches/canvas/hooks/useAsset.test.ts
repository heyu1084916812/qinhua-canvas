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
            : filter.id === 'nobytes'
              ? // 有库行（知道 mime ⇒ 拼得出文件名）但**没有字节** —— 缺失策略要的分支
                [{ id: 'nobytes', mime: 'image/png' }]
              : filter.id === 'badthumb'
                ? // 坏缩略图：被 JSON 化过的普通对象（对账 #234 那个真回归）
                  [{ id: 'badthumb', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), thumb: { 0: 82, 1: 73 } }]
                : filter.id === 'thumbed'
                  ? // 正常缩略图：真字节（面板 / 节点的小图都该走它）
                    [{ id: 'thumbed', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), thumb: new Uint8Array([82, 73, 70, 70]) }]
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

  /**
   * 缺失时的"去哪儿找"（对账 #196 · 增量 4）。
   *
   * `loadAssetUrl` 只负责**把路径算出来**（库行有 mime 就拼确切文件名，没有就写 `<hash>.*`）；
   * "到底算不算缺失"是 hook 的事 —— 它要等退避重试窗口走完（刚生成的图字节可能还在路上），
   * 那一段在 SSR 里跑不到，故这里只钉住喂给它的这一份输入。
   */
  it('库与文件夹都没有字节 → url 为 null，并给出"本该在哪"（含目录名）', async () => {
    const folder = createMemoryAssetFolder()
    await folder.pick()
    // 'nobytes' 的库行有 mime（image/png）但没有字节，夹具里也没有这个文件
    const meta = await loadAssetUrl(kitWithFolder(folder), 'nobytes')
    expect(meta.url).toBeNull()
    expect(meta.expectedPath).toBe('memory-assets/nobytes.png')
  })

  it('连库行都没有（mime 未知）→ 路径写 `<hash>.*`，不猜扩展名', async () => {
    const folder = createMemoryAssetFolder()
    await folder.pick()
    const meta = await loadAssetUrl(kitWithFolder(folder), 'gone')
    expect(meta.url).toBeNull()
    expect(meta.mime).toBeNull()
    expect(meta.expectedPath).toBe('memory-assets/gone.*')
  })

  it('没选目录 → 没有目录语境就不给路径（只说缺失，不编一个出来）', async () => {
    const meta = await loadAssetUrl(kitWithFolder(createMemoryAssetFolder()), 'gone')
    expect(meta.url).toBeNull()
    expect(meta.expectedPath).toBeNull()
  })
})
/**
 * ★★ 坏缩略图不能当缩略图用（对账 #234）：`thumb` 是个被 `JSON.stringify` 过的普通对象时，
 * 必须**回落原图**（`meta.thumb` 不为真，说明没走缩略图那条路），而不是拿它去造一张 0 字节的破图。
 */
describe('坏缩略图回落原图（对账 #234）', () => {
  it('★ 库里那份 thumb 是坏的话，回落原图（不显示破图）', async () => {
    const platform = kitWithFolder(createMemoryAssetFolder())
    const meta = await loadAssetUrl(platform, 'badthumb', { preferThumb: true })
    expect(meta.url).toBeTruthy()
    expect(meta.thumb).toBeFalsy()
  })

  it('★ 有正常的 thumb 就走它（`thumb: true` 是"这条 URL 是小图"的标记）', async () => {
    const platform = kitWithFolder(createMemoryAssetFolder())
    const small = await loadAssetUrl(platform, 'thumbed', { preferThumb: true })
    expect(small.url).toBeTruthy()
    expect(small.thumb).toBe(true)
    // 不打开 preferThumb 的（灯箱 / 旋转 / 标注）仍然拿原图
    const full = await loadAssetUrl(platform, 'thumbed')
    expect(full.url).toBeTruthy()
    expect(full.thumb).toBeFalsy()
  })
})
