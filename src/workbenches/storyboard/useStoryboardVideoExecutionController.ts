import type { Dispatch, SetStateAction } from 'react'
import type { ChannelStore } from '../../state/channel/channelStore'
import type {
  StoryboardCanvasEdge,
  StoryboardCanvasNode,
  StoryboardCanvasPort,
} from '../../features/storyboard/canvasPort'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import {
  buildStoryboardRunPlan,
  type StoryboardVideoPostprocessAction,
} from '../../features/storyboard/execution/storyboardRunPlan'
import type { StoryboardRunTarget } from '../../features/storyboard/execution/storyboardRunPlan'
import type { StoryboardRunPlan } from '../../domain/storyboard/runTypes'
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
import { videoParamsFor } from '../../domain/storyboard/videoParams'
import type { StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import { asAppError, describeError } from '../../shared/result'
import type {
  StoryboardActionKind,
  StoryboardActionStatePort,
} from './useStoryboardActionState'

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
  graphNodes: readonly StoryboardCanvasNode[]
  graphEdges: readonly StoryboardCanvasEdge[]
  liveNodeIds: ReadonlySet<string>
  channels: ChannelStore
  storage: StoragePort
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
  actionState: Pick<StoryboardActionStatePort, 'tryAcquire'>
}

interface PreparedShotVideo {
  shot: StoryboardShot
  channelId: string
  model: string
  params: Record<string, unknown>
  videoMode?: string
  endFrameNodeId: string
  endFrameShot?: StoryboardShot
  nextFrameAvailable: boolean
  imageNode?: StoryboardCanvasNode
  imageMime: string
  endFrameMime: string
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
    storage,
    canvas,
    execution,
    documents,
    projectId,
    flush,
    replaceDoc,
    setLay,
    actionState,
  } = args

  const sourceNodeOf = (shot: StoryboardShot) =>
    shot.videoNodeId
      ? graphNodes.find((node) => node.id === shot.videoNodeId)
      : undefined

  const parentRunIdOf = async (shot: StoryboardShot): Promise<string | undefined> => {
    const rows = await storage.query('runRecords', {
      projectId,
      workbench: 'storyboard',
      subjectId: `shot:${shot.id}`,
    })
    const allowed = new Set([
      'shot-video',
      'video-upscale',
      'video-fps',
      'video-erase',
      'video-edit',
      'video-extend',
      'digital-human',
    ])
    return rows
      .map((row) => row as unknown as {
        id?: unknown
        createdAt?: unknown
        status?: unknown
        params?: unknown
      })
      .filter((row) => {
        const action =
          row.params && typeof row.params === 'object'
            ? (row.params as Record<string, unknown>).action
            : undefined
        return (
          row.status === 'succeeded' &&
          typeof row.id === 'string' &&
          typeof action === 'string' &&
          allowed.has(action)
        )
      })
      .sort(
        (left, right) =>
          Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
      )[0]?.id as string | undefined
  }

  const prepareShotVideo = async (
    shot: StoryboardShot,
    document: StoryboardDoc,
  ): Promise<PreparedShotVideo> => {
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId)) {
      throw new Error('这一镜还没铺到画布 —— 先铺一次，出了图再出视频')
    }
    if (!shot.imageHash) {
      throw new Error('这一镜还没有图 —— 图生视频要先有画面，先点「出图」')
    }
    const imageNode = graphNodes.find((node) => node.id === shot.nodeId)
    if (!imageNode) {
      throw new Error('这一镜的画面节点已经不在画布上')
    }
    const existingVideoNode =
      shot.videoNodeId && liveNodeIds.has(shot.videoNodeId)
        ? graphNodes.find((node) => node.id === shot.videoNodeId)
        : undefined
    const recipe = await channels.defaultForNewNode(
      existingVideoNode?.data as
        | { channelId?: string; model?: string }
        | undefined ?? {},
      'video',
    )
    if (!recipe?.channelId || !recipe.model) {
      throw new Error(
        '还没有可用的视频模型服务 —— 先去「全局设置 → 模型服务」添加一条并勾上视频模型',
      )
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
    if (shotIndex < 0) {
      throw new Error('这一镜已经从分集中删除')
    }
    const nextShot = episodeShots[shotIndex + 1]
    const nextImageNode =
      nextShot?.nodeId &&
      nextShot.imageHash &&
      liveNodeIds.has(nextShot.nodeId)
        ? graphNodes.find((node) => node.id === nextShot.nodeId)
        : undefined
    const nextFrameNodeId = nextImageNode?.id ?? ''
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
    return {
      shot,
      channelId: recipe.channelId,
      model: recipe.model,
      params: recipe.params,
      ...((endFrameNodeId ? 'first-last-frame' : singleImageMode)
        ? {
            videoMode: endFrameNodeId
              ? 'first-last-frame'
              : singleImageMode,
          }
        : {}),
      endFrameNodeId,
      ...(endFrameNodeId && nextShot ? { endFrameShot: nextShot } : {}),
      nextFrameAvailable: !!nextFrameNodeId,
      imageNode,
      imageMime:
        (imageNode.data as { assetMime?: string }).assetMime ?? 'image/png',
      endFrameMime:
        (nextImageNode?.data as { assetMime?: string } | undefined)
          ?.assetMime ?? 'image/png',
    }
  }

  const buildShotVideoPlan = (
    document: StoryboardDoc,
    prepared: readonly PreparedShotVideo[],
  ): StoryboardRunPlan => {
    const first = prepared[0]
    if (!first) throw new Error('漫剧执行计划没有匹配的镜头')
    if (prepared.some((item) => item.shot.episodeId !== first.shot.episodeId)) {
      throw new Error('同一个视频执行计划不能跨分集')
    }
    const byShotId = new Map(
      prepared.map((item) => [item.shot.id, item] as const),
    )
    return buildStoryboardRunPlan({
      doc: document,
      planId: createId('plan'),
      operationId: createId('op'),
      target: ({ action, subject }) => {
        if (action !== 'shot-video' || subject.kind !== 'shot-video') {
          throw new Error('视频执行计划收到了错误的业务主体')
        }
        const item = byShotId.get(subject.shotId)
        if (!item) throw new Error(`镜头缺少执行模型：${subject.shotId}`)
        return {
          channelId: item.channelId,
          model: item.model,
          modelIsUpstream: false,
          params: {
            ...item.params,
            count: 1,
            ...(item.videoMode ? { videoMode: item.videoMode } : {}),
          },
        }
      },
      action: 'shot-video',
      episodeId: first.shot.episodeId,
      shotIds: prepared.map((item) => item.shot.id),
      shotVideoInputs: (shot, nextShot) => {
        const item = byShotId.get(shot.id)
        return {
          includeEndFrame:
            !!item?.endFrameNodeId &&
            !!nextShot &&
            item.endFrameShot?.id === nextShot.id,
          ...(item ? { imageMime: item.imageMime } : {}),
          ...(item ? { endFrameMime: item.endFrameMime } : {}),
        }
      },
    })
  }

  const executePlan = async (plan: StoryboardRunPlan) => {
    const timer = globalThis.setTimeout(
      () => execution.cancel(plan.id),
      20 * 60 * 1000,
    )
    try {
      await flush()
      return await execution.run(plan)
    } finally {
      globalThis.clearTimeout(timer)
    }
  }

  const loadMergedDocument = async () => {
    const latest = await documents.load(projectId)
    return mergeStoryboardRunResults(
      currentDoc() ?? latest,
      latest,
      Date.now(),
    )
  }

  const projectVideoResults = async (
    document: StoryboardDoc,
    plan: StoryboardRunPlan,
    outcome: Awaited<ReturnType<StoryboardExecutionApi['run']>>,
    prepared: readonly PreparedShotVideo[],
  ): Promise<StoryboardDoc> => {
    type PendingProjection = {
      taskId: string
      shot: StoryboardShot
      prepared: PreparedShotVideo
      data: Record<string, unknown>
      hash: string
    }
    const taskByShotId = new Map(
      plan.tasks.flatMap((task) =>
        task.subject.kind === 'shot-video'
          ? [[task.subject.shotId, task] as const]
          : [],
      ),
    )
    const businessFailures = new Set(
      outcome.failures.map((failure) => failure.taskId),
    )
    const pending: PendingProjection[] = []
    for (const preparedItem of prepared) {
      const task = taskByShotId.get(preparedItem.shot.id)
      if (!task) continue
      if (businessFailures.has(task.id)) continue
      const state = outcome.summary.taskResults.find(
        (item) => item.taskId === task.id,
      )?.state
      if (state?.kind !== 'succeeded') continue
      const asset = state.result.find((item) =>
        item.mime.toLowerCase().startsWith('video/'),
      )
      if (!asset) continue
      const shot = document.shots.find(
        (item) => item.id === preparedItem.shot.id,
      )
      if (!shot || shot.videoHash !== asset.hash) continue
      const prompt = shotVideoPrompt(
        document,
        shot,
        preparedItem.endFrameNodeId
          ? preparedItem.endFrameShot
          : undefined,
      )
      const data = await canvas.resolveGenerationData({
        mode: 'video',
        channelId: preparedItem.channelId,
        model: preparedItem.model,
        prompt,
        count: 1,
        durationSec: shot.durationSec,
        ...(preparedItem.videoMode
          ? { videoMode: preparedItem.videoMode }
          : {}),
        assetHash: asset.hash,
        assetMime: asset.mime,
      })
      pending.push({
        taskId: task.id,
        shot,
        prepared: preparedItem,
        data,
        hash: asset.hash,
      })
    }
    if (pending.length === 0) return document

    const nodeIdByTask = new Map<string, string>()
    canvas.beginPlan(
      plan.tasks.length > 1
        ? 'storyboard:episode-video'
        : 'storyboard:shot-video',
      plan.tasks.length > 1 ? '这一集出视频' : '这一镜出视频',
    )
    try {
      for (const item of pending) {
        let videoNodeId =
          item.shot.videoNodeId && liveNodeIds.has(item.shot.videoNodeId)
            ? item.shot.videoNodeId
            : ''
        if (videoNodeId) {
          canvas.updateNodeData(videoNodeId, item.data)
        } else {
          videoNodeId =
            canvas.createGenerationNode({
              at: {
                x: (item.prepared.imageNode?.x ?? 40) + 280,
                y: item.prepared.imageNode?.y ?? 40,
              },
              data: item.data,
            }) ?? ''
        }
        if (!videoNodeId) {
          throw new Error('视频节点没能建出来（模型服务或模型没配全）')
        }
        const connected = new Set(
          graphEdges
            .filter((edge) => edge.target === videoNodeId)
            .map((edge) => edge.source),
        )
        if (
          item.shot.videoEndNodeId &&
          item.shot.videoEndNodeId !== item.prepared.endFrameNodeId &&
          connected.has(item.shot.videoEndNodeId)
        ) {
          const old = graphEdges.find(
            (edge) =>
              edge.source === item.shot.videoEndNodeId &&
              edge.target === videoNodeId,
          )
          if (old) {
            canvas.removeEdge(old.id)
            connected.delete(item.shot.videoEndNodeId)
          }
        }
        if (
          item.shot.nodeId &&
          !connected.has(item.shot.nodeId)
        ) {
          canvas.connectEdge(item.shot.nodeId, videoNodeId)
        }
        if (
          item.prepared.endFrameNodeId &&
          !connected.has(item.prepared.endFrameNodeId)
        ) {
          canvas.connectEdge(item.prepared.endFrameNodeId, videoNodeId)
        }
        nodeIdByTask.set(item.taskId, videoNodeId)
      }
    } finally {
      canvas.endPlan()
    }

    let projected = document
    for (const item of pending) {
      const videoNodeId = nodeIdByTask.get(item.taskId)
      if (!videoNodeId) continue
      projected = setShotVideoNode(
        projected,
        item.shot.id,
        videoNodeId,
        0,
        item.prepared.endFrameNodeId,
      )
    }
    return attachShotVideos(
      projected,
      pending.map((item) => ({ shotId: item.shot.id, hash: item.hash })),
      0,
    )
  }

  const makeShotVideo = async (
    shot: StoryboardShot,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> => {
    const report = (kind: 'running' | 'done' | 'error', text: string) => {
      if (!options.quiet) setLay({ kind, text })
    }
    const document = currentDoc()
    if (!document) {
      report('error', '漫剧文档还没有加载完成')
      return false
    }
    let prepared: PreparedShotVideo
    try {
      prepared = await prepareShotVideo(shot, document)
    } catch (error) {
      report('error', humanError(error))
      return false
    }
    const plan = buildShotVideoPlan(document, [prepared])
    report(
      'running',
      prepared.endFrameNodeId
        ? '这一镜的视频在跑（首尾帧：接到下一镜的画面）…'
        : prepared.nextFrameAvailable
          ? '这一镜的视频在跑（当前视频模型不支持首尾帧，按单张首帧生成）…'
          : '这一镜的视频在跑…',
    )
    try {
      const outcome = await executePlan(plan)
      const task = plan.tasks[0]!
      const result = outcome.summary.taskResults.find(
        (item) => item.taskId === task.id,
      )?.state
      if (result?.kind !== 'succeeded') {
        throw new Error(
          result?.kind === 'failed'
            ? describeError(result.error)
            : result?.kind === 'canceled'
              ? '视频生成已取消'
              : '视频生成没有返回可用结果',
        )
      }
      const businessFailure = outcome.failures.find(
        (failure) => failure.taskId === task.id,
      )
      if (businessFailure) throw new Error(businessFailure.errorText)
      const merged = await loadMergedDocument()
      const projected = await projectVideoResults(
        merged,
        plan,
        outcome,
        [prepared],
      )
      replaceDoc(projected)
      await flush()
      report(
        'done',
        prepared.endFrameNodeId
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
    const document = currentDoc()
    if (!document) {
      setLay({ kind: 'error', text: '漫剧文档还没有加载完成' })
      return
    }
    let prepared: PreparedShotVideo[]
    try {
      prepared = []
      for (const shot of targets) {
        prepared.push(await prepareShotVideo(shot, document))
      }
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
      return
    }
    const plan = buildShotVideoPlan(document, prepared)
    setLay({
      kind: 'running',
      text: `这一集出视频：${prepared.length} 镜已同时开始…`,
    })
    try {
      const outcome = await executePlan(plan)
      const merged = await loadMergedDocument()
      const projected = await projectVideoResults(
        merged,
        plan,
        outcome,
        prepared,
      )
      replaceDoc(projected)
      await flush()
      const businessFailures = new Set(
        outcome.failures.map((failure) => failure.taskId),
      )
      let ok = 0
      let failed = 0
      let canceled = 0
      for (const task of plan.tasks) {
        const state = outcome.summary.taskResults.find(
          (item) => item.taskId === task.id,
        )?.state
        if (state?.kind === 'succeeded' && !businessFailures.has(task.id)) {
          ok += 1
        } else if (state?.kind === 'canceled') {
          canceled += 1
        } else {
          failed += 1
        }
      }
      setLay({
        kind: failed > 0 || canceled > 0 ? 'error' : 'done',
        text:
          canceled > 0
            ? `这一集视频结束：成功 ${ok} 镜，取消 ${canceled} 镜，失败 ${failed} 镜`
            : failed > 0
              ? `这一集视频跑完：成功 ${ok} 镜，失败 ${failed} 镜（失败原因见各自状态）`
              : `这一集 ${ok} 镜视频已出`,
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    }
  }

  const runPostprocessWithLease = async (input: {
    shot: StoryboardShot
    action: StoryboardVideoPostprocessAction
    target: StoryboardRunTarget
    prompt: string
    params: Record<string, unknown>
    includeReferenceImage?: boolean
    sourceNode: StoryboardCanvasNode
    referenceNode?: StoryboardCanvasNode | null
    runningText: string
    successText: string
    transactionLabel: string
    busyKind: StoryboardActionKind
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
    let parentRunId: string | undefined
    try {
      parentRunId = await parentRunIdOf(input.shot)
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
      return false
    }
    const plan = buildStoryboardRunPlan({
      doc: document,
      planId: createId('plan'),
      operationId: createId('op'),
      parentRunId,
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
    }
  }

  const runPostprocess = async (
    input: Parameters<typeof runPostprocessWithLease>[0],
  ) => {
    const lease = actionState.tryAcquire(input.busyKind, input.shot.id)
    if (!lease) return false
    try {
      return await runPostprocessWithLease(input)
    } finally {
      lease.release()
    }
  }

  const makeVideoUpscale = async (
    shot: StoryboardShot,
    target: VideoUpscaleTarget,
    resolution: string,
    frameRate: number | null,
  ) => {
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
      busyKind: 'video-upscale',
    })
  }

  const makeVideoErase = async (
    shot: StoryboardShot,
    target: VideoEraseTarget,
  ) => {
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
      busyKind: 'video-erase',
    })
  }

  const makeVideoEdit = async (
    shot: StoryboardShot,
    target: VideoEditTarget,
    instruction: string,
    resolution: string,
    useReferenceImage: boolean,
  ) => {
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
      busyKind: 'video-edit',
    })
  }

  const makeVideoExtend = async (
    shot: StoryboardShot,
    target: VideoExtendTarget,
    instruction: string,
    resolution: string,
    duration: number | null,
  ) => {
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
      busyKind: 'video-extend',
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
