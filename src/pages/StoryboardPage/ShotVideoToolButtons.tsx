import type { ShotCardActions, ShotCardModel } from './ShotCard.types'
import type { ShotVideoToolsController } from './ShotVideoTools'
import styles from './StoryboardPage.module.css'

export function ShotVideoToolButtons({
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
  const { shot } = model
  const {
    upscaleOpen,
    setUpscaleOpen,
    setVideoEraseOpen,
    videoEditOpen,
    setVideoEditOpen,
    videoExtendOpen,
    setVideoExtendOpen,
    upscaleBusy,
    videoErasing,
    videoEditing,
    videoExtending,
    openUpscale,
    openVideoEdit,
    openVideoExtend,
  } = tools

  return (
    <>
      {actions.onVideoUpscale && shot.videoHash ? (
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-shot-upscale={shot.id}
          disabled={busy || upscaleBusy}
          onClick={() => (upscaleOpen ? setUpscaleOpen(false) : openUpscale())}
        >
          {upscaleBusy ? '视频处理中…' : '视频后处理'}
        </button>
      ) : null}
      {actions.onVideoErase && shot.videoHash ? (
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-video-erase={shot.id}
          disabled={busy || videoErasing}
          onClick={() => setVideoEraseOpen((current) => !current)}
        >
          {videoErasing ? '字幕擦除中…' : '字幕擦除'}
        </button>
      ) : null}
      {actions.onVideoEdit && shot.videoHash ? (
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-video-edit={shot.id}
          disabled={busy || videoEditing}
          onClick={() => (videoEditOpen ? setVideoEditOpen(false) : openVideoEdit())}
        >
          {videoEditing ? '视频编辑中…' : '视频编辑'}
        </button>
      ) : null}
      {actions.onVideoExtend && shot.videoHash ? (
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-video-extend={shot.id}
          disabled={busy || videoExtending}
          onClick={() => (videoExtendOpen ? setVideoExtendOpen(false) : openVideoExtend())}
        >
          {videoExtending ? '视频续写中…' : '视频续写'}
        </button>
      ) : null}
      {actions.onDownloadVideo && shot.videoHash ? (
        <button
          type="button"
          className={styles.ghost}
          data-storyboard-download-video={shot.id}
          onClick={actions.onDownloadVideo}
        >
          下载视频
        </button>
      ) : null}
    </>
  )
}
