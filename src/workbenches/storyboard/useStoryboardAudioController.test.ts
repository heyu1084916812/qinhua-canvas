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
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import type { StoryboardExecutionApi } from '../../features/storyboard/execution/StoryboardExecutionProvider'
import type { StoryboardDocumentPort } from '../../features/storyboard/execution/storyboardCommandExecutor'
import type { StoryboardRunPlan } from '../../domain/storyboard/runTypes'
import type { RunTaskState } from '../../features/shared/execution/runEngine'
import { createStoryboardAudioController } from './useStoryboardAudioController'

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
      canvas: {} as StoryboardCanvasPort,
      execution: { run, cancel: vi.fn() } as unknown as StoryboardExecutionApi,
      documents,
      projectId: 'p1',
      flush: async () => {},
      apply: (next) => applied.push(next),
      setStatus: (text) => {
        status = text
      },
      setVoiceBusy: () => undefined,
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
      canvas: {} as StoryboardCanvasPort,
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
      setVoiceBusy: () => undefined,
    })

    controller.onRemoveBgm()

    expect(applied.episodes[0]?.bgmHash).toBeUndefined()
    expect(applied.episodes[0]?.bgmName).toBeUndefined()
    expect(applied.episodes[0]?.bgmVolume).toBeUndefined()
  })
})
