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
    expect(bundle.hardConstraints.join('\n')).not.toContain('新版品牌要求')
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
})
