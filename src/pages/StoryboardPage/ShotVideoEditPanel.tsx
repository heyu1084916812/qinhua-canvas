import { normalizeVideoEditResolution } from '../../domain/storyboard/videoEdit'
import { ChoicePicker } from '../../features/shared/choicePicker/ChoicePicker'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import type { ShotVideoToolsController } from './ShotVideoTools'
import styles from './StoryboardPage.module.css'

export function ShotVideoEditPanel({
  model,
  actions,
  tools,
}: {
  model: ShotCardModel
  actions: ShotCardActions
  tools: ShotVideoToolsController
}) {
  const { shot, laidOut, videoEditTargets } = model
  const {
    videoEditOpen,
    setVideoEditOpen,
    videoEditTargetIndex,
    setVideoEditTargetIndex,
    videoEditInstruction,
    setVideoEditInstruction,
    videoEditResolution,
    setVideoEditResolution,
    videoEditUseReference,
    setVideoEditUseReference,
    currentVideoEditTarget,
    canReferenceShotImage,
    videoEditing,
  } = tools

  if (!videoEditOpen || !currentVideoEditTarget) return null

  return (
    <div
      className={styles.videoEditPanel}
      data-storyboard-video-edit-panel={shot.id}
    >
      <label className={`${styles.inlineField} ${styles.videoEditPrompt}`}>
        <span className={styles.label}>修改要求</span>
        <textarea
          className={styles.textarea}
          rows={2}
          value={videoEditInstruction}
          placeholder="例如：把白天改成雨夜，保留人物动作和镜头运动"
          data-storyboard-video-edit-instruction={shot.id}
          onChange={(e) => setVideoEditInstruction(e.target.value)}
        />
      </label>
      <label className={styles.inlineField}>
        <span className={styles.label}>模型</span>
        <ChoicePicker
          name={`storyboard-video-edit-target-${shot.id}`}
          className={styles.select}
          value={String(videoEditTargetIndex)}
          ariaLabel="视频编辑模型"
          options={videoEditTargets.map((target, targetIndex) => ({
            value: String(targetIndex),
            label: target.label,
          }))}
          onChange={(value) => {
            const nextIndex = Number(value)
            const nextTarget = videoEditTargets[nextIndex]
            if (!nextTarget) return
            setVideoEditTargetIndex(nextIndex)
            setVideoEditResolution(normalizeVideoEditResolution(nextTarget.model))
            setVideoEditUseReference(
              Boolean(nextTarget.supportsReferenceImage && shot.imageHash && laidOut),
            )
          }}
        />
      </label>
      {currentVideoEditTarget.resolutions.length > 0 ? (
        <label className={styles.inlineField}>
          <span className={styles.label}>清晰度</span>
          <ChoicePicker
            name={`storyboard-video-edit-resolution-${shot.id}`}
            className={styles.select}
            value={videoEditResolution}
            ariaLabel="视频编辑清晰度"
            options={currentVideoEditTarget.resolutions.map((value) => ({
              value,
              label: value,
            }))}
            onChange={setVideoEditResolution}
          />
        </label>
      ) : null}
      {currentVideoEditTarget.supportsReferenceImage ? (
        <label
          className={styles.videoEditReference}
          title={
            canReferenceShotImage
              ? '把当前镜头画面作为参考图一起发送'
              : '当前镜头没有可引用的画面'
          }
        >
          <input
            type="checkbox"
            checked={videoEditUseReference && canReferenceShotImage}
            disabled={!canReferenceShotImage}
            data-storyboard-video-edit-reference={shot.id}
            onChange={(e) => setVideoEditUseReference(e.target.checked)}
          />
          <span>
            参考当前画面
            {currentVideoEditTarget.requiresReferenceImage ? '（必需）' : ''}
          </span>
        </label>
      ) : null}
      <div className={styles.videoEditActions}>
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-video-edit-cancel={shot.id}
          disabled={videoEditing}
          onClick={() => setVideoEditOpen(false)}
        >
          取消
        </button>
        <button
          type="button"
          className={styles.primary}
          data-storyboard-video-edit-submit={shot.id}
          disabled={
            videoEditing ||
            !videoEditInstruction.trim() ||
            (currentVideoEditTarget.requiresReferenceImage &&
              !(videoEditUseReference && canReferenceShotImage))
          }
          onClick={() => {
            setVideoEditOpen(false)
            actions.onVideoEdit?.(
              currentVideoEditTarget,
              videoEditInstruction,
              videoEditResolution,
              videoEditUseReference && canReferenceShotImage,
            )
          }}
        >
          开始编辑
        </button>
      </div>
    </div>
  )
}
