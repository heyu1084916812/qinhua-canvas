import { StoryboardEpisodeDetailsPanel } from './StoryboardEpisodeDetailsPanel'
import { StoryboardShotListPanel } from './StoryboardShotListPanel'
import { StoryboardShotToolbar } from './StoryboardShotToolbar'
import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardEpisodeWorkspacePanel(props: StoryboardEditorViewProps) {
  return (
    <section className={styles.right} aria-label="这一集的分镜">
      {!props.selected ? (
        <div className={styles.placeholder} data-storyboard-no-episode>
          <p className={styles.hint}>
            左边还没有分集。先加一集，这一集的分镜就写在这里。
          </p>
        </div>
      ) : (
        <>
          <StoryboardEpisodeDetailsPanel {...props} />
          <div className={styles.block}>
            <StoryboardShotToolbar {...props} />
            <StoryboardShotListPanel {...props} />
          </div>
        </>
      )}
    </section>
  )
}
