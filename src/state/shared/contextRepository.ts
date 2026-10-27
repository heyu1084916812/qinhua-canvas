import {
  assembleContextBundle,
  contextKitVersionChecksum,
  normalizeContextKitKind,
  normalizeContextMemoryKind,
  type ContextBundle,
  type ContextKit,
  type ContextKitFact,
  type ContextKitKind,
  type ContextKitVersion,
  type ContextMemory,
  type ContextMemoryKind,
  type ContextMemoryRevision,
  type ProjectContextBinding,
} from '../../domain/shared/context'
import { isWorkbenchId, type WorkbenchId } from '../../domain/shared/workbench'
import type { RowOf, StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'

export interface ContextRepository {
  listMemories(): Promise<ContextMemory[]>
  listMemoryRevisions(memoryId?: string): Promise<ContextMemoryRevision[]>
  createMemory(input: {
    kind: ContextMemoryKind
    text: string
    workbench?: WorkbenchId
  }): Promise<ContextMemory>
  updateMemory(
    id: string,
    patch: {
      kind?: ContextMemoryKind
      text?: string
      workbench?: WorkbenchId | null
    },
  ): Promise<ContextMemory | null>
  setMemoryEnabled(id: string, enabled: boolean): Promise<ContextMemory | null>
  removeMemory(id: string): Promise<void>
  listKits(kind?: ContextKitKind): Promise<ContextKit[]>
  createKit(input: {
    kind: ContextKitKind
    name: string
    description?: string
    guide?: string
    facts?: readonly ContextKitFact[]
    assetHashes?: readonly string[]
  }): Promise<{ kit: ContextKit; version: ContextKitVersion }>
  saveKitVersion(
    kitId: string,
    input: {
      guide?: string
      facts?: readonly ContextKitFact[]
      assetHashes?: readonly string[]
      description?: string
    },
  ): Promise<{ kit: ContextKit; version: ContextKitVersion } | null>
  listKitVersions(kitId: string): Promise<ContextKitVersion[]>
  bindProject(input: {
    projectId: string
    kitId: string
    kitVersion: number
    mode?: ProjectContextBinding['mode']
  }): Promise<ProjectContextBinding>
  listProjectBindings(projectId: string): Promise<ProjectContextBinding[]>
  removeBinding(projectId: string, kitId: string): Promise<void>
  bundleForProject(input: {
    projectId: string
    workbench: WorkbenchId
    request: string
    sessionId?: string
    taskId?: string
    skill?: { name: string; content: string }
  }): Promise<ContextBundle>
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function workbenchOf(value: unknown): WorkbenchId | undefined {
  return typeof value === 'string' && isWorkbenchId(value) ? value : undefined
}

function factsOf(value: unknown): ContextKitFact[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ContextKitFact[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const key = textOf(row.key)
    const factValue = textOf(row.value)
    return key && factValue ? [{ key, value: factValue }] : []
  })
}

function hashesOf(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(textOf).filter(Boolean))]
    : []
}

function memoryOf(row: RowOf<'contextMemories'>): ContextMemory {
  return {
    id: String(row.id),
    kind: normalizeContextMemoryKind(row.kind),
    text: textOf(row.text),
    ...(workbenchOf(row.workbench)
      ? { workbench: workbenchOf(row.workbench) }
      : {}),
    enabled: row.enabled !== false,
    currentRevision:
      typeof row.currentRevision === 'number' && row.currentRevision > 0
        ? Math.trunc(row.currentRevision)
        : 1,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  }
}

function memoryRevisionOf(
  row: RowOf<'contextMemoryRevisions'>,
): ContextMemoryRevision {
  return {
    id: String(row.id),
    memoryId: String(row.memoryId ?? ''),
    revision:
      typeof row.revision === 'number' && row.revision > 0
        ? Math.trunc(row.revision)
        : 1,
    kind: normalizeContextMemoryKind(row.kind),
    text: textOf(row.text),
    ...(workbenchOf(row.workbench)
      ? { workbench: workbenchOf(row.workbench) }
      : {}),
    source: row.source === 'agent' ? 'agent' : 'user',
    confidence:
      typeof row.confidence === 'number' && Number.isFinite(row.confidence)
        ? Math.min(1, Math.max(0, row.confidence))
        : 1,
    createdAt: Number(row.createdAt ?? 0),
  }
}

function kitOf(row: RowOf<'contextKits'>): ContextKit {
  return {
    id: String(row.id),
    kind: normalizeContextKitKind(row.kind),
    name: textOf(row.name) || '未命名套件',
    description: textOf(row.description),
    currentVersion:
      typeof row.currentVersion === 'number' && row.currentVersion > 0
        ? Math.trunc(row.currentVersion)
        : 1,
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  }
}

