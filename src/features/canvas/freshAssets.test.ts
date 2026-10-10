import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearFreshAssets,
  forgetFreshAsset,
  freshAssetOf,
  freshAssetStats,
  rememberFreshAsset,
} from './freshAssets'

/**
 * 「刚导入的素材直通车」（对账 #408 的优化）。
 *
 * 这里量的是**边界**：内容寻址保证命中就一定是同一份字节，所以真正要守的是
 * 「不会无限长大」和「淘汰顺序是最近最少使用」。上限写死在实现里（6 份 / 48MB），
 * 测试按自己的大小构造，不去依赖那个数字的具体值 —— 改上限时这些断言照旧成立。
 */

const blobOf = (bytes: number) => new Blob([new Uint8Array(bytes)])

describe('刚导入的素材直通车', () => {
  beforeEach(() => clearFreshAssets())

  it('记进去就能取出来，而且是同一个 Blob（内容寻址 ⇒ 不会取错）', () => {
    const blob = blobOf(16)
    rememberFreshAsset('h1', blob)
    expect(freshAssetOf('h1')).toBe(blob)
    expect(freshAssetOf('nope')).toBeNull()
  })

  it('条数超上限时淘汰最久没用的那一份', () => {
    for (let i = 0; i < 6; i += 1) rememberFreshAsset(`h${i}`, blobOf(8))
    /** 点一下最早那份 ⇒ 它变成"刚用过"，被淘汰的应该是第二早的 */
    expect(freshAssetOf('h0')).not.toBeNull()
    rememberFreshAsset('h6', blobOf(8))
    expect(freshAssetOf('h6')).not.toBeNull()
    expect(freshAssetOf('h0')).not.toBeNull()
    expect(freshAssetOf('h1')).toBeNull()
  })

  it('合计字节超上限时也会淘汰（不能只按条数兜）', () => {
    /** 每份 20MB：第 3 份进来时合计 60MB > 48MB ⇒ 最早那份必须让位 */
    rememberFreshAsset('big1', blobOf(20 * 1024 * 1024))
    rememberFreshAsset('big2', blobOf(20 * 1024 * 1024))
    rememberFreshAsset('big3', blobOf(20 * 1024 * 1024))
    expect(freshAssetOf('big1')).toBeNull()
    expect(freshAssetStats().bytes).toBeLessThanOrEqual(48 * 1024 * 1024)
  })

  it('单份就超过总上限的（大视频）直接不收 —— 别为了它把缓存整片挤空', () => {
    rememberFreshAsset('small', blobOf(8))
    rememberFreshAsset('huge', blobOf(60 * 1024 * 1024))
    expect(freshAssetOf('huge')).toBeNull()
    expect(freshAssetOf('small')).not.toBeNull()
  })

  it('同一 hash 重复记：只留一份，字节数不能重复累加', () => {
    rememberFreshAsset('h1', blobOf(100))
    rememberFreshAsset('h1', blobOf(100))
    expect(freshAssetStats()).toEqual({ count: 1, bytes: 100 })
  })

  it('forget / clear：主动丢弃后取不到', () => {
    rememberFreshAsset('h1', blobOf(8))
    forgetFreshAsset('h1')
    expect(freshAssetOf('h1')).toBeNull()
    rememberFreshAsset('h2', blobOf(8))
    clearFreshAssets()
    expect(freshAssetStats()).toEqual({ count: 0, bytes: 0 })
  })

  it('空 hash / 空 blob 不收（0 字节的素材本来就被导入那一步挡掉了）', () => {
    rememberFreshAsset('', blobOf(8))
    rememberFreshAsset('h1', new Blob([]))
    expect(freshAssetStats().count).toBe(0)
  })
})
