import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardTopBar({
  doc,
  projectName,
  status,
  stats,
  exportActions,
}: StoryboardEditorViewProps) {
  return (
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
      <button
        type="button"
        className={styles.primary}
        data-storyboard-export
        onClick={() => void exportActions.onExport()}
      >
        导出分镜表
      </button>
    </header>
  )
}
