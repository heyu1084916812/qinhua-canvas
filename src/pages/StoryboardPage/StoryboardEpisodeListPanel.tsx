import { episodeSourceText } from '../../domain/storyboard/episodes'
import { shotsOf } from '../../domain/storyboard/storyboard'
import { IconDown, IconTrash, IconUp } from './StoryboardIcons'
import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardEpisodeListPanel({
  doc,
  episodes,
  selected,
  confirming,
  actions,
}: StoryboardEditorViewProps) {
  return (
    <div className={styles.block}>
      <div className={styles.blockHead}>
        <h2 className={styles.blockTitle}>分集</h2>
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-add-episode
          onClick={actions.addEpisode}
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
            const sourceText = episodeSourceText(doc, episode)
            return (
              <li
                key={episode.id}
                className={on ? `${styles.item} ${styles.itemOn}` : styles.item}
                data-storyboard-episode={episode.id}
                data-selected={on ? 'true' : 'false'}
                onClick={() => actions.selectEpisode(episode.id)}
              >
                <div className={styles.itemMain}>
                  <input
                    className={styles.itemTitle}
                    value={episode.title}
                    aria-label={`第 ${index + 1} 集标题`}
                    data-storyboard-episode-name={episode.id}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      actions.patchEpisode(episode.id, { title: e.target.value })
                    }
                  />
                  {episode.sourceRange ? (
                    <span
                      className={styles.itemMeta}
                      data-storyboard-episode-range={episode.id}
                    >
                      原文 {episode.sourceRange.from + 1}–{episode.sourceRange.to} 字
                    </span>
                  ) : null}
                  <span className={styles.itemMeta}>
                    {shotsOf(doc, episode.id).length} 镜
                  </span>
                </div>
                <div className={styles.itemTools}>
                  {sourceText ? (
                    <button
                      type="button"
                      className={styles.ghost}
                      data-storyboard-episode-source={episode.id}
                      onClick={(e) => {
                        e.stopPropagation()
                        actions.openSource({
                          title: episode.title,
                          ...(episode.sourceRange
                            ? { range: episode.sourceRange }
                            : {}),
                          text: sourceText,
                        })
                      }}
                    >
                      看原文
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className={styles.iconBtn}
                    aria-label="上移这一集"
                    title="上移"
                    disabled={index === 0}
                    data-storyboard-episode-up={episode.id}
                    onClick={(e) => {
                      e.stopPropagation()
                      actions.moveEpisode(episode.id, -1)
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
                      actions.moveEpisode(episode.id, 1)
                    }}
                  >
                    <IconDown />
                  </button>
                  <button
                    type="button"
                    className={
                      isConfirming
                        ? `${styles.iconBtn} ${styles.iconBtnDanger}`
                        : styles.iconBtn
                    }
                    aria-label={isConfirming ? '再点一次，删除这一集' : '删除这一集'}
                    title={isConfirming ? '再点一次，删除这一集' : '删除'}
                    data-storyboard-episode-remove={episode.id}
                    data-confirming={isConfirming ? 'true' : 'false'}
                    onClick={(e) => {
                      e.stopPropagation()
                      actions.removeEpisode(episode.id)
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
  )
}
