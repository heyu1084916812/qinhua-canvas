import { describe, expect, it } from 'vitest'
import {
  addEpisode,
  addShot,
  addShotLine,
  emptyStoryboard,
  parseStoryboard,
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
