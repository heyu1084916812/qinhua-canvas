import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import type { PlatformKit, PickedFile } from '../../platform/ports'
import { exportFullBackup, importFullBackup, backupFileName, describeBackup } from './backupIo'

/**
 * 全库备份的导出 / 导入（用户 2026-10-09，对账 #378）。
 *
 * 用内存平台跑端到端：**库 A 导出 → 库 B 导入**，再逐个字段对账。
 * 这比"函数能返回"强得多 —— 它证明的是"换一台机器数据真的回来了"。
 */
function captureFiles(base: PlatformKit): { platform: PlatformKit; saved: () => Blob | null } {
  let blob: Blob | null = null
  const platform: PlatformKit = {
    ...base,
    files: {
      ...base.files,
      async saveFile(_name, next) {
        blob = next
      },
    },
  }
  return { platform, saved: () => blob }
}

function asPicked(name: string, blob: Blob): PickedFile {
  return { name, size: blob.size, mime: blob.type, blob }
}

describe('全库备份 · 导出与导入', () => {
  it('★★ 库 A 导出 → 库 B 导入：项目、素材字节、收藏、技能都回来了', async () => {
    const source = createMemoryPlatform({
      rows: {
        projects: [{ id: 'p1', name: '我的项目', workbench: 'canvas', updatedAt: 5 }],
        nodes: [{ id: 'n1', projectId: 'p1', type: 'prompt' }],
        assets: [
          { id: 'a1', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]), createdAt: 1 },
        ],
        assetLibrary: [{ id: 'a1', savedAt: 2 }],
        skills: [{ id: 's1', name: '我的技能', content: '正文' }],
        ecommerceTasks: [{ id: 'et1', projectId: 'p1', batchId: 'b1', createdAt: 3 }],
        ecommerceResults: [
          { id: 'er1', projectId: 'p1', taskId: 'et1', nodeId: 'n1', position: 0, status: 'done' },
        ],
      },
    })
    const { platform: exportPlatform, saved } = captureFiles(source)

    const result = await exportFullBackup(exportPlatform, { appVersion: '0.1.0' })
    expect(result.manifest.tables.projects).toBe(1)
    expect(result.manifest.tables.assets).toBe(1)
    expect(result.manifest.tables.ecommerceTasks).toBe(1)
    expect(result.manifest.tables.ecommerceResults).toBe(1)
    expect(result.fileName).toContain('轻画备份-')

    const blob = saved()
    expect(blob).not.toBeNull()

    // 换一个空库导入
    const target = createMemoryPlatform()
    const imported = await importFullBackup(target, asPicked(result.fileName, blob!))
    expect(imported.written).toBeGreaterThan(0)
    expect(imported.manifest.tables.skills).toBe(1)

    const projects = await target.storage.query('projects', {})
    expect(projects[0]!.name).toBe('我的项目')
    const edges = await target.storage.query('nodes', { projectId: 'p1' })
    expect(edges).toHaveLength(1)

    const assets = await target.storage.query('assets', { id: 'a1' })
    const bytes = assets[0]!.bytes as Uint8Array
    expect(Array.from(bytes)).toEqual([1, 2, 3])

    expect(await target.storage.query('assetLibrary', {})).toHaveLength(1)
    expect(await target.storage.query('skills', {})).toHaveLength(1)
    expect(await target.storage.query('ecommerceTasks', { projectId: 'p1' })).toHaveLength(1)
    expect(await target.storage.query('ecommerceResults', { projectId: 'p1' })).toHaveLength(1)
  })

  it('★★ 凭据不进备份：导入的库里没有令牌（页面必须如实说明要重填）', async () => {
    const source = createMemoryPlatform({
      rows: { credentials: [{ id: 'cred:1', cipher: 'secret-cipher' }] },
    })
    const { platform, saved } = captureFiles(source)
    await exportFullBackup(platform)
    const text = await saved()!.text()

    expect(text).not.toContain('secret-cipher')

    const target = createMemoryPlatform()
    await importFullBackup(target, asPicked('b.json', saved()!))
    expect(await target.storage.query('credentials', {})).toHaveLength(0)
  })

  it('★ 再导一次同一份备份是幂等的（不产生重复项目）', async () => {
    const source = createMemoryPlatform({
      rows: { projects: [{ id: 'p1', name: '项目', workbench: 'canvas' }] },
    })
    const { platform, saved } = captureFiles(source)
    await exportFullBackup(platform)
    const picked = asPicked('b.json', saved()!)

    const target = createMemoryPlatform()
    await importFullBackup(target, picked)
    await importFullBackup(target, picked)

    expect(await target.storage.query('projects', {})).toHaveLength(1)
  })

  it('★ 导入策略 skip：库里已有的行不动、缺失的补上', async () => {
    const source = createMemoryPlatform({
      rows: {
        projects: [
          { id: 'p1', name: '备份里的名字', workbench: 'canvas' },
          { id: 'p2', name: '只有备份有', workbench: 'canvas' },
        ],
      },
    })
    const { platform, saved } = captureFiles(source)
    await exportFullBackup(platform)

    const target = createMemoryPlatform({
      rows: { projects: [{ id: 'p1', name: '本机改过的名字', workbench: 'canvas' }] },
    })
    const result = await importFullBackup(target, asPicked('b.json', saved()!), { strategy: 'skip' })
    expect(result.skipped).toBe(1)
    expect(result.written).toBe(1)

    const rows = await target.storage.query('projects', {})
    const byId = new Map(rows.map((r) => [r.id as string, r.name as string]))
    expect(byId.get('p1')).toBe('本机改过的名字') // 没被覆盖
    expect(byId.get('p2')).toBe('只有备份有') // 补上了
  })

  it('★★ 坏文件在导入时报错、且不写任何数据（不能留半截库）', async () => {
    const target = createMemoryPlatform({
      rows: { projects: [{ id: 'keep', name: '原有项目', workbench: 'canvas' }] },
    })
    const bad = new Blob(['{ 这不是 JSON'], { type: 'application/json' })

    await expect(importFullBackup(target, asPicked('bad.json', bad))).rejects.toThrow(/JSON/)
    // 原有数据一条不少
    expect(await target.storage.query('projects', {})).toHaveLength(1)
  })

  it('★ 进度回调按表推进，界面能显示"在做什么"', async () => {
    const source = createMemoryPlatform({
      rows: {
        projects: [{ id: 'p1', name: 'x', workbench: 'canvas' }],
        nodes: [{ id: 'n1', projectId: 'p1' }],
      },
    })
    const { platform } = captureFiles(source)
    const labels: string[] = []
    await exportFullBackup(platform, {
      onProgress: (p) => labels.push(p.label),
    })
    expect(labels.length).toBeGreaterThan(1)
    expect(labels[labels.length - 1]).toContain('生成备份文件')
  })

  it('★ 文件名与摘要可读（用户能靠它认出这是哪天的备份）', () => {
    const name = backupFileName(new Date(2026, 9, 9, 8, 5))
    expect(name).toBe('轻画备份-20261009-0805.qinghua-backup.json')

    const summary = describeBackup({
      format: 'qinghua.backup',
      version: 1,
      exportedAt: new Date(2026, 9, 9, 8, 5).getTime(),
      appVersion: '0.1.0',
      tables: { projects: 3, assets: 12, skills: 2, ecommerceTasks: 1, ecommerceResults: 2 },
      includesCredentials: false,
    })
    expect(summary).toContain('3 个项目')
    expect(summary).toContain('12 个素材')
    expect(summary).toContain('2 个技能')
    expect(summary).toContain('1 个电商任务')
    expect(summary).toContain('2 张电商结果')
    expect(summary).toContain('0.1.0')
  })
})
