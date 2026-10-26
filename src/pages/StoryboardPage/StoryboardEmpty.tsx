import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository } from '../../state/project/repository'
import { projectRoute } from '../../domain/shared/workbench'
import styles from './StoryboardPage.module.css'

/** 没有项目时的引导页：给出口，不空白（与电商工作台同一条口径） */
export function StoryboardEmpty() {
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
