import { describe, expect, it, vi } from 'vitest'
import {
  importAudioAsset,
  MAX_AUDIO_BYTES,
  normalizeAudioMime,
  type ImportAudioDeps,
} from './importAudioAsset'

function deps(overrides: {
  mime?: string
  name?: string
  bytes?: Uint8Array
  size?: number
} = {}) {
  const bytes = overrides.bytes ?? new Uint8Array([1, 2, 3, 4])
  const picked = {
    name: overrides.name ?? 'theme.mp3',
    size: overrides.size ?? bytes.length,
    mime: overrides.mime ?? 'audio/mpeg',
    blob: new Blob([bytes as unknown as BlobPart], { type: overrides.mime ?? 'audio/mpeg' }),
  }
  const dispatch = vi.fn()
  const value: ImportAudioDeps = {
    platform: { files: { pickFile: vi.fn(async () => picked) } } as never,
    store: { dispatch } as never,
    projectId: 'p1',
  }
  return { value, dispatch, picked }
}

describe('漫剧音频导入', () => {
  it('空 mime 时从扩展名补音频类型，并把字节写进 assets', async () => {
    const { value, dispatch } = deps({ mime: '', name: 'scene.WAV' })
    const asset = await importAudioAsset(value)
    expect(asset).toMatchObject({ mime: 'audio/wav', name: 'scene.WAV', size: 4 })
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'asset.put',
        asset: expect.objectContaining({
          mime: 'audio/wav',
          bytes: new Uint8Array([1, 2, 3, 4]),
          projectId: 'p1',
        }),
      }),
    )
  })

  it('不是音频就不落库', async () => {
    const { value, dispatch } = deps({ mime: 'text/plain', name: 'notes.txt' })
    await expect(importAudioAsset(value)).rejects.toThrow('只支持')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('超过上限当场拒绝，不先读字节', async () => {
    const { value, dispatch } = deps({ size: MAX_AUDIO_BYTES + 1 })
    await expect(importAudioAsset(value)).rejects.toThrow('50MB')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('mime 标准化只认 audio/* 或已知音频扩展名', () => {
    expect(normalizeAudioMime('', 'a.m4a')).toBe('audio/mp4')
    expect(normalizeAudioMime('audio/ogg; codecs=opus', 'x')).toBe('audio/ogg')
    expect(normalizeAudioMime('image/png', 'x.png')).toBeNull()
  })
})
