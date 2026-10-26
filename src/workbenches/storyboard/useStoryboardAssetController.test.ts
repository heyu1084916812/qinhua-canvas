import { describe, expect, it, vi } from 'vitest'
import {
  addCharacter,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
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
  const dispatch = vi.fn((action: { kind: string }) => {
    if (action.kind === 'node.create') {
      return {
        patches: [
          {
            op: 'upsert',
            table: 'nodes',
            row: { id: 'asset-node' },
          },
        ],
      }
    }
    return { patches: [] }
  })
  const runNode = vi.fn(async () => undefined)
  const beginPlan = vi.fn()
  const endPlan = vi.fn()
  const setLay = vi.fn()
  const controller = createStoryboardAssetController({
    doc,
    currentDoc: () => doc,
    liveNodeIds: new Set(liveIds),
    canvasNodeCount: 2,
    channels: {
      defaultForNewNode: vi.fn(async () => null),
      rememberRecipe: vi.fn(async () => undefined),
    } as unknown as ChannelStore,
    canvasStore: {
      dispatch,
      beginPlan,
      endPlan,
    } as unknown as CanvasStore,
    execution: { runNode },
    projectId: 'p1',
    apply: (next) => applied.push(next),
    setLay,
  })
  return {
    controller,
    applied,
    dispatch,
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

    expect(test.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'node.create',
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

    expect(test.dispatch).toHaveBeenCalledWith({
      kind: 'edge.connect',
      source: 'base-node',
      target: 'asset-node',
    })
    expect(
      test.dispatch.mock.calls.filter(([action]) => action.kind === 'node.create'),
    ).toHaveLength(1)
    expect(test.applied[0]?.characters[0]?.turnaroundNodeId).toBe('asset-node')
  })
})
