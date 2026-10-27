import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createContextRepository } from './contextRepository'

describe('context repository', () => {
  it('★ 记忆每次编辑增加不可变修订，停用后不再进入 ContextBundle', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    const memory = await repo.createMemory({
      kind: 'preference',
      text: '偏好留白',
      workbench: 'canvas',
    })
    const edited = await repo.updateMemory(memory.id, {
      kind: 'constraint',
      text: '文字必须可读',
    })
    expect(edited?.currentRevision).toBe(2)
    expect((await repo.listMemoryRevisions(memory.id)).map((item) => item.revision)).toEqual([
      1,
      2,
    ])
    await repo.setMemoryEnabled(memory.id, false)
    const bundle = await repo.bundleForProject({
      projectId: 'p1',
      workbench: 'canvas',
      request: '做图',
    })
    expect(bundle.memoryRefs).toEqual([])
  })

  it('★★ 套件新版本不会改动已绑定旧版本的项目', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    const created = await repo.createKit({
      kind: 'brand',
      name: '品牌 A',
      guide: '使用深绿色',
      facts: [{ key: '主色', value: '#14532D' }],
    })
    await repo.bindProject({
      projectId: 'p1',
      kitId: created.kit.id,
      kitVersion: 1,
    })
    await repo.saveKitVersion(created.kit.id, {
      guide: '使用黑色',
      facts: [{ key: '主色', value: '#000000' }],
    })
    const oldBundle = await repo.bundleForProject({
      projectId: 'p1',
      workbench: 'canvas',
      request: '旧项目',
    })
    expect(oldBundle.kitVersionRefs).toEqual([
      { kitId: created.kit.id, version: 1 },
    ])
    expect(oldBundle.hardConstraints.join('\n')).toContain('深绿色')
    expect(oldBundle.hardConstraints.join('\n')).not.toContain('使用黑色')

    await repo.bindProject({
      projectId: 'p1',
      kitId: created.kit.id,
      kitVersion: 2,
    })
    const upgraded = await repo.bundleForProject({
      projectId: 'p1',
      workbench: 'canvas',
      request: '升级后的项目',
    })
    expect(upgraded.kitVersionRefs).toEqual([
      { kitId: created.kit.id, version: 2 },
    ])
  })

  it('★ 品牌套件保存 Logo、颜色和字体分区，并兼容旧版本', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    const created = await repo.createKit({
      kind: 'brand',
      name: '品牌 B',
      guide: '克制的网格系统',
      facts: [{ key: '自定义说明', value: '保留旧事实' }],
      assetHashes: ['logo-hash', 'reference-hash'],
      resources: [
        { hash: 'logo-hash', role: 'logo', name: '主 Logo' },
        { hash: 'reference-hash', role: 'reference', name: '空间参考' },
      ],
      colors: [{ id: 'color-1', name: '主色', value: '#14532d' }],
      fonts: [{ id: 'font-1', name: '思源黑体', detail: '标题 700' }],
    })

    expect(created.version.resources).toEqual([
      { hash: 'logo-hash', role: 'logo', name: '主 Logo' },
      { hash: 'reference-hash', role: 'reference', name: '空间参考' },
    ])
    expect(created.version.colors).toEqual([
      { id: 'color-1', name: '主色', value: '#14532d' },
    ])
    expect(created.version.fonts).toEqual([
      { id: 'font-1', name: '思源黑体', detail: '标题 700' },
    ])

    await repo.saveKitVersion(created.kit.id, { guide: '新指南' })
    const [latest] = await repo.listKitVersions(created.kit.id)
    expect(latest?.resources).toEqual(created.version.resources)
    expect(latest?.colors).toEqual(created.version.colors)
    expect(latest?.fonts).toEqual(created.version.fonts)
  })

  it('★ 旧版套件没有资源角色字段时，素材仍按参考素材读回', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    await platform.storage.put('contextKits', {
      id: 'legacy-kit',
      kind: 'brand',
      name: '旧品牌',
      currentVersion: 1,
      createdAt: 1,
      updatedAt: 1,
    })
    await platform.storage.put('contextKitVersions', {
      id: 'legacy-version',
      kitId: 'legacy-kit',
      version: 1,
      guide: '旧指南',
      facts: [],
      assetHashes: ['legacy-logo'],
      createdAt: 1,
    })

    const [version] = await repo.listKitVersions('legacy-kit')
    expect(version?.resources).toEqual([
      { hash: 'legacy-logo', role: 'reference', name: '' },
    ])
    expect(version?.colors).toEqual([])
    expect(version?.fonts).toEqual([])
  })

  it('★ 解绑和删除项目绑定只影响当前项目', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    const brand = await repo.createKit({ kind: 'brand', name: '品牌' })
    const product = await repo.createKit({ kind: 'product', name: '产品' })
    await repo.bindProject({
      projectId: 'p1',
      kitId: brand.kit.id,
      kitVersion: 1,
    })
    await repo.bindProject({
      projectId: 'p2',
      kitId: product.kit.id,
      kitVersion: 1,
    })
    await repo.removeBinding('p1', brand.kit.id)
    expect(await repo.listProjectBindings('p1')).toEqual([])
    expect(await repo.listProjectBindings('p2')).toHaveLength(1)
  })
})
