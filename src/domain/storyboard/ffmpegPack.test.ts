import { describe, expect, it } from 'vitest'
import {
  addEpisode,
  addShot,
  attachShotImages,
  attachShotVideos,
  emptyStoryboard,
  updateEpisode,
  updateShot,
  type StoryboardDoc,
} from './storyboard'
import {
  buildEpisodePack,
  episodeClips,
  episodeTimeline,
  ffmpegCommand,
  packMarkdown,
  srtOf,
  srtTime,
  type PackClip,
} from './ffmpegPack'

/**
 * 漫剧「合成包」（对账 #431）。
 *
 * 这一层的价值全在"**本地真能跑**"上，所以每一条断言都对着一个会让人跑不起来的原因：
 * 命令里出现了不存在的文件 / 静帧的时长写错了位置 / 字幕与画面对不上。
 */
describe('合成包 · 片段清单', () => {
  /** 一集两镜：第 1 镜有视频也有图，第 2 镜只有图 */
  const two = (): StoryboardDoc => {
    let doc = emptyStoryboard('p1', 0)
    doc = addEpisode(doc, 1)
    const ep = doc.episodes[0]!.id
    doc = addShot(doc, ep, 1)
    doc = addShot(doc, ep, 1)
    const [a, b] = doc.shots
    doc = attachShotImages(doc, [{ shotId: a!.id, hash: 'hash-a' }], 1)
    doc = attachShotVideos(doc, [{ shotId: a!.id, hash: 'hash-a-v' }], 1)
    doc = attachShotImages(doc, [{ shotId: b!.id, hash: 'hash-b' }], 1)
    return doc
  }
  const mimeOf = (hash: string) =>
    hash.endsWith('-v') ? 'video/mp4' : hash === 'hash-a' || hash === 'hash-b' ? 'image/png' : undefined
  const assetOf = (hash: string) => {
    const mime = mimeOf(hash)
    /* 视频成片那种远端产物：库里只有 url、没有 bytes ⇒ 素材文件夹里不会有它 */
    return mime ? { mime, local: !hash.endsWith('-v') } : undefined
  }

  it('★★ 视频优先、没有视频才拿图当静帧；文件名就是素材文件夹里的 `<hash>.<ext>`', () => {
    const doc = two()
    const { clips, missing } = episodeClips(doc, doc.episodes[0]!.id, assetOf)
    expect(missing).toEqual([])
    expect(clips.map((c) => [c.index, c.kind, c.file])).toEqual([
      [1, 'video', 'hash-a-v.mp4'],
      [2, 'image', 'hash-b.png'],
    ])
    /* ★ 本地那一栏如实标出来：远端视频产物要用户先下载 */
    expect(clips.map((c) => c.local)).toEqual([false, true])
  })

  it('★★ 没素材的镜头**不进命令**，而是进 missing（否则本地一跑就 No such file）', () => {
    const doc = two()
    const bareShot = { ...doc.shots[1]! }
    delete (bareShot as { imageHash?: string }).imageHash
    delete (bareShot as { videoHash?: string }).videoHash
    const bare: StoryboardDoc = { ...doc, shots: [bareShot] }
    const { clips, missing } = episodeClips(bare, doc.episodes[0]!.id, assetOf)
    expect(clips.map((c) => c.index)).toEqual([])
    expect(missing).toHaveLength(1)
    expect(missing[0]!.reason).toContain('还没出图')
  })

  it('★ 库里查不到 mime ⇒ 也算缺料：不猜扩展名（猜错等于让用户去找不存在的文件）', () => {
    const doc = two()
    const { clips, missing } = episodeClips(doc, doc.episodes[0]!.id, () => undefined)
    expect(clips).toEqual([])
    expect(missing).toHaveLength(2)
    expect(missing[0]!.reason).toContain('库里查不到')
  })

  it('★★ 秒数取的是**分镜表里那一镜自己的**（不是写死的默认 3 秒）', () => {
    const doc = two()
    const withDuration = updateShot(doc, doc.shots[0]!.id, { durationSec: 7 }, 1)
    const { clips } = episodeClips(withDuration, doc.episodes[0]!.id, assetOf)
    expect(clips.map((c) => c.seconds)).toEqual([7, 3])
  })

  it('★★★ 预览与合成包**共用同一条时间轴**（`episodeTimeline`）—— 段数 / 顺序 / 秒数逐项相同', () => {
    const doc = two()
    const timeline = episodeTimeline(doc, doc.episodes[0]!.id)
    const pack = episodeClips(doc, doc.episodes[0]!.id, assetOf)
    expect(timeline.clips.map((c) => [c.index, c.kind, c.hash, c.seconds])).toEqual(
      pack.clips.map((c) => [c.index, c.kind, c.hash, c.seconds]),
    )
    expect(timeline.missing).toEqual(pack.missing)
  })

  it('★★ 没素材的镜头**不占时间轴**（预览里没有画面可放，命令里也没有文件可用）', () => {
    const doc = two()
    const bareShot = { ...doc.shots[1]! }
    delete (bareShot as { imageHash?: string }).imageHash
    delete (bareShot as { videoHash?: string }).videoHash
    const timeline = episodeTimeline({ ...doc, shots: [bareShot] }, doc.episodes[0]!.id)
    expect(timeline.clips).toEqual([])
    expect(timeline.missing.map((m) => m.index)).toEqual([1])
  })
})

