/**
 * 漫剧「合成包」导出（对账 #431；《轻画-漫剧形态调研.md》§M7-6 / §407）。
 *
 * ## 口径（三条例，一条都不许走样）
 *
 * 1. **前端不编码**：这一层只产出**纯文本** —— 素材清单 + 一条可直接粘贴执行的 FFmpeg 命令 +
 *    SRT 字幕。真正的编码留给用户本地的 FFmpeg（架构 §16.2「无服务端 / 无 WASM / 无原生模块」）。
 * 2. **命令里只许出现真实存在的素材**：没出图的镜头**不进命令** —— 否则本地一跑就报
 *    `No such file or directory`，而用户面对一条 200 字符的长命令根本看不出是哪一镜出了问题。
 *    这些镜头进 `missing`，在包与界面上**如实列出来**。
 * 3. **字幕的时间轴必须跟命令的时间轴一致**：SRT 只按**真的进了命令**的片段累加。
 *    被跳过的镜头不占时间、空镜（没台词）占时间但不占编号 —— 否则画面与台词对不上，
 *    那比没有字幕更糟。
 *
 * ## 为什么素材文件名是 `<hash>.<ext>`
 *
 * 因为素材落在用户选的**素材文件夹**里就是这个命名（`assetLocation.ts` 的约定，内容寻址）。
 * 于是"导出的命令"和"文件夹里的文件"天生对得上：用户 `cd` 到素材文件夹直接粘命令就能跑。
 * 反过来若在包里编一个 `shot01.png` 的名字，用户还得手工改一遍名 —— 那就不是"能跑通"了。
 */
import { assetFileName } from '../shared/assetLocation'
import {
  DEFAULT_TRANSITION_SECONDS,
  characterNamesOf,
  clampTransitionSeconds,
  sceneNameOf,
  shotDialogueLines,
  shotsOf,
  type StoryboardDoc,
  type StoryboardEpisode,
  type StoryboardShot,
} from './storyboard'

/** 输出画布尺寸（竖屏漫剧的默认档；要改就改命令里那三个数字，包里的注意事项会写出来） */
export const PACK_WIDTH = 1080
export const PACK_HEIGHT = 1920
export const PACK_FPS = 30

/**
 * **时间轴上的一段**（预览与合成包共用这一份形状）。
 *
 * 为什么要单独一层：预览**播放**某一集与导出**合成**某一集必须是同一条时间轴 ——
 * 各算一遍就会漂（"预览里 12 段、命令里 11 段"这种）。所以两边都取 `episodeTimeline`，
 * 合成包再往它上面补"文件名 / 在不在本地"这两样只有导出才需要的东西。
 */
export interface TimelineClip {
  /** 这一镜在**这一集里的序号**（1 起；空镜也占号 —— 序号是给人看的，不是数组下标） */
  index: number
  shotId: string
  /** `video` = 这一镜有视频，动起来；`image` = 只有图，按静帧撑满它的秒数 */
  kind: 'video' | 'image'
  hash: string
  /** 这一镜的时长（秒） */
  seconds: number
  /** 上一镜设置了淡入淡出，这一段从黑场淡入 */
  fadeIn?: boolean
  /** 淡入时长（秒）；没有设置时回落到默认值 */
  fadeInSeconds?: number
  /** 这一镜设置了到下一镜的淡入淡出，这一段末尾淡出到黑场 */
  fadeOut?: boolean
  /** 淡出时长（秒）；没有设置时回落到默认值 */
  fadeOutSeconds?: number
  /**
   * 这一镜的台词（说话人已解出名字；空 = 没说清）。
   *
   * **一镜可以好几句**（对账 #435 的对白层）：所以 SRT 要按字数把这一镜的秒数分给它们，
   * 而不是每句都占满整镜（那会让字幕比画面慢一截）。
   */
  lines: { lineId: string; speaker: string; text: string; audioHash?: string }[]
  scene: string
  cast: string[]
}

