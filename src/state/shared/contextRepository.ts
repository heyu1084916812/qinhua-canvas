import {
  assembleContextBundle,
  contextKitVersionChecksum,
  contextMemoryScopeOf,
  contextMemorySecretReason,
  normalizeContextKitKind,
  normalizeContextMemoryKind,
  normalizeContextMemoryKey,
  normalizeContextMemoryScope,
  type ContextBundle,
  type ContextKit,
  type ContextKitAsset,
  type ContextKitColor,
  type ContextKitFact,
  type ContextKitFont,
  type ContextKitKind,
  type ContextKitVersion,
  type ContextMemory,
  type ContextMemoryKind,
  type ContextMemoryRevision,
  type ContextMemoryScope,
  type ContextMemorySource,
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
    scope?: ContextMemoryScope
    workbench?: WorkbenchId
    projectId?: string
    sessionId?: string
    key?: string
    expiresAt?: number
    source?: ContextMemorySource
    confidence?: number
    replaceMemoryId?: string
  }): Promise<ContextMemory>
  updateMemory(
    id: string,
    patch: {
      kind?: ContextMemoryKind
      text?: string
      scope?: ContextMemoryScope
      workbench?: WorkbenchId | null
      projectId?: string | null
      sessionId?: string | null
      key?: string | null
      expiresAt?: number | null
      source?: ContextMemorySource
      confidence?: number
    },
  ): Promise<ContextMemory | null>
  setMemoryEnabled(id: string, enabled: boolean): Promise<ContextMemory | null>
  removeMemory(id: string): Promise<void>
  purgeExpiredMemories(now?: number): Promise<number>
  listKits(kind?: ContextKitKind): Promise<ContextKit[]>
  createKit(input: {
    kind: ContextKitKind
    name: string
    description?: string
    guide?: string
    facts?: readonly ContextKitFact[]
    assetHashes?: readonly string[]
    resources?: readonly ContextKitAsset[]
    colors?: readonly ContextKitColor[]
    fonts?: readonly ContextKitFont[]
  }): Promise<{ kit: ContextKit; version: ContextKitVersion }>
  saveKitVersion(
    kitId: string,
    input: {
      guide?: string
      facts?: readonly ContextKitFact[]
      assetHashes?: readonly string[]
      resources?: readonly ContextKitAsset[]
      colors?: readonly ContextKitColor[]
      fonts?: readonly ContextKitFont[]
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
    memoryCharBudget?: number
  }): Promise<ContextBundle>
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function confidenceOf(value: unknown): number {
  const number = finiteNumber(value)
  return number === undefined ? 1 : Math.min(1, Math.max(0, number))
}

function workbenchOf(value: unknown): WorkbenchId | undefined {
  return typeof value === 'string' && isWorkbenchId(value) ? value : undefined
}

function memoryScopeFields(
  value: Record<string, unknown>,
): Pick<ContextMemory, 'scope' | 'workbench' | 'projectId' | 'sessionId'> {
  const workbench = workbenchOf(value.workbench)
  const projectId = textOf(value.projectId)
  const sessionId = textOf(value.sessionId)
  const scope = normalizeContextMemoryScope(
    value.scope ?? (sessionId ? 'session' : projectId ? 'project' : workbench ? 'workbench' : 'global'),
  )
  return {
    scope,
    ...(workbench ? { workbench } : {}),
    ...(projectId ? { projectId } : {}),
    ...(sessionId ? { sessionId } : {}),
  }
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

function resourcesOf(value: unknown, assetHashes: readonly string[]): ContextKitAsset[] {
  const parsed = Array.isArray(value)
    ? value.flatMap((item): ContextKitAsset[] => {
        if (!item || typeof item !== 'object') return []
        const row = item as Record<string, unknown>
        const hash = textOf(row.hash)
        const role = row.role === 'logo' ? 'logo' : row.role === 'reference' ? 'reference' : null
        if (!hash || !role) return []
        return [{ hash, role, name: textOf(row.name) }]
      })
    : []
  const seen = new Set(parsed.map((item) => item.hash))
  for (const hash of assetHashes) {
    if (seen.has(hash)) continue
    parsed.push({ hash, role: 'reference', name: '' })
    seen.add(hash)
  }
  return parsed
}

function colorsOf(value: unknown): ContextKitColor[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ContextKitColor[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const id = textOf(row.id)
    const name = textOf(row.name)
    const raw = textOf(row.value)
    if (!id || !/^#[0-9a-f]{6}$/i.test(raw)) return []
    return [{ id, name, value: raw.toLowerCase() }]
  })
}

function fontsOf(value: unknown): ContextKitFont[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): ContextKitFont[] => {
    if (!item || typeof item !== 'object') return []
    const row = item as Record<string, unknown>
    const id = textOf(row.id)
    const name = textOf(row.name)
    if (!id || !name) return []
    const fontId = textOf(row.fontId)
    const format = textOf(row.format)
    const size =
      typeof row.size === 'number' && Number.isFinite(row.size) && row.size > 0
        ? Math.trunc(row.size)
        : undefined
    return [
      {
        id,
        name,
        detail: textOf(row.detail),
        ...(fontId ? { fontId } : {}),
        ...(format ? { format } : {}),
        ...(size ? { size } : {}),
      },
    ]
  })
}

