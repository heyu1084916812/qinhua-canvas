import type { Dispatch, SetStateAction } from 'react'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import type { StoryboardDoc, StoryboardShot } from '../../domain/storyboard/storyboard'
import {
  setShotVideoNode,
  attachShotVideos,
} from '../../domain/storyboard/storyboard'
import {
  videoUpscaleActionOf,
  type VideoUpscaleModelId,
} from '../../domain/storyboard/videoUpscale'
import type { VideoEraseModelId } from '../../domain/storyboard/videoErase'
import type { VideoEditModelId } from '../../domain/storyboard/videoEdit'
import type { VideoExtendModelId } from '../../domain/storyboard/videoExtend'
import { asAppError, describeError } from '../../shared/result'
import { withStoryboardRunScope } from '../../features/storyboard/runScope'

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

export interface StoryboardVideoControllerArgs {
  currentDoc: () => StoryboardDoc | null
  graphNodes: readonly NodeSnapshot[]
  liveNodeIds: ReadonlySet<string>
  channels: ChannelStore
  canvas: StoryboardCanvasPort
  directTrace: (args: {
    subjectId: string
    scopeId?: string
    kind: 'text' | 'video' | 'speech'
    channelId: string
    model: string
    payload: unknown
    inputs?: DirectRunTraceInput['inputs']
    params?: Record<string, unknown>
  }) => DirectRunTraceInput
  apply: (doc: StoryboardDoc) => void
  setLay: Dispatch<SetStateAction<{ kind: 'idle' | 'running' | 'done' | 'error'; text: string }>>
  videoUpscaleBusy: string | null
  setVideoUpscaleBusy: Dispatch<SetStateAction<string | null>>
  videoEraseBusy: string | null
  setVideoEraseBusy: Dispatch<SetStateAction<string | null>>
  videoEditBusy: string | null
  setVideoEditBusy: Dispatch<SetStateAction<string | null>>
  videoExtendBusy: string | null
  setVideoExtendBusy: Dispatch<SetStateAction<string | null>>
}

