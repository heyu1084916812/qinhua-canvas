import { normalizeVideoExtendSettings } from '../../domain/storyboard/videoExtend'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import type { ShotVideoToolsController } from './ShotVideoTools'
import styles from './StoryboardPage.module.css'

export function ShotVideoExtendPanel({
  model,
  actions,
  tools,
}: {
  model: ShotCardModel
  actions: ShotCardActions
  tools: ShotVideoToolsController
}) {
  const { shot, videoExtendTargets } = model
  const {
    videoExtendOpen,
    setVideoExtendOpen,
    videoExtendTargetIndex,
    setVideoExtendTargetIndex,
    videoExtendInstruction,
    setVideoExtendInstruction,
    videoExtendResolution,
    setVideoExtendResolution,
    videoExtendDuration,
    setVideoExtendDuration,
    currentVideoExtendTarget,
    videoExtending,
  } = tools

  if (!videoExtendOpen || !currentVideoExtendTarget) return null

  return (
    <div
      className={styles.videoEditPanel}
      data-storyboard-video-extend-panel={shot.id}
    >
      <label className={`${styles.inlineField} ${styles.videoEditPrompt}`}>
        <span className={styles.label}>续写要求</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={videoExtendInstruction}
          placeholder="续写接下来发生什么，保持人物、场景和画风一致"
          data-storyboard-video-extend-instruction={shot.id}
          onChange={(e) => setVideoExtendInstruction(e.target.value)}
        />
      </label>
      <label className={styles.inlineField}>
        <span className={styles.label}>模型</span>
        <ChoicePicker
          name={`storyboard-video-extend-target-${shot.id}`}
          className={styles.select}
          value={String(videoExtendTargetIndex)}
          ariaLabel="视频续写模型"
          options={videoExtendTargets.map((target, targetIndex) => ({
            value: String(targetIndex),
            label: target.label,
          }))}
          onChange={(value) => {
            const nextIndex = Number(value)
            const nextTarget = videoExtendTargets[nextIndex]
            if (!nextTarget) return
            const normalized = normalizeVideoExtendSettings(nextTarget.model)
            setVideoExtendTargetIndex(nextIndex)
            setVideoExtendResolution(normalized.resolution)
            setVideoExtendDuration(normalized.duration)
          }}
        />
      </label>
      {currentVideoExtendTarget.resolutions.length > 0 ? (
        <label className={styles.inlineField}>
          <span className={styles.label}>清晰度</span>
          <ChoicePicker
            name={`storyboard-video-extend-resolution-${shot.id}`}
            className={styles.select}
            value={videoExtendResolution}
            ariaLabel="视频续写清晰度"
            options={currentVideoExtendTarget.resolutions.map((value) => ({
              value,
              label: value,
            }))}
            onChange={setVideoExtendResolution}
          />
        </label>
      ) : null}
      {currentVideoExtendTarget.durations.length > 0 ? (
        <label className={styles.inlineField}>
          <span className={styles.label}>新增时长</span>
          <ChoicePicker
            name={`storyboard-video-extend-duration-${shot.id}`}
            className={styles.select}
            value={videoExtendDuration == null ? '' : String(videoExtendDuration)}
            ariaLabel="视频续写新增时长"
            options={currentVideoExtendTarget.durations.map((value) => ({
              value: String(value),
              label: `${value}s`,
            }))}
            onChange={(value) => setVideoExtendDuration(Number(value))}
          />
        </label>
      ) : null}
      <div className={styles.videoEditActions}>
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-video-extend-cancel={shot.id}
          disabled={videoExtending}
          onClick={() => setVideoExtendOpen(false)}
        >
          取消
        </button>
        <button
          type="button"
          className={styles.primary}
          data-storyboard-video-extend-submit={shot.id}
          disabled={videoExtending}
          onClick={() => {
            setVideoExtendOpen(false)
            actions.onVideoExtend?.(
              currentVideoExtendTarget,
              videoExtendInstruction,
              videoExtendResolution,
              videoExtendDuration,
            )
          }}
        >
          开始续写
        </button>
      </div>
    </div>
  )
}
