import { ShotCard } from './ShotCard'
import type { StoryboardEditorViewProps } from './StoryboardEditor.types'
import styles from './StoryboardPage.module.css'

export function StoryboardShotListPanel({
  doc,
  selected,
  shots,
  selectedSourceText,
  liveNodeIds,
  confirming,
  voiceBusy,
  digitalHumanBusy,
  videoUpscaleBusy,
  videoEraseBusy,
  videoEditBusy,
  videoExtendBusy,
  speechTarget,
  digitalHumanTarget,
  videoUpscaleTargets,
  videoEraseTargets,
  videoEditTargets,
  videoExtendTargets,
  canvas,
  actions,
  imageActions,
  videoActions,
  digitalHumanActions,
  audioActions,
}: StoryboardEditorViewProps) {
  if (shots.length === 0) {
    return (
      <p className={styles.hint} data-storyboard-shots-empty>
        这一集还没有分镜。一镜 = 一个画面 + 一句台词 + 一个时长。
      </p>
    )
  }

  const openSelectedSource =
    selected && selectedSourceText
      ? () =>
          actions.openSource({
            title: selected.title,
            ...(selected.sourceRange ? { range: selected.sourceRange } : {}),
            text: selectedSourceText,
          })
      : undefined

  return (
    <ol className={styles.shots}>
      {shots.map((shot, index) => (
        <ShotCard
          key={shot.id}
          shot={shot}
          index={index}
          total={shots.length}
          confirming={confirming === `shot:${shot.id}`}
          laidOut={Boolean(shot.nodeId && liveNodeIds.has(shot.nodeId))}
          state={shot.nodeId ? canvas.nodeStateOf(shot.nodeId) : undefined}
          characters={doc.characters}
          scenes={doc.scenes}
          onPatch={actions.patchShot}
          onAddLine={() => actions.addLine(shot.id)}
          onLinePatch={(lineId, patch) =>
            actions.patchLine(shot.id, lineId, patch)
          }
          onLineRemove={(lineId) => actions.removeLine(shot.id, lineId)}
          speechTarget={speechTarget}
          voiceBusy={voiceBusy}
          onVoice={(lineId) => void audioActions.voiceLine(shot, lineId)}
          onMakeDigitalHuman={
            digitalHumanTarget
              ? () => void digitalHumanActions.makeDigitalHuman(shot)
              : undefined
          }
          digitalHumanBusyShotId={digitalHumanBusy}
          digitalHumanModel={digitalHumanTarget?.model}
          onMove={actions.moveShot}
          onRemove={actions.removeShot}
          onRun={() => imageActions.runShot(shot)}
          onShowSource={openSelectedSource}
          onLocate={
            shot.nodeId && liveNodeIds.has(shot.nodeId)
              ? () => actions.openShotOnCanvas(shot.nodeId!)
              : undefined
          }
          onMakeVideo={
            shot.nodeId && liveNodeIds.has(shot.nodeId) && shot.imageHash
              ? () => void videoActions.makeShotVideo(shot)
              : undefined
          }
          videoPairHint={Boolean(
            shots[index + 1]?.nodeId &&
              liveNodeIds.has(shots[index + 1]!.nodeId!) &&
              shots[index + 1]?.imageHash,
          )}
          videoUpscaleTargets={videoUpscaleTargets}
          videoUpscaleBusyShotId={videoUpscaleBusy}
          onVideoUpscale={
            shot.videoHash &&
            shot.videoNodeId &&
            liveNodeIds.has(shot.videoNodeId) &&
            videoUpscaleTargets.length > 0
              ? (target, resolution, frameRate) =>
                  void videoActions.makeVideoUpscale(
                    shot,
                    target,
                    resolution,
                    frameRate,
                  )
              : undefined
          }
          videoEraseTargets={videoEraseTargets}
          videoEraseBusyShotId={videoEraseBusy}
          onVideoErase={
            shot.videoHash &&
            shot.videoNodeId &&
            liveNodeIds.has(shot.videoNodeId) &&
            videoEraseTargets.length > 0
              ? (target) => void videoActions.makeVideoErase(shot, target)
              : undefined
          }
          videoEditTargets={videoEditTargets}
          videoEditBusyShotId={videoEditBusy}
          onVideoEdit={
            shot.videoHash &&
            shot.videoNodeId &&
            liveNodeIds.has(shot.videoNodeId) &&
            videoEditTargets.length > 0
              ? (target, instruction, resolution, useReferenceImage) =>
                  void videoActions.makeVideoEdit(
                    shot,
                    target,
                    instruction,
                    resolution,
                    useReferenceImage,
                  )
              : undefined
          }
          videoExtendTargets={videoExtendTargets}
          videoExtendBusyShotId={videoExtendBusy}
          onVideoExtend={
            shot.videoHash &&
            shot.videoNodeId &&
            liveNodeIds.has(shot.videoNodeId) &&
            videoExtendTargets.length > 0
              ? (target, instruction, resolution, duration) =>
                  void videoActions.makeVideoExtend(
                    shot,
                    target,
                    instruction,
                    resolution,
                    duration,
                  )
              : undefined
          }
          onDownloadVideo={
            shot.videoHash
              ? () => actions.downloadVideo(shot.videoHash!)
              : undefined
          }
          onBindScene={(sceneId) => actions.bindScene(shot.id, sceneId)}
          onToggleCharacter={(characterId) =>
            actions.toggleCharacter(shot.id, characterId)
          }
        />
      ))}
    </ol>
  )
}
