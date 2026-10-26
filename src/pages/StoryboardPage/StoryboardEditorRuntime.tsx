import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from 'react'
import { useNavigate } from 'react-router-dom'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { StoryboardStore } from '../../state/project/storyboardStore'
import type { PlatformKit } from '../../platform'
import type {
  StoryboardCanvasGraph,
  StoryboardCanvasPort,
} from '../../features/storyboard/canvasPort'
import { useStoryboardExecution } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import { useStoryboardTargets } from '../../features/storyboard/useStoryboardTargets'
import { useSkillsOptional } from '../../app/providers/SkillStoreProvider'
import { BREAKDOWN_SKILL_ID } from '../../domain/storyboard/breakdown'
import { episodeSourceText } from '../../domain/storyboard/episodes'
import { episodeTimeline, srtOf } from '../../domain/storyboard/ffmpegPack'
import type { MergeSuggestion } from '../../domain/storyboard/mergeSuggest'
import {
  addCharacter,
  addEpisode,
  addScene,
  addShot,
  addShotLine,
  bindShotScene,
  mergeAsset,
  moveEpisode,
  moveShot,
  removeCharacter,
  removeEpisode,
  removeScene,
  removeShot,
  removeShotLine,
  shotsNeedingNode,
  shotsOf,
  storyboardStats,
  toggleShotCharacter,
  updateCharacter,
  updateEpisode,
  updateScene,
  updateScript,
  updateShot,
  updateShotLine,
  updateSourceText,
  type StoryboardDoc,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import { fingerprintBytesSync } from '../../domain/shared/hash'
import { projectRoute } from '../../domain/shared/workbench'
import { downloadAsset } from '../../features/shared/assets/downloadAsset'
import { createId } from '../../shared/id'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import { createStoryboardAudioController } from '../../workbenches/storyboard/useStoryboardAudioController'
import { createStoryboardAuthoringController } from '../../workbenches/storyboard/useStoryboardAuthoringController'
import { createStoryboardDigitalHumanExecutionController } from '../../workbenches/storyboard/useStoryboardDigitalHumanExecutionController'
import { createStoryboardExportController } from '../../workbenches/storyboard/useStoryboardExportController'
import { createStoryboardImageExecutionController } from '../../workbenches/storyboard/useStoryboardImageExecutionController'
import { createStoryboardShotController } from '../../workbenches/storyboard/useStoryboardShotController'
import { createStoryboardVideoExecutionController } from '../../workbenches/storyboard/useStoryboardVideoExecutionController'
import type {
  NoticeState,
  StoryboardEditorActions,
  StoryboardEditorViewProps,
} from './StoryboardEditor.types'
import { StoryboardEditorView } from './StoryboardEditorView'

type MergeState = { dropId: string; keepId: string | null }

interface StoryboardEditorRuntimeProps {
  projectId: string
  doc: StoryboardDoc
  platform: PlatformKit
  channels: ChannelStore
  canvas: StoryboardCanvasPort
  graph: StoryboardCanvasGraph
  projectName: string
  status: string
  setStatus: Dispatch<SetStateAction<string>>
  store: StoryboardStore
  docRef: MutableRefObject<StoryboardDoc | null>
  apply: (update: (current: StoryboardDoc) => StoryboardDoc) => StoryboardDoc
  replaceDoc: (doc: StoryboardDoc) => StoryboardDoc
  flush: () => Promise<void>
  selectedId: string
  setSelectedId: Dispatch<SetStateAction<string>>
  confirming: string
  setConfirming: Dispatch<SetStateAction<string>>
  merge: MergeState | null
  setMerge: Dispatch<SetStateAction<MergeState | null>>
  merges: MergeSuggestion[]
  setMerges: Dispatch<SetStateAction<MergeSuggestion[]>>
  mergeScan: NoticeState
  setMergeScan: Dispatch<SetStateAction<NoticeState>>
  mergeConfirmId: string
  setMergeConfirmId: Dispatch<SetStateAction<string>>
}

export function StoryboardEditorRuntime({
  projectId,
  doc,
  platform,
  channels,
  canvas,
  graph,
  projectName,
  status,
  setStatus,
  store,
  docRef,
  apply,
  replaceDoc,
  flush,
  selectedId,
  setSelectedId,
  confirming,
  setConfirming,
  merge,
  setMerge,
  merges,
  setMerges,
  mergeScan,
  setMergeScan,
  mergeConfirmId,
  setMergeConfirmId,
}: StoryboardEditorRuntimeProps) {
  const directTrace = useCallback(
    (args: {
      subjectId: string
      scopeId?: string
      kind: 'text' | 'video' | 'speech'
      channelId: string
      model: string
      payload: unknown
      inputs?: DirectRunTraceInput['inputs']
      params?: Record<string, unknown>
    }): DirectRunTraceInput => ({
      projectId,
      scopeVersion: 1,
      workbench: 'storyboard',
      subjectId: args.subjectId,
      scopeId: args.scopeId ?? projectId,
      operationId: createId('op'),
      inputs: args.inputs ?? [],
      params: {
        kind: args.kind,
        channelId: args.channelId,
        model: args.model,
        ...args.params,
      },
      fingerprint: fingerprintBytesSync(
        new TextEncoder().encode(
          JSON.stringify({
            kind: args.kind,
            channelId: args.channelId,
            model: args.model,
            payload: args.payload,
            params: args.params ?? {},
          }),
        ),
      ),
      sentChannelId: args.channelId,
      sentModel: args.model,
    }),
    [projectId],
  )
  const {
    digitalHumanTarget,
    videoUpscaleTargets,
    videoEditTargets,
    videoEraseTargets,
    videoExtendTargets,
    chatTarget,
    speechTarget,
  } = useStoryboardTargets(channels)
  const skills = useSkillsOptional()
  const navigate = useNavigate()
  const storyboardExecution = useStoryboardExecution()
  const [voiceBusy, setVoiceBusy] = useState<Record<string, boolean>>({})
  const [digitalHumanBusy, setDigitalHumanBusy] = useState<string | null>(null)
  const [videoUpscaleBusy, setVideoUpscaleBusy] = useState<string | null>(null)
  const [videoEraseBusy, setVideoEraseBusy] = useState<string | null>(null)
  const [videoEditBusy, setVideoEditBusy] = useState<string | null>(null)
  const [videoExtendBusy, setVideoExtendBusy] = useState<string | null>(null)
  const [breaking, setBreaking] = useState<NoticeState['kind']>('idle')
  const [breakMsg, setBreakMsg] = useState('')
  const [breakConfirm, setBreakConfirm] = useState(false)
  const breakAbort = useRef<AbortController | null>(null)
  const [lay, setLay] = useState<NoticeState>({ kind: 'idle', text: '' })
  const [preview, setPreview] = useState<{
    at: number
    playing: boolean
  } | null>(null)
  const [rendering, setRendering] = useState(false)
  const [sourcePreview, setSourcePreview] = useState<{
    title: string
    range?: { from: number; to: number }
    text: string
  } | null>(null)
  const [split, setSplit] = useState<NoticeState>({ kind: 'idle', text: '' })
  const [splitConfirm, setSplitConfirm] = useState(false)
  const splitAbort = useRef<AbortController | null>(null)

  useEffect(
    () => () => {
      breakAbort.current?.abort()
      splitAbort.current?.abort()
    },
    [],
  )

  useEffect(() => {
    setBreakConfirm(false)
    setBreaking('idle')
    setBreakMsg('')
  }, [selectedId])

  const stats = storyboardStats(doc)
  const episodes = doc.episodes
  const selected =
    episodes.find((episode) => episode.id === selectedId) ??
    episodes[0] ??
    null
  const shots = selected ? shotsOf(doc, selected.id) : []
  const selectedSourceText = selected
    ? episodeSourceText(doc, selected)
    : ''
  const selectedIndex = selected
    ? episodes.findIndex((episode) => episode.id === selected.id)
    : -1
  const liveNodeIds = new Set(graph.nodes.map((node) => node.id))
  const needNodes = shotsNeedingNode(shots, liveNodeIds)
  const laidCount = shots.filter(
    (shot) => shot.nodeId && liveNodeIds.has(shot.nodeId),
  ).length
  const videoPending = shots.filter(
    (shot) =>
      shot.nodeId &&
      liveNodeIds.has(shot.nodeId) &&
      shot.imageHash &&
      (!shot.videoHash ||
        !shot.videoNodeId ||
        !liveNodeIds.has(shot.videoNodeId)),
  ).length
  const voicePending = shots.reduce(
    (count, shot) =>
      count +
      shot.lines.filter((line) => line.text.trim() && !line.audioHash).length,
    0,
  )
  const timeline = selected
    ? episodeTimeline(doc, selected.id)
    : { clips: [], missing: [] }
  const timelineSrt = srtOf(timeline.clips)
  const timelineSrtCues = timelineSrt
    ? timelineSrt.split('-->').length - 1
    : 0

  const pick = (id: string) => {
    setSelectedId(id)
    setConfirming('')
  }
  const addOneEpisode = () => {
    const next = apply((current) => addEpisode(current, 0))
    setSelectedId(next.episodes[next.episodes.length - 1]?.id ?? '')
    setConfirming('')
  }
  const removeOneEpisode = (id: string) => {
    if (confirming !== `ep:${id}`) {
      setConfirming(`ep:${id}`)
      return
    }
    const at = episodes.findIndex((episode) => episode.id === id)
    const next = apply((current) => removeEpisode(current, id, 0))
    setConfirming('')
    if (selected?.id === id) {
      const fallback =
        next.episodes[Math.min(Math.max(at, 0), next.episodes.length - 1)]
      setSelectedId(fallback?.id ?? '')
    }
  }
  const addOneShot = () => {
    if (!selected) return
    apply((current) => addShot(current, selected.id, 0))
    setConfirming('')
  }
  const removeOneAsset = (kind: 'char' | 'scene', id: string) => {
    const key = `${kind}:${id}`
    if (confirming !== key) {
      setConfirming(key)
      return
    }
    apply((current) =>
      kind === 'char'
        ? removeCharacter(current, id, 0)
        : removeScene(current, id, 0),
    )
    setConfirming('')
  }
  const removeOneShot = (id: string) => {
    if (confirming !== `shot:${id}`) {
      setConfirming(`shot:${id}`)
      return
    }
    apply((current) => removeShot(current, id, 0))
    setConfirming('')
  }
  const patchShot = (
    id: string,
    patch: Partial<Omit<StoryboardShot, 'id' | 'episodeId' | 'lines'>>,
  ) => {
    apply((current) => updateShot(current, id, patch))
  }

  const videoActions = createStoryboardVideoExecutionController({
    currentDoc: () => docRef.current,
    graphNodes: graph.nodes,
    graphEdges: graph.edges,
    liveNodeIds,
    channels,
    storage: platform.storage,
    canvas,
    execution: storyboardExecution,
    documents: store,
    projectId,
    flush,
    replaceDoc,
    setLay,
    videoUpscaleBusy,
    setVideoUpscaleBusy,
    videoEraseBusy,
    setVideoEraseBusy,
    videoEditBusy,
    setVideoEditBusy,
    videoExtendBusy,
    setVideoExtendBusy,
  })
  const imageActions = createStoryboardImageExecutionController({
    doc,
    currentDoc: () => docRef.current,
    selectedEpisodeId: selected?.id,
    liveNodeIds,
    channels,
    canvas,
    execution: storyboardExecution,
    documents: store,
    projectId,
    flush,
    replaceDoc,
    setLay,
  })
  const digitalHumanActions =
    createStoryboardDigitalHumanExecutionController({
      currentDoc: () => docRef.current,
      graphNodes: graph.nodes,
      liveNodeIds,
      digitalHumanTarget,
      platform,
      storage: platform.storage,
      canvas,
      execution: storyboardExecution,
      documents: store,
      projectId,
      flush,
      replaceDoc,
      setLay,
      setDigitalHumanBusy,
    })
  const shotActions = createStoryboardShotController({
    doc,
    currentDoc: () => docRef.current,
    selected,
    shots,
    needNodes,
    graphNodes: graph.nodes,
    liveNodeIds,
    canvas,
    apply: replaceDoc,
    setLay,
  })
  const authoringActions = createStoryboardAuthoringController({
    doc,
    currentDoc: () => docRef.current,
    selected,
    shots,
    chatTarget,
    breakdownSkillContent: skills.skills.find(
      (skill) => skill.id === BREAKDOWN_SKILL_ID,
    )?.content,
    channels,
    projectId,
    directTrace,
    apply: replaceDoc,
    split,
    setSplit,
    splitConfirm,
    setSplitConfirm,
    splitAbort,
    breaking,
    setBreaking,
    setBreakMsg,
    breakConfirm,
    setBreakConfirm,
    breakAbort,
    setMergeScan,
    setMerges,
    setMergeConfirmId,
  })
  const audioActions = createStoryboardAudioController({
    doc,
    currentDoc: () => docRef.current ?? doc,
    selected,
    shots,
    speechTarget,
    platform,
    canvas,
    execution: storyboardExecution,
    documents: store,
    projectId,
    flush,
    apply: replaceDoc,
    setStatus,
    setVoiceBusy,
  })
  const exportActions = createStoryboardExportController({
    doc,
    projectName,
    episodes,
    selected,
    timelineSrt,
    timelineSrtCues,
    platform,
    flush,
    setStatus,
    setRendering,
  })

  const actions: StoryboardEditorActions = {
    selectEpisode: pick,
    addEpisode: addOneEpisode,
    removeEpisode: removeOneEpisode,
    moveEpisode: (id, delta) =>
      apply((current) => moveEpisode(current, id, delta, 0)),
    patchEpisode: (id, patch) =>
      apply((current) => updateEpisode(current, id, patch)),
    patchEpisodeVolume: (id, volume) =>
      apply((current) =>
        updateEpisode(current, id, { bgmVolume: volume }, Date.now()),
      ),
    patchScript: (patch) => apply((current) => updateScript(current, patch)),
    patchSourceText: (text) => {
      setSplitConfirm(false)
      apply((current) => updateSourceText(current, text, 0))
    },
    resetSplitConfirm: () => setSplitConfirm(false),
    openSource: setSourcePreview,
    closeSource: () => setSourcePreview(null),
    addCharacter: () => apply((current) => addCharacter(current, 0)),
    addScene: () => apply((current) => addScene(current, 0)),
    patchCharacter: (id, patch) =>
      apply((current) => updateCharacter(current, id, patch, 0)),
    patchScene: (id, patch) =>
      apply((current) => updateScene(current, id, patch, 0)),
    removeAsset: removeOneAsset,
    openMerge: (_kind, id) => {
      setConfirming('')
      setMerge({ dropId: id, keepId: null })
    },
    pickMerge: (_kind, id, keepId) => setMerge({ dropId: id, keepId }),
    confirmMerge: (kind, id) => {
      if (!merge || merge.dropId !== id || !merge.keepId) return
      const keepId = merge.keepId
      apply((current) => mergeAsset(current, kind, keepId, id, 0))
      setMerge(null)
    },
    cancelMerge: () => setMerge(null),
    handleMergeSuggestion: (suggestion) => {
      const key = `${suggestion.keepId}|${suggestion.dropIds.join(',')}`
      if (mergeConfirmId === key) authoringActions.acceptMerge(suggestion)
      else setMergeConfirmId(key)
    },
    addShot: addOneShot,
    removeShot: removeOneShot,
    moveShot: (id, delta) =>
      apply((current) => moveShot(current, id, delta, 0)),
    patchShot,
    addLine: (shotId) =>
      apply((current) => addShotLine(current, shotId, {}, 0)),
    patchLine: (shotId, lineId, patch) =>
      apply((current) => updateShotLine(current, shotId, lineId, patch, 0)),
    removeLine: (shotId, lineId) =>
      apply((current) => removeShotLine(current, shotId, lineId, 0)),
    bindScene: (shotId, sceneId) =>
      apply((current) => bindShotScene(current, shotId, sceneId, 0)),
    toggleCharacter: (shotId, characterId) =>
      apply((current) =>
        toggleShotCharacter(current, shotId, characterId, 0),
      ),
    openCanvas: () => navigate(projectRoute('canvas', projectId)),
    openShotOnCanvas: (nodeId) =>
      navigate(projectRoute('canvas', projectId, { focus: nodeId })),
    downloadVideo: (hash) =>
      void downloadAsset(
        { assets: platform.assets, files: platform.files },
        hash,
      ),
    openPreview: () => setPreview({ at: 0, playing: true }),
    previewAt: (at) => setPreview({ at, playing: true }),
    togglePreview: () =>
      setPreview((current) =>
        current ? { ...current, playing: !current.playing } : current,
      ),
    closePreview: () => setPreview(null),
  }

  const viewProps: StoryboardEditorViewProps = {
    projectId,
    projectName,
    status,
    doc,
    stats,
    episodes,
    selected,
    selectedIndex,
    shots,
    selectedSourceText,
    liveNodeIds,
    needNodes,
    laidCount,
    videoPending,
    voicePending,
    timeline,
    timelineSrt,
    timelineSrtCues,
    confirming,
    merge,
    merges,
    mergeScan,
    mergeConfirmId,
    split,
    splitConfirm,
    breaking,
    breakMsg,
    breakConfirm,
    lay,
    preview,
    sourcePreview,
    rendering,
    voiceBusy,
    digitalHumanBusy,
    videoUpscaleBusy,
    videoEraseBusy,
    videoEditBusy,
    videoExtendBusy,
    chatTarget,
    speechTarget,
    digitalHumanTarget,
    videoUpscaleTargets,
    videoEraseTargets,
    videoEditTargets,
    videoExtendTargets,
    canvas: {
      nodeStateOf: canvas.nodeStateOf,
      isRunning: canvas.isRunning,
    },
    canRenderLocally: Boolean(platform.cli),
    actions,
    imageActions,
    videoActions,
    digitalHumanActions,
    audioActions,
    authoringActions,
    exportActions,
    shotActions,
  }

  return <StoryboardEditorView {...viewProps} />
}