describe('合成包 · FFmpeg 命令', () => {
  const clip = (over: Partial<PackClip>): PackClip => ({
    index: 1,
    shotId: 's1',
    kind: 'image',
    hash: 'h1',
    file: 'h1.png',
    seconds: 3,
    lines: [],
    scene: '',
    cast: [],
    local: true,
    ...over,
  })

  it('★★★ 静帧的 `-loop 1 -t N` 必须写在**它自己那个 `-i` 之前**（写到末尾只会作用到最后一个输入）', () => {
    const cmd = ffmpegCommand([clip({ file: 'a.png', seconds: 4 }), clip({ index: 2, file: 'b.mp4', kind: 'video' })])
    const loopAt = cmd.indexOf('-loop 1 -t 4 -i a.png')
    const secondAt = cmd.indexOf('-i b.mp4')
    expect(loopAt).toBeGreaterThan(-1)
    expect(loopAt).toBeLessThan(secondAt)
    /* 视频不加 `-loop`：它自己会走完 */
    expect(cmd).not.toContain('-loop 1 -t 3 -i b.mp4')
  })

  it('★★★ 是**一条单行**命令（换行 + `\\` 在 PowerShell 里会被连反斜杠一起吞掉）', () => {
    const cmd = ffmpegCommand([clip({}), clip({ index: 2 })])
    expect(cmd).not.toContain('\n')
    expect(cmd.startsWith('ffmpeg -y ')).toBe(true)
  })

  it('★★ 混合输入走 `concat` 滤镜（demuxer 要求参数完全一致，第一个静帧就会崩）', () => {
    const cmd = ffmpegCommand([clip({}), clip({ index: 2, file: 'b.mp4', kind: 'video' })])
    expect(cmd).toContain('[0:v]')
    expect(cmd).toContain('[1:v]')
    expect(cmd).toContain('concat=n=2:v=1:a=0[outv]')
    expect(cmd).toContain('-map "[outv]"')
  })

  it('★★ BGM 在片段之后追加一个循环输入，裁到总时长并通过 `-shortest` 收口', () => {
    const cmd = ffmpegCommand(
      [clip({ file: 'a.png', seconds: 2 }), clip({ index: 2, file: 'b.png', seconds: 3 })],
      { bgm: { file: 'music.mp3', volume: 0.25 } },
    )
    expect(cmd).toContain('-i b.png -stream_loop -1 -i music.mp3')
    expect(cmd).toContain('[2:a]atrim=0:5,volume=0.25[bgm]')
    expect(cmd).toContain('[bgm]amix=inputs=1:duration=longest:dropout_transition=0')
    expect(cmd).toContain('-map "[outv]" -map "[aout]"')
    expect(cmd).toContain('-c:a aac -b:a 192k')
    expect(cmd).toContain('-shortest')
  })

  it('配音按句起点延迟后与 BGM 混成一条音轨', () => {
    const cmd = ffmpegCommand([clip({ file: 'a.png', seconds: 4 })], {
      bgm: { file: 'music.mp3', volume: 0.2 },
      voices: [{ file: 'line-1.wav', start: 1.25 }],
    })
    expect(cmd).toContain('-i music.mp3 -i line-1.wav')
    expect(cmd).toContain('adelay=1250|1250')
    expect(cmd).toContain('[bgm][voice0]amix=inputs=2:duration=longest:dropout_transition=0')
    expect(cmd).toContain('-map "[outv]" -map "[aout]"')
  })

  it('★ 一镜都没有 ⇒ 空串（调用方据此不导出，而不是导一份跑不了的包）', () => {
    expect(ffmpegCommand([])).toBe('')
  })
})

