import { BgmField } from './BgmField'
import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardEpisodeDetailsPanel({
  selected,
  selectedIndex,
  actions,
  audioActions,
}: StoryboardEditorViewProps) {
  if (!selected) return null

  return (
    <div className={styles.block}>
      <h2 className={styles.blockTitle}>第 {selectedIndex + 1} 集</h2>
      <label className={styles.field}>
        <span className={styles.label}>这一集的标题</span>
        <input
          className={styles.input}
          value={selected.title}
          data-storyboard-episode-title={selected.id}
          onChange={(e) =>
            actions.patchEpisode(selected.id, { title: e.target.value })
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
            actions.patchEpisode(selected.id, { summary: e.target.value })
          }
        />
      </label>
      <div className={styles.row2}>
        <label className={styles.field}>
          <span className={styles.label}>开场钩子</span>
          <input
            className={styles.input}
            value={selected.hookOpen ?? ''}
            placeholder="开场抓人的那一句"
            data-storyboard-episode-hook-open={selected.id}
            onChange={(e) =>
              actions.patchEpisode(selected.id, { hookOpen: e.target.value })
            }
          />
        </label>
        <label className={styles.field}>
          <span className={styles.label}>结尾钩子</span>
          <input
            className={styles.input}
            value={selected.hookEnd ?? ''}
            placeholder="结尾留的那一钩"
            data-storyboard-episode-hook-end={selected.id}
            onChange={(e) =>
              actions.patchEpisode(selected.id, { hookEnd: e.target.value })
            }
          />
        </label>
      </div>
      <BgmField
        episode={selected}
        onPick={() => void audioActions.onPickBgm()}
        onRemove={audioActions.onRemoveBgm}
        onVolume={(volume) =>
          actions.patchEpisodeVolume(selected.id, volume)
        }
      />
    </div>
  )
}
