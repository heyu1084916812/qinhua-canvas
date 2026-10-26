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
import { createStoryboardActionStateStore } from './useStoryboardActionState'

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

function multiShotFixture(count = 2): {
  doc: StoryboardDoc
  nodes: StoryboardCanvasNode[]
} {
  let doc = emptyStoryboard('project-1', 1)
  doc = addEpisode(doc)
  const episodeId = doc.episodes[0]!.id
  for (let index = 0; index < count; index += 1) {
    doc = addShot(doc, episodeId)
  }
  doc = {
    ...doc,
    shots: doc.shots.map((shot, index) => ({
      ...shot,
      nodeId: `image-node-${index}`,
      imageHash: `image-hash-${index}`,
      durationSec: 5,
      scene: `镜头 ${index + 1}`,
    })),
  }
  return {
    doc,
    nodes: doc.shots.map(
      (_, index) =>
        ({
          id: `image-node-${index}`,
          type: 'generation',
          x: 10 + index * 240,
          y: 20,
          w: 200,
          h: 200,
          parentId: null,
          data: {
            assetMime: index === 0 ? 'image/webp' : 'image/jpeg',
          },
        }) as StoryboardCanvasNode,
    ),
  }
}

function outcomeByShot(
  plan: StoryboardRunPlan,
  hashes: readonly (string | null)[],
) {
  const states = hashes.map((hash) =>
    hash
      ? successState(hash)
      : ({
          kind: 'failed',
          error: {
            kind: 'http',
            status: 500,
            body: 'server failed',
          },
          attempts: 1,
        } satisfies RunTaskState),
  )
  return {
    summary: {
      runPlanId: plan.id,
      mode: plan.mode,
      taskResults: plan.tasks.map((task, index) => ({
        taskId: task.id,
        nodeId: task.nodeId,
        state: states[index]!,
      })),
      succeeded: states.filter((state) => state.kind === 'succeeded').length,
      failed: states.filter((state) => state.kind === 'failed').length,
      canceled: 0,
      startedAt: 1,
      finishedAt: 11,
      records: [],
    },
    warnings: [],
    failures: [],
  }
}

