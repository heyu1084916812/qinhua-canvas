import { normalizeVideoUpscaleSettings } from '../../domain/storyboard/videoUpscale'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import type { ShotVideoToolsController } from './ShotVideoTools'
import styles from './StoryboardPage.module.css'

export function ShotUpscalePanel({
  model,
  actions,
  tools,
}: {
  model: ShotCardModel
  actions: ShotCardActions
  tools: ShotVideoToolsController
}) {
  const { shot, videoUpscaleTargets } = model
  const {
    upscaleOpen,
    setUpscaleOpen,
    upscaleTargetIndex,
    setUpscaleTargetIndex,
    upscaleResolution,
    setUpscaleResolution,
    upscaleFrameRate,
    setUpscaleFrameRate,
    currentUpscaleTarget,
    upscaleBusy,
  } = tools

  if (!upscaleOpen || !currentUpscaleTarget) return null

  return (
    <div className={styles.upscalePanel} data-storyboard-upscale-panel={shot.id}>
      <label className={styles.inlineField}>
        <span className={styles.label}>模型</span>
        <ChoicePicker
          name={`storyboard-upscale-target-${shot.id}`}
          className={styles.select}
          value={String(upscaleTargetIndex)}
          ariaLabel="超清模型"
          options={videoUpscaleTargets.map((target, targetIndex) => ({
            value: String(targetIndex),
            label: target.label,
          }))}
          onChange={(next) => {
            const nextIndex = Number(next)
            const nextTarget = videoUpscaleTargets[nextIndex]
            if (!nextTarget) return
            const normalized = normalizeVideoUpscaleSettings(nextTarget.model)
            setUpscaleTargetIndex(nextIndex)
            setUpscaleResolution(normalized.resolution)
            setUpscaleFrameRate(normalized.frameRate)
          }}
        />
      </label>
      {currentUpscaleTarget.resolutions.length > 0 ? (
        <label className={styles.inlineField}>
          <span className={styles.label}>清晰度</span>
          <ChoicePicker
            name={`storyboard-upscale-resolution-${shot.id}`}
            className={styles.select}
            value={upscaleResolution}
            ariaLabel="超清清晰度"
            options={currentUpscaleTarget.resolutions.map((value) => ({
              value,
              label: value,
            }))}
            onChange={setUpscaleResolution}
          />
        </label>
      ) : null}
      {currentUpscaleTarget.frameRates.length > 0 ? (
        <label className={styles.inlineField}>
          <span className={styles.label}>帧率</span>
          <ChoicePicker
            name={`storyboard-upscale-fps-${shot.id}`}
            className={styles.select}
            value={upscaleFrameRate == null ? '' : String(upscaleFrameRate)}
            ariaLabel="超清帧率"
            options={currentUpscaleTarget.frameRates.map((value) => ({
              value: String(value),
              label: `${value}fps`,
            }))}
            onChange={(value) => setUpscaleFrameRate(Number(value))}
          />
        </label>
      ) : null}
      <div className={styles.upscaleActions}>
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-upscale-cancel={shot.id}
          disabled={upscaleBusy}
          onClick={() => setUpscaleOpen(false)}
        >
          取消
        </button>
        <button
          type="button"
          className={styles.primary}
          data-storyboard-upscale-submit={shot.id}
          disabled={upscaleBusy}
          onClick={() => {
            setUpscaleOpen(false)
            actions.onVideoUpscale?.(
              currentUpscaleTarget,
              upscaleResolution,
              upscaleFrameRate,
            )
          }}
        >
          开始超清
        </button>
      </div>
    </div>
  )
}
