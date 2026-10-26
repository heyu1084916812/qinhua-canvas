import { describe, expect, it, vi } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addShot,
  addShotLine,
  emptyStoryboard,
  type StoryboardDoc,
} from '../../domain/storyboard/storyboard'
import { createMemoryPlatform } from '../../platform/memory'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardRunPlan } from '../../domain/storyboard/runTypes'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import { createStoryboardDigitalHumanExecutionController } from './useStoryboardDigitalHumanExecutionController'
import { createStoryboardActionStateStore } from './useStoryboardActionState'

function fixture(): {
  doc: StoryboardDoc
  shotId: string
  lineId: string
} {
  let doc = emptyStoryboard('project-1', 1)
  doc = addCharacter(doc)
  doc = addEpisode(doc)
  const episodeId = doc.episodes[0]!.id
  doc = addShot(doc, episodeId)
  const shotId = doc.shots[0]!.id
  doc = addShotLine(doc, shotId, {
    speakerId: doc.characters[0]!.id,
    text: '你好',
  })
  const lineId = doc.shots[0]!.lines[0]!.id
  doc = {
    ...doc,
    shots: doc.shots.map((shot) => ({
      ...shot,
      nodeId: 'image-node',
      imageHash: 'image-hash',
      durationSec: 5,
      lines: shot.lines.map((line) => ({
        ...line,
        audioHash: 'audio-hash',
        audioName: '林轩-你好.mp3',
      })),
    })),
  }
  return { doc, shotId, lineId }
}

describe('useStoryboardDigitalHumanExecutionController', () => {
  it('单句数字人把画面、音频与语音父记录送入业务计划', async () => {
    const { doc, shotId, lineId } = fixture()
    const platform = createMemoryPlatform({
      rows: {
        assets: [
          {
            id: 'image-hash',
            hash: 'image-hash',
            mime: 'image/webp',
            bytes: new Uint8Array([1]),
          },
          {
            id: 'audio-hash',
            hash: 'audio-hash',
            mime: 'audio/mpeg',
            bytes: new Uint8Array([2]),
          },
        ],
        runRecords: [
          {
            id: 'speech-record',
            projectId: 'project-1',
            workbench: 'storyboard',
            subjectId: `line:${lineId}`,
            status: 'succeeded',
            action: 'speech',
            createdAt: 10,
            params: { action: 'speech' },
          },
        ],
      },
    })
    let captured: StoryboardRunPlan | undefined
    let replaced: StoryboardDoc | undefined
    const run = vi.fn(async (plan: StoryboardRunPlan) => {
      captured = plan
      const state: RunTaskState = {
        kind: 'succeeded',
        result: [
          {
            hash: 'digital-video',
            mime: 'video/mp4',
            bytes: new Uint8Array([3]),
          },
        ],
        duration: 10,
      }
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
          finishedAt: 11,
          records: [],
        },
        warnings: [],
        failures: [],
      }
    })
    const produced: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot) => ({
        ...shot,
        videoHash: 'digital-video',
      })),
    }
    const controller = createStoryboardDigitalHumanExecutionController({
      currentDoc: () => doc,
      graphNodes: [
        {
          id: 'image-node',
          x: 10,
          y: 20,
          data: { assetMime: 'image/webp' },
        } as never,
      ],
      liveNodeIds: new Set(['image-node']),
      digitalHumanTarget: {
        channelId: 'digital-channel',
        model: 'digital-model',
      },
      platform,
      storage: platform.storage,
      canvas: {
        createGenerationNode: vi.fn(() => 'video-node'),
        updateNodeData: vi.fn(),
        connectEdge: vi.fn(),
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
      setLay: vi.fn(),
      actionState: createStoryboardActionStateStore(),
    })

    await controller.makeDigitalHuman(doc.shots[0]!)

    expect(captured?.tasks[0]).toMatchObject({
      action: 'digital-human',
      parentRunId: 'speech-record',
      subject: { kind: 'digital-human', shotId },
      request: {
        inputs: [
          { assetHash: 'image-hash', mime: 'image/webp' },
          { assetHash: 'audio-hash', mime: 'audio/mpeg' },
        ],
      },
    })
    expect(replaced?.shots[0]).toMatchObject({
      videoNodeId: 'video-node',
      videoHash: 'digital-video',
    })
  })

  it('same shot digital human double-click sends once', async () => {
    const { doc } = fixture()
    const platform = createMemoryPlatform({
      rows: {
        assets: [
          {
            id: 'image-hash',
            hash: 'image-hash',
            mime: 'image/webp',
            bytes: new Uint8Array([1]),
          },
          {
            id: 'audio-hash',
            hash: 'audio-hash',
            mime: 'audio/mpeg',
            bytes: new Uint8Array([2]),
          },
        ],
      },
    })
    const actionState = createStoryboardActionStateStore()
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
    let plan: StoryboardRunPlan | undefined
    const run = vi.fn((nextPlan: StoryboardRunPlan) => {
      plan = nextPlan
      markStarted()
      return pending
    })
    const produced: StoryboardDoc = {
      ...doc,
      shots: doc.shots.map((shot) => ({
        ...shot,
        videoHash: 'digital-video',
      })),
    }
    const controller = createStoryboardDigitalHumanExecutionController({
      currentDoc: () => doc,
      graphNodes: [
        {
          id: 'image-node',
          x: 10,
          y: 20,
          data: { assetMime: 'image/webp' },
        } as never,
      ],
      liveNodeIds: new Set(['image-node']),
      digitalHumanTarget: {
        channelId: 'digital-channel',
        model: 'digital-model',
      },
      platform,
      storage: platform.storage,
      canvas: {
        createGenerationNode: vi.fn(() => 'video-node'),
        updateNodeData: vi.fn(),
        connectEdge: vi.fn(),
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

    const first = controller.makeDigitalHuman(doc.shots[0]!)
    await started
    expect(actionState.isBusy('digital-human', doc.shots[0]!.id)).toBe(true)
    await controller.makeDigitalHuman(doc.shots[0]!)
    expect(run).toHaveBeenCalledTimes(1)

    resolveRun({
      summary: {
        runPlanId: plan!.id,
        mode: plan!.mode,
        taskResults: plan!.tasks.map((task) => ({
          taskId: task.id,
          nodeId: task.nodeId,
          state: {
            kind: 'succeeded',
            result: [
              {
                hash: 'digital-video',
                mime: 'video/mp4',
                bytes: new Uint8Array([3]),
              },
            ],
            duration: 10,
          } satisfies RunTaskState,
        })),
        succeeded: 1,
        failed: 0,
        canceled: 0,
        startedAt: 1,
        finishedAt: 11,
        records: [],
      },
      warnings: [],
      failures: [],
    })
    await first
    expect(actionState.isBusy('digital-human', doc.shots[0]!.id)).toBe(false)
  })
})
