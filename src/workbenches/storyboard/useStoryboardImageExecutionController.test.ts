import { describe, expect, it, vi } from 'vitest'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import type { StoryboardProjectionPort } from '../../features/storyboard/canvasPort'
import {
  addCharacter,
  addEpisode,
  addShot,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'
import type { StoryboardRunPlan } from '../../domain/storyboard/runTypes'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import { createStoryboardImageExecutionController } from './useStoryboardImageExecutionController'

function fixture(): {
  doc: StoryboardDoc
  episodeId: string
  firstShotId: string
  secondShotId: string
} {
  let doc = emptyStoryboard('project-1', 1)
  doc = addCharacter(doc)
  doc = addEpisode(doc)
  const episodeId = doc.episodes[0]!.id
  doc = addShot(doc, episodeId)
  doc = addShot(doc, episodeId)
  const firstShotId = doc.shots[0]!.id
  const secondShotId = doc.shots[1]!.id
  doc = {
    ...doc,
    shots: doc.shots.map((shot, index) => ({
      ...shot,
      nodeId: `node-${index + 1}`,
      scene: `镜头 ${index + 1}`,
      characterIds: [doc.characters[0]!.id],
      ...(index === 1 ? { imageHash: 'already-done' } : {}),
    })),
  }
  return { doc, episodeId, firstShotId, secondShotId: secondShotId }
}

function deferredState(hash = 'new-image'): RunTaskState {
  return {
    kind: 'succeeded',
    result: [
      {
        hash,
        mime: 'image/webp',
        bytes: new Uint8Array([1]),
        width: 800,
        height: 1200,
      },
    ],
    duration: 1,
  }
}

function imageOutcome(plan: StoryboardRunPlan, hash = 'new-image') {
  const state = deferredState(hash)
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
      finishedAt: 2,
      records: [],
    },
    warnings: [],
    failures: [],
  }
}

