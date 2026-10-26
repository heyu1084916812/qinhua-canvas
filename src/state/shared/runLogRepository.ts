import type { Project } from '../../domain/project/project'
import type { RunRecord } from '../../domain/shared/execution/runRecord'
import type { StoragePort } from '../../platform/ports'
import type { WorkbenchId } from '../../domain/shared/workbench'

export type RunLogScopeState = 'scoped' | 'legacy' | 'unclassified'

export interface RunLogEntry {
  record: RunRecord
  scopeState: RunLogScopeState
  effectiveWorkbench?: WorkbenchId
  reason?: string
}

export interface RunLogQuery {
  /**
   * 工作台私有日志必须同时提供 projectId + workbench。
   * 不提供 workbench 时是总日志聚合，可以跨工作台读取，也可以显式查未分类。
   */
  projectId?: string
  workbench?: WorkbenchId
  scopeState?: RunLogScopeState
  status?: RunRecord['status']
  action?: string
  operationId?: string
  subjectId?: string
  scopeId?: string
  from?: number
  to?: number
  offset?: number
  limit?: number
}

export interface RunLogPage {
  entries: RunLogEntry[]
  /** 过滤后的总数，不受 offset / limit 影响。 */
  total: number
}

export interface RunLogRepository {
  query(filter?: RunLogQuery): Promise<RunLogPage>
}

const PAGE_SIZE = 256
const LEGACY_MISSING_FIELDS = [
  'scopeVersion',
  'workbench',
  'action',
  'subjectId',
  'scopeId',
  'parentRunId',
  'operationId',
] as const

export function createRunLogRepository(storage: StoragePort): RunLogRepository {
  return {
    async query(filter = {}) {
      validateQuery(filter)
      const reader = createRunLogReader(storage)
      const offset = Math.max(0, filter.offset ?? 0)
      const limit = Math.max(0, filter.limit ?? 200)
      let total = 0
      const entries: RunLogEntry[] = []

      for await (const record of readCandidateRecords(storage, filter)) {
        const entry = await reader.resolve(record)
        if (!matchesFilter(entry, filter)) continue
        total += 1
        if (total > offset && entries.length < limit) entries.push(entry)
      }

      return { entries, total }
    },
  }
}

function validateQuery(filter: RunLogQuery): void {
  if (filter.workbench && !filter.projectId) {
    throw new Error('工作台私有日志查询必须同时绑定 projectId + workbench')
  }
  if (filter.workbench && filter.scopeState === 'unclassified') {
    throw new Error('未分类记录只能在总日志聚合查询中读取')
  }
}

async function* readCandidateRecords(
  storage: StoragePort,
  filter: RunLogQuery,
): AsyncGenerator<RunRecord> {
  const storageFilter = candidateStorageFilter(filter)
  const ranges = [
    ...(filter.from !== undefined ? [{ field: 'createdAt', from: filter.from }] : []),
    ...(filter.to !== undefined ? [{ field: 'createdAt', to: filter.to }] : []),
  ]
  const missingFields =
    filter.scopeState === 'legacy' ? [...LEGACY_MISSING_FIELDS] : undefined
  const queryPage = storage.queryPage?.bind(storage)

  if (queryPage) {
    let offset = 0
    while (true) {
      const page = await queryPage('runRecords', storageFilter as never, {
        missingFields,
        ranges,
        orderBy: { field: 'createdAt', direction: 'desc' },
        offset,
        limit: PAGE_SIZE,
      })
      if (page.rows.length === 0) break
      yield* page.rows as unknown as RunRecord[]
      offset += page.rows.length
      if (offset >= page.total) break
    }
    return
  }

  const rows = (await storage.query(
    'runRecords',
    storageFilter as never,
  )) as unknown as RunRecord[]
  const fallback = rows
    .filter((record) =>
      matchesStoragePage(record, storageFilter, missingFields, ranges),
    )
    .sort(compareRecords)
  yield* fallback
}

function candidateStorageFilter(filter: RunLogQuery): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const key of [
    'projectId',
    'status',
    'action',
    'operationId',
    'subjectId',
    'scopeId',
  ] as const) {
    if (filter[key] !== undefined) result[key] = filter[key]
  }
  if (filter.scopeState === 'scoped' && filter.workbench) {
    result.workbench = filter.workbench
  }
  return result
}

function matchesStoragePage(
  record: RunRecord,
  filter: Record<string, unknown>,
  missingFields: readonly string[] | undefined,
  ranges: readonly { field: string; from?: number; to?: number }[],
): boolean {
  const row = record as unknown as Record<string, unknown>
  if (
    !Object.entries(filter).every(
      ([key, value]) => value === undefined || row[key] === value,
    )
  ) {
    return false
  }
  if (missingFields?.some((field) => row[field] !== undefined)) return false
  for (const range of ranges) {
    const value = row[range.field]
    if (typeof value !== 'number') return false
    if (range.from !== undefined && value < range.from) return false
    if (range.to !== undefined && value > range.to) return false
  }
  return true
}

function compareRecords(a: RunRecord, b: RunRecord): number {
  return b.createdAt - a.createdAt || a.id.localeCompare(b.id)
}

