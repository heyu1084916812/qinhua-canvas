import type { Dispatch, SetStateAction } from 'react'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import {
  buildStoryboardRunPlan,
  type StoryboardVideoPostprocessAction,
} from '../../features/storyboard/execution/storyboardRunPlan'
import type { StoryboardRunTarget } from '../../features/storyboard/execution/storyboardRunPlan'
import type {
  StoryboardDoc,
  StoryboardShot,
} from '../../domain/storyboard/storyboard'
import {
  attachShotVideos,
  mergeStoryboardRunResults,
  shotVideoPrompt,
  setShotVideoNode,
  shotsOf,
} from '../../domain/storyboard/storyboard'
import {
  videoUpscaleActionOf,
  type VideoUpscaleModelId,
} from '../../domain/storyboard/videoUpscale'
import type { VideoEraseModelId } from '../../domain/storyboard/videoErase'
import type { VideoEditModelId } from '../../domain/storyboard/videoEdit'
import type { VideoExtendModelId } from '../../domain/storyboard/videoExtend'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { Edge } from '../../domain/canvas/model/edge'
import { videoParamsFor } from '../../domain/canvas/layout/videoParams'
import { createId } from '../../shared/id'
import { asAppError, describeError } from '../../shared/result'

export interface VideoUpscaleTarget {
  channelId: string
  channelName: string
  model: VideoUpscaleModelId
  label: string
  resolutions: readonly string[]
  frameRates: readonly number[]
}

export interface VideoEraseTarget {
  channelId: string
  channelName: string
  model: VideoEraseModelId
  label: string
}

export interface VideoEditTarget {
  channelId: string
  channelName: string
  model: VideoEditModelId
  label: string
  resolutions: readonly string[]
  supportsReferenceImage: boolean
  requiresReferenceImage: boolean
}

export interface VideoExtendTarget {
  channelId: string
  channelName: string
  model: VideoExtendModelId
  label: string
  resolutions: readonly string[]
  durations: readonly number[]
}

export interface StoryboardVideoExecutionControllerArgs {
  currentDoc: () => StoryboardDoc | null
  graphNodes: readonly NodeSnapshot[]
  graphEdges: readonly Edge[]
  liveNodeIds: ReadonlySet<string>
  channels: ChannelStore
  canvas: StoryboardCanvasPort
  execution: StoryboardExecutionApi
  documents: StoryboardDocumentPort
  projectId: string
  flush: () => Promise<void>
  replaceDoc: (doc: StoryboardDoc) => void
  setLay: Dispatch<
    SetStateAction<{
      kind: 'idle' | 'running' | 'done' | 'error'
      text: string
    }>
  >
  videoUpscaleBusy: string | null
  setVideoUpscaleBusy: Dispatch<SetStateAction<string | null>>
  videoEraseBusy: string | null
  setVideoEraseBusy: Dispatch<SetStateAction<string | null>>
  videoEditBusy: string | null
  setVideoEditBusy: Dispatch<SetStateAction<string | null>>
  videoExtendBusy: string | null
  setVideoExtendBusy: Dispatch<SetStateAction<string | null>>
}

function humanError(error: unknown): string {
  const appError = asAppError(error)
  return appError
    ? describeError(appError)
    : error instanceof Error
      ? error.message
      : String(error)
}

