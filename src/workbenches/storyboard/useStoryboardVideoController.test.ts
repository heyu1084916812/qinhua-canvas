import { describe, expect, it, vi } from 'vitest'
import {
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import {
  createStoryboardVideoController,
  type VideoEditTarget,
  type VideoEraseTarget,
  type VideoExtendTarget,
  type VideoUpscaleTarget,
} from './useStoryboardVideoController'

const trace = (args: {
  subjectId: string
  kind: 'text' | 'video' | 'speech'
  channelId: string
  model: string
  payload: unknown
  inputs?: DirectRunTraceInput['inputs']
  params?: Record<string, unknown>
}): DirectRunTraceInput => ({
  projectId: 'p1',
  workbench: 'storyboard',
  ...args,
  fingerprint: args.subjectId,
})

function node(
  id: string,
  assetHash: string,
  mime = 'video/mp4',
): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type: 'generation',
    parentId: null,
    x: id === 'v1' ? 100 : 0,
    y: 120,
    w: 240,
    h: 192,
    title: id,
    disabled: false,
    data: {
      mode: mime.startsWith('video/') ? 'video' : 'image',
      assetHash,
      assetMime: mime,
      prompt: '',
      linkedPromptNodeIds: [],
      channelId: 'ch1',
      model: 'model1',
      thumbOrder: [],
      upstreamHidden: [],
    },
  }
}

function shotDoc(options: { image?: boolean } = {}): {
  doc: StoryboardDoc
  shot: StoryboardShot
} {
  let doc = addEpisode(emptyStoryboard('p1'))
  const episode = doc.episodes[0]!
  doc = addShot(doc, episode.id)
  const shot = doc.shots[0]!
  doc = {
    ...doc,
    shots: doc.shots.map((item) =>
      item.id === shot.id
        ? {
            ...item,
            videoNodeId: 'v1',
            videoHash: 'old-video',
            durationSec: 5,
            ...(options.image ? { nodeId: 'i1', imageHash: 'ref-image' } : {}),
          }
        : item,
    ),
  }
  return { doc, shot: doc.shots[0]! }
}

function harness(doc: StoryboardDoc, nodes: NodeSnapshot[]) {
  const applied: StoryboardDoc[] = []
  const putAsset = vi.fn()
  const createGenerationNode = vi.fn(() => 'result-node')
  const resolveGenerationData = vi.fn(
    async (extraData: Record<string, unknown>) => extraData,
  )
  const connectEdge = vi.fn()
  const removeEdge = vi.fn()
  const generateVideo = vi.fn(async () => [
    {
      hash: 'new-video',
      mime: 'video/mp4',
      bytes: new Uint8Array([1, 2, 3]),
    },
  ])
  const defaultForNewNode = vi.fn(async () => null)
  const rememberRecipe = vi.fn(async () => undefined)
  const beginPlan = vi.fn()
  const endPlan = vi.fn()
  const setLay = vi.fn()
  const setBusy = vi.fn()

  const controller = createStoryboardVideoController({
    currentDoc: () => doc,
    graphNodes: nodes,
    liveNodeIds: new Set(nodes.map((item) => item.id)),
    channels: {
      generateVideo,
      defaultForNewNode,
      rememberRecipe,
    } as unknown as ChannelStore,
    canvas: {
      putAsset,
      createGenerationNode,
      resolveGenerationData,
      connectEdge,
      removeEdge,
      beginPlan,
      endPlan,
    } as unknown as StoryboardCanvasPort,
    directTrace: trace,
    apply: (next) => applied.push(next),
    setLay,
    videoUpscaleBusy: null,
    setVideoUpscaleBusy: setBusy,
    videoEraseBusy: null,
    setVideoEraseBusy: setBusy,
    videoEditBusy: null,
    setVideoEditBusy: setBusy,
    videoExtendBusy: null,
    setVideoExtendBusy: setBusy,
  })

  return {
    controller,
    applied,
    putAsset,
    createGenerationNode,
    connectEdge,
    removeEdge,
    generateVideo,
    beginPlan,
    endPlan,
    setLay,
    setBusy,
  }
}

