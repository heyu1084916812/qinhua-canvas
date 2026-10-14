import { useMemo, useState } from 'react'
import type { InspirationMediaKind } from '../../domain/inspiration/sources'
import type { StoredInspirationSource } from '../../state/project/inspirationSourceStore'
import styles from './InspirationPage.module.css'

export interface NewInspirationSourceInput {
  name: string
  repo: string
  modelCategory: string
  kind: InspirationMediaKind
}

function formatSyncedAt(value: number | undefined): string {
  if (!value) return '尚未同步'
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export function InspirationSourcesPanel({
  sources,
  counts,
  refreshingIds,
  onClose,
  onAdd,
  onDelete,
  onToggle,
  onMove,
  onRefresh,
}: {
  sources: readonly StoredInspirationSource[]
  counts: ReadonlyMap<string, number>
  refreshingIds: ReadonlySet<string>
  onClose: () => void
  onAdd: (input: NewInspirationSourceInput) => boolean
  onDelete: (id: string) => void
  onToggle: (id: string, enabled: boolean) => void
  onMove: (id: string, delta: -1 | 1) => void
  onRefresh: (id: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [repo, setRepo] = useState('')
  const [modelCategory, setModelCategory] = useState('')
  const [kind, setKind] = useState<InspirationMediaKind>('image')
  const [formError, setFormError] = useState('')

  const modelOptions = useMemo(
    () => [...new Set(sources.map((source) => source.modelCategory).filter(Boolean))],
    [sources],
  )

  const submit = () => {
    const ok = onAdd({ name, repo, modelCategory, kind })
    if (!ok) {
      setFormError('请填名称、GitHub 仓库和模型分类；仓库格式如 owner/repo')
      return
    }
    setAdding(false)
    setFormError('')
    setName('')
    setRepo('')
    setModelCategory('')
    setKind('image')
  }

  return (
    <div
      className={styles.sourceScrim}
      data-inspiration-sources-panel
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className={styles.sourcePanel} role="dialog" aria-modal="true" aria-label="管理来源">
        <header className={styles.sourceHead}>
          <div>
            <h2 className={styles.sourceTitle}>管理来源</h2>
            <p className={styles.sourceSub}>选择想浏览的来源。同步失败会保留上次内容，关闭来源不会删除收藏。</p>
          </div>
          <div className={styles.sourceHeadActions}>
            <button
              type="button"
              className={styles.sourcePrimary}
              data-inspiration-source-add-toggle
              onClick={() => {
                setAdding((value) => !value)
                setFormError('')
              }}
            >
              {adding ? '取消添加' : '＋ 添加来源'}
            </button>
            <button
              type="button"
              className={styles.sourceClose}
              data-inspiration-sources-close
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        </header>

        {adding && (
          <div className={styles.sourceForm} data-inspiration-source-form>
            <label>
              <span>名称</span>
              <input
                value={name}
                data-inspiration-source-form-name
                placeholder="例如：我的 GPT Image 提示词库"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className={styles.sourceFormRepo}>
              <span>GitHub 仓库</span>
              <input
                value={repo}
                data-inspiration-source-form-repo
                placeholder="owner/repo 或 https://github.com/owner/repo"
                onChange={(event) => setRepo(event.target.value)}
              />
            </label>
            <label>
              <span>模型</span>
              <input
                value={modelCategory}
                list="inspiration-model-categories"
                data-inspiration-source-form-model
                placeholder="例如 GPT Image"
                onChange={(event) => setModelCategory(event.target.value)}
              />
              <datalist id="inspiration-model-categories">
                {modelOptions.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
            </label>
            <label>
              <span>类型</span>
              <select
                value={kind}
                data-inspiration-source-form-kind
                onChange={(event) => setKind(event.target.value === 'video' ? 'video' : 'image')}
              >
                <option value="image">图片</option>
                <option value="video">视频</option>
              </select>
            </label>
            <div className={styles.sourceFormFoot}>
              <p className={styles.sourceFormHint}>自定义仓库支持 README 中以三级标题和代码块组织的提示词。</p>
              <button type="button" className={styles.sourcePrimary} onClick={submit}>
                保存来源
              </button>
            </div>
            {formError && <p className={styles.sourceError}>{formError}</p>}
          </div>
        )}

        <div className={styles.sourceList}>
          {sources.map((source, index) => {
            const refreshing = refreshingIds.has(source.id)
            const confirming = confirmId === source.id
            return (
              <article
                key={source.id}
                className={source.enabled ? styles.sourceRow : `${styles.sourceRow} ${styles.sourceRowOff}`}
                data-inspiration-source-row={source.id}
              >
                <div className={styles.sourceOrder}>
                  <button
                    type="button"
                    aria-label="上移"
                    title="上移"
                    disabled={index === 0}
                    onClick={() => onMove(source.id, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label="下移"
                    title="下移"
                    disabled={index === sources.length - 1}
                    onClick={() => onMove(source.id, 1)}
                  >
                    ↓
                  </button>
                </div>
                <div className={styles.sourceInfo}>
                  <h3>{source.name}</h3>
                  <a href={source.repo} target="_blank" rel="noreferrer">
                    {source.repo.replace(/^https?:\/\//, '')}
                  </a>
                  <p>
                    {source.modelCategory} · {source.kind === 'video' ? '视频' : '图片'} ·{' '}
                    {counts.get(source.id) ?? 0} 条 · 同步于 {formatSyncedAt(source.syncedAt)}
                  </p>
                </div>
                <div className={styles.sourceActions}>
                  <button
                    type="button"
                    data-inspiration-source-refresh={source.id}
                    disabled={refreshing}
                    title="刷新来源"
                    onClick={() => onRefresh(source.id)}
                  >
                    {refreshing ? '…' : '↻'}
                  </button>
                  <button
                    type="button"
                    data-inspiration-source-toggle={source.id}
                    aria-pressed={source.enabled}
                    title={source.enabled ? '关闭来源' : '启用来源'}
                    onClick={() => onToggle(source.id, !source.enabled)}
                  >
                    {source.enabled ? '已启用' : '已关闭'}
                  </button>
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        className={styles.sourceDanger}
                        data-inspiration-source-delete-confirm={source.id}
                        onClick={() => {
                          onDelete(source.id)
                          setConfirmId(null)
                        }}
                      >
                        确认删除
                      </button>
                      <button type="button" onClick={() => setConfirmId(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className={styles.sourceDanger}
                      data-inspiration-source-delete={source.id}
                      title="删除来源"
                      onClick={() => setConfirmId(source.id)}
                    >
                      删除
                    </button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
