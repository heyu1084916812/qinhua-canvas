import {
  buildEpisodePack,
  ffmpegArgs,
  type PackClip,
} from '../../domain/storyboard/ffmpegPack'
import {
  exportStoryboardMarkdown,
  shotsOf,
  type StoryboardDoc,
  type StoryboardEpisode,
} from '../../domain/storyboard/storyboard'
import type { PlatformKit } from '../../platform/ports'
import { toBytes } from '../../platform/assets'
import { asAppError, describeError } from '../../shared/result'

export interface StoryboardExportControllerArgs {
  doc: StoryboardDoc
  projectName: string
  episodes: readonly StoryboardEpisode[]
  selected: StoryboardEpisode | null
  timelineSrt: string
  timelineSrtCues: number
  platform: PlatformKit
  flush: () => Promise<void>
  setStatus: (text: string) => void
  setRendering: (rendering: boolean) => void
}

/**
 * 漫剧导出控制器。
 *
 * 只负责把当前文档 / 集变成可保存文件；页面不持有 FFmpeg 参数、素材清单或
 * 导出失败分支。浏览器没有 CLI 时仍可导出 MD / 合成包 / SRT，成片入口由 UI 隐藏。
 */
export function createStoryboardExportController(args: StoryboardExportControllerArgs) {
  const { doc, projectName, episodes, selected, platform, flush, setStatus } = args

  const exportBaseName = () =>
    (doc.script.title.trim() || projectName.trim() || '未命名漫剧').replace(
      /[\\/:*?"<>|]/g,
      '_',
    )

  const onExport = async () => {
    try {
      await flush()
      const markdown = exportStoryboardMarkdown(doc)
      await platform.files.saveFile(
        `${exportBaseName()}-分镜表.md`,
        new Blob([markdown], { type: 'text/markdown;charset=utf-8' }),
      )
      setStatus('已导出分镜表')
    } catch {
      setStatus('导出失败')
    }
  }

  /** 只逐条读这一集真正会用到的素材元数据，不把整张 assets 表拉进内存。 */
  const loadPackAssetInfo = async (episode: StoryboardEpisode) => {
    const wanted = new Set<string>()
    for (const shot of shotsOf(doc, episode.id)) {
      const hash = shot.videoHash ?? shot.imageHash
      if (hash) wanted.add(hash)
      for (const line of shot.lines) {
        if (line.audioHash) wanted.add(line.audioHash)
      }
    }
    if (episode.bgmHash) wanted.add(episode.bgmHash)
    const info = new Map<string, { mime: string; local: boolean }>()
    for (const hash of wanted) {
      const rows = await platform.storage.query('assets', { id: hash })
      const row = rows[0] as { mime?: unknown; bytes?: unknown } | undefined
      if (!row) continue
      const bytes = toBytes(row.bytes)
      info.set(hash, {
        mime: typeof row.mime === 'string' && row.mime ? row.mime : 'image/png',
        local: !!bytes && bytes.length > 0,
      })
    }
    return info
  }

  const onExportPack = async () => {
    if (!selected) return
    const episodeNo = episodes.findIndex((episode) => episode.id === selected.id) + 1
    setStatus('正在准备合成包…')
    try {
      await flush()
      const info = await loadPackAssetInfo(selected)
      const pack = buildEpisodePack({
        doc,
        episode: selected,
        episodeNo,
        assetOf: (hash) => info.get(hash),
        folderName: platform.assetFolder?.current()?.name ?? null,
      })
      if (pack.clips.length === 0) {
        setStatus('这一集还没有能合成的素材：先「铺到画布」再出图')
        return
      }
      const base = exportBaseName()
      await platform.files.saveFile(
        `${base}-第${episodeNo}集-合成包.md`,
        new Blob([pack.markdown], { type: 'text/markdown;charset=utf-8' }),
      )
      let files = 1
      if (pack.srt) {
        await platform.files.saveFile(
          `${base}-第${episodeNo}集.srt`,
          new Blob([pack.srt], { type: 'application/x-subrip;charset=utf-8' }),
        )
        files = 2
      }
      const remote = pack.clips.filter((clip) => !clip.local).length
      const remoteBgm = pack.bgm && !pack.bgm.local ? 1 : 0
      const remoteVoices = pack.voices.filter((voice) => !voice.local).length
      const notes = [
        pack.missing.length > 0 ? `${pack.missing.length} 镜没素材` : '',
        remote + remoteBgm + remoteVoices > 0
          ? `${remote + remoteBgm + remoteVoices} 份素材要先去下载`
          : '',
        pack.bgmMissing ? '背景音乐缺失，未进命令' : '',
        pack.voicesMissing.length > 0 ? `${pack.voicesMissing.length} 句配音缺失` : '',
      ].filter(Boolean)
      setStatus(
        `已导出合成包（${files} 个文件）${notes.length > 0 ? ` —— 包里写明了：${notes.join('、')}` : ''}`,
      )
    } catch {
      setStatus('导出合成包失败')
    }
  }

  const onExportSrt = async () => {
    if (!selected || !args.timelineSrt) return
    const episodeNo = episodes.findIndex((episode) => episode.id === selected.id) + 1
    try {
      await flush()
      await platform.files.saveFile(
        `${exportBaseName()}-第${episodeNo}集-字幕.srt`,
        new Blob([args.timelineSrt], {
          type: 'application/x-subrip;charset=utf-8',
        }),
      )
      setStatus(`第 ${episodeNo} 集字幕已导出（${args.timelineSrtCues} 条）`)
    } catch {
      setStatus('导出 SRT 字幕失败')
    }
  }

  const renderEpisode = async () => {
    if (!selected || !platform.cli) return
    const cli = platform.cli
    args.setRendering(true)
    setStatus('正在检查本机 FFmpeg…')
    try {
      await flush()
      const ffmpeg = await cli.which('ffmpeg')
      if (!ffmpeg) {
        setStatus('没找到本机 FFmpeg：先安装 FFmpeg，并让它能在终端里直接运行')
        return
      }
      const info = await loadPackAssetInfo(selected)
      const episodeNo = episodes.findIndex((episode) => episode.id === selected.id) + 1
      const pack = buildEpisodePack({
        doc,
        episode: selected,
        episodeNo,
        assetOf: (hash) => info.get(hash),
        folderName: platform.assetFolder?.current()?.name ?? null,
      })
      if (pack.clips.length === 0) {
        setStatus('这一集还没有能合成的素材：先「铺到画布」再出图')
        return
      }

      const urls = new Map<string, string>()
      const sourceOf = async (hash: string) => {
        const existing = urls.get(hash)
        if (existing) return existing
        const meta = info.get(hash)
        if (!meta) throw new Error(`素材库缺少 ${hash.slice(0, 8)}…，无法合成`)
        if (meta.local) {
          const local = platform.assets.sourceUrl?.(hash)
          if (local) {
            urls.set(hash, local)
            return local
          }
        }
        const remote = await platform.assets.readUrl(hash)
        if (remote?.url) {
          urls.set(hash, remote.url)
          return remote.url
        }
        throw new Error(`素材 ${hash.slice(0, 8)}… 既没有本地字节，也没有可读取的远端地址`)
      }

      const renderClips: PackClip[] = []
      for (const clip of pack.clips) {
        renderClips.push({ ...clip, file: await sourceOf(clip.hash) })
      }
      const bgmFile = pack.bgm ? await sourceOf(pack.bgm.hash) : ''
      const voiceFiles: { file: string; start: number }[] = []
      for (const voice of pack.voices) {
        voiceFiles.push({ file: await sourceOf(voice.hash), start: voice.start })
      }

      const outDir = await cli.outDir()
      const sep = outDir.includes('\\') ? '\\' : '/'
      const renderBase = `${exportBaseName()}-第${episodeNo}集-${Date.now()}`
      const output = `${outDir}${outDir.endsWith(sep) ? '' : sep}${renderBase}.mp4`
      let subtitleFile = ''
      if (pack.srt) {
        const writeOut = cli.writeOut
        if (!writeOut) {
          setStatus('当前桌面壳不支持写入字幕文件，请更新桌面版后重试')
          return
        }
        subtitleFile = await writeOut(
          `${renderBase}.srt`,
          new TextEncoder().encode(pack.srt),
        )
      }
      const argsForFfmpeg = ffmpegArgs(renderClips, {
        output,
        ...(pack.bgm
          ? { bgm: { file: bgmFile, volume: pack.bgm.volume } }
          : {}),
        ...(voiceFiles.length > 0 ? { voices: voiceFiles } : {}),
        ...(subtitleFile ? { subtitles: { file: subtitleFile } } : {}),
      })
      setStatus(`正在用本机 FFmpeg 合成第 ${episodeNo} 集…`)
      const outcome = await cli.run({
        id: `storyboard-render-${Date.now()}`,
        program: ffmpeg,
        args: argsForFfmpeg,
        timeoutMs: 30 * 60_000,
      })
      if (outcome.timedOut) {
        setStatus('本机 FFmpeg 合成超时（30 分钟）')
        return
      }
      if (outcome.code !== 0) {
        const reason = outcome.stderr.trim().slice(-500) || `退出码 ${String(outcome.code)}`
        setStatus(`本机 FFmpeg 合成失败：${reason}`)
        return
      }
      const bytes = await cli.readOut(output)
      await platform.files.saveFile(
        `${exportBaseName()}-第${episodeNo}集-成片.mp4`,
        new Blob([Uint8Array.from(bytes).buffer], { type: 'video/mp4' }),
      )
      setStatus(`第 ${episodeNo} 集成片已生成并保存`)
    } catch (error) {
      const appError = asAppError(error)
      setStatus(appError ? describeError(appError) : String(error))
    } finally {
      args.setRendering(false)
    }
  }

  return {
    exportBaseName,
    onExport,
    onExportPack,
    onExportSrt,
    renderEpisode,
  }
}
