import { beforeEach, describe, expect, it } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../../platform/memory'
import {
  createCanvasStore,
  type CanvasStore,
} from '../../../state/workbenches/canvas/store'
import { buildGroupRunPlan } from './groupRunPlan'

beforeEach(() => registerAllSpecs())

function setup() {
  return createCanvasStore({
    platform: createMemoryPlatform() as never,
    projectId: 'p1',
  }) as CanvasStore
}

function add(
  store: CanvasStore,
  type: 'group' | 'prompt' | 'generation',
  data: Record<string, unknown>,
  parentId?: string,
) {
  store.dispatch({
    kind: 'node.create',
    projectId: 'p1',
    type,
    at: { x: 0, y: 0 },
    data,
    ...(parentId ? { parentId } : {}),
  })
  return store.getSnapshot().nodes.at(-1)!.id
}

describe('buildGroupRunPlan', () => {
  it('runs the runnable nodes from the group as one topologically ordered plan', () => {
    const store = setup()
    const group = add(store, 'group', { childIds: [] })
    const prompt = add(store, 'prompt', { text: '一只橘猫' }, group)
    const generation = add(
      store,
      'generation',
      { mode: 'image', prompt: '一只橘猫', channelId: 'ch', model: 'img' },
      group,
    )

    const plan = buildGroupRunPlan(store.getSnapshot(), [group, prompt, generation])

    expect(plan.tasks.map((task) => task.nodeId)).toEqual([generation])
    expect(plan.tasks[0]?.request.prompt).toContain('一只橘猫')
    expect(plan.scope).toBe('node')
    expect(plan.mode).toBe('rerunAll')
  })

  it('drops an empty generation instead of creating a right-side shell', () => {
    const store = setup()
    const group = add(store, 'group', { childIds: [] })
    const empty = add(
      store,
      'generation',
      { mode: 'image', prompt: '', channelId: 'ch', model: 'img' },
      group,
    )

    const plan = buildGroupRunPlan(store.getSnapshot(), [group, empty])

    expect(plan.tasks).toEqual([])
  })
})