function createRunLogReader(storage: StoragePort) {
  const records = new Map<string, RunRecord | null>()
  const projects = new Map<string, Project | null>()
  const resolved = new Map<string, RunLogEntry>()

  const getRecord = async (id: string): Promise<RunRecord | null> => {
    if (records.has(id)) return records.get(id) ?? null
    const rows = (await storage.query('runRecords', { id } as never)) as unknown as
      | RunRecord[]
      | undefined
    const record = rows?.[0] ?? null
    records.set(id, record)
    return record
  }

  const getProject = async (id: string): Promise<Project | null> => {
    if (projects.has(id)) return projects.get(id) ?? null
    const rows = (await storage.query('projects', { id } as never)) as unknown as
      | Project[]
      | undefined
    const project = rows?.[0] ?? null
    projects.set(id, project)
    return project
  }

  const classify = async (record: RunRecord): Promise<RunLogEntry> => {
    const project = await getProject(record.projectId)
    if (!project) {
      return {
        record,
        scopeState: 'unclassified',
        reason: '记录所属项目缺失',
      }
    }
    if (!isWorkbench(project.workbench)) {
      return {
        record,
        scopeState: 'unclassified',
        reason: '记录所属项目的工作台无效',
      }
    }

    if (isScopedRecord(record)) {
      if (project.workbench !== record.workbench) {
        return {
          record,
          scopeState: 'unclassified',
          reason: `记录工作台 ${record.workbench} 与项目 ${project.workbench} 不一致`,
        }
      }
      return {
        record,
        scopeState: 'scoped',
        effectiveWorkbench: record.workbench,
      }
    }

    if (!hasAnyScopeField(record)) {
      return {
        record,
        scopeState: 'legacy',
        effectiveWorkbench: project.workbench,
        reason: '旧记录按项目工作台保守推断',
      }
    }

    return {
      record,
      scopeState: 'unclassified',
      reason: '作用域字段不完整或不合法',
    }
  }

  const resolve = async (
    record: RunRecord,
    stack: readonly string[] = [],
  ): Promise<RunLogEntry> => {
    const cached = resolved.get(record.id)
    if (cached) return cached
    if (stack.includes(record.id)) {
      const cycle: RunLogEntry = {
        record,
        scopeState: 'unclassified',
        reason: 'parentRunId 成环',
      }
      resolved.set(record.id, cycle)
      return cycle
    }

    const own = await classify(record)
    if (own.scopeState === 'unclassified' || !record.parentRunId) {
      resolved.set(record.id, own)
      return own
    }

    const parent = await getRecord(record.parentRunId)
    if (!parent) {
      const missing: RunLogEntry = {
        record,
        scopeState: 'unclassified',
        reason: 'parentRunId 指向的记录不存在',
      }
      resolved.set(record.id, missing)
      return missing
    }
    if (parent.projectId !== record.projectId) {
      const crossProject: RunLogEntry = {
        record,
        scopeState: 'unclassified',
        reason: 'parentRunId 跨项目',
      }
      resolved.set(record.id, crossProject)
      return crossProject
    }

    const parentEntry = await resolve(parent, [...stack, record.id])
    if (parentEntry.scopeState === 'unclassified') {
      const invalidParent: RunLogEntry = {
        record,
        scopeState: 'unclassified',
        reason: '祖先记录作用域无效或未分类',
      }
      resolved.set(record.id, invalidParent)
      return invalidParent
    }
    if (
      own.effectiveWorkbench &&
      parentEntry.effectiveWorkbench &&
      own.effectiveWorkbench !== parentEntry.effectiveWorkbench
    ) {
      const crossWorkbench: RunLogEntry = {
        record,
        scopeState: 'unclassified',
        reason: 'parentRunId 跨工作台',
      }
      resolved.set(record.id, crossWorkbench)
      return crossWorkbench
    }

    resolved.set(record.id, own)
    return own
  }

  return { resolve }
}

function isScopedRecord(
  record: RunRecord,
): record is RunRecord & {
  scopeVersion: 1
  workbench: WorkbenchId
  subjectId: string
  scopeId: string
  operationId: string
} {
  return (
    record.scopeVersion === 1 &&
    isWorkbench(record.workbench) &&
    nonEmpty(record.subjectId) &&
    nonEmpty(record.scopeId) &&
    nonEmpty(record.operationId) &&
    (record.action === undefined || nonEmpty(record.action)) &&
    (record.parentRunId === undefined || nonEmpty(record.parentRunId))
  )
}

function hasAnyScopeField(record: RunRecord): boolean {
  return (
    record.scopeVersion !== undefined ||
    record.workbench !== undefined ||
    record.action !== undefined ||
    record.subjectId !== undefined ||
    record.scopeId !== undefined ||
    record.parentRunId !== undefined ||
    record.operationId !== undefined
  )
}

function matchesFilter(entry: RunLogEntry, filter: RunLogQuery): boolean {
  const { record } = entry
  if (filter.projectId && record.projectId !== filter.projectId) return false
  if (filter.workbench) {
    if (entry.scopeState === 'unclassified') return false
    if (entry.effectiveWorkbench !== filter.workbench) return false
  }
  if (filter.scopeState && entry.scopeState !== filter.scopeState) return false
  if (filter.status && record.status !== filter.status) return false
  if (filter.action && record.action !== filter.action) return false
  if (filter.operationId && record.operationId !== filter.operationId) return false
  if (filter.subjectId && record.subjectId !== filter.subjectId) return false
  if (filter.scopeId && record.scopeId !== filter.scopeId) return false
  if (filter.from !== undefined && record.createdAt < filter.from) return false
  if (filter.to !== undefined && record.createdAt > filter.to) return false
  return true
}

function isWorkbench(value: unknown): value is WorkbenchId {
  return value === 'canvas' || value === 'ecommerce' || value === 'storyboard'
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