function canceledOutcome(plan: StoryboardRunPlan) {
  return {
    summary: {
      runPlanId: plan.id,
      mode: plan.mode,
      taskResults: plan.tasks.map((task) => ({
        taskId: task.id,
        nodeId: task.nodeId,
        state: { kind: 'canceled' } satisfies RunTaskState,
      })),
      succeeded: 0,
      failed: 0,
      canceled: plan.tasks.length,
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
      actionState: createStoryboardActionStateStore(),
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
    const actionState = createStoryboardActionStateStore()
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
      actionState,
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
    expect(actionState.getBusy().videoEdit).toEqual({})
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
      actionState: createStoryboardActionStateStore(),
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

  it('整集视频只发起一个零依赖计划，并逐镜携带独立模型与首尾帧', async () => {
    const { doc, nodes } = multiShotFixture()
    const withExistingNode: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot, index) =>
        index === 0 ? { ...shot, videoNodeId: 'video-existing' } : shot,
      ),
    }
    const graphNodes = [
      ...nodes,
      {
        id: 'video-existing',
        type: 'generation',
        x: 300,
        y: 20,
        w: 200,
        h: 200,
        parentId: null,
        data: { model: 'seedance-2.0', assetMime: 'video/mp4' },
      } as StoryboardCanvasNode,
    ]
    const produced: StoryboardDoc = {
      ...withExistingNode,
      shots: withExistingNode.shots.map((shot, index) => ({
        ...shot,
        videoHash: `video-${index + 1}`,
      })),
    }
    let plan: StoryboardRunPlan | undefined
    let replaced: StoryboardDoc | undefined
    let lay = { kind: 'idle', text: '' }
    const run = vi.fn(async (nextPlan: StoryboardRunPlan) => {
      plan = nextPlan
      return outcomeByShot(nextPlan, ['video-1', 'video-2'])
    })
    const updateNodeData = vi.fn()
    const createGenerationNode = vi.fn(() => 'video-created')
    const defaultForNewNode = vi.fn(
      async (data: { model?: string }) =>
        data.model === 'seedance-2.0'
          ? {
              channelId: 'channel-first-last',
              model: 'seedance-2.0',
              params: {},
              substituted: false,
            }
          : {
              channelId: 'channel-image-only',
              model: 'minimax-h3',
              params: {},
              substituted: false,
            },
    )
    const controller = createStoryboardVideoExecutionController({
      currentDoc: () => withExistingNode,
      graphNodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set([
        'image-node-0',
        'image-node-1',
        'video-existing',
      ]),
      channels: {
        defaultForNewNode,
        getState: () => ({
          channels: [
            { id: 'channel-first-last', modelMap: {}, models: [], modelCache: [] },
            { id: 'channel-image-only', modelMap: {}, models: [], modelCache: [] },
          ],
        }),
      } as unknown as ChannelStore,
      storage: createMemoryStorage(),
      canvas: {
        createGenerationNode,
        updateNodeData,
        connectEdge: vi.fn(),
        removeEdge: vi.fn(),
        beginPlan: vi.fn(),
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
      actionState: createStoryboardActionStateStore(),
    })

    await controller.runEpisodeVideos(withExistingNode.shots)

    expect(run).toHaveBeenCalledTimes(1)
    expect(plan?.tasks).toHaveLength(2)
    expect(plan?.tasks.map((task) => task.dependsOn)).toEqual([[], []])
    expect(plan?.tasks.map((task) => task.request.channelId)).toEqual([
      'channel-first-last',
      'channel-image-only',
    ])
    expect(plan?.tasks[0]?.request.inputs).toEqual([
      expect.objectContaining({ assetHash: 'image-hash-0', mime: 'image/webp' }),
      expect.objectContaining({ assetHash: 'image-hash-1', mime: 'image/jpeg' }),
    ])
    expect(plan?.tasks[1]?.request.inputs).toEqual([
      expect.objectContaining({ assetHash: 'image-hash-1', mime: 'image/jpeg' }),
    ])
    expect(updateNodeData).toHaveBeenCalledWith(
      'video-existing',
      expect.objectContaining({ assetHash: 'video-1' }),
    )
    expect(createGenerationNode).toHaveBeenCalledTimes(1)
    expect(replaced?.shots.map((shot) => shot.videoNodeId)).toEqual([
      'video-existing',
      'video-created',
    ])
    expect(replaced?.shots.map((shot) => shot.videoHash)).toEqual([
      'video-1',
      'video-2',
    ])
    expect(lay).toEqual({ kind: 'done', text: '这一集 2 镜视频已出' })
  })

  it('整集里单镜失败不阻断另一镜业务结果与画布投影', async () => {
    const { doc, nodes } = multiShotFixture()
    const produced: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot, index) =>
        index === 0 ? { ...shot, videoHash: 'video-partial' } : shot,
      ),
    }
    let replaced: StoryboardDoc | undefined
    let lay = { kind: 'idle', text: '' }
    const createGenerationNode = vi.fn(() => 'video-partial-node')
    const run = vi.fn(async (plan: StoryboardRunPlan) =>
      outcomeByShot(plan, ['video-partial', null]),
    )
    const controller = createStoryboardVideoExecutionController({
      currentDoc: () => doc,
      graphNodes: nodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set(['image-node-0', 'image-node-1']),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'video-channel',
          model: 'minimax-h3',
          params: {},
          substituted: false,
        }),
        getState: () => ({
          channels: [
            { id: 'video-channel', modelMap: {}, models: [], modelCache: [] },
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
      documents: { load: async () => produced, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: (next) => {
        replaced = next
      },
      setLay: (value) => {
        if (typeof value !== 'function') lay = value
      },
      actionState: createStoryboardActionStateStore(),
    })

    await controller.runEpisodeVideos(doc.shots)

    expect(run).toHaveBeenCalledTimes(1)
    expect(createGenerationNode).toHaveBeenCalledTimes(1)
    expect(replaced?.shots[0]).toMatchObject({
      videoHash: 'video-partial',
      videoNodeId: 'video-partial-node',
    })
    expect(replaced?.shots[1]?.videoHash).toBeUndefined()
    expect(replaced?.shots[1]?.videoNodeId).toBeUndefined()
    expect(lay).toEqual({
      kind: 'error',
      text: '这一集视频跑完：成功 1 镜，失败 1 镜（失败原因见各自状态）',
    })
  })

  it('无图或无模型在请求发出前阻断整集计划', async () => {
    const { doc, nodes } = fixture()
    const noImage: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot) => {
        const { imageHash: _imageHash, ...rest } = shot
        return rest
      }),
    }
    const noImageRun = vi.fn()
    const noImageController = createStoryboardVideoExecutionController({
      currentDoc: () => noImage,
      graphNodes: nodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set(['image-node']),
      channels: {} as ChannelStore,
      storage: createMemoryStorage(),
      canvas: {} as StoryboardCanvasPort,
      execution: { run: noImageRun, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents: { load: async () => noImage, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: () => {},
      setLay: vi.fn(),
      actionState: createStoryboardActionStateStore(),
    })
    await noImageController.runEpisodeVideos(noImage.shots)
    expect(noImageRun).not.toHaveBeenCalled()

    let lay = { kind: 'idle', text: '' }
    const noModelRun = vi.fn()
    const noModelController = createStoryboardVideoExecutionController({
      currentDoc: () => doc,
      graphNodes: nodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set(['image-node']),
      channels: {
        defaultForNewNode: async () => null,
        getState: () => ({ channels: [] }),
      } as unknown as ChannelStore,
      storage: createMemoryStorage(),
      canvas: {} as StoryboardCanvasPort,
      execution: { run: noModelRun, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents: { load: async () => doc, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: () => {},
      setLay: (value) => {
        if (typeof value !== 'function') lay = value
      },
      actionState: createStoryboardActionStateStore(),
    })
    await noModelController.runEpisodeVideos(doc.shots)
    expect(noModelRun).not.toHaveBeenCalled()
    expect(lay).toEqual({
      kind: 'error',
      text: '还没有可用的视频模型服务 —— 先去「全局设置 → 模型服务」添加一条并勾上视频模型',
    })
  })

  it('显式单镜重出复用存活的旧视频节点，不另建副本', async () => {
    const { doc, nodes } = fixture()
    const withVideo: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot) => ({
        ...shot,
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
        data: { assetHash: 'old-video', assetMime: 'video/mp4' },
      } as StoryboardCanvasNode,
    ]
    const produced: StoryboardDoc = {
      ...withVideo,
      shots: withVideo.shots.map((shot) => ({
        ...shot,
        videoHash: 'new-video',
      })),
    }
    let replaced: StoryboardDoc | undefined
    const updateNodeData = vi.fn()
    const createGenerationNode = vi.fn(() => 'unexpected-node')
    const controller = createStoryboardVideoExecutionController({
      currentDoc: () => withVideo,
      graphNodes: videoNodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set(['image-node', 'video-old']),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'video-channel',
          model: 'minimax-h3',
          params: {},
          substituted: false,
        }),
        getState: () => ({
          channels: [
            { id: 'video-channel', modelMap: {}, models: [], modelCache: [] },
          ],
        }),
      } as unknown as ChannelStore,
      storage: createMemoryStorage(),
      canvas: {
        createGenerationNode,
        updateNodeData,
        connectEdge: vi.fn(),
        removeEdge: vi.fn(),
        beginPlan: vi.fn(),
        endPlan: vi.fn(),
        resolveGenerationData: async (data: Record<string, unknown>) => data,
      } as unknown as StoryboardCanvasPort,
      execution: {
        run: async (plan: StoryboardRunPlan) => outcomeFor(plan, 'new-video'),
        cancel: vi.fn(),
      } as unknown as StoryboardExecutionApi,
      documents: { load: async () => produced, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: (next) => {
        replaced = next
      },
      setLay: vi.fn(),
      actionState: createStoryboardActionStateStore(),
    })

    expect(await controller.makeShotVideo(withVideo.shots[0]!)).toBe(true)
    expect(createGenerationNode).not.toHaveBeenCalled()
    expect(updateNodeData).toHaveBeenCalledWith(
      'video-old',
      expect.objectContaining({ assetHash: 'new-video' }),
    )
    expect(replaced?.shots[0]).toMatchObject({
      videoNodeId: 'video-old',
      videoHash: 'new-video',
    })
  })

  it('整集 20 分钟取消以同一个 plan id 收口', async () => {
    vi.useFakeTimers()
    try {
      const { doc, nodes } = fixture()
      let plan: StoryboardRunPlan | undefined
      let resolveRun:
        | ((
            outcome: Awaited<ReturnType<StoryboardExecutionApi['run']>>,
          ) => void)
        | undefined
      let canceledPlanId = ''
      const cancel = vi.fn((planId?: string) => {
        canceledPlanId = planId ?? ''
        if (plan && resolveRun) resolveRun(canceledOutcome(plan))
      })
      const run = vi.fn(
        (nextPlan: StoryboardRunPlan) =>
          new Promise<Awaited<ReturnType<StoryboardExecutionApi['run']>>>(
            (resolve) => {
              plan = nextPlan
              resolveRun = resolve
            },
          ),
      )
      const controller = createStoryboardVideoExecutionController({
        currentDoc: () => doc,
        graphNodes: nodes,
        graphEdges: [] as StoryboardCanvasEdge[],
        liveNodeIds: new Set(['image-node']),
        channels: {
          defaultForNewNode: async () => ({
            channelId: 'video-channel',
            model: 'minimax-h3',
            params: {},
            substituted: false,
          }),
          getState: () => ({
            channels: [
              { id: 'video-channel', modelMap: {}, models: [], modelCache: [] },
            ],
          }),
        } as unknown as ChannelStore,
        storage: createMemoryStorage(),
        canvas: {
          createGenerationNode: vi.fn(),
          updateNodeData: vi.fn(),
          connectEdge: vi.fn(),
          removeEdge: vi.fn(),
          beginPlan: vi.fn(),
          endPlan: vi.fn(),
          resolveGenerationData: async (data: Record<string, unknown>) => data,
        } as unknown as StoryboardCanvasPort,
        execution: { run, cancel } as unknown as StoryboardExecutionApi,
        documents: { load: async () => doc, save: async () => {} },
        projectId: 'project-1',
        flush: async () => {},
        replaceDoc: () => {},
        setLay: vi.fn(),
        actionState: createStoryboardActionStateStore(),
      })

      const running = controller.runEpisodeVideos(doc.shots)
      await vi.advanceTimersByTimeAsync(0)
      expect(run).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(canceledPlanId).toBe(plan?.id)
      await running
    } finally {
      vi.useRealTimers()
    }
  })

  it('same-shot video edit double-click sends once', async () => {
    const { doc, nodes } = fixture()
    const withVideo: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot) => ({
        ...shot,
        videoHash: 'old-video',
        videoNodeId: 'video-old',
      })),
    }
    const graphNodes = [
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
    const actionState = createStoryboardActionStateStore()
    let plan: StoryboardRunPlan | undefined
    let resolveRun!: (
      outcome: Awaited<ReturnType<StoryboardExecutionApi['run']>>,
    ) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const pending = new Promise<
      Awaited<ReturnType<StoryboardExecutionApi['run']>>
    >((resolve) => {
      resolveRun = resolve
    })
    const run = vi.fn((nextPlan: StoryboardRunPlan) => {
      plan = nextPlan
      markStarted()
      return pending
    })
    const produced: StoryboardDoc = {
      ...withVideo,
      shots: withVideo.shots.map((shot) => ({
        ...shot,
        videoHash: 'edited-video',
      })),
    }
    const controller = createStoryboardVideoExecutionController({
      currentDoc: () => withVideo,
      graphNodes,
      graphEdges: [] as StoryboardCanvasEdge[],
      liveNodeIds: new Set(['image-node', 'video-old']),
      channels: {} as ChannelStore,
      storage: createMemoryStorage(),
      canvas: {
        createGenerationNode: vi.fn(() => 'video-edited-node'),
        updateNodeData: vi.fn(),
        connectEdge: vi.fn(),
        removeEdge: vi.fn(),
        beginPlan: vi.fn(),
        endPlan: vi.fn(),
        resolveGenerationData: async (data: Record<string, unknown>) => data,
      } as unknown as StoryboardCanvasPort,
      execution: { run, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents: { load: async () => produced, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: () => {},
      setLay: vi.fn(),
      actionState,
    })
    const target = {
      channelId: 'edit-channel',
      channelName: '编辑渠道',
      model: '全能视频X 视频编辑',
      label: '视频编辑',
      resolutions: ['720p'],
      supportsReferenceImage: false,
      requiresReferenceImage: false,
    } as const

    const first = controller.makeVideoEdit(
      produced.shots[0]!,
      target,
      '改成夜景',
      '720p',
      false,
    )
    await started
    expect(actionState.isBusy('video-edit', withVideo.shots[0]!.id)).toBe(true)
    await controller.makeVideoEdit(
      produced.shots[0]!,
      target,
      '改成夜景',
      '720p',
      false,
    )
    expect(run).toHaveBeenCalledTimes(1)

    resolveRun(outcomeFor(plan!, 'edited-video'))
    await first
    expect(actionState.isBusy('video-edit', withVideo.shots[0]!.id)).toBe(false)
  })
})
