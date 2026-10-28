import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import type { AgentDeliveryMode } from '../../domain/agent/delivery'
import {
  contextMemoryScopeOf,
  normalizeContextMemoryKind,
  type ContextMemory,
  type ContextMemoryKind,
} from '../../domain/shared/context'
import { WORKBENCHES, type WorkbenchId } from '../../domain/shared/workbench'
import { activeWorkbenchId } from '../../state/project/activeCanvas'
import { createPresetStore } from '../../state/project/presetStore'
import { createContextRepository } from '../../state/shared/contextRepository'
import {
  getAgentDeliveryMode,
  setAgentDeliveryMode,
  subscribeAgentDeliveryMode,
} from '../../state/ui/agentDelivery'
import { ChoicePicker } from '../shared/choicePicker/ChoicePicker'
import { MemoryGraph } from './MemoryGraph'
import styles from './AgentMemoryPanel.module.css'

const MEMORY_KINDS: { value: ContextMemoryKind; label: string }[] = [
  { value: 'preference', label: '偏好' },
  { value: 'fact', label: '事实' },
  { value: 'constraint', label: '硬约束' },
  { value: 'decision', label: '已确认决定' },
]

type MemoryScope = 'all' | WorkbenchId
type MemoryScopeMode = 'global' | 'workbench' | 'project' | 'session'

interface ProjectOption {
  id: string
  name: string
}

interface SessionOption {
  id: string
  projectId: string
  title: string
}

const SCOPE_MODES: { value: MemoryScopeMode; label: string }[] = [
  { value: 'global', label: '全部工作台' },
  { value: 'workbench', label: '工作台' },
  { value: 'project', label: '项目' },
  { value: 'session', label: '会话' },
]

const EXPIRY_OPTIONS = [
  { value: '', label: '长期有效' },
  { value: '7', label: '7 天' },
  { value: '30', label: '30 天' },
  { value: '90', label: '90 天' },
]

function scopeLabel(
  memory: ContextMemory,
  projects: readonly ProjectOption[],
  sessions: readonly SessionOption[],
): string {
  const scope = contextMemoryScopeOf(memory)
  if (scope === 'workbench') {
    return memory.workbench ? WORKBENCHES[memory.workbench].label : '工作台'
  }
  if (scope === 'project') {
    return `项目 · ${projects.find((project) => project.id === memory.projectId)?.name ?? memory.projectId ?? '未知'}`
  }
  if (scope === 'session') {
    return `会话 · ${sessions.find((session) => session.id === memory.sessionId)?.title ?? memory.sessionId ?? '未知'}`
  }
  return '全部工作台'
}