describe('useStoryboardImageExecutionController', () => {
  it('定妆图走资产业务计划，不创建画布节点，只写回 baseHash', async () => {
    const { doc } = fixture()
    const characterId = doc.characters[0]!.id
    let captured: StoryboardRunPlan | undefined
    let replaced: StoryboardDoc | undefined
    const run = vi.fn(async (plan: StoryboardRunPlan) => {
      captured = plan
      const state = deferredState('character-base')
      return {
        summary: {
          runPlanId: plan.id,
          mode: plan.mode,
          taskResults: plan.tasks.map((task) => ({
            taskId: task.id,
            nodeId: task.nodeId,
            state,
          })),
          succeeded: 1,
          failed: 0,
          canceled: 0,
          startedAt: 1,
          finishedAt: 2,
          records: [],
        },
        warnings: [],
        failures: [],
      }
    })
    const produced: StoryboardDoc = {
      ...doc,
      characters: doc.characters.map((item) => ({
        ...item,
        baseHash: 'character-base',
      })),
    }
    const actionState = {
      tryAcquire: () => ({ release: () => undefined }),
    }
    const controller = createStoryboardImageExecutionController({
      doc,
      currentDoc: () => doc,
      liveNodeIds: new Set(),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'channel-1',
          model: 'image-model',
          params: { ratio: '1:1' },
          substituted: false,
        }),
      } as unknown as ChannelStore,
      projection: {
        getSnapshot: () => ({ nodes: [], edges: [] }),
      } as unknown as StoryboardProjectionPort,
      execution: { run } as unknown as StoryboardExecutionApi,
      documents: { load: async () => produced, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: (next) => {
        replaced = next
      },
      actionState,
      setLay: () => {},
    })

    await controller.makeAssetBase('char', characterId)

    expect(captured?.tasks[0]).toMatchObject({
      action: 'asset-base',
      subject: {
        kind: 'asset',
        assetId: characterId,
        assetType: 'char',
      },
      request: {
        params: { ratio: '1:1' },
      },
    })
    expect(replaced?.characters[0]!.baseHash).toBe('character-base')
  })

  it('单镜出图走业务计划，并把真实产物 hash / MIME / 尺寸投影到画布节点', async () => {
    const prepared = fixture()
    const doc: StoryboardDoc = {
      ...prepared.doc,
      characters: prepared.doc.characters.map((item) => ({
        ...item,
        baseHash: 'character-base',
        nodeId: 'asset-node',
      })),
    }
    const { episodeId, firstShotId } = prepared
    let captured: StoryboardRunPlan | undefined
    let replaced: StoryboardDoc | undefined
    const run = vi.fn(async (plan: StoryboardRunPlan) => {
      captured = plan
      const state = deferredState()
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
          finishedAt: 2,
          records: [],
        },
        warnings: [],
        failures: [],
      }
    })
    const produced: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot) =>
        shot.id === firstShotId ? { ...shot, imageHash: 'new-image' } : shot,
      ),
    }
    const documents: StoryboardDocumentPort = {
      load: async () => produced,
      save: async () => {},
    }
    const updateNodeData = vi.fn()
    let lay = { kind: 'idle', text: '' }
    const actionState = {
      tryAcquire: () => ({ release: () => undefined }),
    }
    const controller = createStoryboardImageExecutionController({
      doc,
      currentDoc: () => doc,
      selectedEpisodeId: episodeId,
      liveNodeIds: new Set(['asset-node', 'node-1', 'node-2']),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'channel-1',
          model: 'image-model',
          params: {},
          substituted: false,
        }),
      } as unknown as ChannelStore,
      projection: {
        getSnapshot: () => ({
          nodes: [
            {
              id: 'node-1',
              data: { channelId: 'channel-1', model: 'image-model' },
            },
          ],
          edges: [],
        }),
        updateNodeData,
      } as unknown as StoryboardProjectionPort,
      execution: { run } as unknown as StoryboardExecutionApi,
      documents,
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: (next) => {
        replaced = next
      },
      actionState,
      setLay: (value) => {
        lay =
          typeof value === 'function'
            ? (value as (current: typeof lay) => typeof lay)(lay)
            : value
      },
    })

    await controller.runShot(doc.shots[0]!)

    expect(captured?.tasks).toHaveLength(1)
    expect(captured?.tasks[0]).toMatchObject({
      action: 'shot-image',
      subject: {
        kind: 'shot-image',
        shotId: firstShotId,
      },
    })
    expect(replaced?.shots[0]!.imageHash).toBe('new-image')
    expect(updateNodeData).toHaveBeenCalledWith(
      'node-1',
      expect.objectContaining({
        assetHash: 'new-image',
        assetMime: 'image/webp',
        naturalSize: { width: 800, height: 1200 },
      }),
      true,
    )
    expect(lay).toEqual({
      kind: 'done',
      text: '这一镜的图已出（带了 1 张参考图）',
    })
  })

  it('整集出图只提交已铺且未出图的镜头，不重跑已有结果的镜头', async () => {
    const { doc, episodeId } = fixture()
    let captured: StoryboardRunPlan | undefined
    const run = vi.fn(async (plan: StoryboardRunPlan) => {
      captured = plan
      const state = deferredState()
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
          finishedAt: 2,
          records: [],
        },
        warnings: [],
        failures: [],
      }
    })
    const actionState = {
      tryAcquire: () => ({ release: () => undefined }),
    }
    const controller = createStoryboardImageExecutionController({
      doc,
      currentDoc: () => doc,
      selectedEpisodeId: episodeId,
      liveNodeIds: new Set(['node-1', 'node-2']),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'channel-1',
          model: 'image-model',
          params: {},
          substituted: false,
        }),
      } as unknown as ChannelStore,
      projection: {
        getSnapshot: () => ({
          nodes: [
            {
              id: 'node-1',
              data: { channelId: 'channel-1', model: 'image-model' },
            },
            {
              id: 'node-2',
              data: { channelId: 'channel-1', model: 'image-model' },
            },
          ],
          edges: [],
        }),
      } as unknown as StoryboardProjectionPort,
      execution: { run } as unknown as StoryboardExecutionApi,
      documents: { load: async () => doc, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: () => {},
      actionState,
      setLay: () => {},
    })

    await controller.runEpisode()

    expect(
      captured?.tasks.map((task) =>
        task.subject.kind === 'shot-image' ? task.subject.shotId : '',
      ),
    ).toEqual([doc.shots[0]!.id])
  })

  it('projection missing still writes asset and shot image hashes exactly once per action', async () => {
    const prepared = fixture()
    const characterId = prepared.doc.characters[0]!.id
    const produced: StoryboardDoc = {
      ...prepared.doc,
      characters: prepared.doc.characters.map((item) => ({
        ...item,
        baseHash: 'asset-base',
      })),
      shots: prepared.doc.shots.map((shot) =>
        shot.id === prepared.firstShotId
          ? { ...shot, imageHash: 'shot-image' }
          : shot,
      ),
    }
    const replaceDoc = vi.fn()
    const run = vi.fn(async (plan: StoryboardRunPlan) =>
      imageOutcome(
        plan,
        plan.tasks[0]!.action === 'asset-base'
          ? 'asset-base'
          : 'shot-image',
      ),
    )
    const controller = createStoryboardImageExecutionController({
      doc: prepared.doc,
      currentDoc: () => prepared.doc,
      selectedEpisodeId: prepared.episodeId,
      liveNodeIds: new Set(),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'channel-1',
          model: 'image-model',
          params: {},
          substituted: false,
        }),
      } as unknown as ChannelStore,
      projection: {} as StoryboardProjectionPort,
      execution: { run } as unknown as StoryboardExecutionApi,
      documents: {
        load: async () => produced,
        save: async () => {},
      },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc,
      actionState: {
        tryAcquire: () => ({ release: () => undefined }),
      },
      setLay: () => {},
    })

    await controller.makeAssetBase('char', characterId)
    await controller.runShot(prepared.doc.shots[0]!)

    expect(run).toHaveBeenCalledTimes(2)
    expect(replaceDoc).toHaveBeenLastCalledWith(
      expect.objectContaining({
        characters: expect.arrayContaining([
          expect.objectContaining({ id: characterId, baseHash: 'asset-base' }),
        ]),
        shots: expect.arrayContaining([
          expect.objectContaining({
            id: prepared.firstShotId,
            imageHash: 'shot-image',
          }),
        ]),
      }),
    )
  })

  it('same-shot image double-click sends one paid request', async () => {
    const prepared = fixture()
    let plan: StoryboardRunPlan | undefined
    let resolveRun!: (
      outcome: ReturnType<typeof imageOutcome>,
    ) => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const pending = new Promise<ReturnType<typeof imageOutcome>>((resolve) => {
      resolveRun = resolve
    })
    const run = vi.fn((nextPlan: StoryboardRunPlan) => {
      plan = nextPlan
      markStarted()
      return pending
    })
    const controller = createStoryboardImageExecutionController({
      doc: prepared.doc,
      currentDoc: () => prepared.doc,
      selectedEpisodeId: prepared.episodeId,
      liveNodeIds: new Set(['node-1']),
      channels: {
        defaultForNewNode: async () => ({
          channelId: 'channel-1',
          model: 'image-model',
          params: {},
          substituted: false,
        }),
      } as unknown as ChannelStore,
      projection: {
        getSnapshot: () => ({
          nodes: [
            {
              id: 'node-1',
              data: { channelId: 'channel-1', model: 'image-model' },
            },
          ],
          edges: [],
        }),
        updateNodeData: vi.fn(),
      } as unknown as StoryboardProjectionPort,
      execution: { run } as unknown as StoryboardExecutionApi,
      documents: {
        load: async () => prepared.doc,
        save: async () => {},
      },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: () => {},
      actionState: {
        tryAcquire: (() => {
          let held = false
          return () => {
            if (held) return null
            held = true
            return {
              release: () => {
                held = false
              },
            }
          }
        })(),
      },
      setLay: () => {},
    })

    const first = controller.runShot(prepared.doc.shots[0]!)
    await started
    await controller.runShot(prepared.doc.shots[0]!)
    expect(run).toHaveBeenCalledTimes(1)

    resolveRun(imageOutcome(plan!))
    await first
  })
})
