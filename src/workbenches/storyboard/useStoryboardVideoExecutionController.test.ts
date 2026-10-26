import { describe, expect, it, vi } from 'vitest'
import type { ChannelStore } from '../../state/channel/channelStore'
import type {
  StoryboardCanvasEdge,
  StoryboardCanvasNode,
  StoryboardCanvasPort,
} from '../../features/storyboard/canvasPort'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import type { StoryboardRunPlan } from '../../domain/storyboard/runTypes'
import {
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import { createMemoryStorage } from '../../platform/memory'
import { createStoryboardVideoExecutionController } from './useStoryboardVideoExecutionController'

function fixture(): {
  doc: StoryboardDoc
  shot: StoryboardShot
  nodes: StoryboardCanvasNode[]
} {
  let doc = emptyStoryboard('project-1', 1)
  doc = addEpisode(doc)
  const episodeId = doc.episodes[0]!.id
  doc = addShot(doc, episodeId)
  doc = {
    ...doc,
    shots: doc.shots.map((shot) => ({
      ...shot,
      nodeId: 'image-node',
      imageHash: 'image-hash',
      scene: '镜头',
    })),
  }
  return {
    doc,
    shot: doc.shots[0]!,
    nodes: [
      {
        id: 'image-node',
        type: 'generation',
        x: 10,
        y: 20,
        w: 200,
        h: 200,
        parentId: null,
        data: {
          channelId: 'image-channel',
          model: 'image-model',
          assetMime: 'image/webp',
        },
      } as StoryboardCanvasNode,
    ],
  }
}

function successState(hash = 'video-hash'): RunTaskState {
  return {
    kind: 'succeeded',
    result: [
      {
        hash,
        mime: 'video/mp4',
        bytes: new Uint8Array([1]),
      },
    ],
    duration: 10,
  }
}

function outcomeFor(plan: StoryboardRunPlan, hash = 'video-hash') {
  const state = successState(hash)
  return {
    summary: {
      runPlanId: plan.id,
      mode: plan.mode,
      taskResults: plan.tasks.map((task) => ({
        taskId: task.id,
        nodeId: task.nodeId,
        state,
      })),
      succeeded: plan.tasks.length,
      failed: 0,
      canceled: 0,
      startedAt: 1,
      finishedAt: 11,
      records: [],
    },
    warnings: [],
    failures: [],
  }
}

describe('useStoryboardVideoExecutionController', () => {
  it('镜头视频走业务计划，并把视频 hash 投影到新建视频节点', async () => {
    const { doc, shot, nodes } = fixture()
    let captured: StoryboardRunPlan | undefined
    let replaced: StoryboardDoc | undefined
    const createGenerationNode = vi.fn(() => 'video-node')
    const run = vi.fn(async (plan: StoryboardRunPlan) => {
      captured = plan
      return outcomeFor(plan)
    })
    const produced: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((item) => ({
        ...item,
        videoHash: 'video-hash',
      })),
    }
    const controller = createStoryboardVideoExecutionController({
      currentDoc: () => doc,
      graphNodes: nodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set(['image-node']),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'video-channel',
          model: 'video-model',
          params: {},
          substituted: false,
        }),
        getState: () => ({
          channels: [
            {
              id: 'video-channel',
              modelMap: {},
              models: [],
              modelCache: [],
            },
          ],
        }),
      } as unknown as ChannelStore,
      storage: createMemoryStorage(),
      canvas: {
        createGenerationNode,
        updateNodeData: vi.fn(),
        connectEdge: vi.fn(),
        removeEdge: vi.fn(),
        beginPlan: vi.fn(),
        endPlan: vi.fn(),
        resolveGenerationData: async (data: Record<string, unknown>) => data,
      } as unknown as StoryboardCanvasPort,
      execution: { run, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents: {
        load: async () => produced,
        save: async () => {},
      } as StoryboardDocumentPort,
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: (next) => {
        replaced = next
      },
      setLay: vi.fn(),
      videoUpscaleBusy: null,
      setVideoUpscaleBusy: vi.fn(),
      videoEraseBusy: null,
      setVideoEraseBusy: vi.fn(),
      videoEditBusy: null,
      setVideoEditBusy: vi.fn(),
      videoExtendBusy: null,
      setVideoExtendBusy: vi.fn(),
    })

    expect(await controller.makeShotVideo(shot)).toBe(true)
    expect(captured?.tasks[0]).toMatchObject({
      action: 'shot-video',
      subject: { kind: 'shot-video', shotId: shot.id },
      request: {
        kind: 'video',
        inputs: [{ assetHash: 'image-hash', mime: 'image/webp' }],
      },
    })
    expect(createGenerationNode).toHaveBeenCalledTimes(1)
    expect(replaced?.shots[0]).toMatchObject({
      videoNodeId: 'video-node',
      videoHash: 'video-hash',
    })
  })

  it('视频编辑走独立后处理 task，保留旧视频并投影新节点', async () => {
    const { doc, nodes } = fixture()
    const withVideo: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((item) => ({
        ...item,
        videoHash: 'old-video',
        videoNodeId: 'video-old',
      })),
    }
    const videoNodes = [
      ...nodes,
      {
        id: 'video-old',
        type: 'generation',
        x: 300,
        y: 20,
        w: 200,
        h: 200,
        parentId: null,
        data: { assetMime: 'video/webm' },
      } as StoryboardCanvasNode,
    ]
    let captured: StoryboardRunPlan | undefined
    let replaced: StoryboardDoc | undefined
    let lay = { kind: 'idle', text: '' }
    const setBusy = vi.fn()
    const run = vi.fn(async (plan: StoryboardRunPlan) => {
      captured = plan
      return outcomeFor(plan, 'edited-video')
    })
    const produced: StoryboardDoc = {
      ...withVideo,
      shots: withVideo.shots.map((item) => ({
        ...item,
        videoHash: 'edited-video',
      })),
    }
    const storage = createMemoryStorage({
      rows: {
        runRecords: [
          {
            id: 'record-parent-video',
            projectId: 'project-1',
            workbench: 'storyboard',
            subjectId: `shot:${withVideo.shots[0]!.id}`,
            status: 'succeeded',
            createdAt: 5,
            params: { action: 'shot-video' },
          },
        ],
      },
    })
    const beginPlan = vi.fn()
    const controller = createStoryboardVideoExecutionController({
      currentDoc: () => withVideo,
      graphNodes: videoNodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set(['image-node', 'video-old']),
      channels: {} as ChannelStore,
      storage,
      canvas: {
        createGenerationNode: vi.fn(() => 'video-edited-node'),
        updateNodeData: vi.fn(),
        connectEdge: vi.fn(),
        removeEdge: vi.fn(),
        beginPlan,
        endPlan: vi.fn(),
        resolveGenerationData: async (data: Record<string, unknown>) => data,
      } as unknown as StoryboardCanvasPort,
      execution: { run, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents: { load: async () => produced, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: (next) => {
        replaced = next
      },
      setLay: (value) => {
        if (typeof value !== 'function') lay = value
      },
      videoUpscaleBusy: null,
      setVideoUpscaleBusy: vi.fn(),
      videoEraseBusy: null,
      setVideoEraseBusy: vi.fn(),
      videoEditBusy: null,
      setVideoEditBusy: setBusy,
      videoExtendBusy: null,
      setVideoExtendBusy: vi.fn(),
    })

    await controller.makeVideoEdit(
      produced.shots[0]!,
      {
        channelId: 'edit-channel',
        channelName: '编辑渠道',
        model: '全能视频X 视频编辑',
        label: '视频编辑',
        resolutions: ['720p'],
        supportsReferenceImage: true,
        requiresReferenceImage: false,
      },
      '把天空改成黄昏',
      '720p',
      true,
    )

    expect(captured?.tasks[0]).toMatchObject({
      action: 'video-edit',
      parentRunId: 'record-parent-video',
      request: {
        prompt: '把天空改成黄昏',
        inputs: [
          { assetHash: 'old-video', mime: 'video/webm' },
          { assetHash: 'image-hash', mime: 'image/webp' },
        ],
        params: {
          resolution: '720p',
          action: 'video-edit',
        },
      },
    })
    expect(beginPlan).toHaveBeenCalledWith(
      'storyboard:video-edit',
      '镜头视频编辑',
    )
    expect(replaced?.shots[0]).toMatchObject({
      videoNodeId: 'video-edited-node',
      videoHash: 'edited-video',
    })
    expect(setBusy).toHaveBeenNthCalledWith(1, produced.shots[0]!.id)
    expect(setBusy).toHaveBeenLastCalledWith(null)
    expect(lay).toEqual({
      kind: 'done',
      text: '这一镜的视频已按 720p 编辑完成（已参考当前画面）',
    })
  })

  it('超清、补帧、擦字幕、编辑、续写分别映射到独立后处理 action', async () => {
    const { doc, nodes } = fixture()
    const withVideo: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((item) => ({
        ...item,
        videoHash: 'old-video',
        videoNodeId: 'video-old',
      })),
    }
    const videoNodes = [
      ...nodes,
      {
        id: 'video-old',
        type: 'generation',
        x: 300,
        y: 20,
        w: 200,
        h: 200,
        parentId: null,
        data: { assetMime: 'video/mp4' },
      } as StoryboardCanvasNode,
    ]
    const actions: string[] = []
    const run = vi.fn(async (plan: StoryboardRunPlan) => {
      actions.push(plan.tasks[0]!.action)
      return outcomeFor(plan, `video-${actions.length}`)
    })
    const controller = createStoryboardVideoExecutionController({
      currentDoc: () => withVideo,
      graphNodes: videoNodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set(['image-node', 'video-old']),
      channels: {} as ChannelStore,
      storage: createMemoryStorage(),
      canvas: {
        createGenerationNode: vi.fn(() => `result-${actions.length}`),
        updateNodeData: vi.fn(),
        connectEdge: vi.fn(),
        removeEdge: vi.fn(),
        beginPlan: vi.fn(),
        endPlan: vi.fn(),
        resolveGenerationData: async (data: Record<string, unknown>) => data,
      } as unknown as StoryboardCanvasPort,
      execution: { run, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents: {
        load: async () => ({
          ...withVideo,
          shots: withVideo.shots.map((item) => ({
            ...item,
            videoHash: 'new-video',
          })),
        }),
        save: async () => {},
      },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: () => {},
      setLay: () => {},
      videoUpscaleBusy: null,
      setVideoUpscaleBusy: vi.fn(),
      videoEraseBusy: null,
      setVideoEraseBusy: vi.fn(),
      videoEditBusy: null,
      setVideoEditBusy: vi.fn(),
      videoExtendBusy: null,
      setVideoExtendBusy: vi.fn(),
    })

    await controller.makeVideoUpscale(
      withVideo.shots[0]!,
      {
        channelId: 'ch',
        channelName: '渠道',
        model: 'Topaz 视频超清',
        label: '超清',
        resolutions: ['4k'],
        frameRates: [60],
      },
      '4k',
      60,
    )
    await controller.makeVideoUpscale(
      withVideo.shots[0]!,
      {
        channelId: 'ch',
        channelName: '渠道',
        model: 'RH 视频补帧',
        label: '补帧',
        resolutions: [],
        frameRates: [],
      },
      '',
      null,
    )
    await controller.makeVideoErase(withVideo.shots[0]!, {
      channelId: 'ch',
      channelName: '渠道',
      model: '火山字幕擦除 标准版',
      label: '擦字幕',
    })
    await controller.makeVideoEdit(
      withVideo.shots[0]!,
      {
        channelId: 'ch',
        channelName: '渠道',
        model: '全能视频X 视频编辑',
        label: '编辑',
        resolutions: ['720p'],
        supportsReferenceImage: false,
        requiresReferenceImage: false,
      },
      '改成夜晚',
      '720p',
      false,
    )
    await controller.makeVideoExtend(
      withVideo.shots[0]!,
      {
        channelId: 'ch',
        channelName: '渠道',
        model: '万相2.7 视频续写',
        label: '续写',
        resolutions: ['720P'],
        durations: [5],
      },
      '',
      '720P',
      5,
    )

    expect(actions).toEqual([
      'video-upscale',
      'video-fps',
      'video-erase',
      'video-edit',
      'video-extend',
    ])
  })
})
