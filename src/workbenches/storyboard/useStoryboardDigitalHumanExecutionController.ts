import type { Dispatch, SetStateAction } from 'react'
import type {
  StoryboardCanvasNode,
  StoryboardCanvasPort,
} from '../../features/storyboard/canvasPort'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import { buildStoryboardRunPlan } from '../../features/storyboard/execution/storyboardRunPlan'
import type {
  StoryboardDoc,
  StoryboardShot,
} from '../../domain/storyboard/storyboard'
import {
  attachShotVideos,
  mergeStoryboardRunResults,
  setShotVideoNode,
} from '../../domain/storyboard/storyboard'
import { digitalHumanPlanOf } from '../../domain/storyboard/digitalHuman'
import { fingerprintBytesSync } from '../../domain/shared/hash'
import { mixAudioSequentially } from '../../platform/web/audioMix'
import { putGeneratedAssets } from '../../platform/assets'
import type { PlatformKit, StoragePort } from '../../platform/ports'
import { createId } from '../../shared/id'
import { asAppError, describeError } from '../../shared/result'
import type { StoryboardActionStatePort } from './useStoryboardActionState'

export interface StoryboardDigitalHumanExecutionControllerArgs {
  currentDoc: () => StoryboardDoc | null
  graphNodes: readonly StoryboardCanvasNode[]
  liveNodeIds: ReadonlySet<string>
  digitalHumanTarget: {
    channelId: string
    model: string
  } | null
  platform: PlatformKit
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

function humanError(error: unknown): string {
  const appError = asAppError(error)
  return appError
    ? describeError(appError)
    : error instanceof Error
      ? error.message
      : String(error)
}

export function createStoryboardDigitalHumanExecutionController(
  args: StoryboardDigitalHumanExecutionControllerArgs,
) {
  const {
    currentDoc,
    graphNodes,
    liveNodeIds,
    digitalHumanTarget,
    platform,
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

  const parentRunIdOf = async (lineIds: readonly string[]) => {
    for (const lineId of lineIds) {
      const rows = await storage.query('runRecords', {
        projectId,
        workbench: 'storyboard',
        subjectId: `line:${lineId}`,
      })
      const found = rows
        .map((row) => row as unknown as {
          id?: unknown
          status?: unknown
          createdAt?: unknown
          params?: unknown
        })
        .filter((row) => {
          const action =
            row.params && typeof row.params === 'object'
              ? (row.params as Record<string, unknown>).action
              : undefined
          return (
            row.status === 'succeeded' &&
            action === 'speech' &&
            typeof row.id === 'string'
          )
        })
        .sort(
          (left, right) =>
            Number(right.createdAt ?? 0) - Number(left.createdAt ?? 0),
        )[0]
      if (typeof found?.id === 'string') return found.id
    }
    return undefined
  }

  const makeDigitalHuman = async (shot: StoryboardShot) => {
    const planOfLines = digitalHumanPlanOf(shot)
    if (!digitalHumanTarget) {
      setLay({
        kind: 'error',
        text: '当前没有可用的数字人口播模型：在 RunningHub 渠道勾选 Kling V2 数字人口播',
      })
      return
    }
    if (!shot.nodeId || !liveNodeIds.has(shot.nodeId) || !shot.imageHash) {
      setLay({ kind: 'error', text: '这一镜还没有可用的图片节点' })
      return
    }
    if (!planOfLines.ok) {
      setLay({ kind: 'error', text: planOfLines.reason })
      return
    }

    const lease = actionState.tryAcquire('digital-human', shot.id)
    if (!lease) return
    setLay({
      kind: 'running',
      text:
        planOfLines.lines.length > 1
          ? '正在合并整镜配音并生成数字人视频…'
          : '正在调用数字人口播模型…',
    })
    let timer: ReturnType<typeof globalThis.setTimeout> | null = null
    try {
      const image = await platform.assets.read(shot.imageHash)
      if (!image) throw new Error('人像图的素材字节已经不在库里')
      const audioClips = await Promise.all(
        planOfLines.lines.map(async (line) => {
          const audio = await platform.assets.read(line.audioHash!)
          if (!audio) throw new Error('有台词配音的素材字节已经不在库里')
          return audio
        }),
      )
      const mixed =
        planOfLines.lines.length > 1
          ? await mixAudioSequentially(audioClips)
          : audioClips[0]!
      const audioHash =
        planOfLines.lines.length > 1
          ? fingerprintBytesSync(mixed.bytes)
          : planOfLines.lines[0]!.audioHash!
      if (planOfLines.lines.length > 1) {
        await putGeneratedAssets(
          storage,
          platform.assets,
          projectId,
          [
            {
              hash: audioHash,
              mime: mixed.mime,
              bytes: mixed.bytes,
            },
          ],
          Date.now(),
        )
      }
      const parentRunId = await parentRunIdOf(
        planOfLines.lines.map((line) => line.id),
      )
      const plan = buildStoryboardRunPlan({
        doc: currentDoc()!,
        planId: createId('plan'),
        operationId: createId('op'),
        parentRunId,
        target: {
          channelId: digitalHumanTarget.channelId,
          model: digitalHumanTarget.model,
          modelIsUpstream: false,
        },
        action: 'digital-human',
        episodeId: shot.episodeId,
        shotIds: [shot.id],
        audioHash,
        audioMime: mixed.mime,
        imageMime: image.mime,
      })
      timer = globalThis.setTimeout(
        () => execution.cancel(plan.id),
        20 * 60 * 1000,
      )
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
            : '数字人口播没有返回可用结果',
        )
      }
      const output = result.result[0]
      if (!output || !output.mime.toLowerCase().startsWith('video/')) {
        throw new Error('数字人口播没有返回视频产物')
      }
      const latest = await documents.load(projectId)
      const merged = mergeStoryboardRunResults(
        currentDoc() ?? latest,
        latest,
        Date.now(),
      )
      const data = await canvas.resolveGenerationData({
        mode: 'video',
        channelId: digitalHumanTarget.channelId,
        model: digitalHumanTarget.model,
        prompt: '数字人口播',
        durationSec: shot.durationSec,
        assetHash: output.hash,
        assetMime: output.mime,
      })
      const imageNode = graphNodes.find((node) => node.id === shot.nodeId)
      let videoNodeId =
        shot.videoNodeId && liveNodeIds.has(shot.videoNodeId)
          ? shot.videoNodeId
          : ''
      canvas.beginPlan('storyboard:digital-human', '单句数字人口播')
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
          canvas.connectEdge(shot.nodeId, videoNodeId)
        }
      } finally {
        canvas.endPlan()
      }
      if (!videoNodeId) throw new Error('口播视频节点没能建出来')
      const withNode = setShotVideoNode(merged, shot.id, videoNodeId, 0)
      replaceDoc(
        attachShotVideos(
          withNode,
          [{ shotId: shot.id, hash: output.hash }],
          0,
        ),
      )
      setLay({
        kind: 'done',
        text:
          planOfLines.lines.length > 1
            ? `整镜 ${planOfLines.lines.length} 句配音已合并，数字人口播视频已生成`
            : '这一句的数字人口播视频已生成',
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      if (timer !== null) globalThis.clearTimeout(timer)
      lease.release()
    }
  }

  return { makeDigitalHuman }
}
