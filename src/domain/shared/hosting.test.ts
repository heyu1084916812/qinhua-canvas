import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOSTING,
  HOSTING_ROW_ID,
  hostingConfigOf,
  hostingRowOf,
  tmpfilesDirectUrl,
} from './hosting'

/**
 * 素材传输（图床）口径（用户 2026-10-03「图床设置页单独设置一个页面」）。
 *
 * 这里钉的都是**踩过的坑**：默认关闭、脏数据不许抛、以及「页面地址 ≠ 直链」。
 */
describe('素材传输配置', () => {
  it('没配过 / 脏数据 → 一律回落默认（关闭 + 24 小时），不抛', () => {
    expect(hostingConfigOf(undefined)).toEqual(DEFAULT_HOSTING)
    expect(hostingConfigOf({ provider: 'something', expireSeconds: 'x' })).toEqual(DEFAULT_HOSTING)
    expect(hostingConfigOf({ provider: 'tmpfiles', expireSeconds: 60 })).toEqual({
      provider: 'tmpfiles',
      expireSeconds: DEFAULT_HOSTING.expireSeconds,
    })
  })

  it('读写走 `presets` 表的固定行，值原样往返', () => {
    const row = hostingRowOf({ provider: 'tmpfiles', expireSeconds: 172_800 })
    expect(row.id).toBe(HOSTING_ROW_ID)
    expect(hostingConfigOf(row)).toEqual({ provider: 'tmpfiles', expireSeconds: 172_800 })
  })

  it('★★ tmpfiles 返回的是**页面地址**，直链必须换成 `/dl/`', () => {
    expect(
      tmpfilesDirectUrl({ status: 'success', data: { url: 'https://tmpfiles.org/abc123/cat.png' } }),
    ).toBe('https://tmpfiles.org/dl/abc123/cat.png')
  })

  it('不是 tmpfiles 的地址 / 没有地址 → null（不把别家的页面地址当直链发出去）', () => {
    expect(tmpfilesDirectUrl({ data: { url: 'https://example.com/x.png' } })).toBeNull()
    expect(tmpfilesDirectUrl({ data: {} })).toBeNull()
    expect(tmpfilesDirectUrl(null)).toBeNull()
  })
})
