import type { ShotCardActions, ShotCardModel, ShotCardProps } from './ShotCard.types'
import { ShotCardHeader } from './ShotCardHeader'
import { ShotCastPanel } from './ShotCastPanel'
import { ShotMediaPanel } from './ShotMediaPanel'
import { ShotPromptPanel } from './ShotPromptPanel'
import { useShotVideoTools } from './ShotVideoTools'
import styles from './StoryboardPage.module.css'

export function ShotCard({
  shot,
  index,
  total,
  confirming,
  laidOut,
  state,
  characters,
  scenes,
  onPatch,
  onMove,
  onRemove,
  onRun,
  onBindScene,
  onToggleCharacter,
  onLocate,
  onMakeVideo,
  videoPairHint,
  videoUpscaleTargets,
  videoUpscaleBusyShotId,
  onVideoUpscale,
  videoEraseTargets,
  videoEraseBusyShotId,
  onVideoErase,
  videoEditTargets,
  videoEditBusyShotId,
  onVideoEdit,
  videoExtendTargets,
  videoExtendBusyShotId,
  onVideoExtend,
  onDownloadVideo,
  onShowSource,
  onAddLine,
  onLinePatch,
  onLineRemove,
  speechTarget,
  voiceBusy,
  onVoice,
  onMakeDigitalHuman,
  digitalHumanBusyShotId,
  digitalHumanModel,
}: ShotCardProps) {
  const model: ShotCardModel = {
    shot,
    index,
    total,
    confirming,
    laidOut,
    state,
    characters,
    scenes,
    videoPairHint,
    videoUpscaleTargets,
    videoUpscaleBusyShotId,
    videoEraseTargets,
    videoEraseBusyShotId,
    videoEditTargets,
    videoEditBusyShotId,
    videoExtendTargets,
    videoExtendBusyShotId,
    speechTarget,
    voiceBusy,
    digitalHumanBusyShotId,
    digitalHumanModel,
  }
  const actions: ShotCardActions = {
    onPatch,
    onMove,
    onRemove,
    onRun,
    onBindScene,
    onToggleCharacter,
    onLocate,
    onMakeVideo,
    onVideoUpscale,
    onVideoErase,
    onVideoEdit,
    onVideoExtend,
    onDownloadVideo,
    onShowSource,
    onAddLine,
    onLinePatch,
    onLineRemove,
    onVoice,
    onMakeDigitalHuman,
  }
  const videoTools = useShotVideoTools(model, actions)

  const kind =
    state?.kind === 'failed'
      ? 'failed'
      : state?.kind === 'queued' || state?.kind === 'running'
        ? 'running'
        : shot.imageHash
          ? 'done'
          : laidOut
            ? 'laid'
            : 'idle'
  const stateText =
    kind === 'idle'
      ? '还没铺到画布'
      : kind === 'laid'
        ? '已在画布上'
        : kind === 'running'
          ? state?.kind === 'queued'
            ? '排队中…'
            : '生成中…'
          : kind === 'failed'
            ? '生成失败'
            : '已出图'
  const busy = state?.kind === 'queued' || state?.kind === 'running'

  return (
    <li className={styles.shot} data-storyboard-shot={shot.id}>
      <ShotCardHeader model={model} actions={actions} kind={kind} stateText={stateText} />
      <ShotMediaPanel model={model} actions={actions} tools={videoTools} busy={busy} />
      <ShotCastPanel model={model} actions={actions} />
      <ShotPromptPanel model={model} actions={actions} />
    </li>
  )
}
