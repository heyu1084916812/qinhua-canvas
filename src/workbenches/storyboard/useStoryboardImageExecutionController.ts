import type { Dispatch, SetStateAction } from 'react'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import { buildStoryboardRunPlan } from '../../features/storyboard/execution/storyboardRunPlan'
import type { StoryboardRunPlan } from '../../domain/storyboard/runTypes'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import type {
  StoryboardDoc,
  StoryboardShot,
} from '../../domain/storyboard/storyboard'
import {
  mergeStoryboardRunResults,
  shotsOf,
  shotRefNodeIds,
} from '../../domain/storyboard/storyboard'
import { createId } from '../../shared/id'
import { asAppError, describeError } from '../../shared/result'

export interface StoryboardImageExecutionControllerArgs {
  doc: StoryboardDoc
  currentDoc: () => StoryboardDoc | null
  selectedEpisodeId?: string
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
}

function humanError(error: unknown): string {
  const appError = asAppError(error)
  return appError
    ? describeError(appError)
    : error instanceof Error
      ? error.message
      : String(error)
}

export function createStoryboardImageExecutionController(
  args: StoryboardImageExecutionControllerArgs,
) {
  const {
    currentDoc,
    selectedEpisodeId,
    liveNodeIds,
    channels,
    canvas,
    execution,
    documents,
    projectId,
    flush,
    replaceDoc,
    setLay,
  } = args

  const targetForNode = async (nodeId?: string) => {
    const node = nodeId
      ? canvas.getSnapshot().nodes.find((item) => item.id === nodeId)
      : undefined
    const data =
      node?.data && typeof node.data === 'object'
        ? (node.data as { channelId?: string; model?: string })
        : {}
    const recipe = await channels.defaultForNewNode(data, 'image')
    if (!recipe?.channelId || !recipe.model) {
      throw new Error('还没有可用的图片模型服务，先去「全局设置 → 模型服务」添加并勾选图片模型')
    }
    return {
      channelId: recipe.channelId,
      model: recipe.model,
      modelIsUpstream: false,
      params: recipe.params,
    }
  }

  const refresh = async () => {
    const latest = await documents.load(projectId)
    const current = currentDoc() ?? latest
    const merged = mergeStoryboardRunResults(current, latest, Date.now())
    replaceDoc(merged)
    return merged
  }

  const targetOrReport = async (nodeId?: string) => {
    try {
      return await targetForNode(nodeId)
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
      return null
    }
  }

  const projectImageResults = (
    latest: StoryboardDoc,
    plan: StoryboardRunPlan,
    outcome: Awaited<ReturnType<StoryboardExecutionApi['run']>>,
  ) => {
    for (const task of plan.tasks) {
      const subject = task.subject
      const result = outcome.summary.taskResults.find(
        (item) => item.taskId === task.id,
      )?.state
      if (result?.kind !== 'succeeded') continue
      const asset = result.result[0]
      if (!asset) continue

      let nodeId: string | undefined
      let hash: string | undefined
      if (subject.kind === 'shot-image') {
        const shot = latest.shots.find(
          (item) => item.id === subject.shotId,
        )
        nodeId = shot?.nodeId
        hash = shot?.imageHash
      } else if (subject.kind === 'asset') {
        const source =
          subject.assetType === 'char'
            ? latest.characters
            : latest.scenes
        const businessAsset = source.find(
          (item) => item.id === subject.assetId,
        )
        nodeId =
          task.action === 'asset-base'
            ? businessAsset?.nodeId
            : businessAsset?.turnaroundNodeId
        hash =
          task.action === 'asset-base'
            ? businessAsset?.baseHash
            : businessAsset?.turnaroundHash
      }
      if (!nodeId || !hash || !liveNodeIds.has(nodeId)) {
        continue
      }
      canvas.updateNodeData(
        nodeId,
        {
          assetHash: hash,
          assetMime: asset.mime,
          thumbOrder: [hash],
          ...(asset.width && asset.height
            ? { naturalSize: { width: asset.width, height: asset.height } }
            : {}),
        },
        true,
      )
    }
  }

  const execute = async (
    build: (doc: StoryboardDoc) => ReturnType<typeof buildStoryboardRunPlan>,
  ) => {
    const latest = currentDoc()
    if (!latest) return null
    await flush()
    try {
      const plan = build(latest)
      const outcome = await execution.run(plan)
      const persisted = await refresh()
      projectImageResults(persisted, plan, outcome)
      return { plan, outcome, persisted }
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
      return null
    }
  }

  const makeAssetBase = async (kind: 'char' | 'scene', assetId: string) => {
    const latest = currentDoc()
    const asset =
      kind === 'char'
        ? latest?.characters.find((item) => item.id === assetId)
        : latest?.scenes.find((item) => item.id === assetId)
    const targetValue = await targetOrReport(asset?.nodeId)
    if (!targetValue) return
    const result = await execute(
      (current) =>
        buildStoryboardRunPlan({
          doc: current,
          planId: createId('plan'),
          operationId: createId('op'),
          target: targetValue,
          action: 'asset-base',
          assetType: kind,
          assetIds: [assetId],
        }),
    )
    const failure = result?.outcome.failures[0]
    if (failure) setLay({ kind: 'error', text: failure.errorText })
  }

  const makeAssetTurnaround = async (assetId: string) => {
    const latest = currentDoc()
    const asset = latest?.characters.find((item) => item.id === assetId)
    const targetValue = await targetOrReport(asset?.turnaroundNodeId)
    if (!targetValue) return
    const result = await execute(
      (current) =>
        buildStoryboardRunPlan({
          doc: current,
          planId: createId('plan'),
          operationId: createId('op'),
          target: targetValue,
          action: 'asset-turnaround',
          assetType: 'char',
          assetIds: [assetId],
        }),
    )
    const failure = result?.outcome.failures[0]
    if (failure) setLay({ kind: 'error', text: failure.errorText })
  }

  const runShot = async (shot: StoryboardShot) => {
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId)) {
      setLay({ kind: 'error', text: '这一镜还没铺到画布' })
      return
    }
    const targetValue = await targetOrReport(shot.nodeId)
    if (!targetValue) return
    const latest = currentDoc()
    const refs = latest
      ? shotRefNodeIds(latest, shot, liveNodeIds).length
      : 0
    if (refs > 0) {
      setLay({ kind: 'running', text: `这一镜在跑（带 ${refs} 张参考图）…` })
    }
    const result = await execute(
      (latest) =>
        buildStoryboardRunPlan({
          doc: latest,
          planId: createId('plan'),
          operationId: createId('op'),
          target: targetValue,
          action: 'shot-image',
          episodeId: shot.episodeId,
          shotIds: [shot.id],
        }),
    )
    if (!result || refs === 0) return
    const failed = result.outcome.summary.taskResults.find(
      (item) => item.state.kind === 'failed',
    )
    if (failed?.state.kind === 'failed') {
      setLay({
        kind: 'error',
        text: `这一镜出图失败：${describeError(failed.state.error)}`,
      })
      return
    }
    const failure = result.outcome.failures[0]
    if (failure) {
      setLay({ kind: 'error', text: failure.errorText })
      return
    }
    setLay({ kind: 'done', text: `这一镜的图已出（带了 ${refs} 张参考图）` })
  }

  const runEpisode = async () => {
    const latest = currentDoc()
    if (!latest || !selectedEpisodeId) return
    const targets = shotsOf(latest, selectedEpisodeId).filter(
      (shot) => shot.nodeId && liveNodeIds.has(shot.nodeId) && !shot.imageHash,
    )
    if (targets.length === 0) {
      setLay({ kind: 'done', text: '这一集没有待出图的镜头（要重出请用单镜那把）' })
      return
    }
    const resolved = await Promise.all(
      targets.map(async (shot) => [
        shot.id,
        await targetOrReport(shot.nodeId),
      ] as const),
    )
    if (resolved.some(([, targetValue]) => !targetValue)) return
    const targetsByShot = new Map(
      resolved.map(([shotId, targetValue]) => [shotId, targetValue!]),
    )
    setLay({ kind: 'idle', text: '' })
    const result = await execute(
      (current) =>
        buildStoryboardRunPlan({
          doc: current,
          planId: createId('plan'),
          operationId: createId('op'),
          target: ({ subject }) =>
            (() => {
              const shotId =
                subject.kind === 'shot-image' ? subject.shotId : ''
              const targetValue = targetsByShot.get(shotId)
              if (!targetValue) {
                throw new Error(`镜头缺少执行模型：${shotId}`)
              }
              return targetValue
            })(),
          action: 'shot-image',
          episodeId: selectedEpisodeId,
          shotIds: targets.map((shot) => shot.id),
        }),
    )
    if (!result) return
    const failure = result.outcome.failures[0]
    if (failure) {
      setLay({ kind: 'error', text: failure.errorText })
      return
    }
    setLay({
      kind: 'done',
      text: `已跑完这一集 ${targets.length} 镜（失败的镜头各自标了原因）`,
    })
  }

  return {
    makeAssetBase,
    makeAssetTurnaround,
    runShot,
    runEpisode,
  }
}
