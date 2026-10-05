import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory/index'
import type { AssetFolderPort } from '../../platform/ports'
import { describeExportReport, exportAssetsToFolder } from './exportAssetsToFolder'

/**
 * 「把内置库素材一次性导出到文件夹」的验收（对账 #196 · 增量 5，封装迁移前置）。
 *
 * 这一档的**判据必须是盘上真的出现了文件**（文件名还得是 `<hash>.<ext>`），
 * 只断言"调用成功"证明不了什么：迁移时用户要的正是那批字节。
 */
describe('导出内置库素材到文件夹', () => {
  const rows = {
    assets: [
      { id: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) },
      { id: 'h2', mime: 'video/mp4', bytes: new Uint8Array([2]) },
    ],
  }

  it('没选目录时什么都不做（内置库模式，返回空报告）', async () => {
    const platform = createMemoryPlatform({ rows })
    const report = await exportAssetsToFolder(platform)
    expect(report).toMatchObject({ total: 0, written: 0, exists: 0, noBytes: 0, failed: 0 })
    expect(await platform.assetFolder!.list()).toEqual([])
  })

  it('★ 把内置库里的每一份字节都写到盘上，文件名是 <hash>.<ext>', async () => {
    const platform = createMemoryPlatform({ rows })
    await platform.assetFolder!.pick()
    const seen: string[] = []
    const report = await exportAssetsToFolder(platform, (done, total) =>
      seen.push(`${done}/${total}`),
    )
    expect(report).toMatchObject({ total: 2, written: 2, exists: 0, noBytes: 0, failed: 0 })
    expect((await platform.assetFolder!.list()).sort()).toEqual(['h1.png', 'h2.mp4'])
    // 进度是按"文件数"报的（大目录要能看到走到哪了）
    expect(seen).toEqual(['1/2', '2/2'])
  })

  it('★ 再点一次是幂等的：同一份内容不会写出第二个文件', async () => {
    const platform = createMemoryPlatform({ rows })
    await platform.assetFolder!.pick()
    await exportAssetsToFolder(platform)
    const again = await exportAssetsToFolder(platform)
    expect(again).toMatchObject({ written: 0, exists: 2 })
    expect((await platform.assetFolder!.list()).sort()).toEqual(['h1.png', 'h2.mp4'])
  })

  it('★★ 只有远端地址的素材单独报「搬不动」，不混进"跳过"', async () => {
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'remote1', mime: 'video/mp4', url: 'https://example.com/a.mp4' }] },
    })
    await platform.assetFolder!.pick()
    const report = await exportAssetsToFolder(platform)
    expect(report).toMatchObject({ total: 1, written: 0, exists: 0, noBytes: 1, failed: 0 })
    expect(describeExportReport(report, '我的素材')).toContain('搬不动')
  })

  it('写盘失败如实报：带上文件名与原因（不许静默）', async () => {
    const platform = createMemoryPlatform({ rows: { assets: [rows.assets[0]!] } })
    const broken: AssetFolderPort = {
      ...platform.assetFolder!,
      supported: () => true,
      current: () => ({ name: '只读盘' }),
      has: async () => false,
      write: async () => {
        throw new Error('磁盘只读')
      },
    }
    const report = await exportAssetsToFolder({ ...platform, assetFolder: broken })
    expect(report).toMatchObject({ total: 1, written: 0, failed: 1 })
    expect(report.failures[0]).toMatchObject({ name: 'h1.png', reason: '磁盘只读' })
    expect(describeExportReport(report, '只读盘')).toContain('h1.png')
  })

  it('一句话结果：空库、全成功、混合三种都读得懂', () => {
    expect(describeExportReport({ total: 0, written: 0, exists: 0, noBytes: 0, failed: 0, failures: [] }, 'x')).toBe(
      '内置库里还没有素材',
    )
    expect(
      describeExportReport({ total: 3, written: 3, exists: 0, noBytes: 0, failed: 0, failures: [] }, '我的素材'),
    ).toBe('已导出 3 个素材到「我的素材」')
    expect(
      describeExportReport(
        { total: 4, written: 1, exists: 2, noBytes: 1, failed: 0, failures: [] },
        '我的素材',
      ),
    ).toBe('已导出 1 个素材到「我的素材」，2 个盘上已有，1 个只有远端地址、没有本地字节（搬不动）')
  })
})
