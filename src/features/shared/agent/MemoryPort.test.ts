import { describe, expect, it, vi } from 'vitest'
import type { ContextBundle, ContextMemory } from '../../../domain/shared/context'
import type { MemoryCandidate } from '../../../domain/shared/memoryOrganizer'
import { createAgentMemoryPort } from './MemoryPort'

const bundle: ContextBundle = {
  request: '做一张主图',
  scope: { workbench: 'canvas', projectId: 'p1', sessionId: 's1' },
  hardConstraints: [],
  facts: [],
  softPreferences: [],
  projectDecisions: [],
  procedures: [],
  sessionDecisions: [],
  exclusions: [],
  conflicts: [],
  memoryRefs: [],
  kitVersionRefs: [],
  assetHashes: [],
  budget: {
    maxMemoryChars: 12000,
    usedMemoryChars: 0,
    omittedMemoryRefs: [],
  },
  digest: 'digest',
}

const candidate: MemoryCandidate = {
  kind: 'constraint',
  text: '品牌主色只能用深蓝',
  scope: 'project',
  projectId: 'p1',
  key: 'brand.primaryColor',
  confidence: 0.9,
  reason: '用户确认',
}

describe('AgentMemoryPort', () => {
  it('reads the existing ContextBundle without copying memory into another store', async () => {
    const repository = {
      bundleForProject: vi.fn(async () => bundle),
      createMemory: vi.fn(),
    }
    const port = createAgentMemoryPort(repository)

    await expect(
      port.read({
        projectId: 'p1',
        workbench: 'canvas',
        request: '做一张主图',
        sessionId: 's1',
      }),
    ).resolves.toBe(bundle)
    expect(repository.bundleForProject).toHaveBeenCalledOnce()
    expect(repository.createMemory).not.toHaveBeenCalled()
  })

  it('writes only an accepted candidate through the existing repository', async () => {
    const memory = {
      id: 'm1',
      kind: 'constraint',
      text: candidate.text,
      scope: 'project',
      projectId: 'p1',
      key: 'brand.primarycolor',
      source: 'agent',
      confidence: 0.9,
      enabled: true,
      currentRevision: 1,
      createdAt: 1,
      updatedAt: 1,
    } satisfies ContextMemory
    const repository = {
      bundleForProject: vi.fn(),
      createMemory: vi.fn(async () => memory),
    }
    const port = createAgentMemoryPort(repository)

    await expect(port.remember(candidate)).resolves.toBe(memory)
    expect(repository.createMemory).toHaveBeenCalledWith({
      kind: 'constraint',
      text: candidate.text,
      scope: 'project',
      projectId: 'p1',
      key: 'brand.primaryColor',
      source: 'agent',
      confidence: 0.9,
    })
  })

  it('rejects lower-level candidates before they reach storage', async () => {
    const repository = {
      bundleForProject: vi.fn(),
      createMemory: vi.fn(),
    }
    const port = createAgentMemoryPort(repository)

    await expect(
      port.remember({
        ...candidate,
        scope: 'project',
        projectId: '',
      }),
    ).rejects.toThrow('项目记忆缺少项目')
    expect(repository.createMemory).not.toHaveBeenCalled()
  })
})
