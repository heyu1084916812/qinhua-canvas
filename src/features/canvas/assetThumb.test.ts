import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory/index'
import { ensureAssetThumb, makeThumbBytes, thumbPlan } from './assetThumb'

/**
 * 缩略图（对账 #231）的**护栏**测试。
 *
 * ⚠️ 真正的解码 / 重编码（`createImageBitmap` + `OffscreenCanvas`）单测环境里没有 ——
 * 那部分靠真机探针量（`img.naturalWidth` 从 3000 掉到 640 才是证据）。
 * 这里钉的是"什么时候该动、什么时候不许动、不支持时不许崩也不许写半成品"。
 */
describe('thumbPlan：要不要缩、缩成多大', () => {
  it('大图按**长边**缩到上限，比例不变（横竖都算对）', () => {
    expect(thumbPlan({ width: 3840, height: 2160 }, 640)).toEqual({ width: 640, height: 360 })
    expect(thumbPlan({ width: 2160, height: 3840 }, 640)).toEqual({ width: 360, height: 640 })
  })

  it('★ 本来就小 ⇒ 不缩（省一次重编码，也省一份重复字节）', () => {
    expect(thumbPlan({ width: 640, height: 480 }, 640)).toBeNull()
    expect(thumbPlan({ width: 200, height: 200 }, 640)).toBeNull()
  })

  it('★ 尺寸读不出来 ⇒ 不缩（不猜：宁可继续用原图，也不生成一张尺寸错的图）', () => {
    expect(thumbPlan(null)).toBeNull()
    expect(thumbPlan({ width: 0, height: 100 })).toBeNull()
    expect(thumbPlan({ width: 100, height: 0 })).toBeNull()
  })

  it('极端长条也不会算出 0（否则 canvas 尺寸非法）', () => {
    expect(thumbPlan({ width: 8000, height: 20 }, 640)).toEqual({ width: 640, height: 2 })
  })
})

describe('ensureAssetThumb：落库那一步的护栏', () => {
  it('★ 环境不支持（单测里没有 createImageBitmap / OffscreenCanvas）⇒ 返回 false，且**不写库**', async () => {
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'h1', mime: 'image/png', bytes: new Uint8Array([1]) }] },
    })
    expect(typeof createImageBitmap).toBe('undefined')
    expect(await makeThumbBytes(new Blob([new Uint8Array([1])]))).toBeNull()

    const ok = await ensureAssetThumb(
      platform,
      { id: 'h1', mime: 'image/png' },
      new Blob([new Uint8Array([1])]),
    )
    expect(ok).toBe(false)
    const row = (await platform.storage.query('assets', { id: 'h1' }))[0] as { thumb?: unknown }
    expect(row.thumb).toBeUndefined() // 不许写半成品（写了会让"有 thumb"这条判据失真）
  })

  it('已经有 thumb ⇒ 直接跳过（不重复解码）', async () => {
    const platform = createMemoryPlatform()
    const ok = await ensureAssetThumb(platform, { id: 'h1', thumb: new Uint8Array([9]) }, new Blob([]))
    expect(ok).toBe(false)
  })
})
