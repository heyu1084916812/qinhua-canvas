import {
  StoryboardCanvasHost,
} from '../../app/workbenchHosts/StoryboardCanvasHost'
import { StoryboardExecutionHost } from '../../app/workbenchHosts/StoryboardExecutionHost'
import { StoryboardEditor } from './StoryboardEditor'
import styles from './StoryboardPage.module.css'

export function StoryboardProject({ projectId }: { projectId: string }) {
  return (
    <StoryboardExecutionHost projectId={projectId}>
      <StoryboardCanvasHost
        projectId={projectId}
        renderLoading={(error) => (
          <div className={styles.emptyWrap} data-storyboard-hydrating>
            <p className={styles.emptyText}>
              {error ? `项目读取失败：${error}` : '正在读取这个漫剧项目…'}
            </p>
          </div>
        )}
      >
        <StoryboardEditor projectId={projectId} />
      </StoryboardCanvasHost>
    </StoryboardExecutionHost>
  )
}
