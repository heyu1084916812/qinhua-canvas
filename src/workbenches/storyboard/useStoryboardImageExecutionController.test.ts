import { describe, expect, it, vi } from 'vitest'
import type { ChannelStore } from '../../state/channel/channelStore'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
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
      canvas: {
        getSnapshot: () => ({ nodes: [], edges: [] }),
      } as unknown as StoryboardCanvasPort,
      execution: { run } as unknown as StoryboardExecutionApi,
      documents: { load: async () => produced, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: (next) => {
        replaced = next
      },
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
      canvas: {
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
      } as unknown as StoryboardCanvasPort,
      execution: { run } as unknown as StoryboardExecutionApi,
      documents,
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: (next) => {
        replaced = next
      },
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
      canvas: {
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
      } as unknown as StoryboardCanvasPort,
      execution: { run } as unknown as StoryboardExecutionApi,
      documents: { load: async () => doc, save: async () => {} },
      projectId: 'project-1',
      flush: async () => {},
      replaceDoc: () => {},
      setLay: () => {},
    })

    await controller.runEpisode()

    expect(
      captured?.tasks.map((task) =>
        task.subject.kind === 'shot-image' ? task.subject.shotId : '',
      ),
    ).toEqual([doc.shots[0]!.id])
  })
})
