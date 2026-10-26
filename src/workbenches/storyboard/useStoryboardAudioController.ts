import type { Dispatch, SetStateAction } from 'react'
import type { SpeechTarget } from '../../domain/shared/chatTarget'
import type { DirectRunTraceInput } from '../../state/shared/directRun'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { ChannelStore } from '../../state/channel/channelStore'
import {
  speechSettingsOf,
  updateEpisode,
  updateShotLine,
  type StoryboardDoc,
  type StoryboardEpisode,
  type StoryboardShot,
} from '../../domain/storyboard/storyboard'
import { importAudioAsset } from '../../features/storyboard/importAudioAsset'
import type { PlatformKit } from '../../platform/ports'
import { asAppError, describeError } from '../../shared/result'

export interface StoryboardAudioControllerArgs {
  doc: StoryboardDoc
  currentDoc: () => StoryboardDoc
  selected: StoryboardEpisode | null
  shots: readonly StoryboardShot[]
  speechTarget: SpeechTarget | null
  platform: PlatformKit
  channels: ChannelStore
  canvasStore: CanvasStore
  projectId: string
  directTrace: (args: {
    subjectId: string
    kind: 'text' | 'video' | 'speech'
    channelId: string
    model: string
    payload: unknown
    inputs?: DirectRunTraceInput['inputs']
    params?: Record<string, unknown>
  }) => DirectRunTraceInput
  apply: (doc: StoryboardDoc) => void
  setStatus: (text: string) => void
  setVoiceBusy: Dispatch<SetStateAction<Record<string, boolean>>>
}

export function createStoryboardAudioController(args: StoryboardAudioControllerArgs) {
  const {
    doc,
    currentDoc,
    selected,
    shots,
    speechTarget,
    platform,
    channels,
    canvasStore,
    projectId,
    directTrace,
    apply,
    setStatus,
    setVoiceBusy,
  } = args

  const voiceLine = async (
    shot: StoryboardShot,
    lineId: string,
    options: { quiet?: boolean } = {},
  ): Promise<boolean> => {
    const report = (text: string) => {
      if (!options.quiet) setStatus(text)
    }
    const line = shot.lines.find((item) => item.id === lineId)
    if (!line || !line.text.trim()) {
      report('先写台词，再生成配音')
      return false
    }
    if (!speechTarget) {
      report('还没有可用的配音模型：去设置里给渠道勾选一个 audio / tts 模型')
      return false
    }
    const speech = speechSettingsOf(currentDoc(), line)
    const voice = speech.voice || speechTarget.voices[0] || 'alloy'
    setVoiceBusy((current) => ({ ...current, [lineId]: true }))
    const ac = new AbortController()
    const timer = globalThis.setTimeout(() => ac.abort(), 120_000)
    try {
      const asset = await channels.generateSpeech({
        channelId: speechTarget.channelId,
        model: speechTarget.model,
        text: line.text,
        voice,
        speed: speech.speed,
        responseFormat: 'mp3',
        timeoutMs: 120_000,
        signal: ac.signal,
        trace: directTrace({
          subjectId: `shot:${shot.id}:line:${lineId}:speech`,
          kind: 'speech',
          channelId: speechTarget.channelId,
          model: speechTarget.model,
          payload: {
            text: line.text,
            voice,
            speed: speech.speed,
            responseFormat: 'mp3',
          },
          params: { voice, speed: speech.speed },
        }),
      })
      canvasStore.dispatch({
        kind: 'asset.put',
        asset: {
          hash: asset.hash,
          mime: asset.mime,
          bytes: asset.bytes,
          createdAt: Date.now(),
          projectId,
        },
      })
      const base = currentDoc()
      const speaker = base.characters.find((item) => item.id === line.speakerId)?.name ?? '旁白'
      apply(
        updateShotLine(
          base,
          shot.id,
          lineId,
          {
            audioHash: asset.hash,
            audioName: `${speaker}-${line.text.trim().slice(0, 16)}.mp3`,
          },
          Date.now(),
        ),
      )
      report(`已生成配音：${speaker} · ${line.text.trim().slice(0, 20)}`)
      return true
    } catch (error) {
      const appError = asAppError(error)
      report(appError ? describeError(appError) : String(error))
      return false
    } finally {
      globalThis.clearTimeout(timer)
      setVoiceBusy((current) => {
        const next = { ...current }
        delete next[lineId]
        return next
      })
    }
  }

  const runEpisodeVoices = async () => {
    if (!speechTarget) {
      setStatus('还没有可用的配音模型：去设置里给渠道勾选一个 audio / tts 模型')
      return
    }
    const targets = shots.flatMap((shot) =>
      shot.lines
        .filter((line) => line.text.trim() && !line.audioHash)
        .map((line) => ({ shot, line })),
    )
    if (targets.length === 0) {
      setStatus('这一集没有待生成的台词配音')
      return
    }
    let ok = 0
    let failed = 0
    for (let i = 0; i < targets.length; i += 1) {
      const { shot, line } = targets[i]!
      setStatus(`正在补齐本集配音 ${i + 1}/${targets.length}：第 ${shots.indexOf(shot) + 1} 镜…`)
      const success = await voiceLine(shot, line.id, { quiet: true })
      if (success) ok += 1
      else failed += 1
    }
    setStatus(
      failed > 0
        ? `本集配音跑完：成功 ${ok} 句，失败 ${failed} 句（失败原因见状态提示）`
        : `本集 ${ok} 句配音已生成`,
    )
  }

  const onPickBgm = async () => {
    if (!selected) return
    setStatus('正在导入背景音乐…')
    try {
      const asset = await importAudioAsset({ platform, store: canvasStore, projectId })
      if (!asset) {
        setStatus('')
        return
      }
      apply(
        updateEpisode(
          doc,
          selected.id,
          {
            bgmHash: asset.hash,
            bgmName: asset.name,
            bgmVolume: selected.bgmVolume ?? 0.2,
          },
          Date.now(),
        ),
      )
      setStatus(`已导入背景音乐「${asset.name}」`)
    } catch (error) {
      const appError = asAppError(error)
      setStatus(appError ? describeError(appError) : String(error))
    }
  }

  const onRemoveBgm = () => {
    if (!selected) return
    apply(updateEpisode(doc, selected.id, { bgmHash: '' }, Date.now()))
    setStatus('已移除背景音乐')
  }

  return {
    voiceLine,
    runEpisodeVoices,
    onPickBgm,
    onRemoveBgm,
  }
}
