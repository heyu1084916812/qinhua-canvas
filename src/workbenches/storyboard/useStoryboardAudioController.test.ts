import { describe, expect, it, vi } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addShot,
  addShotLine,
  emptyStoryboard,
  updateEpisode,
} from '../../domain/storyboard/storyboard'
import { createMemoryPlatform } from '../../platform/memory'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import type { StoryboardRunPlan } from '../../domain/storyboard/runTypes'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import { createStoryboardAudioController } from './useStoryboardAudioController'
import { createStoryboardActionStateStore } from './useStoryboardActionState'

describe('Storyboard audio controller', () => {
  it('生成配音后把 hash 写回台词', async () => {
    const platform = createMemoryPlatform()
    let doc = addEpisode(emptyStoryboard('p1'))
    const episode = doc.episodes[0]!
    doc = addCharacter(doc)
    const character = doc.characters[0]!
    doc = addShot(doc, episode.id)
    const shot = doc.shots[0]!
    doc = addShotLine(doc, shot.id, { speakerId: character.id, text: '你好' })
    const updatedShot = doc.shots[0]!
    const line = updatedShot.lines[0]!
    expect(line.text).toBe('你好')
    const applied: typeof doc[] = []
    let captured: StoryboardRunPlan | undefined
    const run = vi.fn(async (plan: StoryboardRunPlan) => {
      captured = plan
      const state: RunTaskState = {
        kind: 'succeeded',
        result: [
          {
            hash: 'audio1',
            mime: 'audio/mpeg',
            bytes: new Uint8Array([1, 2]),
          },
        ],
        duration: 1,
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
          finishedAt: 2,
          records: [],
        },
        warnings: [],
        failures: [],
      }
    })
    const produced = {
      ...doc,
      shots: doc.shots.map((item) => ({
        ...item,
        lines: item.lines.map((itemLine) => ({
          ...itemLine,
          audioHash: 'audio1',
          audioName: `${character.name}-你好.mp3`,
        })),
      })),
    }
    const documents: StoryboardDocumentPort = {
      load: async () => produced,
      save: async () => {},
    }
    let status = ''

    const controller = createStoryboardAudioController({
      doc,
      currentDoc: () => doc,
      selected: episode,
      shots: doc.shots,
      speechTarget: {
        channelId: 'ch1',
        model: 'tts1',
        label: '配音',
        voices: ['nova'],
      },
      platform,
      execution: { run, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents,
      projectId: 'p1',
      flush: async () => {},
      apply: (next) => applied.push(next),
      setStatus: (text) => {
        status = text
      },
      actionState: createStoryboardActionStateStore(),
    })

    const ok = await controller.voiceLine(updatedShot, line.id)

    expect(ok, status).toBe(true)
    expect(captured?.tasks[0]).toMatchObject({
      action: 'speech',
      subject: {
        kind: 'speech',
        episodeId: updatedShot.episodeId,
        shotId: updatedShot.id,
        lineId: line.id,
      },
      request: {
        kind: 'speech',
        prompt: '你好',
        params: {
          voice: 'nova',
          responseFormat: 'mp3',
        },
      },
    })
    expect(applied[0]?.shots[0]?.lines[0]).toMatchObject({
      audioHash: 'audio1',
    })
  })

  it('移除背景音乐只清 hash，不删除其他集参数', () => {
    let doc = addEpisode(emptyStoryboard('p1'))
    const episode = doc.episodes[0]!
    doc = updateEpisode(
      doc,
      episode.id,
      { bgmHash: 'bgm1', bgmName: '主题曲', bgmVolume: 0.35 },
      1,
    )
    let applied = doc
    const controller = createStoryboardAudioController({
      doc,
      currentDoc: () => doc,
      selected: doc.episodes[0]!,
      shots: [],
      speechTarget: null,
      platform: createMemoryPlatform(),
      execution: {} as StoryboardExecutionApi,
      documents: {
        load: async () => doc,
        save: async () => {},
      },
      projectId: 'p1',
      flush: async () => {},
      apply: (next) => {
        applied = next
      },
      setStatus: () => undefined,
      actionState: createStoryboardActionStateStore(),
    })

    controller.onRemoveBgm()

    expect(applied.episodes[0]?.bgmHash).toBeUndefined()
    expect(applied.episodes[0]?.bgmName).toBeUndefined()
    expect(applied.episodes[0]?.bgmVolume).toBeUndefined()
  })

  it('BGM writes the picked bytes to public assets without a canvas projection', async () => {
    const doc = addEpisode(emptyStoryboard('p1'))
    const selected = doc.episodes[0]!
    const memory = createMemoryPlatform()
    const bytes = new Uint8Array([7, 8, 9])
    const platform = {
      ...memory,
      files: {
        ...memory.files,
        pickFile: vi.fn(async () => ({
          name: 'theme.mp3',
          size: bytes.length,
          mime: 'audio/mpeg',
          blob: new Blob([bytes], { type: 'audio/mpeg' }),
        })),
      },
    }
    let applied = doc
    const controller = createStoryboardAudioController({
      doc,
      currentDoc: () => doc,
      selected,
      shots: [],
      speechTarget: null,
      platform,
      execution: {} as StoryboardExecutionApi,
      documents: {
        load: async () => doc,
        save: async () => {},
      },
      projectId: 'p1',
      flush: async () => {},
      apply: (next) => {
        applied = next
      },
      setStatus: () => {},
      actionState: createStoryboardActionStateStore(),
    })

    await controller.onPickBgm()

    const hash = applied.episodes[0]?.bgmHash
    expect(hash).toBeTruthy()
    expect(applied.episodes[0]).toMatchObject({
      bgmHash: hash,
      bgmName: 'theme.mp3',
    })
    const rows = await memory.storage.query('assets', { id: hash })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      mime: 'audio/mpeg',
      bytes,
      projectId: 'p1',
    })
  })

  it('same voice double-click sends once and releases after failure or cancellation', async () => {
    const platform = createMemoryPlatform()
    let doc = addEpisode(emptyStoryboard('p1'))
    const episode = doc.episodes[0]!
    doc = addShot(doc, episode.id)
    doc = addShotLine(doc, doc.shots[0]!.id, { text: '你好' })
    const shot = doc.shots[0]!
    const line = shot.lines[0]!
    const actionState = createStoryboardActionStateStore()
    let firstPlan: StoryboardRunPlan | undefined
    let releaseFirst!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const firstRun = new Promise<
      Awaited<ReturnType<StoryboardExecutionApi['run']>>
    >((resolve) => {
      releaseFirst = () =>
        resolve({
          summary: {
            runPlanId: firstPlan!.id,
            mode: firstPlan!.mode,
            taskResults: firstPlan!.tasks.map((task) => ({
              taskId: task.id,
              nodeId: task.nodeId,
              state: {
                kind: 'succeeded',
                result: [
                  {
                    hash: 'audio1',
                    mime: 'audio/mpeg',
                    bytes: new Uint8Array([1]),
                  },
                ],
                duration: 1,
              } satisfies RunTaskState,
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
        })
    })
    const outcome = (
      plan: StoryboardRunPlan,
      state: RunTaskState,
      canceledCount: number,
    ) => ({
      summary: {
        runPlanId: plan.id,
        mode: plan.mode,
        taskResults: plan.tasks.map((task) => ({
          taskId: task.id,
          nodeId: task.nodeId,
          state,
        })),
        succeeded: state.kind === 'succeeded' ? 1 : 0,
        failed: state.kind === 'failed' ? 1 : 0,
        canceled: canceledCount,
        startedAt: 1,
        finishedAt: 2,
        records: [],
      },
      warnings: [],
      failures: [],
    })
    const run = vi
      .fn<StoryboardExecutionApi['run']>()
      .mockImplementationOnce((plan) => {
        firstPlan = plan
        markStarted()
        return firstRun
      })
      .mockRejectedValueOnce(new Error('provider failed'))
      .mockImplementationOnce(async (plan) =>
        outcome(plan, { kind: 'canceled' }, 1),
      )
      .mockImplementationOnce(async (plan) =>
        outcome(
          plan,
          {
            kind: 'succeeded',
            result: [
              {
                hash: 'audio2',
                mime: 'audio/mpeg',
                bytes: new Uint8Array([2]),
              },
            ],
            duration: 1,
          },
          0,
        ),
      )
    const produced = {
      ...doc,
      shots: doc.shots.map((item) => ({
        ...item,
        lines: item.lines.map((itemLine) => ({
          ...itemLine,
          audioHash: 'audio2',
        })),
      })),
    }
    const controller = createStoryboardAudioController({
      doc,
      currentDoc: () => doc,
      selected: episode,
      shots: doc.shots,
      speechTarget: {
        channelId: 'ch1',
        model: 'tts1',
        label: '配音',
        voices: ['nova'],
      },
      platform,
      execution: { run, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents: { load: async () => produced, save: async () => {} },
      projectId: 'p1',
      flush: async () => {},
      apply: () => {},
      setStatus: () => {},
      actionState,
    })

    const first = controller.voiceLine(shot, line.id)
    await started
    expect(actionState.isBusy('voice', line.id)).toBe(true)
    await expect(controller.voiceLine(shot, line.id)).resolves.toBe(false)
    expect(run).toHaveBeenCalledTimes(1)

    releaseFirst()
    await expect(first).resolves.toBe(true)
    expect(actionState.isBusy('voice', line.id)).toBe(false)

    await expect(controller.voiceLine(shot, line.id)).resolves.toBe(false)
    expect(run).toHaveBeenCalledTimes(2)
    expect(actionState.isBusy('voice', line.id)).toBe(false)

    await expect(controller.voiceLine(shot, line.id)).resolves.toBe(false)
    expect(run).toHaveBeenCalledTimes(3)
    expect(actionState.isBusy('voice', line.id)).toBe(false)

    await expect(controller.voiceLine(shot, line.id)).resolves.toBe(true)
    expect(run).toHaveBeenCalledTimes(4)
    expect(actionState.isBusy('voice', line.id)).toBe(false)
  })
})