/** 合成包用的一段 = 时间轴的一段 + 落盘要用的两个字段 */
export interface PackClip extends TimelineClip {
  /** 素材文件夹里那个文件名（`<hash>.<ext>`） */
  file: string
  /**
   * 这份素材**本地有没有字节**。
   *
   * `false` = 远端产物（视频成片那种：`assets` 行里只有 `url`、没有 `bytes`）——
   * 而素材文件夹的镜像**只写本地字节**（`assetMirror.ts` 那条 `no-bytes`），
   * 所以那个文件**不在**素材文件夹里，命令直接跑会报 `No such file`。
   * 这一栏就是给用户的那句"先把这一份下载下来"的依据。
   */
  local: boolean
}

export interface PackMissing {
  index: number
  reason: string
}

export interface PackBgm {
  hash: string
  file: string
  local: boolean
  volume: number
  name?: string
}

export interface PackVoiceTrack {
  lineId: string
  clipIndex: number
  speaker: string
  text: string
  hash: string
  file: string
  local: boolean
  /** 在全片里的起点（秒） */
  start: number
}

/** 一条素材在库里的样子（页面查 `assets` 行后喂进来；domain 不许 import 平台层） */
export interface PackAssetInfo {
  mime: string
  local: boolean
}

export type PackAssetLookup = (hash: string) => PackAssetInfo | undefined

export interface EpisodePack {
  clips: PackClip[]
  missing: PackMissing[]
  bgm?: PackBgm
  bgmMissing?: string
  voices: PackVoiceTrack[]
  voicesMissing: string[]
  /** 一条**单行**命令（换行 + `\` 在 PowerShell 里不是续行，会连反斜杠一起吞掉） */
  command: string
  /** SRT 全文；这一集一句台词都没有时是空串 */
  srt: string
  /** 给人看的那一份（清单 + 命令 + 字幕 + 缺料） */
  markdown: string
}

/**
 * 这一集**能进命令**的片段（顺序 = 分镜顺序）。
 *
 * `mimeOf` 查不到 mime ⇒ 当作缺料：没有扩展名就没法拼出文件夹里的真名，
 * 与其猜一个（猜错等于让用户去找一个不存在的文件），不如如实说"库里查不到这条素材"。
 */
export function episodeClips(
  doc: StoryboardDoc,
  episodeId: string,
  assetOf: PackAssetLookup,
): { clips: PackClip[]; missing: PackMissing[] } {
  const { clips: timeline, missing } = episodeTimeline(doc, episodeId)
  const clips: PackClip[] = []
  for (const clip of timeline) {
    const info = assetOf(clip.hash)
    if (!info) {
      missing.push({ index: clip.index, reason: `库里查不到这条素材（${clip.hash.slice(0, 8)}…），可能是被清理过` })
      continue
    }
    clips.push({ ...clip, file: assetFileName(clip.hash, info.mime), local: info.local })
  }
  missing.sort((a, b) => a.index - b.index)
  return { clips, missing }
}

/**
 * **这一集的时间轴**（预览播放与合成包共用）。
 *
 * 口径三条，与合成包那一节同源：
 * - **视频优先**：这一镜有视频就用视频（分镜要的是"动起来"），没有才拿图当静帧；
 * - **两样都没有 ⇒ 不占时间轴**（进 `missing`）：预览里它没有画面可放，命令里它没有文件可用 ——
 *   两边的处理必须一致，否则预览会多出几秒。
 * - 顺序 = 分镜顺序，序号 = 在这一集里的第几镜（空镜也占号，给人看的）。
 */
