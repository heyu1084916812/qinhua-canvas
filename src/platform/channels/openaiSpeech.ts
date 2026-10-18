import { fingerprintBytes } from '../../domain/shared/hash'
import type { SafeChannelConfig } from '../ports'
import {
  authHeader,
  classifyError,
  GENERATE_TIMEOUT_MS,
  openAiBaseUrl,
} from './openaiCommon'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type GeneratedAsset,
  type SpeechRunRequest,
} from './types'

const MIME_BY_FORMAT: Record<NonNullable<SpeechRunRequest['responseFormat']>, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  pcm: 'audio/wav',
}

/**
 * OpenAI 兼容 TTS：`POST /audio/speech` 直接回音频字节。
 *
 * 与图片 / 视频不同，响应体不是 JSON；这里只认真实非空字节，失败时保留服务端原话。
 */
export function createOpenAiSpeechAdapter(
  config: SafeChannelConfig & { apiKey: string | null },
  deps: ChannelDeps,
): NonNullable<ChannelAdapter['generateSpeech']> {
  const speechUrl = `${openAiBaseUrl(config)}/audio/speech`

  return async (request, signal): Promise<GeneratedAsset> => {
    const text = request.text.trim()
    if (!text) throw new ChannelError({ kind: 'validation', field: 'text', reason: '配音文本不能为空' })
    const voice = request.voice.trim()
    if (!voice) throw new ChannelError({ kind: 'validation', field: 'voice', reason: '请选择音色' })
    const format = request.responseFormat ?? 'mp3'
    const speed = Math.min(4, Math.max(0.25, request.speed ?? 1))

    const res = await deps.network.request(
      {
        url: speechUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
        body: {
          model: request.model,
          input: text,
          voice,
          response_format: format,
          speed,
        },
        timeoutMs: request.timeoutMs ?? GENERATE_TIMEOUT_MS,
      },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const bytes = new Uint8Array(await res.arrayBuffer())
    if (bytes.length === 0) {
      throw new ChannelError({ kind: 'parse', raw: 'TTS 响应是空音频' })
    }
    return {
      hash: await fingerprintBytes(bytes),
      mime: MIME_BY_FORMAT[format],
      bytes,
    }
  }
}
