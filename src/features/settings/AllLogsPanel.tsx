import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { RunRecord } from '../../domain/shared/execution/runRecord'
import type { WorkbenchId } from '../../domain/shared/workbench'
import { ChoicePicker } from '../shared/choicePicker/ChoicePicker'
import { RunLogList } from '../shared/execution/RunLogList'
import type {
  RunLogQuery,
  RunLogScopeState,
} from '../../state/shared/runLogRepository'
import styles from './AllLogsPanel.module.css'

interface ProjectOption {
  id: string
  name: string
}

const WORKBENCH_OPTIONS: { value: '' | WorkbenchId; label: string }[] = [
  { value: '', label: '全部工作台' },
  { value: 'canvas', label: '无限画布' },
  { value: 'ecommerce', label: '电商' },
  { value: 'storyboard', label: '漫剧' },
]

const STATUS_OPTIONS: { value: '' | RunRecord['status']; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'succeeded', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'canceled', label: '已取消' },
  { value: 'interrupted', label: '已中断' },
]

const SCOPE_OPTIONS: { value: '' | RunLogScopeState; label: string }[] = [
  { value: '', label: '全部来源' },
  { value: 'scoped', label: '新记录' },
  { value: 'legacy', label: '旧记录' },
  { value: 'unclassified', label: '未分类' },
]

export function AllLogsPanel() {
  const platform = usePlatform()
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [projectId, setProjectId] = useState('')
  const [workbench, setWorkbench] = useState<'' | WorkbenchId>('')
  const [status, setStatus] = useState<'' | RunRecord['status']>('')
  const [scopeState, setScopeState] = useState<'' | RunLogScopeState>('')

  useEffect(() => {
    let alive = true
    void platform.storage
      .query('projects', {})
      .then((rows) => {
        if (!alive) return
        setProjects(
          rows
            .filter((row) => !row.deletedAt)
            .map((row) => ({
              id: String(row.id),
              name: String(row.name ?? '').trim() || '未命名项目',
            }))
            .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')),
        )
      })
      .catch(() => {
        if (alive) setProjects([])
      })
    return () => {
      alive = false
    }
  }, [platform])

  const filter = useMemo<Omit<RunLogQuery, 'offset' | 'limit'>>(
    () => ({
      aggregate: true,
      ...(projectId ? { projectId } : {}),
      ...(workbench ? { workbench } : {}),
      ...(status ? { status } : {}),
      ...(scopeState ? { scopeState } : {}),
    }),
    [projectId, scopeState, status, workbench],
  )

  return (
    <div className={styles.panel} data-all-logs>
      <section className={styles.filters} aria-label="总日志筛选">
        <ChoicePicker
          name="all-logs-project"
          value={projectId}
          onChange={setProjectId}
          options={[
            { value: '', label: '全部项目' },
            ...projects.map((project) => ({ value: project.id, label: project.name })),
          ]}
          placeholder="全部项目"
          ariaLabel="按项目筛选"
          className={styles.picker}
        />
        <ChoicePicker
          name="all-logs-workbench"
          value={workbench}
          onChange={(value) => setWorkbench(value as '' | WorkbenchId)}
          options={WORKBENCH_OPTIONS}
          placeholder="全部工作台"
          ariaLabel="按工作台筛选"
          className={styles.picker}
        />
        <ChoicePicker
          name="all-logs-status"
          value={status}
          onChange={(value) => setStatus(value as '' | RunRecord['status'])}
          options={STATUS_OPTIONS}
          placeholder="全部状态"
          ariaLabel="按状态筛选"
          className={styles.picker}
        />
        <ChoicePicker
          name="all-logs-scope"
          value={scopeState}
          onChange={(value) => setScopeState(value as '' | RunLogScopeState)}
          options={SCOPE_OPTIONS}
          placeholder="全部来源"
          ariaLabel="按作用域分类筛选"
          className={styles.picker}
        />
      </section>
      <RunLogList
        filter={filter}
        pageSize={50}
        emptyText="当前筛选下没有运行记录"
      />
    </div>
  )
}