export function episodeTimeline(
  doc: StoryboardDoc,
  episodeId: string,
): { clips: TimelineClip[]; missing: PackMissing[] } {
  const picked: { shot: StoryboardShot; clip: TimelineClip }[] = []
  const missing: PackMissing[] = []
  shotsOf(doc, episodeId).forEach((shot, i) => {
    const index = i + 1
    const pick = shot.videoHash
      ? ({ kind: 'video', hash: shot.videoHash } as const)
      : shot.imageHash
        ? ({ kind: 'image', hash: shot.imageHash } as const)
        : null
    if (!pick) {
      missing.push({ index, reason: '还没出图 —— 这一镜没有任何素材可拼' })
      return
    }
    picked.push({
      shot,
      clip: {
        index,
        shotId: shot.id,
        kind: pick.kind,
        hash: pick.hash,
        seconds: Math.max(1, Math.round(shot.durationSec)),
        lines: shotDialogueLines(doc, shot),
        scene: sceneNameOf(doc, shot),
        cast: characterNamesOf(doc, shot),
      },
    })
  })
  /**
   * 转场只发生在**前后两段都真的有素材**时：中间缺一镜时不能跨过它硬接淡出，
   * 否则预览看起来像“上一镜要结束了”，命令却把它接在更后面的画面上。
   */
  for (let i = 1; i < picked.length; i += 1) {
    if (picked[i - 1]!.shot.transition !== 'fade') continue
    const seconds = clampTransitionSeconds(picked[i - 1]!.shot.transitionSec)
    picked[i - 1]!.clip.fadeOut = true
    picked[i - 1]!.clip.fadeOutSeconds = seconds
    picked[i]!.clip.fadeIn = true
    picked[i]!.clip.fadeInSeconds = seconds
  }
  return { clips: picked.map((entry) => entry.clip), missing }
}

/**
 * 把片段拼成**一条** FFmpeg 命令。
 *
 * 为什么用 `concat` **滤镜**而不是 concat demuxer：demuxer 那条路要求所有输入编解码参数完全一致，
 * 而这里天然是**混合**的（有的是 png 静帧、有的是 mp4 片段）—— 用 demuxer 会在第一个静帧上崩。
 * 代价是重编码（本地跑得慢一点），换来的是"一条命令对任何组合都能出片"。
 */
export function ffmpegArgs(
  clips: readonly PackClip[],
  opts: {
    width?: number
    height?: number
    fps?: number
    output?: string
    bgm?: { file: string; volume?: number }
    voices?: readonly { file: string; start: number }[]
  } = {},
): string[] {
  if (clips.length === 0) return []
  const w = opts.width ?? PACK_WIDTH
  const h = opts.height ?? PACK_HEIGHT
  const fps = opts.fps ?? PACK_FPS
  const output = opts.output ?? '成片.mp4'
  const inputs: string[] = []
  const chains: string[] = []
  clips.forEach((clip, i) => {
    /**
     * 静帧要自己"活"够这一镜的秒数：`-loop 1 -t N` 是**输入侧**选项，
     * 必须写在它自己那个 `-i` 之前 —— 写到命令末尾只会作用到最后一个输入上。
     */
    if (clip.kind === 'image') {
      inputs.push('-loop', '1', '-t', String(clip.seconds), '-i', clip.file)
    } else {
      inputs.push('-i', clip.file)
    }
    const fadeInSeconds = Math.min(
      clip.fadeInSeconds ?? DEFAULT_TRANSITION_SECONDS,
      Math.max(0.1, clip.seconds / 2),
    )
    const fadeOutSeconds = Math.min(
      clip.fadeOutSeconds ?? DEFAULT_TRANSITION_SECONDS,
      Math.max(0.1, clip.seconds / 2),
    )
    let chain =
      `[${i}:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,` +
      `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=${fps},format=yuv420p`
    if (clip.fadeIn) chain += `,fade=t=in:st=0:d=${fadeInSeconds.toFixed(3)}`
    if (clip.fadeOut) {
      const start = Math.max(0, clip.seconds - fadeOutSeconds).toFixed(3)
      chain += `,fade=t=out:st=${start}:d=${fadeOutSeconds.toFixed(3)}`
    }
    chains.push(`${chain}[v${i}]`)
  })
  const concat = `${clips.map((_, i) => `[v${i}]`).join('')}concat=n=${clips.length}:v=1:a=0[outv]`
  const totalSeconds = clips.reduce((sum, clip) => sum + clip.seconds, 0)
  const audioChains: string[] = []
  const audioLabels: string[] = []
  let nextInput = clips.length
  if (opts.bgm?.file) {
    inputs.push('-stream_loop', '-1', '-i', opts.bgm.file)
    const volume = Math.min(1, Math.max(0, opts.bgm.volume ?? 0.2))
    audioChains.push(`[${nextInput}:a]atrim=0:${totalSeconds},volume=${volume}[bgm]`)
    audioLabels.push('[bgm]')
    nextInput += 1
  }
  for (const [i, voice] of (opts.voices ?? []).entries()) {
    const delay = Math.max(0, Math.round(voice.start * 1000))
    audioChains.push(
      `[${nextInput}:a]aresample=48000,adelay=${delay}|${delay},volume=1.0[voice${i}]`,
    )
    audioLabels.push(`[voice${i}]`)
    inputs.push('-i', voice.file)
    nextInput += 1
  }
  let audioMap = ''
  let audioFilters: string[] = []
  if (audioLabels.length > 0) {
    audioFilters = [
      ...audioChains,
      `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:dropout_transition=0,` +
        `atrim=0:${totalSeconds},aresample=48000[aout]`,
    ]
    audioMap = '[aout]'
  }
  return [
    '-y',
    ...inputs,
    '-filter_complex',
    [...chains, concat, ...audioFilters].join(';'),
    '-map',
    '[outv]',
    ...(audioMap ? ['-map', audioMap, '-c:a', 'aac', '-b:a', '192k'] : []),
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    ...(audioMap ? ['-shortest'] : []),
    output,
  ]
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:=+%#-]+$/.test(value)
    ? value
    : `"${value.replaceAll('"', '\\"')}"`
}

