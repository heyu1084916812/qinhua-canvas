import { describe, expect, it, vi } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addShot,
  addShotLine,
  emptyStoryboard,
  updateEpisode,
} from '../../domain/storyboard/storyboard'
import type { ChannelStore } from '../../state/channel/channelStore'
import { createMemoryPlatform } from '../../platform/memory'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import type { StoryboardCanvasPort } from '../../features/storyboard/canvasPort'
import { createStoryboardAudioController } from './useStoryboardAudioController'

function trace(): DirectRunTraceInput {
  return {
    projectId: 'p1',
    workbench: 'storyboard',
    subjectId: 'shot:1',
    fingerprint: 'fp',
  }
}

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
    const putAsset = vi.fn()
    const generateSpeech = vi.fn(async () => ({
      hash: 'audio1',
      mime: 'audio/mpeg',
      bytes: new Uint8Array([1, 2]),
    }))
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
      channels: { generateSpeech } as unknown as ChannelStore,
      canvas: { putAsset } as unknown as StoryboardCanvasPort,
      directTrace: trace,
      apply: (next) => applied.push(next),
      setStatus: (text) => {
        status = text
      },
      setVoiceBusy: () => undefined,
    })

    const ok = await controller.voiceLine(updatedShot, line.id)

    expect(ok, status).toBe(true)
    expect(generateSpeech).toHaveBeenCalledTimes(1)
    expect(putAsset).toHaveBeenCalledWith(
      expect.objectContaining({ hash: 'audio1', mime: 'audio/mpeg' }),
    )
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
      channels: {} as ChannelStore,
      canvas: {} as StoryboardCanvasPort,
      directTrace: trace,
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
