import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory/index'
import type { AssetFolderPort } from '../../platform/ports'
import { pickAndSyncAssets } from './pickAndSyncAssets'

/**
 * #516：选目录与同步现有素材合成一步。
 *
 * 这条要证明的是**盘上真的多了文件**，而不是函数返回了一句"成功"。
 * 同时锁住取消分支：取消后不许拿旧目录继续导出。
 */
describe('选择素材文件夹并同步', () => {
  const rows = {
    assets: [
      { id: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) },
      { id: 'h2', mime: 'video/mp4', bytes: new Uint8Array([2]) },
    ],
  }

  it('★★ 选完目录立刻把现有素材复制过去，并如实报进度与结果', async () => {
    const platform = createMemoryPlatform({ rows })
    const seen: string[] = []

    const result = await pickAndSyncAssets(platform, (done, total) => seen.push(`${done}/${total}`))

    expect(result.picked).toBe(true)
    expect(result.folderName).toBe('memory-assets')
    expect(result.report).toMatchObject({ total: 2, written: 2, failed: 0 })
    expect(result.message).toContain('已导出 2 个素材')
    expect((await platform.assetFolder!.list()).sort()).toEqual(['h1.png', 'h2.mp4'])
    expect(seen).toEqual(['1/2', '2/2'])
  })

  it('★ 用户取消选择后不导出，也绝不拿旧目录冒充一次成功', async () => {
    const platform = createMemoryPlatform({ rows })
    const base = platform.assetFolder!
    const cancelling: AssetFolderPort = {
      ...base,
      current: () => ({ name: '旧目录' }),
      pick: async () => null,
    }

    const result = await pickAndSyncAssets({ ...platform, assetFolder: cancelling })

    expect(result).toMatchObject({ picked: false, folderName: '旧目录', report: null })
    expect(result.message).toBe('没有选择文件夹')
    expect(await base.list()).toEqual([])
  })
})
