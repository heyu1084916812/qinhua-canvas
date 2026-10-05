import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory/index'
import { createCanvasStore } from '../../state/workbenches/canvas/store'
import { solidPng } from '../../platform/channels/mockPng'
import { registerAllSpecs } from '../../domain/canvas/nodeSpecs'
import { describeLoadResult, gridPoint, loadAssetsFromFolder } from './loadFromFolder'

// 单测环境没有渲染层，节点规格要手动注册（否则 `node.create` 会判「未知节点类型」）
registerAllSpecs()

/**
 * 「从文件夹加载」的验收（对账 #196 · 增量 3）。
 *
 * 用内存平台 + 真 store 跑：素材要真的落库、节点要真的建出来 —— 只测"扫了几个文件"
 * 证明不了这条链路通（上次 #193 的教训：看着生效和真的生效是两件事）。
 */
describe('从文件夹加载素材', () => {
  it('网格落位是纯函数', () => {
    expect(gridPoint({ x: 0, y: 0 }, 0)).toEqual({ x: 0, y: 0 })
    expect(gridPoint({ x: 0, y: 0 }, 1)).toEqual({ x: 260, y: 0 })
    expect(gridPoint({ x: 0, y: 0 }, 4)).toEqual({ x: 0, y: 260 })
    expect(gridPoint({ x: 10, y: 20 }, 5)).toEqual({ x: 270, y: 280 })
  })

  it('素材建成节点并落库；非素材文件跳过；结果如实汇报', async () => {
    const png = solidPng(8, 6, [255, 0, 0], 'folder-a')
    const platform = createMemoryPlatform({
      assetFolderFiles: {
        'pic-a.png': new Blob([png as unknown as BlobPart], { type: 'image/png' }),
        'notes.md': new Blob(['hello'], { type: 'text/markdown' }),
      },
    })
    await platform.assetFolder!.pick()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })

    const result = await loadAssetsFromFolder({ platform, store, projectId: 'p1' }, { x: 0, y: 0 })
    // 失败必须带原因（只报"1 个失败"等于没报）
    expect(result.failures).toEqual([])
    expect(result).toMatchObject({ imported: 1, skipped: 1, failed: 0 })

    const nodes = store.getSnapshot().nodes
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe('generation')
    // 节点名来自文件名（去掉扩展名）——正是"从文件夹加载"最直观的可用性
    expect(nodes[0].title).toBe('pic-a')
    expect((nodes[0].data as { assetHash?: string }).assetHash).toBeTruthy()

    await store.flush()
    expect((await platform.storage.query('assets', {})).length).toBe(1)
  })

  /**
   * ★ 进度（对账 #229）：几千张的目录点下去不能"长时间没反应"。
   * 分母是**要处理的素材文件数**：非素材文件不占步（它们只记进"跳过"），
   * 否则 readme / 缓存文件一多，进度会白白少走一截、看着像卡住。
   */
  it('★ 大目录有进度：两步走完，分母只算素材文件（非素材不占步）', async () => {
    const platform = createMemoryPlatform({
      assetFolderFiles: {
        'a.png': new Blob([solidPng(8, 6, [9, 9, 9], 'folder-progress') as unknown as BlobPart], {
          type: 'image/png',
        }),
        'notes.md': new Blob(['x'], { type: 'text/markdown' }),
        'b.png': new Blob([solidPng(8, 6, [1, 2, 3], 'folder-progress-2') as unknown as BlobPart], {
          type: 'image/png',
        }),
      },
    })
    await platform.assetFolder!.pick()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })

    const seen: string[] = []
    const result = await loadAssetsFromFolder(
      { platform, store, projectId: 'p1' },
      { x: 0, y: 0 },
      (done, total) => seen.push(`${done}/${total}`),
    )

    expect(result).toMatchObject({ imported: 2, skipped: 1 })
    expect(seen).toHaveLength(2) // 两张图 ⇒ 两步；`notes.md` 不占步
    expect(seen.every((s) => s.endsWith('/2'))).toBe(true)
    expect(seen.at(-1)).toBe('2/2')
    expect(new Set(seen).size).toBe(2) // 每一步都往前走，不会重复报同一步
  })

  it('同一张图重复加载 → 内容寻址去重（素材不新增、节点各自成节点）', async () => {
    const png = solidPng(8, 6, [0, 128, 255], 'folder-dup')
    const folderFiles = {
      'a.png': new Blob([png as unknown as BlobPart], { type: 'image/png' }),
      'b.png': new Blob([png as unknown as BlobPart], { type: 'image/png' }),
    }
    const platform = createMemoryPlatform({ assetFolderFiles: folderFiles })
    await platform.assetFolder!.pick()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })

    await loadAssetsFromFolder({ platform, store, projectId: 'p1' }, { x: 0, y: 0 })
    await store.flush()
    const rows = await platform.storage.query('assets', {})
    // 两个文件内容相同 ⇒ 同一个 hash ⇒ 只落一行素材（但两个文件各自建了节点）
    expect(rows.length).toBe(1)
    expect(store.getSnapshot().nodes).toHaveLength(2)
  })

  it('没授权文件夹时是空操作（不是错误）', async () => {
    const platform = createMemoryPlatform({ assetFolderFiles: { 'a.png': new Blob(['x']) } })
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    const result = await loadAssetsFromFolder({ platform, store, projectId: 'p1' }, { x: 0, y: 0 })
    expect(result).toMatchObject({ imported: 0, skipped: 0, failed: 0 })
    expect(store.getSnapshot().nodes).toHaveLength(0)
  })

  it('给人话的结果（跳过与失败都要说出来）', () => {
    expect(describeLoadResult({ imported: 2, skipped: 0, failed: 0, failures: [] })).toBe('从文件夹加载 2 张')
    const withFailure = describeLoadResult({
      imported: 2,
      skipped: 1,
      failed: 1,
      failures: [{ name: 'x.png', reason: '磁盘只读' }],
    })
    expect(withFailure).toContain('跳过 1 个非素材文件')
    expect(withFailure).toContain('x.png')
    expect(withFailure).toContain('磁盘只读')
    expect(describeLoadResult({ imported: 0, skipped: 0, failed: 0, failures: [] })).toBe(
      '这个文件夹里没有可用的图片 / 视频',
    )
  })
})
