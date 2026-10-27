import { describe, expect, it } from 'vitest'
import {
  assembleContextBundle,
  contextKitVersionChecksum,
  contextConflictsOf,
  formatContextBundleForPrompt,
  type ContextKit,
  type ContextKitVersion,
  type ContextMemory,
  type ContextMemoryRevision,
  type ProjectContextBinding,
} from './context'

const now = 1_000

const memory = (patch: Partial<ContextMemory> = {}): ContextMemory => ({
  id: 'memory-1',
  kind: 'preference',
  text: '喜欢克制的留白',
  enabled: true,
  currentRevision: 1,
  createdAt: now,
  updatedAt: now,
  ...patch,
})

const memoryRevision = (
  patch: Partial<ContextMemoryRevision> = {},
): ContextMemoryRevision => ({
  id: 'memory-revision-1',
  memoryId: 'memory-1',
  revision: 1,
  kind: 'preference',
  text: '喜欢克制的留白',
  source: 'user',
  confidence: 1,
  createdAt: now,
  ...patch,
})

const kit = (patch: Partial<ContextKit> = {}): ContextKit => ({
  id: 'kit-brand',
  kind: 'brand',
  name: '品牌 A',
  description: '',
  currentVersion: 1,
  createdAt: now,
  updatedAt: now,
  ...patch,
})

const version = (patch: Partial<ContextKitVersion> = {}): ContextKitVersion => ({
  id: 'kit-version-1',
  kitId: 'kit-brand',
  version: 1,
  guide: '主色使用深绿，视觉保持克制。',
  facts: [{ key: '主色', value: '#14532D' }],
  assetHashes: ['asset-logo'],
  resources: [{ hash: 'asset-logo', role: 'logo', name: '主 Logo' }],
  colors: [{ id: 'color-primary', name: '主色', value: '#14532d' }],
  fonts: [{ id: 'font-title', name: '思源黑体', detail: '标题 700' }],
  checksum: 'checksum',
  createdAt: now,
  ...patch,
})

const binding = (patch: Partial<ProjectContextBinding> = {}): ProjectContextBinding => ({
  id: 'binding-1',
  projectId: 'p1',
  kitId: 'kit-brand',
  kitVersion: 1,
  mode: 'locked',
  createdAt: now,
  updatedAt: now,
  ...patch,
})

