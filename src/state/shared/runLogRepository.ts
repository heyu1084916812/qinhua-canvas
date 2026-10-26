import type { RunRecord } from '../../domain/shared/execution/runRecord'
import type { WorkbenchId } from '../../domain/shared/workbench'
import type { StoragePort } from '../../platform/ports'
import type { Project } from '../../domain/project/project'

export type RunLogScopeState = 'scoped' | 'legacy' | 'unclassified'

export interface RunLogEntry {
  record: RunRecord
  scopeState: RunLogScopeState
  effectiveWorkbench?: WorkbenchId
  reason?: string
}

export interface RunLogQuery {
  projectId?: string
  workbench?: WorkbenchId
  status?: RunRecord['status']
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

const WORKBENCHES: readonly WorkbenchId[] = ['canvas', 'ecommerce', 'storyboard']

export function createRunLogRepository(storage: StoragePort): RunLogRepository {
  return {
    async query(filter = {}) {
      const [runRows, projectRows] = await Promise.all([
        filter.projectId
          ? storage.query('runRecords', { projectId: filter.projectId })
          : storage.query('runRecords', {}),
        filter.projectId
          ? storage.query('projects', { id: filter.projectId })
          : storage.query('projects', {}),
      ])
      const projectWorkbench = new Map<string, WorkbenchId>(
        (projectRows as unknown as Project[]).map((project) => [
          project.id,
          project.workbench,
        ]),
      )

      const records = runRows as unknown as RunRecord[]
      const recordById = new Map(records.map((record) => [record.id, record]))
      const entries = records
        .map((record) => classifyRecord(record, projectWorkbench))
        .map((entry) => validateParent(entry, recordById))
        .filter((entry) => matchesFilter(entry, filter))
        .sort(compareEntries)
      const offset = Math.max(0, filter.offset ?? 0)
      const limit = Math.max(0, filter.limit ?? 200)
      return {
        entries: entries.slice(offset, offset + limit),
        total: entries.length,
      }
    },
  }
}

function classifyRecord(
  record: RunRecord,
  projectWorkbench: ReadonlyMap<string, WorkbenchId>,
): RunLogEntry {
  const project = projectWorkbench.get(record.projectId)
  if (isScopedRecord(record)) {
    if (project && project !== record.workbench) {
      return {
        record,
        scopeState: 'unclassified',
        reason: `记录工作台 ${record.workbench} 与项目 ${project} 不一致`,
      }
    }
    return {
      record,
      scopeState: 'scoped',
      effectiveWorkbench: record.workbench,
    }
  }

  const hasAnyScopeField =
    record.scopeVersion !== undefined ||
    record.workbench !== undefined ||
    record.subjectId !== undefined ||
    record.scopeId !== undefined ||
    record.parentRunId !== undefined ||
    record.operationId !== undefined
  if (!hasAnyScopeField && project) {
    return {
      record,
      scopeState: 'legacy',
      effectiveWorkbench: project,
      reason: '旧记录按项目工作台保守推断',
    }
  }

  return {
    record,
    scopeState: 'unclassified',
    reason: hasAnyScopeField ? '作用域字段不完整或不合法' : '缺少可证明的工作台归属',
  }
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
    (record.parentRunId === undefined || nonEmpty(record.parentRunId))
  )
}

function matchesFilter(entry: RunLogEntry, filter: RunLogQuery): boolean {
  const { record } = entry
  if (filter.projectId && record.projectId !== filter.projectId) return false
  if (filter.workbench) {
    if (entry.scopeState === 'unclassified') return false
    if (entry.effectiveWorkbench !== filter.workbench) return false
  }
  if (filter.status && record.status !== filter.status) return false
  if (filter.subjectId && record.subjectId !== filter.subjectId) return false
  if (filter.scopeId && record.scopeId !== filter.scopeId) return false
  if (filter.from !== undefined && record.createdAt < filter.from) return false
  if (filter.to !== undefined && record.createdAt > filter.to) return false
  return true
}

function compareEntries(a: RunLogEntry, b: RunLogEntry): number {
  return (
    b.record.createdAt - a.record.createdAt ||
    a.record.id.localeCompare(b.record.id)
  )
}

function validateParent(
  entry: RunLogEntry,
  recordById: ReadonlyMap<string, RunRecord>,
): RunLogEntry {
  const parentId = entry.record.parentRunId
  if (!parentId) return entry
  const parent = recordById.get(parentId)
  if (!parent || parent.projectId !== entry.record.projectId) {
    return {
      record: entry.record,
      scopeState: 'unclassified',
      reason: 'parentRunId 不存在或跨项目',
    }
  }
  const seen = new Set<string>([entry.record.id])
  let current: RunRecord | undefined = parent
  while (current?.parentRunId) {
    if (seen.has(current.id) || current.id === entry.record.id) {
      return {
        record: entry.record,
        scopeState: 'unclassified',
        reason: 'parentRunId 成环',
      }
    }
    seen.add(current.id)
    current = recordById.get(current.parentRunId)
  }
  return entry
}

function isWorkbench(value: unknown): value is WorkbenchId {
  return typeof value === 'string' && WORKBENCHES.includes(value as WorkbenchId)
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}