export function AgentMemoryPanel() {
  const platform = usePlatform()
  const repo = useMemo(() => createContextRepository(platform.storage), [platform])
  const presets = useMemo(() => createPresetStore(platform.storage), [platform])
  const deliveryMode = useSyncExternalStore(
    subscribeAgentDeliveryMode,
    getAgentDeliveryMode,
    getAgentDeliveryMode,
  )
  const [memories, setMemories] = useState<ContextMemory[]>([])
  const [text, setText] = useState('')
  const [kind, setKind] = useState<ContextMemoryKind>('preference')
  const [scope, setScope] = useState<MemoryScope>('all')
  const [scopeMode, setScopeMode] = useState<MemoryScopeMode>('global')
  const [projectId, setProjectId] = useState('')
  const [sessionId, setSessionId] = useState('')
  const [memoryKey, setMemoryKey] = useState('')
  const [expiryDays, setExpiryDays] = useState('')
  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [sessions, setSessions] = useState<SessionOption[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [deliveryStatus, setDeliveryStatus] = useState('')

  const refresh = async () => {
    await repo.purgeExpiredMemories()
    setMemories(await repo.listMemories())
  }
  useEffect(() => {
    void refresh()
  }, [repo])

  useEffect(() => {
    let alive = true
    void presets
      .loadAgentDeliveryMode()
      .then((mode) => {
        if (alive) setAgentDeliveryMode(mode)
      })
      .catch(() => {
        if (alive) setDeliveryStatus('读取失败，暂时使用“引导”')
      })
    return () => {
      alive = false
    }
  }, [presets])

  useEffect(() => {
    let alive = true
    void Promise.all([
      platform.storage.query('projects', {}),
      platform.storage.query('agentSessions', {}),
    ])
      .then(([projectRows, sessionRows]) => {
        if (!alive) return
        const nextProjects = projectRows
          .filter((row) => !row.deletedAt)
          .map((row) => ({
            id: String(row.id),
            name: String(row.name ?? '').trim() || '未命名项目',
          }))
          .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
        const nextSessions = sessionRows
          .map((row) => ({
            id: String(row.id),
            projectId: String(row.projectId ?? ''),
            title: String(row.title ?? '').trim() || '未命名会话',
          }))
          .filter((row) => row.projectId)
          .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
        setProjects(nextProjects)
        setSessions(nextSessions)
        const activeProject =
          activeWorkbenchId('canvas') ??
          activeWorkbenchId('ecommerce') ??
          activeWorkbenchId('storyboard')
        setProjectId(
          (current) =>
            current ||
            (activeProject && nextProjects.some((project) => project.id === activeProject)
              ? activeProject
              : nextProjects[0]?.id ?? ''),
        )
      })
      .catch((error) => {
        if (alive) {
          setStatus(error instanceof Error ? error.message : '项目或会话读取失败')
        }
      })
    return () => {
      alive = false
    }
  }, [platform])

  const projectSessions = useMemo(
    () => sessions.filter((item) => item.projectId === projectId),
    [projectId, sessions],
  )

  useEffect(() => {
    if (scopeMode !== 'session') return
    setSessionId((current) =>
      projectSessions.some((item) => item.id === current)
        ? current
        : projectSessions[0]?.id ?? '',
    )
  }, [projectSessions, scopeMode])

  const add = async () => {
    const value = text.trim()
    if (!value || busy) return
    if (scopeMode === 'workbench' && scope === 'all') return
    if ((scopeMode === 'project' || scopeMode === 'session') && !projectId) return
    if (scopeMode === 'session' && !sessionId) return
    setBusy(true)
    setStatus('')
    try {
      await repo.createMemory({
        kind,
        text: value,
        scope: scopeMode,
        ...(scopeMode === 'workbench' && scope !== 'all' ? { workbench: scope } : {}),
        ...(scopeMode === 'project' || scopeMode === 'session' ? { projectId } : {}),
        ...(scopeMode === 'session' ? { sessionId } : {}),
        ...(memoryKey.trim() ? { key: memoryKey.trim() } : {}),
        ...(expiryDays
          ? { expiresAt: Date.now() + Number(expiryDays) * 86_400_000 }
          : {}),
        source: 'user',
        confidence: 1,
      })
      setText('')
      setMemoryKey('')
      await refresh()
      setStatus('记忆已保存')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '记忆保存失败')
    } finally {
      setBusy(false)
    }
  }

  const beginEdit = (memory: ContextMemory) => {
    setEditingId(memory.id)
    setEditingText(memory.text)
    setStatus('')
  }

  const saveEdit = async (memory: ContextMemory) => {
    const value = editingText.trim()
    if (!value || busy) return
    setBusy(true)
    try {
      await repo.updateMemory(memory.id, { text: value })
      setEditingId(null)
      setEditingText('')
      await refresh()
      setStatus('记忆已更新')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '更新失败')
    } finally {
      setBusy(false)
    }
  }

  const toggle = async (memory: ContextMemory) => {
    setBusy(true)
    try {
      await repo.setMemoryEnabled(memory.id, !memory.enabled)
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const remove = async (memory: ContextMemory) => {
    setBusy(true)
    try {
      await repo.removeMemory(memory.id)
      if (editingId === memory.id) setEditingId(null)
      await refresh()
      setStatus('记忆已删除')
    } finally {
      setBusy(false)
    }
  }

  const targetReady =
    scopeMode === 'global' ||
    (scopeMode === 'workbench' && scope !== 'all') ||
    (scopeMode === 'project' && Boolean(projectId)) ||
    (scopeMode === 'session' && Boolean(projectId) && Boolean(sessionId))

  const chooseDeliveryMode = async (mode: AgentDeliveryMode) => {
    setAgentDeliveryMode(mode)
    setDeliveryStatus('')
    try {
      await presets.saveAgentDeliveryMode(mode)
    } catch {
      setDeliveryStatus('保存失败，本次运行仍按当前选择')
    }
  }

  return (
    <div className={styles.panel} data-agent-memory-panel>
      <section className={styles.section} data-agent-behavior>
        <div className={styles.sectionHead}>
          <h3>运行中的消息</h3>
          <p>Agent 正在工作时，新消息默认立即引导当前任务。</p>
        </div>
        <div className={styles.choiceRow}>
          <span className={styles.choiceLabel}>发送方式</span>
          <div className={styles.segmented}>
            {([
              { value: 'steer', label: '引导' },
              { value: 'queue', label: '排队' },
            ] as const).map((item) => (
              <button
                key={item.value}
                type="button"
                className={deliveryMode === item.value ? styles.choiceOn : styles.choice}
                data-agent-delivery-mode-option={item.value}
                aria-pressed={deliveryMode === item.value}
                onClick={() => void chooseDeliveryMode(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <p className={styles.behaviorHint}>
          引导会立即调整当前任务；排队会等当前回合结束后再发送。按 Ctrl/Cmd+Enter
          可临时切换一次。
        </p>
        {deliveryStatus ? (
          <span className={styles.status} role="status">
            {deliveryStatus}
          </span>
        ) : null}
      </section>
      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3>新增记忆</h3>
          <p>只记录你确认过的稳定偏好、事实和硬约束；一次性要求不会自动写进这里。</p>
        </div>
        <textarea
          className={styles.textarea}
          value={text}
          placeholder="例如：我偏好留白充足、低饱和度的商业视觉；品牌主色不要使用霓虹色。"
          data-agent-memory-input
          onChange={(event) => setText(event.target.value)}
        />
        <div className={styles.choiceRow}>
          <span className={styles.choiceLabel}>类型</span>
          <div className={styles.segmented}>
            {MEMORY_KINDS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={kind === item.value ? styles.choiceOn : styles.choice}
                data-agent-memory-kind={item.value}
                aria-pressed={kind === item.value}
                onClick={() => setKind(normalizeContextMemoryKind(item.value))}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.choiceRow}>
          <span className={styles.choiceLabel}>作用范围</span>
          <div className={styles.segmented}>
            {SCOPE_MODES.map((item) => (
              <button
                key={item.value}
                type="button"
                className={scopeMode === item.value ? styles.choiceOn : styles.choice}
                data-agent-memory-scope={item.value}
                aria-pressed={scopeMode === item.value}
                onClick={() => setScopeMode(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        {scopeMode === 'workbench' ? (
          <div className={styles.choiceRow}>
            <span className={styles.choiceLabel}>工作台</span>
            <div className={styles.segmented}>
              {(Object.keys(WORKBENCHES) as WorkbenchId[]).map((id) => (
                <button
                  key={id}
                  type="button"
                  className={scope === id ? styles.choiceOn : styles.choice}
                  aria-pressed={scope === id}
                  onClick={() => setScope(id)}
                >
                  {WORKBENCHES[id].label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {scopeMode === 'project' || scopeMode === 'session' ? (
          <div className={styles.fieldRow}>
            <span className={styles.choiceLabel}>项目</span>
            <ChoicePicker
              name="agent-memory-project"
              className={styles.fieldControl}
              value={projectId}
              onChange={(next) => {
                setProjectId(next)
                setSessionId('')
              }}
              options={projects.map((project) => ({
                value: project.id,
                label: project.name,
              }))}
              placeholder={projects.length ? '选择项目' : '还没有项目'}
              ariaLabel="记忆所属项目"
            />
          </div>
        ) : null}
        {scopeMode === 'session' ? (
          <div className={styles.fieldRow}>
            <span className={styles.choiceLabel}>会话</span>
            <ChoicePicker
              name="agent-memory-session"
              className={styles.fieldControl}
              value={sessionId}
              onChange={setSessionId}
              options={projectSessions.map((session) => ({
                value: session.id,
                label: session.title,
              }))}
              placeholder={projectSessions.length ? '选择会话' : '该项目还没有会话'}
              ariaLabel="记忆所属会话"
            />
          </div>
        ) : null}
        <div className={styles.fieldRow}>
          <span className={styles.choiceLabel}>主题</span>
          <input
            className={styles.fieldInput}
            value={memoryKey}
            placeholder="可选，如 brand.primaryColor"
            data-agent-memory-key
            onChange={(event) => setMemoryKey(event.target.value)}
          />
        </div>
        <div className={styles.fieldRow}>
          <span className={styles.choiceLabel}>有效期</span>
          <ChoicePicker
            name="agent-memory-expiry"
            className={styles.fieldControl}
            value={expiryDays}
            onChange={setExpiryDays}
            options={EXPIRY_OPTIONS}
            placeholder="长期有效"
            ariaLabel="记忆有效期"
          />
        </div>
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={!text.trim() || !targetReady || busy}
            data-agent-memory-add
            onClick={() => void add()}
          >
            保存记忆
          </button>
          {status ? (
            <span className={styles.status} role={status.includes('失败') ? 'alert' : undefined}>
              {status}
            </span>
          ) : null}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3>关系图谱</h3>
          <p>按偏好、事实、硬约束和已确认决定建立关系；停用记忆会变淡。</p>
        </div>
        <MemoryGraph memories={memories} />
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHead}>
          <h3>已保存的记忆</h3>
          <p>{memories.length} 条；停用后不会进入任何工作台的上下文。</p>
        </div>
        {memories.length === 0 ? (
          <div className={styles.empty}>还没有记忆。Agent 不会凭空猜你的长期偏好。</div>
        ) : (
          <div className={styles.list}>
            {memories.map((memory) => (
              <article
                key={memory.id}
                className={styles.item}
                data-agent-memory-item={memory.id}
                data-agent-memory-enabled={memory.enabled ? 'true' : 'false'}
              >
                <div className={styles.itemTop}>
                  <span className={styles.badge}>
                    {MEMORY_KINDS.find((item) => item.value === memory.kind)?.label ??
                      memory.kind}
                  </span>
                  <span className={styles.scope}>{scopeLabel(memory, projects, sessions)}</span>
                  <span className={styles.source}>
                    {memory.source === 'agent' ? 'Agent 提议' : '手动保存'}
                  </span>
                  {memory.key ? <span className={styles.key}>{memory.key}</span> : null}
                  <span className={styles.revision}>修订 {memory.currentRevision}</span>
                  {memory.expiresAt ? (
                    <span className={styles.revision}>
                      有效至 {new Date(memory.expiresAt).toLocaleDateString('zh-CN')}
                    </span>
                  ) : null}
                  <label className={styles.toggle}>
                    <input
                      type="checkbox"
                      checked={memory.enabled}
                      disabled={busy}
                      onChange={() => void toggle(memory)}
                    />
                    启用
                  </label>
                </div>
                {editingId === memory.id ? (
                  <>
                    <textarea
                      className={styles.textarea}
                      value={editingText}
                      onChange={(event) => setEditingText(event.target.value)}
                    />
                    <div className={styles.itemActions}>
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={!editingText.trim() || busy}
                        onClick={() => void saveEdit(memory)}
                      >
                        保存
                      </button>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => setEditingId(null)}
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className={styles.itemText}>{memory.text}</p>
                    <div className={styles.itemActions}>
                      <button
                        type="button"
                        className={styles.secondary}
                        onClick={() => beginEdit(memory)}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        className={styles.danger}
                        disabled={busy}
                        title="删除这条记忆，之后不会再进入 Agent 上下文"
                        onClick={() => void remove(memory)}
                      >
                        忘记
                      </button>
                    </div>
                  </>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
