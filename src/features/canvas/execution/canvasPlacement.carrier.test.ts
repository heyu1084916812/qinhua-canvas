import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import { createMemoryPlatform } from '../../../platform/memory'
import { createCanvasStore } from '../../../state/workbenches/canvas/store'
import { buildRunPlan } from './buildRunPlan'
import { createCanvasPlacement } from './canvasPlacement'

describe('canvas placement carrier provenance', () => {
  beforeEach(() => {
    registerAllSpecs()
  })

  it('marks a newly created carrier from a normal generation rerun', () => {
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    const nodeId = 'gen-source'
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 0, y: 0 },
      id: nodeId,
      data: {
        ...generationSpec.createDefaultData(),
        prompt: 'rerun this image',
        channelId: 'channel-1',
        model: 'image-1',
        assetHash: 'source-hash',
        thumbOrder: [],
        upstreamHidden: [],
      },
    })

    const plan = buildRunPlan('node', { originNodeId: nodeId }, store.getSnapshot(), 'single')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]?.slot.kind).toBe('new')

    const placement = createCanvasPlacement(() => 'p1')
    const began = placement.begin(plan.tasks[0]!, {
      isRepeat: false,
      slotIndex: 0,
      slotCount: 1,
    })
    const create = began.commands.find((command) => command.kind === 'node.create')

    expect(create?.kind).toBe('node.create')
    if (create?.kind !== 'node.create') throw new Error('expected node.create')
    expect((create.data as Record<string, unknown>).__carrierOf).toBe(nodeId)
  })

  it('does not mark reused source nodes as their own carriers', () => {
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    const nodeId = 'gen-empty'
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 0, y: 0 },
      id: nodeId,
      data: {
        ...generationSpec.createDefaultData(),
        prompt: 'first image',
        channelId: 'channel-1',
        model: 'image-1',
        thumbOrder: [],
        upstreamHidden: [],
      },
    })

    const plan = buildRunPlan('node', { originNodeId: nodeId }, store.getSnapshot(), 'single')
    expect(plan.tasks[0]?.slot).toEqual({ kind: 'reuse', nodeId })

    const placement = createCanvasPlacement(() => 'p1')
    const began = placement.begin(plan.tasks[0]!, {
      isRepeat: false,
      slotIndex: 0,
      slotCount: 1,
    })

    expect(began.targetId).toBe(nodeId)
    expect(began.commands).toEqual([])
  })
})
