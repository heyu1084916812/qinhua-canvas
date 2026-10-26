import { describeError } from '../../shared/result'
import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import { ShotThumb, ShotVideo } from './StoryboardMedia'
import { ShotVideoPanels } from './ShotVideoPanels'
import { ShotVideoToolButtons } from './ShotVideoToolButtons'
import type { ShotVideoToolsController } from './ShotVideoTools'
import styles from './StoryboardPage.module.css'

export function ShotMediaPanel({
  model,
  actions,
  tools,
  busy,
}: {
  model: ShotCardModel
  actions: ShotCardActions
  tools: ShotVideoToolsController
  busy: boolean
}) {
  const { shot, laidOut, state, videoPairHint } = model

  return (
    <>
      <div className={styles.shotBar}>
        {shot.videoHash ? (
          <span className={styles.shotVideo} data-storyboard-shot-video-preview={shot.id}>
            <ShotVideo hash={shot.videoHash} />
          </span>
        ) : null}
        {shot.imageHash ? (
          <span className={styles.shotImage} data-storyboard-shot-image={shot.id}>
            <ShotThumb hash={shot.imageHash} />
          </span>
        ) : null}
        <div className={styles.itemTools}>
          <button
            type="button"
            className={styles.ghost}
            data-storyboard-shot-run={shot.id}
            disabled={!laidOut || busy}
            onClick={actions.onRun}
          >
            {shot.imageHash ? '重出这一镜' : '出图'}
          </button>
          {actions.onLocate ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-locate={shot.id}
              onClick={actions.onLocate}
            >
              在画布里定位
            </button>
          ) : null}
          {actions.onMakeVideo ? (
            <button
              type="button"
              className={styles.ghost}
              data-storyboard-shot-video={shot.id}
              disabled={busy}
              title={
                videoPairHint
                  ? '下一镜也已出图：优先用这一镜和下一镜做首尾帧；模型不支持时回落单张首帧'
                  : '拿这一镜的图去生成一段视频（另起一个视频节点，这一镜的图不会被顶掉）'
              }
              onClick={actions.onMakeVideo}
            >
              {shot.videoHash
                ? `重出这一镜的视频${videoPairHint ? ' · 首尾帧' : ''}`
                : `出视频${videoPairHint ? ' · 首尾帧' : ''}`}
            </button>
          ) : null}
          <ShotVideoToolButtons
            model={model}
            actions={actions}
            tools={tools}
            busy={busy}
          />
        </div>
      </div>
      <ShotVideoPanels model={model} actions={actions} tools={tools} />
      {state?.kind === 'failed' ? (
        <p className={styles.error} data-storyboard-shot-error={shot.id}>
          {describeError(state.error)}
        </p>
      ) : null}
    </>
  )
}