export function ffmpegCommand(
  clips: readonly PackClip[],
  opts: Parameters<typeof ffmpegArgs>[1] = {},
): string {
  const args = ffmpegArgs(clips, opts)
  return args.length > 0 ? ['ffmpeg', ...args.map(shellArg)].join(' ') : ''
}

/** 秒 → `HH:MM:SS,mmm`（SRT 的时间格式就是这一种，逗号不是句点） */
export function srtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const pad = (n: number, width = 2) => String(n).padStart(width, '0')
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor((ms % 3600000) / 60000))}:${pad(
    Math.floor((ms % 60000) / 1000),
  )},${pad(ms % 1000, 3)}`
}

/**
 * SRT 字幕。**空镜占时间、不占编号** —— 编号是给播放器看的连续序号，
 * 时间轴是给画面看的：两者混在一起就会出现"第 3 条字幕比画面早两秒"。
 * 一句台词都没有时返回空串（调用方据此不导 SRT 文件，而不是导一个 0 字节的空文件）。
 *
 * **一镜多句**（对账 #435）：按**字数比例**把这一镜的秒数分给它们。
 * 为什么不每句都占满整镜：那会让第二句比画面晚一截；为什么不平均分：
 * 长句本来就该念得久一点。分法只有这一处（预览与导出共用同一份时间轴）。
 *
 * **字幕正文不带说话人前缀**：SRT 是给观众看的，画面里已经有谁在说话；
 * 说话人留在分镜表（`骑手：今天最后一单`）与数据层（`speakerId`，将来喂 TTS 用）。
 */
export function srtOf(clips: readonly TimelineClip[]): string {
  const blocks: string[] = []
  let cursor = 0
  let no = 0
  for (const clip of clips) {
    const from = cursor
    cursor += clip.seconds
    for (const cue of cueSpansOf(clip, from)) {
      no += 1
      blocks.push(`${no}\n${srtTime(cue.from)} --> ${srtTime(cue.to)}\n${cue.text}`)
    }
  }
  return blocks.length === 0 ? '' : `${blocks.join('\n\n')}\n`
}

/** 这一镜的几句对白各占哪一段时间（按字数分；只有一句时就是整镜） */
export function timelineLineSpans(
  clip: TimelineClip,
  from: number,
): { from: number; to: number; line: TimelineClip['lines'][number] }[] {
  const lines = clip.lines.filter((line) => line.text.trim())
  if (lines.length === 0) return []
  if (lines.length === 1) {
    return [{ from, to: from + clip.seconds, line: lines[0]! }]
  }
  const weights = lines.map((line) => Math.max(1, line.text.trim().length))
  const total = weights.reduce((sum, w) => sum + w, 0)
  let at = from
  return lines.map((line, i) => {
    const start = at
    /* 最后一条**钉到这一镜的末尾**：浮点累加会留下几毫秒的缝，字幕就会有一小段空窗 */
    at = i === lines.length - 1 ? from + clip.seconds : at + (clip.seconds * weights[i]!) / total
    return { from: start, to: at, line }
  })
}

/** 这一镜的几条字幕各占哪一段时间（按字数分；只有一句时就是整镜） */
function cueSpansOf(
  clip: TimelineClip,
  from: number,
): { from: number; to: number; text: string }[] {
  return timelineLineSpans(clip, from).map((cue) => ({
    from: cue.from,
    to: cue.to,
    text: cue.line.text.trim(),
  }))
}

/**
 * 把每句已生成的 TTS 放到全片时间轴上。
 *
 * 起点与字幕共用 `lineSpansOf`：同一镜多句仍按字数分；没有画面、没进时间轴的镜头
 * 不会偷偷出现一条声音。素材查询失败只记缺失，不猜扩展名。
 */
export function voiceTracksOf(
  clips: readonly TimelineClip[],
  assetOf: PackAssetLookup,
): { voices: PackVoiceTrack[]; missing: string[] } {
  const voices: PackVoiceTrack[] = []
  const missing: string[] = []
  let cursor = 0
  for (const clip of clips) {
    for (const cue of timelineLineSpans(clip, cursor)) {
      const hash = cue.line.audioHash
      if (!hash) continue
      const info = assetOf(hash)
      if (!info) {
        missing.push(
          `第 ${clip.index} 镜「${cue.line.speaker ? `${cue.line.speaker}：` : ''}${cue.line.text.trim().slice(0, 18)}」的配音素材在库里查不到`,
        )
        continue
      }
      voices.push({
        lineId: cue.line.lineId,
        clipIndex: clip.index,
        speaker: cue.line.speaker,
        text: cue.line.text.trim(),
        hash,
        file: assetFileName(hash, info.mime),
        local: info.local,
        start: cue.from,
      })
    }
    cursor += clip.seconds
  }
  return { voices, missing }
}

/** 清单里一格（竖线会把 Markdown 表格拆开，所以正文里一律换成斜杠） */
function cell(text: string): string {
  return text.replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim()
}

/**
 * 清单 / 预览里那句话（**带说话人前缀**，与 SRT 刻意不同）：
 * 这两处是**制作视角** —— 谁说的要看得见；SRT 是观众视角，画面里已经有人了。
 */
export function dialogueTextOf(clip: TimelineClip): string {
  return clip.lines
    .filter((line) => line.text.trim())
    .map((line) => (line.speaker ? `${line.speaker}：${line.text.trim()}` : line.text.trim()))
    .join(' / ')
}

export interface PackMarkdownArgs {
  clips: readonly PackClip[]
  missing: readonly PackMissing[]
  bgm?: PackBgm
  bgmMissing?: string
  voices?: readonly PackVoiceTrack[]
  voicesMissing?: readonly string[]
  command: string
  srt: string
  /** 剧名（空则回落「未命名漫剧」） */
  title: string
  episode: StoryboardEpisode
  episodeNo: number
  /** 用户当前选的素材文件夹名（没选就写"还没选"，并告诉他去哪选） */
  folderName: string | null
  /** 成品文件名 */
  output: string
}

/**
 * 给用户看的那一份。
 *
 * 结构按"拿到手先做什么"排：**怎么用 → 命令 → 字幕 → 逐镜清单 → 缺什么**。
 * 注意事项只写两条会真把人绊倒的（视频长度与分镜表不一致、尺寸改哪儿），不写通用 FFmpeg 科普。
 */
export function packMarkdown(args: PackMarkdownArgs): string {
  const {
    clips,
    missing,
    bgm,
    bgmMissing,
    voices = [],
    voicesMissing = [],
    command,
    srt,
    episode,
    episodeNo,
  } = args
  const title = args.title.trim() || '未命名漫剧'
  const ep = episode.title.trim() || `第 ${episodeNo} 集`
  const total = clips.reduce((sum, c) => sum + c.seconds, 0)
  const out: string[] = []
  const chinese = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十']
  const extras = (bgm || bgmMissing ? 1 : 0) + (voices.length || voicesMissing.length ? 1 : 0) + (srt ? 1 : 0)
  const listNo = 3 + extras
  let section = 3
  const nextHeading = (label: string) => `## ${chinese[section++]}、${label}`

  out.push(`# ${title} · ${ep} · 合成包`)
  out.push('')
  out.push(
    '> 这一份是**纯文本**：应用不替你做编码（架构 §16.2：无服务端 / 无 WASM / 无原生模块）。' +
      '下面那条命令在你自己机器上的 FFmpeg 里跑。',
  )
  out.push('')
  out.push('## 一、怎么用（三步）')
  out.push('')
  out.push(
    `1. 打开终端，进到**素材文件夹**（当前：${
      args.folderName ? `\`${args.folderName}\`` : '还没选 —— 去「设置 → 存储」选一个目录'
    }）`,
  )
  out.push(
    `2. 确认下面第${chinese[listNo]}节列出的文件都在那个文件夹里（素材按 \`<hash>.<ext>\` 命名，命令里写的就是它们）`,
  )
  out.push(`3. 粘贴执行「二、合成命令」，得到 \`${args.output}\``)
  out.push('')
  out.push('## 二、合成命令')
  out.push('')
  out.push('```bash')
  out.push(command)
  out.push('```')
  out.push('')
  if (bgm || bgmMissing) {
    out.push(nextHeading('背景音乐'))
    out.push('')
    if (bgm) {
      out.push(
        `- \`${bgm.file}\`${bgm.name ? `（${bgm.name}）` : ''}，音量 ${Math.round(bgm.volume * 100)}%，循环并裁到成片长度。`,
      )
    } else {
      out.push(`- ${bgmMissing}`)
    }
    out.push('')
  }
  if (voices.length > 0 || voicesMissing.length > 0) {
    out.push(nextHeading('配音'))
    out.push('')
    for (const voice of voices) {
      out.push(
        `- 第 ${voice.clipIndex} 镜 ${voice.start.toFixed(2)}s：\`${voice.file}\` · ` +
          `${voice.speaker ? `${voice.speaker}：` : ''}${cell(voice.text)}`,
      )
    }
    for (const item of voicesMissing) out.push(`- ${item}`)
    out.push('')
  }
  if (srt) {
    out.push(nextHeading('字幕（复制出来存成 `.srt`，或用同目录下那份）'))
    out.push('')
    out.push('```srt')
    out.push(srt.trimEnd())
    out.push('```')
    out.push('')
  }
  out.push(nextHeading('逐镜清单'))
  out.push('')
  out.push(`第 ${episodeNo} 集 · 可合成 ${clips.length} 镜 · 粗排 ${total} 秒`)
  out.push('')
  out.push('| # | 素材 | 文件 | 秒 | 场景 | 角色 | 台词 |')
  out.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const clip of clips) {
    out.push(
      `| ${clip.index} | ${clip.kind === 'video' ? '视频' : '静帧'} | \`${clip.file}\` | ${clip.seconds} | ` +
        `${cell(clip.scene)} | ${cell(clip.cast.join('、'))} | ${cell(dialogueTextOf(clip))} |`,
    )
  }
  out.push('')
  out.push(nextHeading('这几份素材**不在素材文件夹里**（远端产物没有本地字节）'))
  out.push('')
  const remote = clips.filter((c) => !c.local)
  const remoteVoices = voices.filter((voice) => !voice.local)
  if (remote.length === 0 && (!bgm || bgm.local) && remoteVoices.length === 0) {
    out.push('无 —— 这一集要用的素材都在本地。')
  } else {
    out.push('下面这些是**远端产物**（应用手里只有地址、没有字节）：先在画布上把它们下载下来，')
    out.push('存成命令里那个文件名、放进素材文件夹，再跑命令 —— 否则 FFmpeg 会报找不到文件。')
    out.push('')
    for (const clip of remote) out.push(`- 第 ${clip.index} 镜：\`${clip.file}\``)
    if (bgm && !bgm.local) out.push(`- 背景音乐：\`${bgm.file}\``)
    for (const voice of remoteVoices) out.push(`- 第 ${voice.clipIndex} 镜配音：\`${voice.file}\``)
  }
  out.push('')
  out.push(nextHeading('缺料的镜头（它们不在命令里）'))
  out.push('')
  if (missing.length === 0 && !bgmMissing && voicesMissing.length === 0) {
    out.push('无 —— 这一集每一镜都进了命令。')
  } else {
    for (const item of missing) out.push(`- 第 ${item.index} 镜：${item.reason}`)
    if (bgmMissing) out.push(`- 背景音乐：${bgmMissing}`)
    for (const item of voicesMissing) out.push(`- 配音：${item}`)
  }
  out.push('')
  out.push(nextHeading('两条注意事项'))
  out.push('')
  out.push(
    '- **视频按它的实际长度进片**，静帧按分镜表里那个秒数 —— 两者不一致时，字幕会跟着漂。' +
      '想严格对齐，就在那一段视频的 `-i` 前加 `-t N`（N = 分镜表里的秒数）。',
  )
  out.push(
    `- 画面统一到 **${PACK_WIDTH}×${PACK_HEIGHT} / ${PACK_FPS}fps**（竖屏）。要改尺寸就改命令里那三处数字` +
      '（`scale`、`pad` 两处宽高，以及 `fps`）。',
  )
  return `${out.join('\n')}\n`
}