describe('合成包 · SRT 字幕', () => {
  /** 一句台词的片段（说话人空 = 没说清；字幕正文本来就不带前缀） */
  const clip = (index: number, seconds: number, dialogue: string): PackClip => ({
    index,
    shotId: `s${index}`,
    kind: 'image',
    hash: `h${index}`,
    file: `h${index}.png`,
    seconds,
    lines: dialogue ? [{ lineId: `l${index}`, speaker: '', text: dialogue }] : [],
    scene: '',
    cast: [],
    local: true,
  })

  it('★★★ 空镜**占时间、不占编号**（编号乱了播放器就会把字幕挂错镜）', () => {
    const srt = srtOf([clip(1, 3, '第一句'), clip(2, 4, ''), clip(3, 2, '第三句')])
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:03,000\n第一句')
    /* 第二镜没台词 ⇒ 第三条字幕从 7 秒开始，编号仍是 2 */
    expect(srt).toContain('2\n00:00:07,000 --> 00:00:09,000\n第三句')
    expect(srt).not.toContain('00:00:03,000 --> 00:00:07,000\n')
  })

  it('★ 时间格式是 `HH:MM:SS,mmm`（逗号不是句点）', () => {
    expect(srtTime(0)).toBe('00:00:00,000')
    expect(srtTime(61.5)).toBe('00:01:01,500')
    expect(srtTime(3661.25)).toBe('01:01:01,250')
  })

  it('★★★ 一镜多句：按**字数比例**分这一镜的秒数（不是每句都占满整镜）', () => {
    /* 短句 2 字 + 长句 10 字 = 12 份，6 秒这一镜 ⇒ 1 秒 + 5 秒 */
    const shot: PackClip = {
      index: 1,
      shotId: 's1',
      kind: 'image',
      hash: 'h1',
      file: 'h1.png',
      seconds: 6,
      lines: [
        { lineId: 'l1', speaker: '骑手', text: '短短' },
        { lineId: 'l2', speaker: '收货人', text: '这是一句长得多的话啊' },
      ],
      scene: '',
      cast: [],
      local: true,
    }
    const srt = srtOf([shot])
    expect(srt).toContain('1\n00:00:00,000 --> 00:00:01,000\n短短')
    expect(srt).toContain('2\n00:00:01,000 --> 00:00:06,000\n这是一句长得多的话啊')
    /* **字幕正文不带说话人前缀**：SRT 是给观众看的，画面里已经有人在说话了 */
    expect(srt).not.toContain('骑手：')
    expect(srt).not.toContain('收货人：')
  })

  it('★ 一句台词都没有 ⇒ 空串（不导出一个 0 字节的 .srt）', () => {
    expect(srtOf([clip(1, 3, ''), clip(2, 3, '')])).toBe('')
  })
})

