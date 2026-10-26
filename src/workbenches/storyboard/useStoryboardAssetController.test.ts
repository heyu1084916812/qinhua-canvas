import { describe, expect, it, vi } from 'vitest'
import {
  addCharacter,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import { createStoryboardAssetController } from './useStoryboardAssetController'

function docWithCharacter(patch: { nodeId?: string } = {}) {
  let doc = addCharacter(emptyStoryboard('p1'))
  doc = {
    ...doc,
    characters: doc.characters.map((character) => ({
      ...character,
      ...patch,
    })),
  }
  return doc
}

function harness(doc: StoryboardDoc, liveIds: string[] = []) {
  const applied: StoryboardDoc[] = []
  const createGenerationNode = vi.fn(() => 'asset-node')
  const resolveGenerationData = vi.fn(
    async (extraData: Record<string, unknown>) => extraData,
  )
  const connectEdge = vi.fn()
  const runNode = vi.fn(async () => undefined)
  const beginPlan = vi.fn()
  const endPlan = vi.fn()
  const setLay = vi.fn()
  const controller = createStoryboardAssetController({
    doc,
    currentDoc: () => doc,
    liveNodeIds: new Set(liveIds),
    canvas: {
      getSnapshot: () => ({ nodes: [{}, {}], edges: [] }),
      resolveGenerationData,
      createGenerationNode,
      connectEdge,
      runNode,
      beginPlan,
      endPlan,
    } as unknown as StoryboardCanvasPort,
    apply: (next) => applied.push(next),
    setLay,
  })
  return {
    controller,
    applied,
    createGenerationNode,
    connectEdge,
    runNode,
    beginPlan,
    endPlan,
    setLay,
  }
}

describe('Storyboard asset controller', () => {
  it('定妆图缺节点时新建并原地运行，随后把节点 id 写回资产', async () => {
    const doc = docWithCharacter()
    const test = harness(doc)

    await test.controller.makeAssetBase('char', doc.characters[0]!.id)

    expect(test.createGenerationNode).toHaveBeenCalledWith(
      expect.objectContaining({
        at: { x: 40, y: 440 },
        data: expect.objectContaining({
          mode: 'image',
          prompt: expect.stringContaining('正面半身'),
        }),
      }),
    )
    expect(test.runNode).toHaveBeenCalledWith('asset-node', { inPlace: true })
    expect(test.applied[0]?.characters[0]?.nodeId).toBe('asset-node')
    expect(test.beginPlan).toHaveBeenCalledWith('storyboard:asset-base', '定妆图 ×1')
    expect(test.endPlan).toHaveBeenCalledTimes(1)
  })

  it('已有存活节点时复用，不重复创建；多视角连接定妆图作为参考', async () => {
    let doc = docWithCharacter({ nodeId: 'base-node' })
    doc = {
      ...doc,
      characters: doc.characters.map((character) => ({
        ...character,
        nodeId: 'base-node',
      })),
    }
    const test = harness(doc, ['base-node'])

    await test.controller.makeAssetTurnaround(doc.characters[0]!.id)

    expect(test.connectEdge).toHaveBeenCalledWith('base-node', 'asset-node')
    expect(test.createGenerationNode).toHaveBeenCalledTimes(1)
    expect(test.applied[0]?.characters[0]?.turnaroundNodeId).toBe('asset-node')
  })
})
