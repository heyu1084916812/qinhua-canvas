import { describe, it, expect, vi } from 'vitest'
import { assetFileName, downloadAsset } from './downloadAsset'
import type { AssetPort, FilePort } from '../../platform/ports'

/**
 * 下载素材（用户 2026-09-18）。
 *
 * 之所以值得单测：这条路径有**三种结局**，而它们的用户可见行为完全不同——
 * `missing`（素材不在库里）要说「已不在素材库」，`failed`（落盘出错）说「下载失败」，
 * 成功则安静。把它们合并成「一律静默」是最省事也最坑的写法：
 * 用户点了没反应，只能怀疑是功能坏了。
 */
function deps(
  over: {
    bytes?: Uint8Array | null
    saveThrows?: boolean
    remoteUrl?: string | null
    saveFromUrlVia?: 'saved' | 'opened'
    saveFromUrlThrows?: boolean
  } = {},
) {
  const saved: { name: string; blob: Blob }[] = []
  const fromUrl: { url: string; name: string }[] = []
  const assets: AssetPort = {
    read: vi.fn(async () =>
      over.bytes === null ? null : { bytes: over.bytes ?? new Uint8Array([1, 2, 3]), mime: 'image/png' },
    ),
    readUrl: vi.fn(async () =>
      over.remoteUrl ? { url: over.remoteUrl, mime: 'video/mp4' } : null,
    ),
  }
  const files: FilePort = {
    pickFile: vi.fn(async () => null),
    saveFile: vi.fn(async (name: string, blob: Blob) => {
      if (over.saveThrows) throw new Error('disk full')
      saved.push({ name, blob })
    }),
    saveFromUrl: vi.fn(async (url: string, name: string) => {
      if (over.saveFromUrlThrows) throw new Error('拿不到字节')
      fromUrl.push({ url, name })
      return over.saveFromUrlVia ?? 'saved'
    }),
  }
  return { assets, files, saved, fromUrl }
}

describe('assetFileName', () => {
  it('按 mime 定扩展名，并带上 hash 前 8 位（两次下载不会混成 "(1)"）', () => {
    expect(assetFileName('abcdef1234567890', 'image/png')).toBe('轻画-abcdef12.png')
    expect(assetFileName('abcdef1234567890', 'video/mp4')).toBe('轻画-abcdef12.mp4')
    expect(assetFileName('abcdef1234567890', 'image/jpeg')).toBe('轻画-abcdef12.jpg')
  })

  it('不认识的 mime → .bin（不猜，也不崩）', () => {
    expect(assetFileName('abcdef1234567890', 'application/octet-stream')).toBe('轻画-abcdef12.bin')
  })
})

describe('downloadAsset', () => {
  it('素材在库里 → 落盘一次，文件名带 hash 前缀（拿回来能分辨是拿回来的第几张）', async () => {
    const d = deps()
    const r = await downloadAsset(d, 'abcdef1234567890')
    expect(r).toEqual({ ok: true, via: 'file' })
    expect(d.saved).toHaveLength(1)
    expect(d.saved[0]!.name).toBe('轻画-abcdef12.png')
    // Blob 的 mime 取自素材本体，不是猜的
    expect(d.saved[0]!.blob.type).toBe('image/png')
  })

  it('★ 素材不在库里 → missing（而不是静默成功）', async () => {
    const d = deps({ bytes: null })
    expect(await downloadAsset(d, 'deadbeefdeadbeef')).toEqual({ ok: false, reason: 'missing' })
    expect(d.saved).toHaveLength(0)
  })

  it('★ 落盘抛错 → failed（不把异常漏给调用方，也不假装成功）', async () => {
    const d = deps({ saveThrows: true })
    expect(await downloadAsset(d, 'abcdef1234567890')).toEqual({ ok: false, reason: 'failed' })
  })

  it('读素材本身抛错 → 当成 missing（读不到就是没有，不往上炸）', async () => {
    const assets: AssetPort = {
      read: vi.fn(async () => {
        throw new Error('indexeddb closed')
      }),
      readUrl: vi.fn(async () => null),
    }
    const files: FilePort = {
      pickFile: vi.fn(async () => null),
      saveFile: vi.fn(async () => {}),
      saveFromUrl: vi.fn(async () => 'saved' as const),
    }
    expect(await downloadAsset({ assets, files }, 'abcdef1234567890')).toEqual({
      ok: false,
      reason: 'missing',
    })
  })

  /**
   * 用户 2026-10-03：「刚刚生成的视频，节点的下载功能无法下载，显示素材不在素材库」。
   *
   * 视频成片托管在远端，`assets` 行里只有 `url`、没有字节 —— 「读不到字节」被误判成
   * 「这张素材不在库里」。下面三条把这条分岔钉死：有地址就不许报 missing。
   */
  it('★★ 只有远端地址（没有字节）→ 走远端下载，而不是报「不在素材库」', async () => {
    const d = deps({ bytes: null, remoteUrl: 'https://cdn.example.com/v.mp4' })
    expect(await downloadAsset(d, 'abcdef1234567890')).toEqual({ ok: true, via: 'file' })
    expect(d.saved).toHaveLength(0)
    expect(d.fromUrl).toEqual([
      { url: 'https://cdn.example.com/v.mp4', name: '轻画-abcdef12.mp4' },
    ])
  })

  it('★★ 远端取不到字节（CORS 拦下）→ 交给浏览器，如实报 via=tab', async () => {
    const d = deps({
      bytes: null,
      remoteUrl: 'https://cdn.example.com/v.mp4',
      saveFromUrlVia: 'opened',
    })
    expect(await downloadAsset(d, 'abcdef1234567890')).toEqual({ ok: true, via: 'tab' })
  })

  it('远端这条路抛错 → failed（不假装成功，也不报成 missing）', async () => {
    const d = deps({ bytes: null, remoteUrl: 'https://cdn.example.com/v.mp4', saveFromUrlThrows: true })
    expect(await downloadAsset(d, 'abcdef1234567890')).toEqual({ ok: false, reason: 'failed' })
  })

  it('既没字节也没地址 → 才是真的 missing', async () => {
    const d = deps({ bytes: null, remoteUrl: null })
    expect(await downloadAsset(d, 'abcdef1234567890')).toEqual({ ok: false, reason: 'missing' })
    expect(d.fromUrl).toHaveLength(0)
  })
})
