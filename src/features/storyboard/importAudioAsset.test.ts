import { describe, expect, it, vi } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
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
  const memory = createMemoryPlatform()
  const pickFile = vi.fn(async () => picked)
  const value: ImportAudioDeps = {
    platform: {
      ...memory,
      files: { ...memory.files, pickFile },
    },
    storage: memory.storage,
    projectId: 'project-1',
  }
  return { value, storage: memory.storage, picked }
}

describe('漫剧音频导入', () => {
  it('空 mime 时从扩展名补音频类型，并把字节写进 assets', async () => {
    const { value, storage } = deps({ mime: '', name: 'scene.WAV' })
    const asset = await importAudioAsset(value)
    expect(asset).toMatchObject({ mime: 'audio/wav', name: 'scene.WAV', size: 4 })
    const rows = await storage.query('assets', { id: asset!.hash })
    expect(rows[0]).toMatchObject({
      mime: 'audio/wav',
      bytes: new Uint8Array([1, 2, 3, 4]),
      projectId: 'project-1',
    })
  })

  it('不是音频就不落库', async () => {
    const { value, storage } = deps({ mime: 'text/plain', name: 'notes.txt' })
    await expect(importAudioAsset(value)).rejects.toThrow('只支持')
    expect(await storage.query('assets', {})).toHaveLength(0)
  })

  it('超过上限当场拒绝，不先读字节', async () => {
    const { value, storage } = deps({ size: MAX_AUDIO_BYTES + 1 })
    await expect(importAudioAsset(value)).rejects.toThrow('50MB')
    expect(await storage.query('assets', {})).toHaveLength(0)
  })

  it('mime 标准化只认 audio/* 或已知音频扩展名', () => {
    expect(normalizeAudioMime('', 'a.m4a')).toBe('audio/mp4')
    expect(normalizeAudioMime('audio/ogg; codecs=opus', 'x')).toBe('audio/ogg')
    expect(normalizeAudioMime('image/png', 'x.png')).toBeNull()
  })
})
