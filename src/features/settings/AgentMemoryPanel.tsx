import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  normalizeContextMemoryKind,
  type ContextMemory,
  type ContextMemoryKind,
} from '../../domain/shared/context'
import { WORKBENCHES, type WorkbenchId } from '../../domain/shared/workbench'
import { createContextRepository } from '../../state/shared/contextRepository'
import { MemoryGraph } from './MemoryGraph'
import styles from './AgentMemoryPanel.module.css'

const MEMORY_KINDS: { value: ContextMemoryKind; label: string }[] = [
  { value: 'preference', label: '偏好' },
  { value: 'fact', label: '事实' },
  { value: 'constraint', label: '硬约束' },
  { value: 'decision', label: '已确认决定' },
]

type MemoryScope = 'all' | WorkbenchId

export function AgentMemoryPanel() {
  const platform = usePlatform()
  const repo = useMemo(() => createContextRepository(platform.storage), [platform])
  const [memories, setMemories] = useState<ContextMemory[]>([])
  const [text, setText] = useState('')
  const [kind, setKind] = useState<ContextMemoryKind>('preference')
  const [scope, setScope] = useState<MemoryScope>('all')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingText, setEditingText] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  const refresh = async () => setMemories(await repo.listMemories())
  useEffect(() => {
    void refresh()
  }, [repo])

  const add = async () => {
    const value = text.trim()
    if (!value || busy) return
    setBusy(true)
    setStatus('')
    try {
      await repo.createMemory({
        kind,
        text: value,
        ...(scope === 'all' ? {} : { workbench: scope }),
      })
      setText('')
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

  return (
    <div className={styles.panel} data-agent-memory-panel>
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
            <button
              type="button"
              className={scope === 'all' ? styles.choiceOn : styles.choice}
              aria-pressed={scope === 'all'}
              onClick={() => setScope('all')}
            >
              全部工作台
            </button>
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
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.primary}
            disabled={!text.trim() || busy}
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
                  <span className={styles.scope}>
                    {memory.workbench
                      ? WORKBENCHES[memory.workbench].label
                      : '全部工作台'}
                  </span>
                  <span className={styles.revision}>修订 {memory.currentRevision}</span>
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
                        onClick={() => void remove(memory)}
                      >
                        删除
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
