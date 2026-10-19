import type { AssetPayload } from '../ports'

export interface MixedAudio extends AssetPayload {
  mime: 'audio/wav'
}

/**
 * Decode arbitrary browser-supported audio (including MP3 from TTS), place
 * clips in list order on one track, and export a portable PCM WAV.
 */
export async function mixAudioSequentially(
  clips: readonly AssetPayload[],
  gapSeconds = 0.15,
): Promise<MixedAudio> {
  if (clips.length === 0) throw new Error('没有可合并的音频')
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('当前环境不支持音轨合成')
  }
  const sampleRate = 24_000
  const decodeContext = new OfflineAudioContext(1, 1, sampleRate)
  const buffers: AudioBuffer[] = []
  for (const clip of clips) {
    const bytes = clip.bytes.slice()
    const decoded = await decodeContext.decodeAudioData(bytes.buffer)
    buffers.push(decoded)
  }
  const gap = Math.max(0, gapSeconds)
  const duration =
    buffers.reduce((sum, buffer) => sum + buffer.duration, 0) +
    gap * Math.max(0, buffers.length - 1)
  const context = new OfflineAudioContext(
    1,
    Math.max(1, Math.ceil(duration * sampleRate)),
    sampleRate,
  )
  let cursor = 0
  for (const buffer of buffers) {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(context.destination)
    source.start(cursor)
    cursor += buffer.duration + gap
  }
  const rendered = await context.startRendering()
  return { bytes: encodeWav16(rendered), mime: 'audio/wav' }
}

function encodeWav16(buffer: AudioBuffer): Uint8Array {
  const channels = 1
  const frames = buffer.length
  const bytes = new Uint8Array(44 + frames * channels * 2)
  const view = new DataView(bytes.buffer)
  const writeText = (offset: number, text: string) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index))
    }
  }
  writeText(0, 'RIFF')
  view.setUint32(4, 36 + frames * 2, true)
  writeText(8, 'WAVE')
  writeText(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeText(36, 'data')
  view.setUint32(40, frames * 2, true)
  const samples = buffer.getChannelData(0)
  let offset = 44
  for (let index = 0; index < frames; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
    offset += 2
  }
  return bytes
}