describe('Storyboard video controller', () => {
  it('超清只读旧视频，结果落独立新节点并保留旧节点', async () => {
    const { doc, shot } = shotDoc()
    const source = node('v1', 'old-video')
    const test = harness(doc, [source])
    const target: VideoUpscaleTarget = {
      channelId: 'ch1',
      channelName: 'RH',
      model: 'Topaz 视频超清',
      label: 'Topaz',
      resolutions: ['1080p', '4k'],
      frameRates: [30, 60],
    }

    await test.controller.makeVideoUpscale(shot, target, '4k', 60)

    expect(test.generateVideo).toHaveBeenCalledTimes(1)
    expect(test.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'ch1',
        model: 'Topaz 视频超清',
        prompt: '视频超清',
        inputs: [
          expect.objectContaining({
            nodeId: 'v1',
            assetHash: 'old-video',
            mime: 'video/mp4',
          }),
        ],
        params: { resolution: '4k', fps: '60' },
      }),
    )
    expect(test.createGenerationNode).toHaveBeenCalledWith(
      expect.objectContaining({
        at: { x: 420, y: 120 },
        data: expect.objectContaining({
          mode: 'video',
          assetHash: 'new-video',
          assetMime: 'video/mp4',
        }),
      }),
    )
    expect(test.connectEdge).toHaveBeenCalledWith('v1', 'result-node')
    expect(test.removeEdge).not.toHaveBeenCalled()
    expect(test.applied.at(-1)?.shots[0]).toMatchObject({
      videoNodeId: 'result-node',
      videoHash: 'new-video',
    })
    expect(test.beginPlan).toHaveBeenCalledWith(
      'storyboard:video-upscale',
      '镜头视频超清',
    )
    expect(test.endPlan).toHaveBeenCalledTimes(1)
    expect(test.setBusy).toHaveBeenLastCalledWith(null)
  })

  it('字幕擦除只发送视频输入，不伪造提示词或清晰度参数', async () => {
    const { doc, shot } = shotDoc()
    const test = harness(doc, [node('v1', 'old-video')])
    const target: VideoEraseTarget = {
      channelId: 'ch1',
      channelName: '火山',
      model: '火山字幕擦除 标准版',
      label: '标准版',
    }

    await test.controller.makeVideoErase(shot, target)

    expect(test.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '',
        params: {},
        inputs: [
          expect.objectContaining({
            assetHash: 'old-video',
            mime: 'video/mp4',
          }),
        ],
      }),
    )
    expect(test.applied.at(-1)?.shots[0]?.videoHash).toBe('new-video')
  })

  it('视频编辑同时连接源视频与当前画面参考图', async () => {
    const { doc, shot } = shotDoc({ image: true })
    const test = harness(doc, [
      node('v1', 'old-video'),
      node('i1', 'ref-image', 'image/png'),
    ])
    const target: VideoEditTarget = {
      channelId: 'ch1',
      channelName: 'RunningHub',
      model: '万相2.7 视频编辑',
      label: '万相2.7',
      resolutions: ['720P', '1080P'],
      supportsReferenceImage: true,
      requiresReferenceImage: true,
    }

    await test.controller.makeVideoEdit(shot, target, '换成红色外套', '1080P', true)

    expect(test.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '换成红色外套',
        params: { resolution: '1080P' },
        inputs: [
          expect.objectContaining({ nodeId: 'v1', assetHash: 'old-video' }),
          expect.objectContaining({ nodeId: 'i1', assetHash: 'ref-image' }),
        ],
      }),
    )
    expect(test.connectEdge).toHaveBeenCalledWith('v1', 'result-node')
    expect(test.connectEdge).toHaveBeenCalledWith('i1', 'result-node')
    expect(test.setLay).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'done',
        text: expect.stringContaining('已参考当前画面'),
      }),
    )
  })

  it('必填参考图的编辑模型在未勾选参考图时提前阻断，不请求渠道', async () => {
    const { doc, shot } = shotDoc({ image: true })
    const test = harness(doc, [
      node('v1', 'old-video'),
      node('i1', 'ref-image', 'image/png'),
    ])
    const target: VideoEditTarget = {
      channelId: 'ch1',
      channelName: 'RunningHub',
      model: '万相2.7 视频编辑',
      label: '万相2.7',
      resolutions: ['720P', '1080P'],
      supportsReferenceImage: true,
      requiresReferenceImage: true,
    }

    await test.controller.makeVideoEdit(shot, target, '换背景', '1080P', false)

    expect(test.generateVideo).not.toHaveBeenCalled()
    expect(test.connectEdge).not.toHaveBeenCalled()
    expect(test.setLay).toHaveBeenCalledWith({
      kind: 'error',
      text: '这个模型必须参考当前镜头画面',
    })
  })

  it('视频续写把新增时长与清晰度送到真实请求，空指令使用一致性兜底', async () => {
    const { doc, shot } = shotDoc()
    const test = harness(doc, [node('v1', 'old-video')])
    const target: VideoExtendTarget = {
      channelId: 'ch1',
      channelName: 'RunningHub',
      model: '万相2.7 视频续写',
      label: '万相2.7',
      resolutions: ['720P', '1080P'],
      durations: [2, 5],
    }

    await test.controller.makeVideoExtend(shot, target, '  ', '720P', 5)

    expect(test.generateVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: '延续当前镜头内容与运动，保持人物、场景和画风一致',
        params: { resolution: '720P', duration: 5 },
        inputs: [
          expect.objectContaining({
            nodeId: 'v1',
            assetHash: 'old-video',
          }),
        ],
      }),
    )
    expect(test.applied.at(-1)?.shots[0]?.videoHash).toBe('new-video')
    expect(test.setLay).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: 'done',
        text: '这一镜已续写 5 秒 · 720P',
      }),
    )
  })
})