describe('ContextBundle', () => {
  it('★ 个人记忆按工作台过滤，约束进硬约束，偏好进软偏好', () => {
    const bundle = assembleContextBundle({
      request: '做一张主图',
      scope: { workbench: 'ecommerce', projectId: 'p1' },
      memories: [
        memory(),
        memory({ id: 'constraint', kind: 'constraint', text: '文字必须可读' }),
        memory({ id: 'storyboard', workbench: 'storyboard', text: '不要采用' }),
      ],
      memoryRevisions: [
        memoryRevision(),
        memoryRevision({
          id: 'constraint-revision',
          memoryId: 'constraint',
          kind: 'constraint',
          text: '文字必须可读',
        }),
      ],
      kits: [],
      kitVersions: [],
      bindings: [],
    })
    expect(bundle.softPreferences).toEqual(['喜欢克制的留白'])
    expect(bundle.hardConstraints).toEqual(['文字必须可读'])
    expect(bundle.memoryRefs).toHaveLength(2)
  })

  it('★★ 项目绑定固定版本，新版本不会自动进入旧项目', () => {
    const bundle = assembleContextBundle({
      request: '出图',
      scope: { workbench: 'canvas', projectId: 'p1' },
      memories: [],
      memoryRevisions: [],
      kits: [kit({ currentVersion: 2 })],
      kitVersions: [
        version(),
        version({
          id: 'kit-version-2',
          version: 2,
          guide: '新版品牌要求',
          facts: [{ key: '主色', value: '#000000' }],
        }),
      ],
      bindings: [binding()],
    })
    expect(bundle.kitVersionRefs).toEqual([{ kitId: 'kit-brand', version: 1 }])
    expect(bundle.assetHashes).toEqual(['asset-logo'])
    expect(bundle.hardConstraints.join('\n')).toContain('深绿')
    expect(bundle.hardConstraints.join('\n')).toContain('颜色 主色：#14532d')
    expect(bundle.hardConstraints.join('\n')).toContain('字体 思源黑体：标题 700')
    expect(bundle.hardConstraints.join('\n')).toContain('主素材 1 张')
    expect(bundle.hardConstraints.join('\n')).not.toContain('新版品牌要求')
  })

  it('★★ 角色与自定义套件按项目绑定版本进入同一 ContextBundle', () => {
    const roleKit = kit({ id: 'kit-role', kind: 'role', name: '主角小满' })
    const customKit = kit({ id: 'kit-custom', kind: 'custom', name: '品牌活动规范' })
    const roleVersion = version({
      id: 'role-v1',
      kitId: roleKit.id,
      guide: '小满始终穿橙色雨衣，左眉有一颗痣。',
      facts: [],
      assetHashes: ['role-reference'],
      resources: [{ hash: 'role-reference', role: 'reference', name: '小满定妆图' }],
      colors: [],
      fonts: [],
    })
    const customVersion = version({
      id: 'custom-v1',
      kitId: customKit.id,
      guide: '活动画面统一使用无衬线标题和左侧大留白。',
      facts: [{ key: '活动名', value: '春日计划' }],
      assetHashes: [],
      resources: [],
      colors: [],
      fonts: [],
    })
    const bundle = assembleContextBundle({
      request: '继续做第二张',
      scope: { workbench: 'storyboard', projectId: 'p1' },
      memories: [],
      memoryRevisions: [],
      kits: [roleKit, customKit],
      kitVersions: [roleVersion, customVersion],
      bindings: [
        binding({ id: 'role-binding', kitId: roleKit.id }),
        binding({ id: 'custom-binding', kitId: customKit.id }),
      ],
    })

    expect(bundle.kitVersionRefs).toEqual([
      { kitId: roleKit.id, version: 1 },
      { kitId: customKit.id, version: 1 },
    ])
    expect(bundle.assetHashes).toEqual(['role-reference'])
    expect(bundle.hardConstraints.join('\n')).toContain('橙色雨衣')
    expect(bundle.hardConstraints.join('\n')).toContain('左侧大留白')
  })

  it('★ 不同套件里的同名事实冲突会解释来源，不会静默选一个', () => {
    const versions = [
      version(),
      version({
        id: 'kit-version-product',
        kitId: 'kit-product',
        facts: [{ key: '主色', value: '#FF0000' }],
      }),
    ]
    expect(contextConflictsOf(versions, (id) => (id === 'kit-brand' ? '品牌 A' : '产品 B'))).toEqual([
      {
        key: '主色',
        values: ['#14532D', '#FF0000'],
        sources: ['产品 B v1', '品牌 A v1'],
        message: '主色 存在冲突：#14532D / #FF0000',
      },
    ])
  })

  it('★ 套件版本 checksum 对事实顺序与重复素材不敏感', () => {
    const base = {
      kitId: 'kit-brand',
      version: 1,
      guide: ' 指南 ',
      facts: [
        { key: 'B', value: '2' },
        { key: 'A', value: '1' },
      ],
      assetHashes: ['b', 'a', 'a'],
    }
    expect(contextKitVersionChecksum(base)).toBe(
      contextKitVersionChecksum({
        ...base,
        facts: [...base.facts].reverse(),
        assetHashes: ['a', 'b'],
      }),
    )
  })

  it('★ 套件版本 checksum 包含颜色、字体和素材角色', () => {
    const base = {
      kitId: 'kit-brand',
      version: 1,
      guide: '',
      facts: [],
      assetHashes: ['logo'],
      resources: [{ hash: 'logo', role: 'logo' as const, name: '主 Logo' }],
      colors: [{ id: 'c1', name: '主色', value: '#14532d' }],
      fonts: [{ id: 'f1', name: '思源黑体', detail: '标题' }],
    }
    expect(contextKitVersionChecksum(base)).not.toBe(
      contextKitVersionChecksum({
        ...base,
        resources: [{ hash: 'logo', role: 'reference', name: '主 Logo' }],
      }),
    )
    expect(contextKitVersionChecksum(base)).not.toBe(
      contextKitVersionChecksum({
        ...base,
        colors: [{ id: 'c1', name: '主色', value: '#ffffff' }],
      }),
    )
  })

  it('★ Prompt 只注入当前绑定、记忆与冲突摘要', () => {
    const bundle = assembleContextBundle({
      request: '出图',
      scope: { workbench: 'canvas', projectId: 'p1' },
      memories: [memory({ kind: 'constraint', text: '不要使用霓虹色' })],
      memoryRevisions: [
        memoryRevision({ kind: 'constraint', text: '不要使用霓虹色' }),
      ],
      kits: [kit()],
      kitVersions: [version()],
      bindings: [binding()],
      skill: { name: '品牌海报', content: '先分析主色，再写提示词。' },
    })
    const text = formatContextBundleForPrompt(bundle)
    expect(text).toContain('不要使用霓虹色')
    expect(text).toContain('品牌 A v1')
    expect(text).toContain('先分析主色')
  })

  it('★★ 记忆按会话、项目、工作台和全局分层，并且过期项不进入上下文', () => {
    const bundle = assembleContextBundle({
      request: '继续做图',
      scope: { workbench: 'canvas', projectId: 'p1', sessionId: 's1' },
      memories: [
        memory({ id: 'global', text: '全局偏好' }),
        memory({ id: 'workbench', scope: 'workbench', workbench: 'canvas', text: '画布偏好' }),
        memory({ id: 'project', scope: 'project', projectId: 'p1', text: '项目事实', kind: 'fact' }),
        memory({
          id: 'session',
          scope: 'session',
          sessionId: 's1',
          text: '本会话采用蓝色',
          kind: 'decision',
        }),
        memory({
          id: 'expired',
          scope: 'project',
          projectId: 'p1',
          text: '过期事实',
          kind: 'fact',
          expiresAt: 1,
        }),
        memory({
          id: 'other-project',
          scope: 'project',
          projectId: 'p2',
          text: '别的项目',
          kind: 'fact',
        }),
      ],
      memoryRevisions: [],
      kits: [],
      kitVersions: [],
      bindings: [],
    })
    expect(bundle.softPreferences).toEqual(['画布偏好', '全局偏好'])
    expect(bundle.facts).toEqual(['项目事实'])
    expect(bundle.sessionDecisions).toEqual(['本会话采用蓝色'])
    expect(bundle.memoryRefs.map((item) => item.id)).toEqual([
      'session',
      'project',
      'workbench',
      'global',
    ])
  })

  it('★★ 同作用域同主题的记忆冲突会带出来源，不会静默覆盖', () => {
    const bundle = assembleContextBundle({
      request: '出图',
      scope: { workbench: 'ecommerce', projectId: 'p1' },
      memories: [
        memory({
          id: 'memory-a',
          kind: 'fact',
          key: 'brand.primaryColor',
          text: '主色 #14532D',
          scope: 'project',
          projectId: 'p1',
        }),
        memory({
          id: 'memory-b',
          kind: 'fact',
          key: 'brand.primaryColor',
          text: '主色 #000000',
          scope: 'project',
          projectId: 'p1',
        }),
      ],
      memoryRevisions: [],
      kits: [],
      kitVersions: [],
      bindings: [],
    })
    expect(bundle.conflicts).toHaveLength(1)
    expect(bundle.conflicts[0]?.values).toEqual(['主色 #000000', '主色 #14532D'])
    expect(bundle.conflicts[0]?.message).toContain('存在冲突')
  })

  it('★ 预算先保留硬约束和事实，只省略低优先级偏好', () => {
    const bundle = assembleContextBundle({
      request: '出图',
      scope: { workbench: 'canvas', projectId: 'p1' },
      memories: [
        memory({ id: 'constraint', kind: 'constraint', text: '必须保留完整文字' }),
        memory({ id: 'fact', kind: 'fact', text: '品牌名是青禾' }),
        memory({ id: 'short', text: '短偏好', updatedAt: now + 3 }),
        memory({ id: 'long', text: '很长的偏好'.repeat(20), updatedAt: now + 2 }),
      ],
      memoryRevisions: [],
      kits: [],
      kitVersions: [],
      bindings: [],
      memoryCharBudget: 20,
    })
    expect(bundle.hardConstraints).toEqual(['必须保留完整文字'])
    expect(bundle.facts).toEqual(['品牌名是青禾'])
    expect(bundle.softPreferences).toEqual(['短偏好'])
    expect(bundle.budget.omittedMemoryRefs).toEqual([
      { id: 'long', revision: 1, reason: 'memory_budget' },
    ])
  })
})
