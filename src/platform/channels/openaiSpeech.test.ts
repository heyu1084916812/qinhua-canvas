import { describe, expect, it, vi } from 'vitest'
import { createOpenAiSpeechAdapter } from './openaiSpeech'
import { ChannelError, type ChannelDeps, type SpeechRunRequest } from './types'

const request = (over: Partial<SpeechRunRequest> = {}): SpeechRunRequest => ({
  channelId: 'ch1',
  model: 'tts-1',
  text: '今天最后一单',
  voice: 'alloy',
  speed: 1,
  responseFormat: 'mp3',
  ...over,
})

function adapter(bytes = new Uint8Array([1, 2, 3])) {
  const calls: unknown[] = []
  const network = {
    request: vi.fn(async (req: unknown) => {
      calls.push(req)
      return {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' },
        text: async () => '',
        json: async () => ({}),
        arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      }
    }),
  }
  const fn = createOpenAiSpeechAdapter(
    {
      id: 'ch1',
      protocol: 'openai-compatible',
      baseUrl: 'https://example.com/v1',
      credentialRef: null,
      apiKey: 'sk-test',
    },
    { network } as unknown as ChannelDeps,
  )
  return { fn, calls }
}

describe('OpenAI 兼容 TTS', () => {
  it('发 /audio/speech，并把二进制原样产出为内容寻址素材', async () => {
    const a = adapter()
    const asset = await a.fn(request(), new AbortController().signal)
    expect(a.calls[0]).toMatchObject({
      url: 'https://example.com/v1/audio/speech',
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer sk-test' }),
      body: {
        model: 'tts-1',
        input: '今天最后一单',
        voice: 'alloy',
        response_format: 'mp3',
        speed: 1,
      },
    })
    expect(asset.mime).toBe('audio/mpeg')
    expect(Array.from(asset.bytes)).toEqual([1, 2, 3])
    expect(asset.hash).toHaveLength(16)
  })

  it('空文本 / 空音色在发请求前就拒绝', async () => {
    const a = adapter()
    await expect(a.fn(request({ text: ' ' }), new AbortController().signal)).rejects.toBeInstanceOf(
      ChannelError,
    )
    await expect(a.fn(request({ voice: '' }), new AbortController().signal)).rejects.toBeInstanceOf(
      ChannelError,
    )
    expect(a.calls).toHaveLength(0)
  })

  it('空音频不当成功', async () => {
    const a = adapter(new Uint8Array())
    await expect(a.fn(request(), new AbortController().signal)).rejects.toMatchObject({
      name: 'ChannelError',
      appError: { kind: 'parse' },
    })
  })
})
