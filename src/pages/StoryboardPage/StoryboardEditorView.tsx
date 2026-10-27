import { useState } from 'react'
import { RunLogDrawer } from '../../features/shared/execution/RunLogDrawer'
import { EpisodePreview } from './EpisodePreview'
import { SourcePreview } from './SourcePreview'
import { StoryboardAssetPanel } from './StoryboardAssetPanel'
import { StoryboardEpisodeListPanel } from './StoryboardEpisodeListPanel'
import { StoryboardEpisodeWorkspacePanel } from './StoryboardEpisodeWorkspacePanel'
import { StoryboardSourcePanel } from './StoryboardSourcePanel'
import { StoryboardTopBar } from './StoryboardTopBar'
import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardEditorView(props: StoryboardEditorViewProps) {
  const { preview, sourcePreview, selected, timeline, actions } = props
  const [logsOpen, setLogsOpen] = useState(false)

  return (
    <div className={styles.page} data-storyboard-page>
      <StoryboardTopBar {...props} onOpenLogs={() => setLogsOpen(true)} />
      <div className={styles.body}>
        <section className={styles.left} aria-label="剧本与分集">
          <StoryboardSourcePanel {...props} />
          <StoryboardEpisodeListPanel {...props} />
          <StoryboardAssetPanel {...props} />
        </section>
        <StoryboardEpisodeWorkspacePanel {...props} />
      </div>
      {preview && timeline.clips.length > 0 ? (
        <EpisodePreview
          clips={timeline.clips}
          bgmHash={selected?.bgmHash}
          bgmName={selected?.bgmName}
          bgmVolume={selected?.bgmVolume}
          at={preview.at}
          playing={preview.playing}
          onAt={actions.previewAt}
          onTogglePlay={actions.togglePreview}
          onClose={actions.closePreview}
        />
      ) : null}
      {sourcePreview ? (
        <SourcePreview
          title={sourcePreview.title}
          range={sourcePreview.range}
          text={sourcePreview.text}
          onClose={actions.closeSource}
        />
      ) : null}
      {logsOpen ? (
        <RunLogDrawer
          title="漫剧日志"
          filter={{ projectId: props.projectId, workbench: 'storyboard' }}
          onClose={() => setLogsOpen(false)}
        />
      ) : null}
    </div>
  )
}