export function createStoryboardVideoExecutionController(
  args: StoryboardVideoExecutionControllerArgs,
) {
  const {
    currentDoc,
    graphNodes,
    graphEdges,
    liveNodeIds,
    channels,
    canvas,
    execution,
    documents,
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
  } = args

  const sourceNodeOf = (shot: StoryboardShot) =>
    shot.videoNodeId
      ? graphNodes.find((node) => node.id === shot.videoNodeId)
      : undefined

  const makeShotVideo = async (
    shot: StoryboardShot,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> => {
    const report = (kind: 'running' | 'done' | 'error', text: string) => {
      if (!options.quiet) setLay({ kind, text })
    }
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId)) {
      report('error', '这一镜还没铺到画布 —— 先铺一次，出了图再出视频')
      return false
    }
    if (!shot.imageHash) {
      report('error', '这一镜还没有图 —— 图生视频要先有画面，先点「出图」')
      return false
    }
    const document = currentDoc()
    if (!document) {
      report('error', '漫剧文档还没有加载完成')
      return false
    }
    const existingVideoNode =
      shot.videoNodeId && liveNodeIds.has(shot.videoNodeId)
        ? graphNodes.find((node) => node.id === shot.videoNodeId)
        : undefined
    let recipe:
      | Awaited<ReturnType<ChannelStore['defaultForNewNode']>>
      | null = null
    try {
      recipe = await channels.defaultForNewNode(
        existingVideoNode?.data as
          | { channelId?: string; model?: string }
          | undefined ?? {},
        'video',
      )
    } catch (error) {
      report('error', humanError(error))
      return false
    }
    if (!recipe?.channelId || !recipe.model) {
      report(
        'error',
        '还没有可用的视频模型服务 —— 先去「全局设置 → 模型服务」添加一条并勾上视频模型',
      )
      return false
    }
    const liveChannel = channels
      .getState()
      .channels.find((channel) => channel.id === recipe.channelId)
    const logicalModel =
      Object.entries(liveChannel?.modelMap ?? {}).find(
        ([, upstream]) => upstream === recipe.model,
      )?.[0] ?? recipe.model
    const videoSpec = videoParamsFor(logicalModel)
    const episodeShots = shotsOf(document, shot.episodeId)
    const shotIndex = episodeShots.findIndex((item) => item.id === shot.id)
    const nextShot =
      shotIndex >= 0 ? episodeShots[shotIndex + 1] : undefined
    const nextFrameNodeId =
      nextShot?.nodeId &&
      nextShot.imageHash &&
      liveNodeIds.has(nextShot.nodeId)
        ? nextShot.nodeId
        : ''
    const supportsFirstLastFrame =
      !!nextFrameNodeId &&
      (videoSpec
        ? videoSpec.modes.includes('first-last-frame')
        : true)
    const endFrameNodeId = supportsFirstLastFrame ? nextFrameNodeId : ''
    const singleImageMode = videoSpec?.modes.includes('image-to-video')
      ? 'image-to-video'
      : videoSpec?.modes.includes('all-purpose')
        ? 'all-purpose'
        : undefined
    const videoMode = endFrameNodeId
      ? 'first-last-frame'
      : singleImageMode
    const imageNode = graphNodes.find((node) => node.id === shot.nodeId)
    const nextImageNode = nextFrameNodeId
      ? graphNodes.find((node) => node.id === nextFrameNodeId)
      : undefined
    const imageMime =
      (imageNode?.data as { assetMime?: string } | undefined)?.assetMime ??
      'image/png'
    const nextImageMime =
      (nextImageNode?.data as { assetMime?: string } | undefined)?.assetMime ??
      'image/png'
    const plan = buildStoryboardRunPlan({
      doc: document,
      planId: createId('plan'),
      operationId: createId('op'),
      target: {
        channelId: recipe.channelId,
        model: recipe.model,
        modelIsUpstream: false,
        params: {
          ...recipe.params,
          count: 1,
          ...(videoMode ? { videoMode } : {}),
        },
      },
      action: 'shot-video',
      episodeId: shot.episodeId,
      shotIds: [shot.id],
      includeNextShotEndFrame: !!endFrameNodeId,
      imageMime,
      nextImageMime,
    })

    report(
      'running',
      endFrameNodeId
        ? '这一镜的视频在跑（首尾帧：接到下一镜的画面）…'
        : nextFrameNodeId
          ? '这一镜的视频在跑（当前视频模型不支持首尾帧，按单张首帧生成）…'
          : '这一镜的视频在跑…',
    )
    const timer = globalThis.setTimeout(
      () => execution.cancel(plan.id),
      20 * 60 * 1000,
    )
    try {
      await flush()
      const outcome = await execution.run(plan)
      const businessFailure = outcome.failures[0]
      if (businessFailure) throw new Error(businessFailure.errorText)
      const task = plan.tasks[0]!
      const result = outcome.summary.taskResults.find(
        (item) => item.taskId === task.id,
      )?.state
      if (result?.kind !== 'succeeded') {
        throw new Error(
          result?.kind === 'failed'
            ? describeError(result.error)
            : '视频生成没有返回可用结果',
        )
      }
      const output = result.result[0]
      if (!output || !output.mime.toLowerCase().startsWith('video/')) {
        throw new Error('视频生成没有返回视频产物')
      }
      const latest = await documents.load(projectId)
      const merged = mergeStoryboardRunResults(
        currentDoc() ?? latest,
        latest,
        Date.now(),
      )
      const prompt = shotVideoPrompt(
        document,
        shot,
        endFrameNodeId ? nextShot : undefined,
      )
      const data = await canvas.resolveGenerationData({
        mode: 'video',
        channelId: recipe.channelId,
        model: recipe.model,
        prompt,
        count: 1,
        durationSec: shot.durationSec,
        ...(videoMode ? { videoMode } : {}),
        assetHash: output.hash,
        assetMime: output.mime,
      })
      let videoNodeId =
        shot.videoNodeId && liveNodeIds.has(shot.videoNodeId)
          ? shot.videoNodeId
          : ''
      canvas.beginPlan('storyboard:shot-video', '这一镜出视频')
      try {
        if (videoNodeId) {
          canvas.updateNodeData(videoNodeId, data)
        } else {
          videoNodeId =
            canvas.createGenerationNode({
              at: {
                x: (imageNode?.x ?? 40) + 280,
                y: imageNode?.y ?? 40,
              },
              data,
            }) ?? ''
        }
        if (videoNodeId) {
          const connected = new Set(
            graphEdges
              .filter((edge) => edge.target === videoNodeId)
              .map((edge) => edge.source),
          )
          if (
            shot.videoEndNodeId &&
            shot.videoEndNodeId !== endFrameNodeId &&
            connected.has(shot.videoEndNodeId)
          ) {
            const old = graphEdges.find(
              (edge) =>
                edge.source === shot.videoEndNodeId &&
                edge.target === videoNodeId,
            )
            if (old) {
              canvas.removeEdge(old.id)
              connected.delete(shot.videoEndNodeId)
            }
          }
          if (!connected.has(shot.nodeId)) {
            canvas.connectEdge(shot.nodeId, videoNodeId)
          }
          if (endFrameNodeId && !connected.has(endFrameNodeId)) {
            canvas.connectEdge(endFrameNodeId, videoNodeId)
          }
        }
      } finally {
        canvas.endPlan()
      }
      if (!videoNodeId) {
        throw new Error('视频节点没能建出来（模型服务或模型没配全）')
      }
      const withNode = setShotVideoNode(
        merged,
        shot.id,
        videoNodeId,
        0,
        endFrameNodeId,
      )
      replaceDoc(
        attachShotVideos(
          withNode,
          [{ shotId: shot.id, hash: output.hash }],
          0,
        ),
      )
      report(
        'done',
        endFrameNodeId
          ? '这一镜的视频已出（用了这一镜与下一镜的首尾帧）'
          : '这一镜的视频已出（画布里就挂在这一镜的图右边）',
      )
      return true
    } catch (error) {
      const message = humanError(error)
      report(
        'error',
        message.includes('视频节点没能建出来')
          ? message
          : `这一镜的视频生成失败：${message}`,
      )
      return false
    } finally {
      globalThis.clearTimeout(timer)
    }
  }

  const runEpisodeVideos = async (
    shots: readonly StoryboardShot[],
  ): Promise<void> => {
    const targets = shots.filter(
      (shot) =>
        shot.nodeId &&
        liveNodeIds.has(shot.nodeId) &&
        shot.imageHash &&
        (!shot.videoHash ||
          !shot.videoNodeId ||
          !liveNodeIds.has(shot.videoNodeId)),
    )
    if (targets.length === 0) {
      setLay({
        kind: 'done',
        text: '这一集没有待出视频的镜头（要重出请用单镜那把）',
      })
      return
    }
    let ok = 0
    let failed = 0
    for (let index = 0; index < targets.length; index += 1) {
      setLay({
        kind: 'running',
        text: `这一集出视频 ${index + 1}/${targets.length}：第 ${
          shots.indexOf(targets[index]!) + 1
        } 镜…`,
      })
      const success = await makeShotVideo(targets[index]!, { quiet: true })
      if (success) ok += 1
      else failed += 1
    }
    setLay({
      kind: failed > 0 ? 'error' : 'done',
      text:
        failed > 0
          ? `这一集视频跑完：成功 ${ok} 镜，失败 ${failed} 镜（失败原因见各自状态）`
          : `这一集 ${ok} 镜视频已出`,
    })
  }

  const runPostprocess = async (input: {
    shot: StoryboardShot
    action: StoryboardVideoPostprocessAction
    target: StoryboardRunTarget
    prompt: string
    params: Record<string, unknown>
    includeReferenceImage?: boolean
    sourceNode: NodeSnapshot
    referenceNode?: NodeSnapshot | null
    runningText: string
    successText: string
    transactionLabel: string
    setBusy: Dispatch<SetStateAction<string | null>>
  }) => {
    const document = currentDoc()
    if (!document) {
      setLay({ kind: 'error', text: '漫剧文档还没有加载完成' })
      return false
    }
    const sourceMime =
      (input.sourceNode.data as { assetMime?: string }).assetMime ??
      'video/mp4'
    const referenceMime =
      (input.referenceNode?.data as { assetMime?: string } | undefined)
        ?.assetMime ?? 'image/png'
    const plan = buildStoryboardRunPlan({
      doc: document,
      planId: createId('plan'),
      operationId: createId('op'),
      target: input.target,
      action: input.action,
      episodeId: input.shot.episodeId,
      shotIds: [input.shot.id],
      prompt: input.prompt,
      params: input.params,
      videoMime: sourceMime,
      referenceImageMime: referenceMime,
      includeReferenceImage: input.includeReferenceImage,
    })

    input.setBusy(input.shot.id)
    setLay({ kind: 'running', text: input.runningText })
    const timer = globalThis.setTimeout(
      () => execution.cancel(plan.id),
      20 * 60 * 1000,
    )
    try {
      await flush()
      const outcome = await execution.run(plan)
      const failure = outcome.failures[0]
      if (failure) throw new Error(failure.errorText)
      const task = plan.tasks[0]!
      const result = outcome.summary.taskResults.find(
        (item) => item.taskId === task.id,
      )?.state
      if (result?.kind !== 'succeeded') {
        throw new Error(
          result?.kind === 'failed'
            ? describeError(result.error)
            : '视频后处理没有返回可用结果',
        )
      }
      const output = result.result[0]
      if (!output || !output.mime.toLowerCase().startsWith('video/')) {
        throw new Error('视频后处理没有返回视频产物')
      }

      const latest = await documents.load(projectId)
      const merged = mergeStoryboardRunResults(
        currentDoc() ?? latest,
        latest,
        Date.now(),
      )
      let videoNodeId = ''
      const data = await canvas.resolveGenerationData({
        mode: 'video',
        channelId: input.target.channelId,
        model: input.target.model,
        prompt: input.prompt,
        ...input.params,
        durationSec: input.shot.durationSec,
        assetHash: output.hash,
        assetMime: output.mime,
      })
      canvas.beginPlan(`storyboard:${input.action}`, input.transactionLabel)
      try {
        videoNodeId =
          canvas.createGenerationNode({
            at: {
              x: input.sourceNode.x + 320,
              y: input.sourceNode.y,
            },
            data,
          }) ?? ''
        if (videoNodeId) {
          canvas.connectEdge(input.shot.videoNodeId!, videoNodeId)
          if (input.referenceNode) {
            canvas.connectEdge(input.referenceNode.id, videoNodeId)
          }
        }
      } finally {
        canvas.endPlan()
      }
      const withNode = videoNodeId
        ? setShotVideoNode(merged, input.shot.id, videoNodeId, 0)
        : merged
      replaceDoc(
        attachShotVideos(
          withNode,
          [{ shotId: input.shot.id, hash: output.hash }],
          0,
        ),
      )
      if (!videoNodeId) {
        throw new Error('视频后处理节点没能建出来')
      }
      setLay({ kind: 'done', text: input.successText })
      return true
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
      return false
    } finally {
      globalThis.clearTimeout(timer)
      input.setBusy(null)
    }
  }

  const makeVideoUpscale = async (
    shot: StoryboardShot,
    target: VideoUpscaleTarget,
    resolution: string,
    frameRate: number | null,
  ) => {
    if (videoUpscaleBusy) return
    if (
      !shot.videoHash ||
      !shot.videoNodeId ||
      !liveNodeIds.has(shot.videoNodeId)
    ) {
      setLay({ kind: 'error', text: '这一镜还没有可超清的视频节点' })
      return
    }
    const sourceNode = sourceNodeOf(shot)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const action = videoUpscaleActionOf(target.model)
    const actionLabel = action === 'fps' ? '补帧' : '超清'
    await runPostprocess({
      shot,
      action: action === 'fps' ? 'video-fps' : 'video-upscale',
      target: { channelId: target.channelId, model: target.model },
      prompt: `视频${actionLabel}`,
      params: {
        ...(resolution ? { resolution } : {}),
        ...(frameRate !== null ? { fps: String(frameRate) } : {}),
      },
      sourceNode,
      runningText: `正在用 ${target.model} 处理这一镜…`,
      successText:
        action === 'fps'
          ? '这一镜的视频补帧已完成'
          : `这一镜已生成 ${resolution}${frameRate !== null ? ` · ${frameRate}fps` : ''} 超清视频`,
      transactionLabel: `镜头视频${actionLabel}`,
      setBusy: setVideoUpscaleBusy,
    })
  }

  const makeVideoErase = async (
    shot: StoryboardShot,
    target: VideoEraseTarget,
  ) => {
    if (videoEraseBusy) return
    if (
      !shot.videoHash ||
      !shot.videoNodeId ||
      !liveNodeIds.has(shot.videoNodeId)
    ) {
      setLay({ kind: 'error', text: '这一镜还没有可擦除字幕的视频节点' })
      return
    }
    const sourceNode = sourceNodeOf(shot)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    await runPostprocess({
      shot,
      action: 'video-erase',
      target: { channelId: target.channelId, model: target.model },
      prompt: '',
      params: {},
      sourceNode,
      runningText: `正在用 ${target.model} 擦除这一镜的字幕…`,
      successText: '这一镜的字幕已擦除，新视频已保存',
      transactionLabel: '镜头视频字幕擦除',
      setBusy: setVideoEraseBusy,
    })
  }

  const makeVideoEdit = async (
    shot: StoryboardShot,
    target: VideoEditTarget,
    instruction: string,
    resolution: string,
    useReferenceImage: boolean,
  ) => {
    if (videoEditBusy) return
    const prompt = instruction.trim()
    if (!prompt) {
      setLay({ kind: 'error', text: '先写清这段视频要改什么' })
      return
    }
    if (
      !shot.videoHash ||
      !shot.videoNodeId ||
      !liveNodeIds.has(shot.videoNodeId)
    ) {
      setLay({ kind: 'error', text: '这一镜还没有可编辑的视频节点' })
      return
    }
    const sourceNode = sourceNodeOf(shot)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const referenceNode =
      useReferenceImage && shot.nodeId && liveNodeIds.has(shot.nodeId)
        ? graphNodes.find((node) => node.id === shot.nodeId)
        : null
    if (
      useReferenceImage &&
      (!target.supportsReferenceImage || !referenceNode || !shot.imageHash)
    ) {
      setLay({ kind: 'error', text: '这一镜没有可引用的画面，取消参考图后再试' })
      return
    }
    if (target.requiresReferenceImage && !useReferenceImage) {
      setLay({ kind: 'error', text: '这个模型必须参考当前镜头画面' })
      return
    }
    await runPostprocess({
      shot,
      action: 'video-edit',
      target: { channelId: target.channelId, model: target.model },
      prompt,
      params: resolution ? { resolution } : {},
      includeReferenceImage: useReferenceImage,
      sourceNode,
      referenceNode,
      runningText: `正在用 ${target.model} 编辑这一镜…`,
      successText: resolution
        ? `这一镜的视频已按 ${resolution} 编辑完成${referenceNode ? '（已参考当前画面）' : ''}`
        : `这一镜的视频已编辑完成${referenceNode ? '（已参考当前画面）' : ''}`,
      transactionLabel: '镜头视频编辑',
      setBusy: setVideoEditBusy,
    })
  }

  const makeVideoExtend = async (
    shot: StoryboardShot,
    target: VideoExtendTarget,
    instruction: string,
    resolution: string,
    duration: number | null,
  ) => {
    if (videoExtendBusy) return
    if (
      !shot.videoHash ||
      !shot.videoNodeId ||
      !liveNodeIds.has(shot.videoNodeId)
    ) {
      setLay({ kind: 'error', text: '这一镜还没有可续写的视频节点' })
      return
    }
    const sourceNode = sourceNodeOf(shot)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    await runPostprocess({
      shot,
      action: 'video-extend',
      target: { channelId: target.channelId, model: target.model },
      prompt:
        instruction.trim() ||
        '延续当前镜头内容与运动，保持人物、场景和画风一致',
      params: {
        ...(resolution ? { resolution } : {}),
        ...(duration !== null ? { duration } : {}),
      },
      sourceNode,
      runningText: `正在用 ${target.model} 续写这一镜…`,
      successText:
        duration !== null
          ? `这一镜已续写 ${duration} 秒${resolution ? ` · ${resolution}` : ''}`
          : `这一镜已按 ${resolution} 续写完成`,
      transactionLabel: '镜头视频续写',
      setBusy: setVideoExtendBusy,
    })
  }

  return {
    makeShotVideo,
    runEpisodeVideos,
    makeVideoUpscale,
    makeVideoErase,
    makeVideoEdit,
    makeVideoExtend,
  }
}
