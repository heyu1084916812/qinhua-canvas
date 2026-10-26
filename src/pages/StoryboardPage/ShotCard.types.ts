import type { RunTaskState } from '../../features/shared/execution/runEngine'
import type { SpeechTarget } from '../../domain/shared/chatTarget'
import type {
  DramaCharacter,
  DramaScene,
  StoryboardLine,
  StoryboardShot,
} from '../../domain/storyboard/storyboard'
import type {
  VideoEditTarget,
  VideoEraseTarget,
  VideoExtendTarget,
  VideoUpscaleTarget,
} from '../../workbenches/storyboard/useStoryboardVideoExecutionController'

export interface ShotCardModel {
  shot: StoryboardShot
  index: number
  total: number
  confirming: boolean
  /** 这一镜的节点现在还在画布上。 */
  laidOut: boolean
  state?: RunTaskState
  characters: readonly DramaCharacter[]
  scenes: readonly DramaScene[]
  videoPairHint?: boolean
  videoUpscaleTargets: readonly VideoUpscaleTarget[]
  videoUpscaleBusyShotId: string | null
  videoEraseTargets: readonly VideoEraseTarget[]
  videoEraseBusyShotId: string | null
  videoEditTargets: readonly VideoEditTarget[]
  videoEditBusyShotId: string | null
  videoExtendTargets: readonly VideoExtendTarget[]
  videoExtendBusyShotId: string | null
  speechTarget: SpeechTarget | null
  voiceBusy: Record<string, boolean>
  digitalHumanBusyShotId: string | null
  digitalHumanModel?: string
}

export interface ShotCardActions {
  onPatch: (
    id: string,
    patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId' | 'lines'>>,
  ) => void
  onAddLine: () => void
  onLinePatch: (lineId: string, patch: Partial<Omit<StoryboardLine, 'id'>>) => void
  onLineRemove: (lineId: string) => void
  onVoice: (lineId: string) => void
  onMakeDigitalHuman?: () => void
  onMove: (id: string, delta: number) => void
  onRemove: (id: string) => void
  onRun: () => void
  onBindScene: (sceneId: string | null) => void
  onToggleCharacter: (characterId: string) => void
  onLocate?: () => void
  onMakeVideo?: () => void
  onVideoUpscale?: (
    target: VideoUpscaleTarget,
    resolution: string,
    frameRate: number | null,
  ) => void
  onVideoErase?: (target: VideoEraseTarget) => void
  onVideoEdit?: (
    target: VideoEditTarget,
    instruction: string,
    resolution: string,
    useReferenceImage: boolean,
  ) => void
  onVideoExtend?: (
    target: VideoExtendTarget,
    instruction: string,
    resolution: string,
    duration: number | null,
  ) => void
  onDownloadVideo?: () => void
  onShowSource?: () => void
}

export type ShotCardProps = ShotCardModel & ShotCardActions