export function createStoryboardVideoController(args: StoryboardVideoControllerArgs) {
  const {
    graphNodes,
    liveNodeIds,
    channels,
    canvas,
    directTrace,
    apply,
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
  const graph = { nodes: graphNodes }
  const humanError = (error: unknown) => {
    const appError = asAppError(error)
    return appError ? describeError(appError) : error instanceof Error ? error.message : String(error)
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
    const sourceNode = graph.nodes.find((node) => node.id === shot.videoNodeId)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const sourceMime =
      (sourceNode.data as { assetMime?: string }).assetMime ?? 'video/mp4'
    const action = videoUpscaleActionOf(target.model)
    const actionLabel = action === 'fps' ? '补帧' : '超清'
    const prompt = `视频${actionLabel}`

    setVideoUpscaleBusy(shot.id)
    setLay({ kind: 'running', text: `正在用 ${target.model} 处理这一镜…` })
    const ac = new AbortController()
    const timer = globalThis.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: target.channelId,
        model: target.model,
        prompt,
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.videoNodeId,
            assetHash: shot.videoHash,
            mime: sourceMime,
          },
        ],
        params: {
          ...(resolution ? { resolution } : {}),
          ...(frameRate !== null ? { fps: String(frameRate) } : {}),
        },
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:video-upscale`,
          scopeId: `episode:${shot.episodeId}`,
          kind: 'video',
          channelId: target.channelId,
          model: target.model,
          payload: {
            prompt,
            videoHash: shot.videoHash,
            resolution,
            frameRate,
          },
          params: { resolution, frameRate },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error(`视频${actionLabel}模型没有返回视频`)
      const mime = output.mime || 'video/mp4'
      if (!mime.toLowerCase().startsWith('video/')) {
        throw new Error(`视频${actionLabel}返回了非视频产物：${mime}`)
      }

      canvas.putAsset({
        ...output,
        mime,
      })
      const data = withStoryboardRunScope(
        await canvas.resolveGenerationData({
          mode: 'video',
          channelId: target.channelId,
          model: target.model,
          prompt,
          ...(resolution ? { resolution } : {}),
          ...(frameRate !== null ? { fps: String(frameRate) } : {}),
          durationSec: shot.durationSec,
          assetHash: output.hash,
          assetMime: mime,
        }),
        {
          subjectKind: 'video-postprocess',
          subjectId: `shot:${shot.id}`,
          scopeId: `episode:${shot.episodeId}`,
        },
      )

      let upscaleNodeId = ''
      canvas.beginPlan(`storyboard:video-${action}`, `镜头视频${actionLabel}`)
      try {
        upscaleNodeId =
          canvas.createGenerationNode({
            at: { x: sourceNode.x + 320, y: sourceNode.y },
            data,
          }) ?? ''
        if (upscaleNodeId) {
          canvas.connectEdge(shot.videoNodeId, upscaleNodeId)
        }
      } finally {
        canvas.endPlan()
      }
      if (!upscaleNodeId) throw new Error(`视频${actionLabel}节点没能建出来`)

      const current = args.currentDoc()
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, upscaleNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({
        kind: 'done',
        text: action === 'fps'
          ? '这一镜的视频补帧已完成'
          : `这一镜已生成 ${resolution}${frameRate !== null ? ` · ${frameRate}fps` : ''} 超清视频`,
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setVideoUpscaleBusy(null)
      globalThis.clearTimeout(timer)
    }
  }

  /** 已有镜头视频 → 用真实字幕擦除端点生成新视频节点，旧视频保留。 */
  const makeVideoErase = async (
    shot: StoryboardShot,
    target: VideoEraseTarget,
  ) => {
    if (videoEraseBusy) return
    if (!shot.videoHash || !shot.videoNodeId || !liveNodeIds.has(shot.videoNodeId)) {
      setLay({ kind: 'error', text: '这一镜还没有可擦除字幕的视频节点' })
      return
    }
    const sourceNode = graph.nodes.find((node) => node.id === shot.videoNodeId)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const sourceMime =
      (sourceNode.data as { assetMime?: string }).assetMime ?? 'video/mp4'

    setVideoEraseBusy(shot.id)
    setLay({ kind: 'running', text: `正在用 ${target.model} 擦除这一镜的字幕…` })
    const ac = new AbortController()
    const timer = globalThis.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: target.channelId,
        model: target.model,
        prompt: '',
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.videoNodeId,
            assetHash: shot.videoHash,
            mime: sourceMime,
          },
        ],
        params: {},
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:video-erase`,
          scopeId: `episode:${shot.episodeId}`,
          kind: 'video',
          channelId: target.channelId,
          model: target.model,
          payload: { videoHash: shot.videoHash },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error('字幕擦除模型没有返回视频')
      const mime = output.mime || 'video/mp4'
      if (!mime.toLowerCase().startsWith('video/')) {
        throw new Error(`字幕擦除返回了非视频产物：${mime}`)
      }

      canvas.putAsset({
        ...output,
        mime,
      })
      const data = withStoryboardRunScope(
        await canvas.resolveGenerationData({
          mode: 'video',
          channelId: target.channelId,
          model: target.model,
          prompt: '视频字幕擦除',
          durationSec: shot.durationSec,
          assetHash: output.hash,
          assetMime: mime,
        }),
        {
          subjectKind: 'video-postprocess',
          subjectId: `shot:${shot.id}`,
          scopeId: `episode:${shot.episodeId}`,
        },
      )

      let eraseNodeId = ''
      canvas.beginPlan('storyboard:video-erase', '镜头视频字幕擦除')
      try {
        eraseNodeId =
          canvas.createGenerationNode({
            at: { x: sourceNode.x + 320, y: sourceNode.y },
            data,
          }) ?? ''
        if (eraseNodeId) {
          canvas.connectEdge(shot.videoNodeId, eraseNodeId)
        }
      } finally {
        canvas.endPlan()
      }
      if (!eraseNodeId) throw new Error('字幕擦除节点没能建出来')

      const current = args.currentDoc()
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, eraseNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({ kind: 'done', text: '这一镜的字幕已擦除，新视频已保存' })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setVideoEraseBusy(null)
      globalThis.clearTimeout(timer)
    }
  }

  /** 已有镜头视频 → 按文字指令编辑，结果落独立新视频节点，旧视频保留。 */
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
    if (!shot.videoHash || !shot.videoNodeId || !liveNodeIds.has(shot.videoNodeId)) {
      setLay({ kind: 'error', text: '这一镜还没有可编辑的视频节点' })
      return
    }
    const sourceNode = graph.nodes.find((node) => node.id === shot.videoNodeId)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const sourceMime =
      (sourceNode.data as { assetMime?: string }).assetMime ?? 'video/mp4'
    const referenceNode =
      useReferenceImage && shot.nodeId && liveNodeIds.has(shot.nodeId)
        ? graph.nodes.find((node) => node.id === shot.nodeId)
        : null
    const referenceHash = useReferenceImage ? shot.imageHash : undefined
    if (
      useReferenceImage &&
      (!target.supportsReferenceImage || !referenceNode || !referenceHash)
    ) {
      setLay({ kind: 'error', text: '这一镜没有可引用的画面，取消参考图后再试' })
      return
    }
    if (target.requiresReferenceImage && !useReferenceImage) {
      setLay({ kind: 'error', text: '这个模型必须参考当前镜头画面' })
      return
    }
    const referenceMime =
      (referenceNode?.data as { assetMime?: string } | undefined)?.assetMime ?? 'image/png'

    setVideoEditBusy(shot.id)
    setLay({ kind: 'running', text: `正在用 ${target.model} 编辑这一镜…` })
    const ac = new AbortController()
    const timer = globalThis.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: target.channelId,
        model: target.model,
        prompt,
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.videoNodeId,
            assetHash: shot.videoHash,
            mime: sourceMime,
          },
          ...(referenceNode && referenceHash
            ? [
                {
                  kind: 'asset' as const,
                  nodeId: referenceNode.id,
                  assetHash: referenceHash,
                  mime: referenceMime,
                },
              ]
            : []),
        ],
        params: resolution ? { resolution } : {},
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:video-edit`,
          scopeId: `episode:${shot.episodeId}`,
          kind: 'video',
          channelId: target.channelId,
          model: target.model,
          payload: {
            prompt,
            videoHash: shot.videoHash,
            referenceHash,
            resolution,
          },
          params: { resolution },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error('视频编辑模型没有返回视频')
      const mime = output.mime || 'video/mp4'
      if (!mime.toLowerCase().startsWith('video/')) {
        throw new Error(`视频编辑返回了非视频产物：${mime}`)
      }

      canvas.putAsset({
        ...output,
        mime,
      })
      const data = withStoryboardRunScope(
        await canvas.resolveGenerationData({
          mode: 'video',
          channelId: target.channelId,
          model: target.model,
          prompt,
          ...(resolution ? { resolution } : {}),
          durationSec: shot.durationSec,
          assetHash: output.hash,
          assetMime: mime,
        }),
        {
          subjectKind: 'video-postprocess',
          subjectId: `shot:${shot.id}`,
          scopeId: `episode:${shot.episodeId}`,
        },
      )

      let editNodeId = ''
      canvas.beginPlan('storyboard:video-edit', '镜头视频编辑')
      try {
        editNodeId =
          canvas.createGenerationNode({
            at: { x: sourceNode.x + 320, y: sourceNode.y },
            data,
          }) ?? ''
        if (editNodeId) {
          canvas.connectEdge(shot.videoNodeId, editNodeId)
          if (referenceNode) {
            canvas.connectEdge(referenceNode.id, editNodeId)
          }
        }
      } finally {
        canvas.endPlan()
      }
      if (!editNodeId) throw new Error('视频编辑节点没能建出来')

      const current = args.currentDoc()
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, editNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({
        kind: 'done',
        text: resolution
          ? `这一镜的视频已按 ${resolution} 编辑完成${referenceNode ? '（已参考当前画面）' : ''}`
          : `这一镜的视频已编辑完成${referenceNode ? '（已参考当前画面）' : ''}`,
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setVideoEditBusy(null)
      globalThis.clearTimeout(timer)
    }
  }

  /** 已有镜头视频 → 续写后续动作，结果落独立新视频节点，旧视频保留。 */
  const makeVideoExtend = async (
    shot: StoryboardShot,
    target: VideoExtendTarget,
    instruction: string,
    resolution: string,
    duration: number | null,
  ) => {
    if (videoExtendBusy) return
    if (!shot.videoHash || !shot.videoNodeId || !liveNodeIds.has(shot.videoNodeId)) {
      setLay({ kind: 'error', text: '这一镜还没有可续写的视频节点' })
      return
    }
    const sourceNode = graph.nodes.find((node) => node.id === shot.videoNodeId)
    if (!sourceNode) {
      setLay({ kind: 'error', text: '这一镜的视频节点已经不在画布上' })
      return
    }
    const sourceMime =
      (sourceNode.data as { assetMime?: string }).assetMime ?? 'video/mp4'
    const prompt =
      instruction.trim() || '延续当前镜头内容与运动，保持人物、场景和画风一致'

    setVideoExtendBusy(shot.id)
    setLay({ kind: 'running', text: `正在用 ${target.model} 续写这一镜…` })
    const ac = new AbortController()
    const timer = globalThis.setTimeout(() => ac.abort(), 20 * 60 * 1000)
    try {
      const outputs = await channels.generateVideo({
        kind: 'video',
        channelId: target.channelId,
        model: target.model,
        prompt,
        inputs: [
          {
            kind: 'asset',
            nodeId: shot.videoNodeId,
            assetHash: shot.videoHash,
            mime: sourceMime,
          },
        ],
        params: {
          ...(resolution ? { resolution } : {}),
          ...(duration !== null ? { duration } : {}),
        },
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:video-extend`,
          scopeId: `episode:${shot.episodeId}`,
          kind: 'video',
          channelId: target.channelId,
          model: target.model,
          payload: {
            prompt,
            videoHash: shot.videoHash,
            resolution,
            duration,
          },
          params: { resolution, duration },
        }),
      })
      const output = outputs[0]
      if (!output) throw new Error('视频续写模型没有返回视频')
      const mime = output.mime || 'video/mp4'
      if (!mime.toLowerCase().startsWith('video/')) {
        throw new Error(`视频续写返回了非视频产物：${mime}`)
      }

      canvas.putAsset({
        ...output,
        mime,
      })
      const data = withStoryboardRunScope(
        await canvas.resolveGenerationData({
          mode: 'video',
          channelId: target.channelId,
          model: target.model,
          prompt,
          ...(resolution ? { resolution } : {}),
          ...(duration !== null ? { durationSec: duration } : {}),
          assetHash: output.hash,
          assetMime: mime,
        }),
        {
          subjectKind: 'video-postprocess',
          subjectId: `shot:${shot.id}`,
          scopeId: `episode:${shot.episodeId}`,
        },
      )

      let extendNodeId = ''
      canvas.beginPlan('storyboard:video-extend', '镜头视频续写')
      try {
        extendNodeId =
          canvas.createGenerationNode({
            at: { x: sourceNode.x + 320, y: sourceNode.y },
            data,
          }) ?? ''
        if (extendNodeId) {
          canvas.connectEdge(shot.videoNodeId, extendNodeId)
        }
      } finally {
        canvas.endPlan()
      }
      if (!extendNodeId) throw new Error('视频续写节点没能建出来')

      const current = args.currentDoc()
      if (current) {
        const withNode = setShotVideoNode(current, shot.id, extendNodeId, 0)
        apply(attachShotVideos(withNode, [{ shotId: shot.id, hash: output.hash }], 0))
      }
      setLay({
        kind: 'done',
        text:
          duration !== null
            ? `这一镜已续写 ${duration} 秒${resolution ? ` · ${resolution}` : ''}`
            : `这一镜已按 ${resolution} 续写完成`,
      })
    } catch (error) {
      setLay({ kind: 'error', text: humanError(error) })
    } finally {
      setVideoExtendBusy(null)
      globalThis.clearTimeout(timer)
    }
  }

  return {
    makeVideoUpscale,
    makeVideoErase,
    makeVideoEdit,
    makeVideoExtend,
  }
}