function memoryOf(row: RowOf<'contextMemories'>): ContextMemory {
  const expiresAt = finiteNumber(row.expiresAt)
  const source = row.source === 'agent' ? 'agent' : 'user'
  const confidence = confidenceOf(row.confidence)
  return {
    id: String(row.id),
    kind: normalizeContextMemoryKind(row.kind),
    text: textOf(row.text),
    ...memoryScopeFields(row),
    ...(normalizeContextMemoryKey(row.key)
      ? { key: normalizeContextMemoryKey(row.key) }
      : {}),
    ...(expiresAt !== undefined && expiresAt > 0 ? { expiresAt } : {}),
    source,
    confidence,
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
  const expiresAt = finiteNumber(row.expiresAt)
  return {
    id: String(row.id),
    memoryId: String(row.memoryId ?? ''),
    revision:
      typeof row.revision === 'number' && row.revision > 0
        ? Math.trunc(row.revision)
        : 1,
    kind: normalizeContextMemoryKind(row.kind),
    text: textOf(row.text),
    ...memoryScopeFields(row),
    ...(normalizeContextMemoryKey(row.key)
      ? { key: normalizeContextMemoryKey(row.key) }
      : {}),
    ...(expiresAt !== undefined && expiresAt > 0 ? { expiresAt } : {}),
    source: row.source === 'agent' ? 'agent' : 'user',
    confidence: confidenceOf(row.confidence),
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
  const assetHashes = hashesOf(row.assetHashes)
  const base = {
    id: String(row.id),
    kitId: String(row.kitId ?? ''),
    version:
      typeof row.version === 'number' && row.version > 0
        ? Math.trunc(row.version)
        : 1,
    guide: textOf(row.guide),
    facts: factsOf(row.facts),
    assetHashes,
    resources: resourcesOf(row.resources, assetHashes),
    colors: colorsOf(row.colors),
    fonts: fontsOf(row.fonts),
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

  const scopedMemoryFields = (input: {
    scope?: ContextMemoryScope
    workbench?: WorkbenchId | null
    projectId?: string | null
    sessionId?: string | null
  }): Pick<ContextMemory, 'scope' | 'workbench' | 'projectId' | 'sessionId'> => {
    const scope = normalizeContextMemoryScope(
      input.scope ??
        (input.sessionId
          ? 'session'
          : input.projectId
            ? 'project'
            : input.workbench
              ? 'workbench'
              : 'global'),
    )
    if (scope === 'global') return { scope }
    if (scope === 'workbench') {
      const workbench = workbenchOf(input.workbench)
      if (!workbench) throw new Error('工作台记忆必须指定工作台')
      return { scope, workbench }
    }
    if (scope === 'project') {
      const projectId = textOf(input.projectId)
      if (!projectId) throw new Error('项目记忆必须指定项目')
      return { scope, projectId }
    }
    const sessionId = textOf(input.sessionId)
    if (!sessionId) throw new Error('会话记忆必须指定会话')
    const projectId = textOf(input.projectId)
    const workbench = workbenchOf(input.workbench)
    return {
      scope,
      sessionId,
      ...(projectId ? { projectId } : {}),
      ...(workbench ? { workbench } : {}),
    }
  }

  const sameMemoryTarget = (left: ContextMemory, right: ContextMemory): boolean => {
    const leftScope = contextMemoryScopeOf(left)
    return (
      leftScope === contextMemoryScopeOf(right) &&
      (leftScope !== 'workbench' || left.workbench === right.workbench) &&
      (leftScope !== 'project' || left.projectId === right.projectId) &&
      (leftScope !== 'session' || left.sessionId === right.sessionId)
    )
  }

  const updateMemoryImpl = async (
    id: string,
    patch: Parameters<ContextRepository['updateMemory']>[1],
  ): Promise<ContextMemory | null> =>
    storage.transaction(
      ['contextMemories', 'contextMemoryRevisions'],
      async (tx) => {
        const rows = await tx.query('contextMemories', { id })
        if (!rows[0]) return null
        const current = memoryOf(rows[0])
        const text =
          patch.text !== undefined ? patch.text.trim() : current.text
        if (!text) throw new Error('记忆正文不能为空')
        const secret = contextMemorySecretReason(text)
        if (secret) throw new Error(`记忆里不能保存${secret}`)
        const scopeFields =
          patch.scope !== undefined ||
          patch.workbench !== undefined ||
          patch.projectId !== undefined ||
          patch.sessionId !== undefined
            ? scopedMemoryFields({
                scope: patch.scope ?? contextMemoryScopeOf(current),
                workbench:
                  patch.workbench !== undefined
                    ? patch.workbench
                    : current.workbench,
                projectId:
                  patch.projectId !== undefined
                    ? patch.projectId
                    : current.projectId,
                sessionId:
                  patch.sessionId !== undefined
                    ? patch.sessionId
                    : current.sessionId,
              })
            : {
                scope: contextMemoryScopeOf(current),
                ...(current.workbench ? { workbench: current.workbench } : {}),
                ...(current.projectId ? { projectId: current.projectId } : {}),
                ...(current.sessionId ? { sessionId: current.sessionId } : {}),
              }
        const next: ContextMemory = {
          ...current,
          ...scopeFields,
          ...(patch.kind ? { kind: normalizeContextMemoryKind(patch.kind) } : {}),
          text,
          ...(patch.key !== undefined
            ? normalizeContextMemoryKey(patch.key)
              ? { key: normalizeContextMemoryKey(patch.key) }
              : { key: undefined }
            : {}),
          ...(patch.expiresAt !== undefined
            ? finiteNumber(patch.expiresAt) && Number(patch.expiresAt) > 0
              ? { expiresAt: Math.trunc(Number(patch.expiresAt)) }
              : { expiresAt: undefined }
            : {}),
          ...(patch.source ? { source: patch.source } : {}),
          ...(patch.confidence !== undefined
            ? { confidence: confidenceOf(patch.confidence) }
            : {}),
          updatedAt: Date.now(),
          currentRevision: current.currentRevision + 1,
        }
        const existingMemories = (await tx.query('contextMemories', {})).map(memoryOf)
        const conflict = existingMemories.find(
          (memory) =>
            memory.id !== id &&
            memory.enabled &&
            Boolean(next.key) &&
            normalizeContextMemoryKey(memory.key) === next.key &&
            sameMemoryTarget(memory, next) &&
            memory.text.trim().toLowerCase() !== next.text.trim().toLowerCase(),
        )
        if (conflict) {
          throw new Error(`同一作用域已有记忆「${conflict.text}」，请替换原记忆或换一个主题键`)
        }
        const revision: ContextMemoryRevision = {
          id: createId('memrev'),
          memoryId: next.id,
          revision: next.currentRevision,
          kind: next.kind,
          text: next.text,
          ...scopeFields,
          ...(next.key ? { key: next.key } : {}),
          ...(next.expiresAt ? { expiresAt: next.expiresAt } : {}),
          source: next.source ?? 'user',
          confidence: next.confidence ?? 1,
          createdAt: next.updatedAt,
        }
        await tx.put('contextMemories', next as never)
        await tx.put('contextMemoryRevisions', revision as never)
        return next
      },
    )

  const createMemoryImpl: ContextRepository['createMemory'] = async (input) => {
    const value = input.text.trim()
    if (!value) throw new Error('记忆正文不能为空')
    const secret = contextMemorySecretReason(value)
    if (secret) throw new Error(`记忆里不能保存${secret}`)
    const scopeFields = scopedMemoryFields(input)
    const kind = normalizeContextMemoryKind(input.kind)
    const key = normalizeContextMemoryKey(input.key)
    const existing = (await listMemories()).find(
      (memory) =>
        memory.enabled &&
        memory.kind === kind &&
        sameMemoryTarget(memory, { ...memory, ...scopeFields }) &&
        memory.text.trim().toLowerCase() === value.toLowerCase(),
    )
    if (existing) return existing
    if (key) {
      const conflict = (await listMemories()).find(
        (memory) =>
          memory.enabled &&
          normalizeContextMemoryKey(memory.key) === key &&
          sameMemoryTarget(memory, { ...memory, ...scopeFields }),
      )
      if (conflict) {
        if (input.replaceMemoryId !== conflict.id) {
          throw new Error(`同一作用域已有记忆「${conflict.text}」，请确认是否替换`)
        }
        const replaced = await updateMemoryImpl(conflict.id, {
          kind,
          text: value,
          ...scopeFields,
          key,
          ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
          source: input.source ?? 'user',
          confidence: confidenceOf(input.confidence),
        })
        if (!replaced) throw new Error('要替换的记忆已不存在')
        return replaced
      }
    }
    if (input.replaceMemoryId) {
      const replaced = await updateMemoryImpl(input.replaceMemoryId, {
        kind,
        text: value,
        ...scopeFields,
        key,
        ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
        source: input.source ?? 'user',
        confidence: confidenceOf(input.confidence),
      })
      if (!replaced) throw new Error('要替换的记忆已不存在')
      return replaced
    }
    const at = Date.now()
    const memory: ContextMemory = {
      id: createId('memory'),
      kind,
      text: value,
      ...scopeFields,
      ...(key ? { key } : {}),
      ...(input.expiresAt !== undefined && input.expiresAt > 0
        ? { expiresAt: Math.trunc(input.expiresAt) }
        : {}),
      source: input.source ?? 'user',
      confidence: confidenceOf(input.confidence),
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
      ...scopeFields,
      ...(memory.key ? { key: memory.key } : {}),
      ...(memory.expiresAt ? { expiresAt: memory.expiresAt } : {}),
      source: memory.source ?? 'user',
      confidence: memory.confidence ?? 1,
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
  }

  return {
    listMemories,
    listMemoryRevisions,
    listKits,
    listKitVersions,
    listProjectBindings,

    createMemory: createMemoryImpl,

    updateMemory: updateMemoryImpl,

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

    async purgeExpiredMemories(now = Date.now()) {
      const expired = (await listMemories()).filter(
        (memory) => memory.expiresAt !== undefined && memory.expiresAt <= now,
      )
      for (const memory of expired) {
        await storage.transaction(
          ['contextMemories', 'contextMemoryRevisions'],
          async (tx) => {
            const revisions = await tx.query('contextMemoryRevisions', {
              memoryId: memory.id,
            })
            for (const revision of revisions) {
              await tx.delete('contextMemoryRevisions', revision.id)
            }
            await tx.delete('contextMemories', memory.id)
          },
        )
      }
      return expired.length
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
        resources: resourcesOf(input.resources, hashesOf(input.assetHashes)),
        colors: colorsOf(input.colors),
        fonts: fontsOf(input.fonts),
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
            resources:
              input.resources !== undefined
                ? resourcesOf(
                    input.resources,
                    input.assetHashes !== undefined
                      ? hashesOf(input.assetHashes)
                      : input.resources.map((resource) => resource.hash),
                  )
                : previous?.resources ?? [],
            colors:
              input.colors !== undefined
                ? colorsOf(input.colors)
                : previous?.colors ?? [],
            fonts:
              input.fonts !== undefined
                ? fontsOf(input.fonts)
                : previous?.fonts ?? [],
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
        ...(input.memoryCharBudget !== undefined
          ? { memoryCharBudget: input.memoryCharBudget }
          : {}),
      })
    },
  }
}
