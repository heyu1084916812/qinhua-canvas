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

  it('★★ 记忆持久化作用域、来源、过期时间和修订', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    const memory = await repo.createMemory({
      kind: 'fact',
      text: '项目主色是深绿',
      scope: 'project',
      projectId: 'p1',
      key: 'brand.primarycolor',
      source: 'agent',
      confidence: 0.86,
      expiresAt: 50_000,
    })
    expect(memory.scope).toBe('project')
    expect(memory.projectId).toBe('p1')
    expect(memory.source).toBe('agent')
    expect(memory.confidence).toBe(0.86)
    expect(memory.expiresAt).toBe(50_000)
    const [revision] = await repo.listMemoryRevisions(memory.id)
    expect(revision).toMatchObject({
      scope: 'project',
      projectId: 'p1',
      key: 'brand.primarycolor',
      source: 'agent',
      confidence: 0.86,
    })
  })

  it('★★ 密钥、令牌、密码和 Cookie 不能写进记忆', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    await expect(
      repo.createMemory({ kind: 'fact', text: 'api_key=sk-1234567890abcdef' }),
    ).rejects.toThrow('不能保存')
    await expect(
      repo.createMemory({ kind: 'fact', text: 'password: 123456' }),
    ).rejects.toThrow('不能保存')
  })

  it('★★ 同作用域同主题冲突必须显式替换，重复正文直接去重', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    const first = await repo.createMemory({
      kind: 'fact',
      text: '主色是深绿',
      scope: 'project',
      projectId: 'p1',
      key: 'brand.primaryColor',
    })
    const duplicate = await repo.createMemory({
      kind: 'fact',
      text: '主色是深绿',
      scope: 'project',
      projectId: 'p1',
      key: 'brand.primaryColor',
    })
    expect(duplicate.id).toBe(first.id)
    await expect(
      repo.createMemory({
        kind: 'fact',
        text: '主色是黑色',
        scope: 'project',
        projectId: 'p1',
        key: 'brand.primaryColor',
      }),
    ).rejects.toThrow('请确认是否替换')
    const replaced = await repo.createMemory({
      kind: 'fact',
      text: '主色是黑色',
      scope: 'project',
      projectId: 'p1',
      key: 'brand.primaryColor',
      replaceMemoryId: first.id,
    })
    expect(replaced.id).toBe(first.id)
    expect(replaced.text).toBe('主色是黑色')
    expect(replaced.currentRevision).toBe(2)
  })

  it('★ 过期记忆可批量清理，未过期与不同项目记忆不受影响', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    const expired = await repo.createMemory({
      kind: 'fact',
      text: '旧项目尺寸',
      scope: 'project',
      projectId: 'p1',
      expiresAt: 100,
    })
    const active = await repo.createMemory({
      kind: 'fact',
      text: '新项目尺寸',
      scope: 'project',
      projectId: 'p2',
      expiresAt: 500,
    })
    expect(await repo.purgeExpiredMemories(200)).toBe(1)
    expect((await repo.listMemories()).map((memory) => memory.id)).toEqual([active.id])
    expect(await repo.listMemoryRevisions(expired.id)).toEqual([])
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
      fonts: [
        {
          id: 'font-1',
          name: '思源黑体',
          detail: '标题 700',
          fontId: 'font_real_1',
          format: 'woff2',
          size: 1024,
        },
      ],
    })

    expect(created.version.resources).toEqual([
      { hash: 'logo-hash', role: 'logo', name: '主 Logo' },
      { hash: 'reference-hash', role: 'reference', name: '空间参考' },
    ])
    expect(created.version.colors).toEqual([
      { id: 'color-1', name: '主色', value: '#14532d' },
    ])
    expect(created.version.fonts).toEqual([
      {
        id: 'font-1',
        name: '思源黑体',
        detail: '标题 700',
        fontId: 'font_real_1',
        format: 'woff2',
        size: 1024,
      },
    ])

    await repo.saveKitVersion(created.kit.id, { guide: '新指南' })
    const [latest] = await repo.listKitVersions(created.kit.id)
    expect(latest?.resources).toEqual(created.version.resources)
    expect(latest?.colors).toEqual(created.version.colors)
    expect(latest?.fonts).toEqual(created.version.fonts)
  })

  it('★★ 角色与自定义套件可分类创建、读回和绑定项目', async () => {
    const platform = createMemoryPlatform()
    const repo = createContextRepository(platform.storage)
    const role = await repo.createKit({
      kind: 'role',
      name: '主角小满',
      guide: '橙色雨衣，左眉有一颗痣。',
      resources: [
        { hash: 'role-main', role: 'logo', name: '角色定妆图' },
      ],
    })
    const custom = await repo.createKit({
      kind: 'custom',
      name: '活动规范',
      guide: '标题使用无衬线字体，画面保持左侧留白。',
    })

    expect((await repo.listKits('role')).map((kit) => kit.id)).toEqual([role.kit.id])
    expect((await repo.listKits('custom')).map((kit) => kit.id)).toEqual([custom.kit.id])
    expect((await repo.listKits('brand')).map((kit) => kit.id)).not.toContain(role.kit.id)

    await repo.bindProject({
      projectId: 'p1',
      kitId: role.kit.id,
      kitVersion: 1,
    })
    await repo.bindProject({
      projectId: 'p1',
      kitId: custom.kit.id,
      kitVersion: 1,
    })
    const bundle = await repo.bundleForProject({
      projectId: 'p1',
      workbench: 'storyboard',
      request: '继续做下一镜',
    })
    expect(bundle.kitVersionRefs).toEqual([
      { kitId: role.kit.id, version: 1 },
      { kitId: custom.kit.id, version: 1 },
    ])
    expect(bundle.assetHashes).toEqual(['role-main'])
    expect(bundle.hardConstraints.join('\n')).toContain('橙色雨衣')
    expect(bundle.hardConstraints.join('\n')).toContain('左侧留白')
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