export interface BuildPackArgs {
  doc: StoryboardDoc
  episode: StoryboardEpisode
  /** 这一集是第几集（1 起，只用于标题与文案） */
  episodeNo: number
  assetOf: PackAssetLookup
  folderName: string | null
  /** 成品文件名（默认「第 N 集.mp4」） */
  output?: string
}

/** 页面只用这一个入口：剩下的全是纯函数（可单测）。 */
export function buildEpisodePack(args: BuildPackArgs): EpisodePack {
  const { clips, missing } = episodeClips(args.doc, args.episode.id, args.assetOf)
  const { voices, missing: voicesMissing } = voiceTracksOf(clips, args.assetOf)
  const output = args.output ?? `第${args.episodeNo}集.mp4`
  let bgm: PackBgm | undefined
  let bgmMissing: string | undefined
  if (args.episode.bgmHash) {
    const info = args.assetOf(args.episode.bgmHash)
    if (info) {
      bgm = {
        hash: args.episode.bgmHash,
        file: assetFileName(args.episode.bgmHash, info.mime),
        local: info.local,
        volume: Math.min(1, Math.max(0, args.episode.bgmVolume ?? 0.2)),
        ...(args.episode.bgmName?.trim() ? { name: args.episode.bgmName.trim() } : {}),
      }
    } else {
      bgmMissing = `背景音乐「${
        args.episode.bgmName?.trim() || args.episode.bgmHash.slice(0, 8)
      }」在素材库里查不到，已从合成命令中排除`
    }
  }
  const command = ffmpegCommand(clips, {
    output,
    ...(bgm ? { bgm: { file: bgm.file, volume: bgm.volume } } : {}),
    ...(voices.length > 0
      ? { voices: voices.map((voice) => ({ file: voice.file, start: voice.start })) }
      : {}),
  })
  const srt = srtOf(clips)
  const markdown = packMarkdown({
    clips,
    missing,
    ...(bgm ? { bgm } : {}),
    ...(bgmMissing ? { bgmMissing } : {}),
    voices,
    voicesMissing,
    command,
    srt,
    title: args.doc.script.title,
    episode: args.episode,
    episodeNo: args.episodeNo,
    folderName: args.folderName,
    output,
  })
  return {
    clips,
    missing,
    ...(bgm ? { bgm } : {}),
    ...(bgmMissing ? { bgmMissing } : {}),
    voices,
    voicesMissing,
    command,
    srt,
    markdown,
  }
}
