import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository } from '../../state/project/repository'
import { createStoryboardStore } from '../../state/project/storyboardStore'
import { projectRoute } from '../../domain/shared/workbench'
import {
  addEpisode,
  addShot,
  exportStoryboardMarkdown,
  moveEpisode,
  moveShot,
  removeEpisode,
  removeShot,
  shotsOf,
  storyboardStats,
  updateEpisode,
  updateScript,
  updateShot,
  type StoryboardDoc,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import styles from './StoryboardPage.module.css'

/**
 * 漫剧工作台页（对账 #382，第一阶段）。
 *
 * 这一页只做**视频前段**：剧本 → 分集 → 分镜，出得去一份分镜表（Markdown）。
 * 逐镜视频 / 配音 / 成片合成**不在这一阶段** —— 调研稿 §4.4 的结论是：
 * 视频参数表还没补齐（#120），现在接视频只会做出一个"看着全流程、实际跑不通"的壳。
 *
 * 为什么这一页不挂画布 store：分镜不是节点图。形态若被用起来（用户真的按这个流程干活），
 * 再决定要不要把镜头接进画布出图；现在接就是替用户决定他的工作流。
 */

/** 防抖窗口：连打一串字只落一次库（与外观偏好同一条口径） */
const SAVE_DEBOUNCE_MS = 400

export function StoryboardPage() {
  const { projectId } = useParams<{ projectId?: string }>()
  if (!projectId) return <StoryboardEmpty />
  return <StoryboardProject key={projectId} projectId={projectId} />
}

/** 没有项目时的引导页：给出口，不空白（与电商工作台同一条口径） */
function StoryboardEmpty() {
  const platform = usePlatform()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const repo = createProjectRepository(platform.storage)
      const project = await repo.create({ name: '漫剧', workbench: 'storyboard' })
      navigate(projectRoute('storyboard', project.id))
    } catch {
      setError('新建项目失败，稍后再试')
      setBusy(false)
    }
  }

  return (
    <div className={styles.emptyWrap} data-storyboard-empty-page>
      <h1 className={styles.emptyTitle}>漫剧工作台</h1>
      <p className={styles.emptyText}>
        先把剧本写下来，再拆成分集与分镜；每一镜的画面与提示词都能直接拿去生图。
        做完导出「分镜表」，可以直接交给后面的人和工具。
      </p>
      <button
        type="button"
        className={styles.primary}
        disabled={busy}
        data-storyboard-create
        onClick={() => void create()}
      >
        {busy ? '正在新建…' : '新建漫剧项目'}
      </button>
      {error ? <p className={styles.error}>{error}</p> : null}
      <p className={styles.emptyHint}>也可以从「项目」页新建 —— 新建菜单里选「漫剧工作台」。</p>
    </div>
  )
}

