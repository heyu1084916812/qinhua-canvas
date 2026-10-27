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
