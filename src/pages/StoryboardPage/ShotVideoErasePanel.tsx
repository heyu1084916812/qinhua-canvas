import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import type { ShotVideoToolsController } from './ShotVideoTools'
import styles from './StoryboardPage.module.css'

export function ShotVideoErasePanel({
  model,
  actions,
  tools,
}: {
  model: ShotCardModel
  actions: ShotCardActions
  tools: ShotVideoToolsController
}) {
  const { shot, videoEraseTargets } = model
  const {
    videoEraseOpen,
    setVideoEraseOpen,
    videoEraseTargetIndex,
    setVideoEraseTargetIndex,
    currentVideoEraseTarget,
    videoErasing,
  } = tools

  if (!videoEraseOpen || !currentVideoEraseTarget) return null

  return (
    <div
      className={styles.videoEditPanel}
      data-storyboard-video-erase-panel={shot.id}
    >
      <label className={styles.inlineField}>
        <span className={styles.label}>模型</span>
        <ChoicePicker
          name={`storyboard-video-erase-target-${shot.id}`}
          className={styles.select}
          value={String(videoEraseTargetIndex)}
          ariaLabel="字幕擦除模型"
          options={videoEraseTargets.map((target, targetIndex) => ({
            value: String(targetIndex),
            label: target.label,
          }))}
          onChange={(value) => setVideoEraseTargetIndex(Number(value))}
        />
      </label>
      <div className={styles.videoEditActions}>
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-video-erase-cancel={shot.id}
          disabled={videoErasing}
          onClick={() => setVideoEraseOpen(false)}
        >
          取消
        </button>
        <button
          type="button"
          className={styles.primary}
          data-storyboard-video-erase-submit={shot.id}
          disabled={videoErasing}
          onClick={() => {
            setVideoEraseOpen(false)
            actions.onVideoErase?.(currentVideoEraseTarget)
          }}
        >
          开始擦除
        </button>
      </div>
    </div>
  )
}
