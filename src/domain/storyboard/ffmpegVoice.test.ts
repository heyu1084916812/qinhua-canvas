import { describe, expect, it } from 'vitest'
import {
  addEpisode,
  addShot,
  addShotLine,
  attachShotImages,
  emptyStoryboard,
  updateShotLine,
  type StoryboardDoc,
} from './storyboard'
import { buildEpisodePack, episodeTimeline, voiceTracksOf } from './ffmpegPack'

function docWithVoice(): StoryboardDoc {
  let doc = emptyStoryboard('p1', 0)
  doc = addEpisode(doc, 1)
  doc = addShot(doc, doc.episodes[0]!.id, 3)
  let shot = doc.shots[0]!
  doc = addShotLine(doc, shot.id, { text: '今天最后一单' }, 1)
  shot = doc.shots[0]!
  doc = attachShotImages(doc, [{ shotId: shot.id, hash: 'image-hash' }], 1)
  doc = updateShotLine(
    doc,
    shot.id,
    shot.lines[0]!.id,
    {
      voice: 'alloy',
      audioHash: 'voice-hash',
      audioName: '旁白-今天最后一单.mp3',
    },
    1,
  )
  return doc
}

const assetOf = (hash: string) =>
  hash === 'image-hash'
    ? { mime: 'image/png', local: true }
    : hash === 'voice-hash'
      ? { mime: 'audio/mpeg', local: true }
      : undefined

describe('漫剧配音与合成包同源', () => {
  it('台词配音按字幕同一条时间轴进入命令', () => {
    const doc = docWithVoice()
    const episode = doc.episodes[0]!
    const timeline = episodeTimeline(doc, episode.id)
    const tracks = voiceTracksOf(timeline.clips, assetOf)
    expect(tracks.missing).toEqual([])
    expect(tracks.voices).toHaveLength(1)
    expect(tracks.voices[0]).toMatchObject({
      file: 'voice-hash.mp3',
      local: true,
      start: 0,
      text: '今天最后一单',
    })

    const pack = buildEpisodePack({
      doc,
      episode,
      episodeNo: 1,
      assetOf,
      folderName: 'assets',
    })
    expect(pack.voices).toHaveLength(1)
    expect(pack.command).toContain('-i voice-hash.mp3')
    expect(pack.command).toContain('adelay=0|0')
    expect(pack.markdown).toContain('配音')
    expect(pack.markdown).toContain('voice-hash.mp3')
  })

  it('配音素材被清理后如实报缺失，不拼一个不存在的文件', () => {
    const doc = docWithVoice()
    const episode = doc.episodes[0]!
    const timeline = episodeTimeline(doc, episode.id)
    const tracks = voiceTracksOf(timeline.clips, (hash) =>
      hash === 'image-hash' ? { mime: 'image/png', local: true } : undefined,
    )
    expect(tracks.voices).toEqual([])
    expect(tracks.missing[0]).toContain('配音素材在库里查不到')
  })
})