function StoryboardProject({ projectId }: { projectId: string }) {
  const platform = usePlatform()
  const store = useMemo(() => createStoryboardStore(platform.storage), [platform])
  const [doc, setDoc] = useState<StoryboardDoc | null>(null)
  const [projectName, setProjectName] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [status, setStatus] = useState('')
  /** 二次确认：'' | `ep:<id>` | `shot:<id>`（删除是不可撤销的，第一下只改文案） */
  const [confirming, setConfirming] = useState('')
  const timer = useRef<number | null>(null)
  const pending = useRef<StoryboardDoc | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await platform.storage.open()
      const [loaded, project] = await Promise.all([
        store.load(projectId),
        createProjectRepository(platform.storage).get(projectId),
      ])
      if (cancelled) return
      setDoc(loaded)
      setProjectName(project?.name ?? '')
      setSelectedId(loaded.episodes[0]?.id ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [platform, projectId, store])

  /** 把还没到防抖时间的写入立刻落库（导出前、离开页面前各冲一次） */
  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
    const next = pending.current
    pending.current = null
    if (!next) return
    await store.save(next)
  }, [store])

  useEffect(
    () => () => {
      void flush()
    },
    [flush],
  )

  const apply = (next: StoryboardDoc) => {
    const stamped = { ...next, updatedAt: Date.now() }
    setDoc(stamped)
    pending.current = stamped
    setStatus('正在保存…')
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      const toSave = pending.current
      pending.current = null
      if (!toSave) return
      void store.save(toSave).then(
        () => setStatus('已保存'),
        () => setStatus('保存失败'),
      )
    }, SAVE_DEBOUNCE_MS)
  }

  if (!doc) {
    return (
      <div className={styles.loading} data-storyboard-loading>
        正在打开漫剧项目…
      </div>
    )
  }

  const stats = storyboardStats(doc)
  const episodes = doc.episodes
  const selected = episodes.find((e) => e.id === selectedId) ?? episodes[0] ?? null
  const shots = selected ? shotsOf(doc, selected.id) : []
  const selectedIndex = selected ? episodes.findIndex((e) => e.id === selected.id) : -1

  const pick = (id: string) => {
    setSelectedId(id)
    setConfirming('')
  }

  const addOneEpisode = () => {
    const next = addEpisode(doc, 0)
    apply(next)
    setSelectedId(next.episodes[next.episodes.length - 1]?.id ?? '')
    setConfirming('')
  }

  const removeOneEpisode = (id: string) => {
    if (confirming !== `ep:${id}`) {
      setConfirming(`ep:${id}`)
      return
    }
    const at = episodes.findIndex((e) => e.id === id)
    const next = removeEpisode(doc, id, 0)
    apply(next)
    setConfirming('')
    if (selected?.id === id) {
      const fallback = next.episodes[Math.min(Math.max(at, 0), next.episodes.length - 1)]
      setSelectedId(fallback?.id ?? '')
    }
  }

  const addOneShot = () => {
    if (!selected) return
    apply(addShot(doc, selected.id, 0))
    setConfirming('')
  }

  const removeOneShot = (id: string) => {
    if (confirming !== `shot:${id}`) {
      setConfirming(`shot:${id}`)
      return
    }
    apply(removeShot(doc, id, 0))
    setConfirming('')
  }

  const patchShot = (id: string, patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId'>>) => {
    apply(updateShot(doc, id, patch))
  }

  const onExport = async () => {
    try {
      await flush()
      const markdown = exportStoryboardMarkdown(doc)
      const base = (doc.script.title.trim() || projectName.trim() || '未命名漫剧').replace(
        /[\\/:*?"<>|]/g,
        '_',
      )
      await platform.files.saveFile(
        `${base}-分镜表.md`,
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      )
      setStatus('已导出分镜表')
    } catch {
      setStatus('导出失败')
    }
  }

  return (
    <div className={styles.page} data-storyboard-page>
      <header className={styles.bar}>
        <div className={styles.titleWrap}>
          <h1 className={styles.title} data-storyboard-title>
            {doc.script.title || '未命名漫剧'}
          </h1>
          <p className={styles.sub}>{projectName || '漫剧项目'}</p>
        </div>
        <p className={styles.stats} data-storyboard-stats>
          {stats.episodes} 集 · {stats.shots} 镜 · 粗排 {stats.durationSec} 秒
        </p>
        <span className={styles.status} role="status" data-storyboard-status>
          {status}
        </span>
        <button type="button" className={styles.primary} data-storyboard-export onClick={() => void onExport()}>
          导出分镜表
        </button>
      </header>

      <div className={styles.body}>
        <section className={styles.left} aria-label="剧本与分集">
          <div className={styles.block}>
            <h2 className={styles.blockTitle}>剧本</h2>
            <label className={styles.field}>
              <span className={styles.label}>片名</span>
              <input
                className={styles.input}
                value={doc.script.title}
                data-storyboard-script-title
                onChange={(e) => apply(updateScript(doc, { title: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>一句话故事</span>
              <input
                className={styles.input}
                value={doc.script.logline}
                placeholder="一句话说清这个故事"
                data-storyboard-script-logline
                onChange={(e) => apply(updateScript(doc, { logline: e.target.value }))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>正文</span>
              <textarea
                className={styles.textarea}
                rows={9}
                value={doc.script.body}
                placeholder="把故事写下来；分集与分镜从这一段拆"
                data-storyboard-script-body
                onChange={(e) => apply(updateScript(doc, { body: e.target.value }))}
              />
            </label>
          </div>

          <div className={styles.block}>
            <div className={styles.blockHead}>
              <h2 className={styles.blockTitle}>分集</h2>
              <button
                type="button"
                className={styles.ghost}
                data-storyboard-add-episode
                onClick={addOneEpisode}
              >
                新增一集
              </button>
            </div>
            {episodes.length === 0 ? (
              <p className={styles.hint} data-storyboard-episodes-empty>
                还没有分集。先加一集，再把这一集要讲什么写下来。
              </p>
            ) : (
              <ul className={styles.list}>
                {episodes.map((episode, index) => {
                  const on = selected?.id === episode.id
                  const isConfirming = confirming === `ep:${episode.id}`
                  return (
                    <li
                      key={episode.id}
                      className={on ? `${styles.item} ${styles.itemOn}` : styles.item}
                      data-storyboard-episode={episode.id}
                      data-selected={on ? 'true' : 'false'}
                      onClick={() => pick(episode.id)}
                    >
                      <div className={styles.itemMain}>
                        <input
                          className={styles.itemTitle}
                          value={episode.title}
                          aria-label={`第 ${index + 1} 集标题`}
                          data-storyboard-episode-name={episode.id}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) =>
                            apply(updateEpisode(doc, episode.id, { title: e.target.value }))
                          }
                        />
                        <span className={styles.itemMeta}>{shotsOf(doc, episode.id).length} 镜</span>
                      </div>
                      <div className={styles.itemTools}>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label="上移这一集"
                          title="上移"
                          disabled={index === 0}
                          data-storyboard-episode-up={episode.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            apply(moveEpisode(doc, episode.id, -1, 0))
                          }}
                        >
                          <IconUp />
                        </button>
                        <button
                          type="button"
                          className={styles.iconBtn}
                          aria-label="下移这一集"
                          title="下移"
                          disabled={index === episodes.length - 1}
                          data-storyboard-episode-down={episode.id}
                          onClick={(e) => {
                            e.stopPropagation()
                            apply(moveEpisode(doc, episode.id, 1, 0))
                          }}
                        >
                          <IconDown />
                        </button>
                        <button
                          type="button"
                          className={isConfirming ? `${styles.iconBtn} ${styles.iconBtnDanger}` : styles.iconBtn}
                          aria-label={isConfirming ? '再点一次，删除这一集' : '删除这一集'}
                          title={isConfirming ? '再点一次，删除这一集' : '删除'}
                          data-storyboard-episode-remove={episode.id}
                          data-confirming={isConfirming ? 'true' : 'false'}
                          onClick={(e) => {
                            e.stopPropagation()
                            removeOneEpisode(episode.id)
                          }}
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>

        <section className={styles.right} aria-label="这一集的分镜">
          {!selected ? (
            <div className={styles.placeholder} data-storyboard-no-episode>
              <p className={styles.hint}>左边还没有分集。先加一集，这一集的分镜就写在这里。</p>
            </div>
          ) : (
            <>
              <div className={styles.block}>
                <h2 className={styles.blockTitle}>第 {selectedIndex + 1} 集</h2>
                <label className={styles.field}>
                  <span className={styles.label}>这一集的标题</span>
                  <input
                    className={styles.input}
                    value={selected.title}
                    data-storyboard-episode-title={selected.id}
                    onChange={(e) =>
                      apply(updateEpisode(doc, selected.id, { title: e.target.value }))
                    }
                  />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>这一集要讲什么</span>
                  <textarea
                    className={styles.textarea}
                    rows={3}
                    value={selected.summary}
                    placeholder="这一集的起止与转折"
                    data-storyboard-episode-summary={selected.id}
                    onChange={(e) =>
                      apply(updateEpisode(doc, selected.id, { summary: e.target.value }))
                    }
                  />
                </label>
              </div>

              <div className={styles.block}>
                <div className={styles.blockHead}>
                  <h2 className={styles.blockTitle}>分镜</h2>
                  <button
                    type="button"
                    className={styles.ghost}
                    data-storyboard-add-shot
                    onClick={addOneShot}
                  >
                    新增一镜
                  </button>
                </div>
                {shots.length === 0 ? (
                  <p className={styles.hint} data-storyboard-shots-empty>
                    这一集还没有分镜。一镜 = 一个画面 + 一句台词 + 一个时长。
                  </p>
                ) : (
                  <ol className={styles.shots}>
                    {shots.map((shot, index) => (
                      <ShotCard
                        key={shot.id}
                        shot={shot}
                        index={index}
                        total={shots.length}
                        confirming={confirming === `shot:${shot.id}`}
                        onPatch={patchShot}
                        onMove={(id, delta) => apply(moveShot(doc, id, delta, 0))}
                        onRemove={removeOneShot}
                      />
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function ShotCard({
  shot,
  index,
  total,
  confirming,
  onPatch,
  onMove,
  onRemove,
}: {
  shot: StoryboardShot
  index: number
  total: number
  confirming: boolean
  onPatch: (id: string, patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId'>>) => void
  onMove: (id: string, delta: number) => void
  onRemove: (id: string) => void
}) {
  return (
    <li className={styles.shot} data-storyboard-shot={shot.id}>
      <div className={styles.shotHead}>
        <span className={styles.shotNo}>第 {index + 1} 镜</span>
        <div className={styles.itemTools}>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="上移这一镜"
            title="上移"
            disabled={index === 0}
            data-storyboard-shot-up={shot.id}
            onClick={() => onMove(shot.id, -1)}
          >
            <IconUp />
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            aria-label="下移这一镜"
            title="下移"
            disabled={index === total - 1}
            data-storyboard-shot-down={shot.id}
            onClick={() => onMove(shot.id, 1)}
          >
            <IconDown />
          </button>
          <button
            type="button"
            className={confirming ? `${styles.iconBtn} ${styles.iconBtnDanger}` : styles.iconBtn}
            aria-label={confirming ? '再点一次，删除这一镜' : '删除这一镜'}
            title={confirming ? '再点一次，删除这一镜' : '删除'}
            data-storyboard-shot-remove={shot.id}
            data-confirming={confirming ? 'true' : 'false'}
            onClick={() => onRemove(shot.id)}
          >
            <IconTrash />
          </button>
        </div>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>画面</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.scene}
          placeholder="这一镜画什么"
          data-storyboard-shot-scene={shot.id}
          onChange={(e) => onPatch(shot.id, { scene: e.target.value })}
        />
      </label>
      <div className={styles.row2}>
        <label className={styles.field}>
          <span className={styles.label}>台词 / 旁白</span>
          <input
            className={styles.input}
            value={shot.dialogue}
            placeholder="可以是空的（空镜）"
            data-storyboard-shot-dialogue={shot.id}
            onChange={(e) => onPatch(shot.id, { dialogue: e.target.value })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>时长（秒）</span>
          <input
            className={styles.input}
            type="number"
            min={1}
            step={1}
            value={shot.durationSec}
            data-storyboard-shot-duration={shot.id}
            onChange={(e) => onPatch(shot.id, { durationSec: Number(e.target.value) })}
          />
        </label>
      </div>
      <label className={styles.field}>
        <span className={styles.label}>画面提示词</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={shot.prompt}
          placeholder="留空就用上面的「画面」"
          data-storyboard-shot-prompt={shot.id}
          onChange={(e) => onPatch(shot.id, { prompt: e.target.value })}
        />
      </label>
    </li>
  )
}

function IconUp() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  )
}

function IconDown() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 5v14" />
      <path d="M6 13l6 6 6-6" />
    </svg>
  )
}

function IconTrash() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V4h6v3" />
    </svg>
  )
}
