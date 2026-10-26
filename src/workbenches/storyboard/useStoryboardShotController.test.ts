import { describe, expect, it, vi } from 'vitest'
import {
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'
import type {
  StoryboardCanvasEdge,
  StoryboardCanvasNode,
  StoryboardCanvasPort,
} from '../../features/storyboard/canvasPort'
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
    })),
  }
}

function harness(doc: StoryboardDoc) {
  const updateNodeData = vi.fn()
  const beginPlan = vi.fn()
  const endPlan = vi.fn()
  const setLay = vi.fn()
  const getSnapshot = vi.fn(() => ({
    nodes: [] as StoryboardCanvasNode[],
    edges: [] as StoryboardCanvasEdge[],
  }))
  const controller = createStoryboardShotController({
    doc,
    currentDoc: () => doc,
    selected: doc.episodes[0]!,
    shots: doc.shots,
    needNodes: [],
    graphNodes: [],
    liveNodeIds: new Set(['n1', 'n2']),
    canvas: {
      updateNodeData,
      beginPlan,
      endPlan,
      getSnapshot,
    } as unknown as StoryboardCanvasPort,
    apply: () => undefined,
    setLay,
  })
  return {
    controller,
    updateNodeData,
    beginPlan,
    endPlan,
    setLay,
  }
}

describe('Storyboard shot controller', () => {
  it('没有待铺镜头时不创建画布事务', async () => {
    const doc = shotDoc()
    const test = harness(doc)

    await test.controller.layOut()

    expect(test.beginPlan).not.toHaveBeenCalled()
    expect(test.setLay).toHaveBeenCalledWith({
      kind: 'done',
      text: '这一集的镜头都已经在画布上了',
    })
  })

  it('刷新提示词只改仍在画布上的镜头，整批只占一个事务', () => {
    const doc = shotDoc()
    const test = harness(doc)

    test.controller.syncPrompts()

    expect(test.beginPlan).toHaveBeenCalledWith(
      'storyboard:sync-prompt',
      '按资产刷新提示词 ×2',
    )
    expect(test.updateNodeData).toHaveBeenCalledTimes(2)
    expect(test.updateNodeData).toHaveBeenCalledWith(
      'n1',
      { prompt: expect.any(String) },
      false,
    )
    expect(test.endPlan).toHaveBeenCalledTimes(1)
    expect(test.setLay).toHaveBeenCalledWith({
      kind: 'done',
      text: '已按当前资产刷新 2 个节点的提示词',
    })
  })
})
