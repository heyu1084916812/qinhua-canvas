import type {
  DramaCharacter,
  DramaScene,
  StoryboardDoc,
  StoryboardEpisode,
  StoryboardLine,
  StoryboardShot,
  StoryboardStats,
} from '../../domain/storyboard/storyboard'
import type { ChatTarget, SpeechTarget } from '../../domain/shared/chatTarget'
import type { MergeSuggestion } from '../../domain/storyboard/mergeSuggest'
import type { episodeTimeline } from '../../domain/storyboard/ffmpegPack'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import type { StoryboardDigitalHumanTarget } from '../../features/storyboard/useStoryboardTargets'
import type {
  VideoEditTarget,
  VideoEraseTarget,
  VideoExtendTarget,
  VideoUpscaleTarget,
} from '../../workbenches/storyboard/useStoryboardVideoExecutionController'
import type { createStoryboardAudioController } from '../../workbenches/storyboard/useStoryboardAudioController'
import type { createStoryboardAuthoringController } from '../../workbenches/storyboard/useStoryboardAuthoringController'
import type { createStoryboardDigitalHumanExecutionController } from '../../workbenches/storyboard/useStoryboardDigitalHumanExecutionController'
import type { createStoryboardExportController } from '../../workbenches/storyboard/useStoryboardExportController'
import type { createStoryboardImageExecutionController } from '../../workbenches/storyboard/useStoryboardImageExecutionController'
import type { createStoryboardVideoExecutionController } from '../../workbenches/storyboard/useStoryboardVideoExecutionController'
import type { ShotCardProps } from './ShotCard.types'

export type NoticeState = {
  kind: 'idle' | 'running' | 'done' | 'error'
  text: string
}

export type StoryboardSourcePreview = {
  title: string
  range?: { from: number; to: number }
  text: string
}

export type StoryboardPreviewState = {
  at: number
  playing: boolean
}

export type StoryboardEpisodePatch = Partial<
  Pick<
    StoryboardEpisode,
    'title' | 'summary' | 'hookOpen' | 'hookEnd' | 'bgmHash' | 'bgmName' | 'bgmVolume'
  >
>

export type StoryboardShotPatch = Parameters<
  ShotCardProps['onPatch']
>[1]

export type StoryboardLinePatch = Partial<Omit<StoryboardLine, 'id'>>

export type StoryboardCharacterPatch = Partial<
  Pick<DramaCharacter, 'name' | 'description' | 'aliases' | 'voice' | 'speed'>
>

export type StoryboardScenePatch = Partial<
  Pick<DramaScene, 'name' | 'description' | 'aliases'>
>

export type StoryboardImageActions = ReturnType<
  typeof createStoryboardImageExecutionController
>
export type StoryboardVideoActions = ReturnType<
  typeof createStoryboardVideoExecutionController
>
export type StoryboardDigitalHumanActions = ReturnType<
  typeof createStoryboardDigitalHumanExecutionController
>
export type StoryboardAudioActions = ReturnType<
  typeof createStoryboardAudioController
>
export type StoryboardAuthoringActions = ReturnType<
  typeof createStoryboardAuthoringController
>
export type StoryboardExportActions = ReturnType<
  typeof createStoryboardExportController
>
export type StoryboardShotActions = {
  layOut(): Promise<void>
  syncPrompts(): void
}

export interface StoryboardEditorActions {
  selectEpisode(id: string): void
  addEpisode(): void
  removeEpisode(id: string): void
  moveEpisode(id: string, delta: number): void
  patchEpisode(id: string, patch: StoryboardEpisodePatch): void
  patchEpisodeVolume(id: string, volume: number): void
  patchScript(patch: Partial<StoryboardDoc['script']>): void
  patchSourceText(text: string): void
  resetSplitConfirm(): void
  openSource(preview: StoryboardSourcePreview): void
  closeSource(): void
  addCharacter(): void
  addScene(): void
  patchCharacter(id: string, patch: StoryboardCharacterPatch): void
  patchScene(id: string, patch: StoryboardScenePatch): void
  removeAsset(kind: 'char' | 'scene', id: string): void
  openMerge(kind: 'char' | 'scene', id: string): void
  pickMerge(kind: 'char' | 'scene', id: string, keepId: string): void
  confirmMerge(kind: 'char' | 'scene', id: string): void
  cancelMerge(): void
  handleMergeSuggestion(suggestion: MergeSuggestion): void
  addShot(): void
  removeShot(id: string): void
  moveShot(id: string, delta: number): void
  patchShot(id: string, patch: StoryboardShotPatch): void
  addLine(shotId: string): void
  patchLine(shotId: string, lineId: string, patch: StoryboardLinePatch): void
  removeLine(shotId: string, lineId: string): void
  bindScene(shotId: string, sceneId: string | null): void
  toggleCharacter(shotId: string, characterId: string): void
  openCanvas(): void
  openShotOnCanvas(nodeId: string): void
  downloadVideo(hash: string): void
  openPreview(): void
  previewAt(at: number): void
  togglePreview(): void
  closePreview(): void
}

export interface StoryboardEditorViewProps {
  projectId: string
  projectName: string
  status: string
  doc: StoryboardDoc
  stats: StoryboardStats
  episodes: readonly StoryboardEpisode[]
  selected: StoryboardEpisode | null
  selectedIndex: number
  shots: readonly StoryboardShot[]
  selectedSourceText: string
  liveNodeIds: ReadonlySet<string>
  needNodes: readonly StoryboardShot[]
  laidCount: number
  videoPending: number
  voicePending: number
  timeline: ReturnType<typeof episodeTimeline>
  timelineSrt: string
  timelineSrtCues: number
  confirming: string
  merge: { dropId: string; keepId: string | null } | null
  merges: readonly MergeSuggestion[]
  mergeScan: NoticeState
  mergeConfirmId: string
  split: NoticeState
  splitConfirm: boolean
  breaking: NoticeState['kind']
  breakMsg: string
  breakConfirm: boolean
  lay: NoticeState
  preview: StoryboardPreviewState | null
  sourcePreview: StoryboardSourcePreview | null
  rendering: boolean
  voiceBusy: Record<string, boolean>
  digitalHumanBusy: string | null
  videoUpscaleBusy: string | null
  videoEraseBusy: string | null
  videoEditBusy: string | null
  videoExtendBusy: string | null
  chatTarget: ChatTarget | null
  speechTarget: SpeechTarget | null
  digitalHumanTarget: StoryboardDigitalHumanTarget | null
  videoUpscaleTargets: readonly VideoUpscaleTarget[]
  videoEraseTargets: readonly VideoEraseTarget[]
  videoEditTargets: readonly VideoEditTarget[]
  videoExtendTargets: readonly VideoExtendTarget[]
  canvas: Pick<StoryboardCanvasPort, 'nodeStateOf' | 'isRunning'>
  canRenderLocally: boolean
  actions: StoryboardEditorActions
  imageActions: StoryboardImageActions
  videoActions: StoryboardVideoActions
  digitalHumanActions: StoryboardDigitalHumanActions
  audioActions: StoryboardAudioActions
  authoringActions: StoryboardAuthoringActions
  exportActions: StoryboardExportActions
  shotActions: StoryboardShotActions
}