describe('合成包 · 整包与清单', () => {
  const doc = (): StoryboardDoc => {
    let next = emptyStoryboard('p1', 0)
    next = { ...next, script: { title: '雨夜快递', logline: '', body: '' } }
    next = addEpisode(next, 1)
    next = addShot(next, next.episodes[0]!.id, 1)
    return attachShotImages(next, [{ shotId: next.shots[0]!.id, hash: 'hash-a' }], 1)
  }

  it('★★★ 清单里写着命令、写着成品名、缺料单独一段（用户不用猜哪一镜没进片）', () => {
    const base = doc()
    const withBare = addShot(base, base.episodes[0]!.id, 1)
    const pack = buildEpisodePack({
      doc: withBare,
      episode: withBare.episodes[0]!,
      episodeNo: 1,
      assetOf: (h) => (h === 'hash-a' ? { mime: 'image/png', local: true } : undefined),
      folderName: 'my-assets',
    })
    expect(pack.clips).toHaveLength(1)
    expect(pack.markdown).toContain('# 雨夜快递 · 第 1 集 · 合成包')
    expect(pack.markdown).toContain('ffmpeg -y -loop 1 -t 3 -i hash-a.png')
    /* 成品名跟着集数走（`buildEpisodePack` 的默认值）——命令末尾与"怎么用"里都是它 */
    expect(pack.command.endsWith('第1集.mp4')).toBe(true)
    expect(pack.markdown).toContain('得到 `第1集.mp4`')
    expect(pack.markdown).toContain('`my-assets`')
    expect(pack.markdown).toContain('第 2 镜：还没出图')
    expect(pack.markdown).toContain('要用的素材都在本地')
  })

  it('★★★ 远端产物（只有 url）单独列出来：先在画布上下载、存成命令里那个文件名', () => {
    const base = doc()
    const withVideo = attachShotVideos(base, [{ shotId: base.shots[0]!.id, hash: 'hash-a-v' }], 1)
    const pack = buildEpisodePack({
      doc: withVideo,
      episode: withVideo.episodes[0]!,
      episodeNo: 1,
      assetOf: () => ({ mime: 'video/mp4', local: false }),
      folderName: 'my-assets',
    })
    expect(pack.clips).toHaveLength(1)
    /* 命令里仍然写着那个文件名（名字是确定的），但包里必须说清它不在本地 */
    expect(pack.command).toContain('-i hash-a-v.mp4')
    expect(pack.markdown).toContain('不在素材文件夹里')
    expect(pack.markdown).toContain('第 1 镜：`hash-a-v.mp4`')
  })

  it('★ 还没选素材文件夹 ⇒ 清单直说去「设置 → 存储」选（而不是写一个编出来的路径）', () => {
    const base = doc()
    const md = packMarkdown({
      clips: [],
      missing: [{ index: 1, reason: '还没出图' }],
      command: '',
      srt: '',
      title: '',
      episode: base.episodes[0]!,
      episodeNo: 1,
      folderName: null,
      output: '第1集.mp4',
    })
    expect(md).toContain('设置 → 存储')
    expect(md).toContain('# 未命名漫剧')
    expect(md).toContain('第 1 镜：还没出图')
  })

  it('★★ BGM 有本地字节 ⇒ 进命令、进清单；坏引用 ⇒ 不进命令并明确写缺料', () => {
    let withBgm = doc()
    withBgm = updateEpisode(
      withBgm,
      withBgm.episodes[0]!.id,
      { bgmHash: 'music-hash', bgmName: '雨夜主题.mp3', bgmVolume: 0.35 },
      1,
    )
    const ok = buildEpisodePack({
      doc: withBgm,
      episode: withBgm.episodes[0]!,
      episodeNo: 1,
      assetOf: (hash) =>
        hash === 'hash-a'
          ? { mime: 'image/png', local: true }
          : hash === 'music-hash'
            ? { mime: 'audio/mpeg', local: true }
            : undefined,
      folderName: 'my-assets',
    })
    expect(ok.bgm).toMatchObject({
      file: 'music-hash.mp3',
      local: true,
      volume: 0.35,
      name: '雨夜主题.mp3',
    })
    expect(ok.command).toContain('music-hash.mp3')
    expect(ok.markdown).toContain('背景音乐')
    expect(ok.markdown).toContain('音量 35%')

    const missing = buildEpisodePack({
      doc: withBgm,
      episode: withBgm.episodes[0]!,
      episodeNo: 1,
      assetOf: (hash) => (hash === 'hash-a' ? { mime: 'image/png', local: true } : undefined),
      folderName: 'my-assets',
    })
    expect(missing.bgm).toBeUndefined()
    expect(missing.bgmMissing).toContain('素材库里查不到')
    expect(missing.command).not.toContain('music-hash')
    expect(missing.markdown).toContain('已从合成命令中排除')
  })
})
