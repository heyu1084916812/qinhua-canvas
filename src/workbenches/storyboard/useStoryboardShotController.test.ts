import { describe, expect, it, vi } from 'vitest'
import {
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'
import type { Edge } from '../../domain/canvas/model/edge'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import { createMemoryPlatform } from '../../platform/memory'
import { createStoryboardShotController } from './useStoryboardShotController'

function shotDoc(): StoryboardDoc {
  let doc = addEpisode(emptyStoryboard('p1'))
  const episode = doc.episodes[0]!
  doc = addShot(doc, episode.id)
  doc = addShot(doc, episode.id)
  return {
    ...doc,
    shots: doc.shots.map((shot, index) => ({
      ...shot,
      nodeId: `n${index + 1}`,
      ...(index === 0 ? { imageHash: 'done-image' } : {}),
    })),
  }
}

function harness(doc: StoryboardDoc) {
  const dispatch = vi.fn(() => ({ patches: [] }))
  const beginPlan = vi.fn()
  const endPlan = vi.fn()
  const runNode = vi.fn(async () => undefined)
  const nodeStateOf = vi.fn(() => undefined)
  const setLay = vi.fn()
  const getSnapshot = vi.fn(() => ({
    nodes: [] as NodeSnapshot[],
    edges: [] as Edge[],
  }))
  const controller = createStoryboardShotController({
    doc,
    currentDoc: () => doc,
    selected: doc.episodes[0]!,
    shots: doc.shots,
    needNodes: [],
    graphNodes: [],
    graphEdges: [],
    liveNodeIds: new Set(['n1', 'n2']),
    channels: {} as ChannelStore,
    canvasStore: {
      dispatch,
      beginPlan,
      endPlan,
      getSnapshot,
    } as unknown as CanvasStore,
    execution: { runNode, nodeStateOf },
    platform: createMemoryPlatform(),
    projectId: 'p1',
    directTrace: () => ({
      projectId: 'p1',
      workbench: 'storyboard',
      subjectId: 'test',
      fingerprint: 'fp',
    }),
    digitalHumanTarget: null,
    apply: () => undefined,
    setLay,
    setDigitalHumanBusy: () => undefined,
  })
  return {
    controller,
    dispatch,
    beginPlan,
    endPlan,
    runNode,
    setLay,
  }
}

describe('Storyboard shot controller', () => {
  it('刷新提示词只改仍在画布上的镜头，整批只占一个事务', () => {
    const doc = shotDoc()
    const test = harness(doc)

    test.controller.syncPrompts()

    expect(test.beginPlan).toHaveBeenCalledWith(
      'storyboard:sync-prompt',
      '按资产刷新提示词 ×2',
    )
    expect(test.dispatch).toHaveBeenCalledTimes(2)
    expect(test.dispatch).toHaveBeenCalledWith({
      kind: 'node.updateData',
      id: 'n1',
      patch: { prompt: expect.any(String) },
      transient: false,
    })
    expect(test.endPlan).toHaveBeenCalledTimes(1)
    expect(test.setLay).toHaveBeenCalledWith({
      kind: 'done',
      text: '已按当前资产刷新 2 个节点的提示词',
    })
  })

  it('整集出图跳过已出过的镜头，只串行运行待出图节点', async () => {
    const doc = shotDoc()
    const test = harness(doc)

    await test.controller.runEpisode()

    expect(test.runNode).toHaveBeenCalledTimes(1)
    expect(test.runNode).toHaveBeenCalledWith('n2', { inPlace: true })
    expect(test.setLay).toHaveBeenLastCalledWith({
      kind: 'done',
      text: '已跑完这一集 1 镜（失败的镜头各自标了原因）',
    })
  })

  it('出视频前先检查画面，缺图直接报错且不解析渠道', async () => {
    const doc = shotDoc()
    const test = harness(doc)

    const success = await test.controller.makeShotVideo(doc.shots[1]!)

    expect(success).toBe(false)
    expect(test.runNode).not.toHaveBeenCalled()
    expect(test.setLay).toHaveBeenCalledWith({
      kind: 'error',
      text: '这一镜还没有图 —— 图生视频要先有画面，先点「出图」',
    })
  })
})