function kitVersionOf(row: RowOf<'contextKitVersions'>): ContextKitVersion {
  const base = {
    id: String(row.id),
    kitId: String(row.kitId ?? ''),
    version:
      typeof row.version === 'number' && row.version > 0
        ? Math.trunc(row.version)
        : 1,
    guide: textOf(row.guide),
    facts: factsOf(row.facts),
    assetHashes: hashesOf(row.assetHashes),
    createdAt: Number(row.createdAt ?? 0),
  }
  return {
    ...base,
    checksum:
      textOf(row.checksum) ||
      contextKitVersionChecksum(base),
  }
}

function bindingOf(
  row: RowOf<'projectContextBindings'>,
): ProjectContextBinding {
  return {
    id: String(row.id),
    projectId: String(row.projectId ?? ''),
    kitId: String(row.kitId ?? ''),
    kitVersion:
      typeof row.kitVersion === 'number' && row.kitVersion > 0
        ? Math.trunc(row.kitVersion)
        : 1,
    mode: row.mode === 'prefer' ? 'prefer' : 'locked',
    createdAt: Number(row.createdAt ?? 0),
    updatedAt: Number(row.updatedAt ?? 0),
  }
}

export function createContextRepository(storage: StoragePort): ContextRepository {
  const listMemories = async (): Promise<ContextMemory[]> =>
    (await storage.query('contextMemories', {})).map(memoryOf).sort(
      (left, right) => right.updatedAt - left.updatedAt,
    )

  const listMemoryRevisions = async (
    memoryId?: string,
  ): Promise<ContextMemoryRevision[]> => {
    const rows = memoryId
      ? await storage.query('contextMemoryRevisions', { memoryId })
      : await storage.query('contextMemoryRevisions', {})
    return rows.map(memoryRevisionOf).sort(
      (left, right) => left.memoryId.localeCompare(right.memoryId) || left.revision - right.revision,
    )
  }

  const listKits = async (kind?: ContextKitKind): Promise<ContextKit[]> =>
    (await storage.query('contextKits', kind ? { kind } : {}))
      .map(kitOf)
      .sort((left, right) => right.updatedAt - left.updatedAt)

  const listKitVersions = async (kitId: string): Promise<ContextKitVersion[]> =>
    (await storage.query('contextKitVersions', { kitId }))
      .map(kitVersionOf)
      .sort((left, right) => right.version - left.version)

  const listProjectBindings = async (
    projectId: string,
  ): Promise<ProjectContextBinding[]> =>
    (await storage.query('projectContextBindings', { projectId }))
      .map(bindingOf)
      .sort((left, right) => right.updatedAt - left.updatedAt)

  return {
    listMemories,
    listMemoryRevisions,
    listKits,
    listKitVersions,
    listProjectBindings,

    async createMemory({ kind, text, workbench }) {
      const value = text.trim()
      if (!value) throw new Error('记忆正文不能为空')
      const at = Date.now()
      const memory: ContextMemory = {
        id: createId('memory'),
        kind: normalizeContextMemoryKind(kind),
        text: value,
        ...(workbench ? { workbench } : {}),
        enabled: true,
        currentRevision: 1,
        createdAt: at,
        updatedAt: at,
      }
      const revision: ContextMemoryRevision = {
        id: createId('memrev'),
        memoryId: memory.id,
        revision: 1,
        kind: memory.kind,
        text: memory.text,
        ...(memory.workbench ? { workbench: memory.workbench } : {}),
        source: 'user',
        confidence: 1,
        createdAt: at,
      }
      await storage.transaction(
        ['contextMemories', 'contextMemoryRevisions'],
        async (tx) => {
          await tx.put('contextMemories', memory as never)
          await tx.put('contextMemoryRevisions', revision as never)
        },
      )
      return memory
    },

    async updateMemory(id, patch) {
      return storage.transaction(
        ['contextMemories', 'contextMemoryRevisions'],
        async (tx) => {
          const rows = await tx.query('contextMemories', { id })
          if (!rows[0]) return null
          const current = memoryOf(rows[0])
          const next: ContextMemory = {
            ...current,
            ...(patch.kind ? { kind: normalizeContextMemoryKind(patch.kind) } : {}),
            ...(patch.text !== undefined ? { text: patch.text.trim() } : {}),
            ...(patch.workbench !== undefined
              ? patch.workbench
                ? { workbench: patch.workbench }
                : { workbench: undefined }
              : {}),
            currentRevision: current.currentRevision + 1,
            updatedAt: Date.now(),
          }
          if (!next.text) throw new Error('记忆正文不能为空')
          const revision: ContextMemoryRevision = {
            id: createId('memrev'),
            memoryId: next.id,
            revision: next.currentRevision,
            kind: next.kind,
            text: next.text,
            ...(next.workbench ? { workbench: next.workbench } : {}),
            source: 'user',
            confidence: 1,
            createdAt: next.updatedAt,
          }
          await tx.put('contextMemories', next as never)
          await tx.put('contextMemoryRevisions', revision as never)
          return next
        },
      )
    },

    async setMemoryEnabled(id, enabled) {
      const rows = await storage.query('contextMemories', { id })
      if (!rows[0]) return null
      const next = { ...memoryOf(rows[0]), enabled, updatedAt: Date.now() }
      await storage.put('contextMemories', next as never)
      return next
    },

    async removeMemory(id) {
      await storage.transaction(
        ['contextMemories', 'contextMemoryRevisions'],
        async (tx) => {
          const revisions = await tx.query('contextMemoryRevisions', { memoryId: id })
          for (const revision of revisions) {
            await tx.delete('contextMemoryRevisions', revision.id)
          }
          await tx.delete('contextMemories', id)
        },
      )
    },

    async createKit(input) {
      const name = input.name.trim()
      if (!name) throw new Error('套件名称不能为空')
      const at = Date.now()
      const kit: ContextKit = {
        id: createId('kit'),
        kind: normalizeContextKitKind(input.kind),
        name,
        description: textOf(input.description),
        currentVersion: 1,
        createdAt: at,
        updatedAt: at,
      }
      const versionBase = {
        kitId: kit.id,
        version: 1,
        guide: textOf(input.guide),
        facts: factsOf(input.facts),
        assetHashes: hashesOf(input.assetHashes),
      }
      const version: ContextKitVersion = {
        id: createId('kitver'),
        ...versionBase,
        checksum: contextKitVersionChecksum(versionBase),
        createdAt: at,
      }
      await storage.transaction(
        ['contextKits', 'contextKitVersions'],
        async (tx) => {
          await tx.put('contextKits', kit as never)
          await tx.put('contextKitVersions', version as never)
        },
      )
      return { kit, version }
    },

    async saveKitVersion(kitId, input) {
      return storage.transaction(
        ['contextKits', 'contextKitVersions'],
        async (tx) => {
          const kitRows = await tx.query('contextKits', { kitId })
          const currentRows = await tx.query('contextKits', { id: kitId })
          const row = currentRows[0] ?? kitRows[0]
          if (!row) return null
          const current = kitOf(row)
          const previous = (await tx.query('contextKitVersions', { kitId }))
            .map(kitVersionOf)
            .sort((left, right) => right.version - left.version)[0]
          const at = Date.now()
          const versionNumber = current.currentVersion + 1
          const base = {
            kitId,
            version: versionNumber,
            guide:
              input.guide !== undefined
                ? textOf(input.guide)
                : previous?.guide ?? '',
            facts:
              input.facts !== undefined
                ? factsOf(input.facts)
                : previous?.facts ?? [],
            assetHashes:
              input.assetHashes !== undefined
                ? hashesOf(input.assetHashes)
                : previous?.assetHashes ?? [],
          }
          const version: ContextKitVersion = {
            id: createId('kitver'),
            ...base,
            checksum: contextKitVersionChecksum(base),
            createdAt: at,
          }
          const nextKit: ContextKit = {
            ...current,
            ...(input.description !== undefined
              ? { description: textOf(input.description) }
              : {}),
            currentVersion: versionNumber,
            updatedAt: at,
          }
          await tx.put('contextKits', nextKit as never)
          await tx.put('contextKitVersions', version as never)
          return { kit: nextKit, version }
        },
      )
    },

    async bindProject(input) {
      const versions = await storage.query('contextKitVersions', {
        kitId: input.kitId,
        version: input.kitVersion,
      })
      if (!versions[0]) throw new Error('该套件版本不存在')
      const existing = (
        await storage.query('projectContextBindings', {
          projectId: input.projectId,
          kitId: input.kitId,
        })
      )[0]
      const at = Date.now()
      const binding: ProjectContextBinding = existing
        ? {
            ...bindingOf(existing),
            kitVersion: input.kitVersion,
            mode: input.mode ?? 'locked',
            updatedAt: at,
          }
        : {
            id: createId('bind'),
            projectId: input.projectId,
            kitId: input.kitId,
            kitVersion: input.kitVersion,
            mode: input.mode ?? 'locked',
            createdAt: at,
            updatedAt: at,
          }
      await storage.put('projectContextBindings', binding as never)
      return binding
    },

    async removeBinding(projectId, kitId) {
      const rows = await storage.query('projectContextBindings', {
        projectId,
        kitId,
      })
      for (const row of rows) {
        await storage.delete('projectContextBindings', row.id)
      }
    },

    async bundleForProject(input) {
      const [memories, memoryRevisions, kits, bindings] = await Promise.all([
        listMemories(),
        listMemoryRevisions(),
        listKits(),
        listProjectBindings(input.projectId),
      ])
      const bound = new Set(bindings.map((binding) => binding.kitId))
      const versions = (
        await Promise.all(
          kits
            .filter((kit) => bound.has(kit.id))
            .map((kit) => listKitVersions(kit.id)),
        )
      ).flat()
      return assembleContextBundle({
        request: input.request,
        scope: {
          workbench: input.workbench,
          projectId: input.projectId,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          ...(input.taskId ? { taskId: input.taskId } : {}),
        },
        memories,
        memoryRevisions,
        kits,
        kitVersions: versions,
        bindings,
        ...(input.skill ? { skill: input.skill } : {}),
      })
    },
  }
}
