import { describe, expect, it } from 'vitest'
import {
  addCharacter,
  addEpisode,
  addShot,
  addShotLine,
  emptyStoryboard,
  parseStoryboard,
  speechSettingsOf,
  updateCharacter,
  updateShotLine,
  type StoryboardDoc,
} from './storyboard'

function withLine(): { doc: StoryboardDoc; shotId: string; lineId: string } {
  let doc = emptyStoryboard('p1', 0)
  doc = addEpisode(doc, 1)
  doc = addShot(doc, doc.episodes[0]!.id, 3)
  let shot = doc.shots[0]!
  doc = addShotLine(doc, shot.id, { text: '' }, 1)
  shot = doc.shots[0]!
  const lineId = shot.lines[0]!.id
  doc = updateShotLine(doc, shot.id, lineId, { text: '今天最后一单' }, 1)
  return { doc, shotId: shot.id, lineId }
}

describe('漫剧台词的配音字段', () => {
  it('音色与语速读回时夹在合法区间；坏数据回落默认', () => {
    const doc = parseStoryboard(
      {
        episodes: [{ id: 'e1', title: '一' }],
        shots: [
          {
            id: 's1',
            episodeId: 'e1',
            scene: '雨夜',
            lines: [
              {
                id: 'l1',
                text: '你好',
                voice: 'nova',
                speed: 9,
                audioHash: 'audio-1',
                audioName: '第一句.mp3',
              },
              { id: 'l2', text: '再见', speed: 'bad' },
            ],
          },
        ],
      },
      'p1',
    )
    expect(doc.shots[0]!.lines[0]).toMatchObject({
      voice: 'nova',
      speed: 4,
      audioHash: 'audio-1',
      audioName: '第一句.mp3',
    })
    expect(doc.shots[0]!.lines[1]!.speed).toBeUndefined()
  })

  it('★★ 角色默认音色 / 语速能读写；台词显式值优先，句级 1.0 语速也能覆盖角色默认', () => {
    const doc = parseStoryboard(
      {
        characters: [
          { id: 'c1', name: '骑手', voice: 'nova', speed: 1.2 },
          { id: 'c2', name: '收货人', voice: 'alloy', speed: 0.9 },
        ],
        scenes: [{ id: 's0', name: '门口', voice: 'ignored', speed: 3 }],
        episodes: [{ id: 'e1', title: '一' }],
        shots: [
          {
            id: 's1',
            episodeId: 'e1',
            scene: '雨夜',
            lines: [
              { id: 'l1', speakerId: 'c1', text: '默认继承' },
              { id: 'l2', speakerId: 'c1', text: '显式覆盖', voice: 'alloy', speed: 1 },
            ],
          },
        ],
      },
      'p1',
    )
    expect(doc.characters[0]).toMatchObject({ voice: 'nova', speed: 1.2 })
    expect(doc.characters[1]).toMatchObject({ voice: 'alloy', speed: 0.9 })
    expect(doc.scenes[0]).not.toHaveProperty('voice')
    expect(doc.scenes[0]).not.toHaveProperty('speed')
    expect(speechSettingsOf(doc, doc.shots[0]!.lines[0]!)).toEqual({
      voice: 'nova',
      speed: 1.2,
    })
    expect(speechSettingsOf(doc, doc.shots[0]!.lines[1]!)).toEqual({
      voice: 'alloy',
      speed: 1,
    })
    const overridden = updateShotLine(
      doc,
      doc.shots[0]!.id,
      doc.shots[0]!.lines[0]!.id,
      { speed: 1 },
      2,
    )
    expect(overridden.shots[0]!.lines[0]!.speed).toBe(1)
    expect(speechSettingsOf(overridden, overridden.shots[0]!.lines[0]!)).toEqual({
      voice: 'nova',
      speed: 1,
    })
  })

  it('角色默认值可清空，改默认值不会擅自删除已经生成的台词配音', () => {
    let doc = emptyStoryboard('p1', 0)
    doc = addCharacter(doc, 1)
    const id = doc.characters[0]!.id
    doc = addEpisode(doc, 2)
    doc = addShot(doc, doc.episodes[0]!.id, 3)
    const shotId = doc.shots[0]!.id
    doc = addShotLine(doc, shotId, { speakerId: id, text: '已经配过音' }, 3)
    const lineId = doc.shots[0]!.lines[0]!.id
    doc = updateShotLine(
      doc,
      shotId,
      lineId,
      { audioHash: 'audio-1', audioName: '骑手.mp3' },
      3,
    )
    doc = updateCharacter(doc, id, { voice: 'nova', speed: 1.2 }, 2)
    doc = updateCharacter(doc, id, { voice: '' }, 3)
    expect(doc.characters[0]!.voice).toBeUndefined()
    expect(doc.characters[0]!.speed).toBe(1.2)
    expect(doc.shots[0]!.lines[0]).toMatchObject({
      audioHash: 'audio-1',
      audioName: '骑手.mp3',
    })
    doc = updateCharacter(doc, id, { speed: 1 }, 4)
    expect(doc.characters[0]!.speed).toBeUndefined()
  })

  it('改正文 / 音色 / 语速都会让旧配音失效；单独写回产物引用不会', () => {
    const base = withLine()
    const voiced = updateShotLine(
      base.doc,
      base.shotId,
      base.lineId,
      {
        voice: 'alloy',
        audioHash: 'audio-1',
        audioName: '第一句.mp3',
      },
      2,
    )
    expect(voiced.shots[0]!.lines[0]).toMatchObject({
      voice: 'alloy',
      audioHash: 'audio-1',
      audioName: '第一句.mp3',
    })

    for (const patch of [{ text: '改过的台词' }, { voice: 'nova' }, { speed: 1.2 }]) {
      const next = updateShotLine(voiced, base.shotId, base.lineId, patch, 3)
      expect(next.shots[0]!.lines[0]!.audioHash).toBeUndefined()
      expect(next.shots[0]!.lines[0]!.audioName).toBeUndefined()
    }
  })
})
