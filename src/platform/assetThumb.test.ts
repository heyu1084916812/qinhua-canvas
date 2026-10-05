import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from './memory/index'
import { ensureAssetThumb, makeThumbBytes, thumbPlan } from './assetThumb'
import { backfillAssetThumbs, needsThumb, thumbBytesOf } from './assetThumb'

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

describe('needsThumb：哪一行该补', () => {
  it('★ 三种"不补"：已经有 thumb / 不是图 / 没有本地字节（只有远端地址）', () => {
    expect(needsThumb({ id: 'a', mime: 'image/png', bytes: new Uint8Array([1]) })).toBe(true)
    expect(
      needsThumb({ id: 'b', mime: 'image/png', bytes: new Uint8Array([1]), thumb: new Uint8Array([9]) }),
    ).toBe(false)
    expect(needsThumb({ id: 'c', mime: 'video/mp4', bytes: new Uint8Array([1]) })).toBe(false)
    expect(needsThumb({ id: 'd', mime: 'image/png', url: 'https://example.com/a.png' })).toBe(false)
  })
})

/**
 * 存量素材的**一次性补图**（对账 #232）。
 * 单测环境造不出缩略图（没有 `createImageBitmap`），所以这里钉的是**扫描与护栏**：
 * 扫的是整表、进度按行报、能中断、以及"造不出来时绝不写半成品"。
 * 真正生成的那一半由真机探针量（`probe-thumb-backfill.mjs`）。
 */
describe('backfillAssetThumbs：存量补图', () => {
  const makePlatform = () =>
    createMemoryPlatform({
      rows: {
        assets: [
          { id: 'big', mime: 'image/png', bytes: new Uint8Array([1]) },
          { id: 'has', mime: 'image/png', bytes: new Uint8Array([2]), thumb: new Uint8Array([9]) },
          { id: 'vid', mime: 'video/mp4', url: 'https://example.com/v.mp4' },
        ],
      },
    })

  it('扫的是**整表**（跳过的那几种也算扫过），进度按行报到最后', async () => {
    const platform = makePlatform()
    const seen: string[] = []
    const result = await backfillAssetThumbs(platform, { onProgress: (done, total) => seen.push(`${done}/${total}`) })
    expect(result.scanned).toBe(3)
    expect(result.aborted).toBe(false)
    expect(seen.at(-1)).toBe('3/3')
  })

  it('★ 环境造不出缩略图 ⇒ generated = 0，且**不许写半成品**（只有原本就有的那行带 thumb）', async () => {
    const platform = makePlatform()
    const result = await backfillAssetThumbs(platform)
    expect(result.generated).toBe(0)
    const rows = await platform.storage.query('assets', {})
    const withThumb = rows.filter((r) => (r as { thumb?: unknown }).thumb !== undefined).map((r) => r.id)
    expect(withThumb).toEqual(['has'])
  })

  it('★ 可中断：一开始就 abort ⇒ aborted=true 且一行都不处理（别在用户进画布时抢活）', async () => {
    const platform = makePlatform()
    const controller = new AbortController()
    controller.abort()
    const result = await backfillAssetThumbs(platform, { signal: controller.signal })
    expect(result.aborted).toBe(true)
    expect(result.scanned).toBe(0)
  })
})
/**
 * ★★ `thumbBytesOf`：**认不出来的 thumb 一律当作没有**（对账 #234）。
 *
 * 这条防的是"看着有、其实是空的"：被 `JSON.stringify` 过的缩略图是个普通对象
 * （`{"0":82,…}`），若照着 `new Uint8Array(obj)` 去读就得到**空数组** ⇒ 节点显示 0 字节的破图。
 * 宁可当作"没有缩略图"（继续用原图，并把坏的那份重生成）。
 */
describe('thumbBytesOf：只认真字节', () => {
  it('三种真形态都认；空的（长度 0）等于没有', () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(thumbBytesOf(bytes)).toBe(bytes)
    expect(Array.from(thumbBytesOf(new Uint8Array([1, 2]).buffer)!)).toEqual([1, 2])
    expect(Array.from(thumbBytesOf([1, 2, 3])!)).toEqual([1, 2, 3])
    expect(thumbBytesOf(new Uint8Array(0))).toBeNull()
    expect(thumbBytesOf(new ArrayBuffer(0))).toBeNull()
    expect(thumbBytesOf([])).toBeNull()
  })

  it('★ 被 JSON 化过的缩略图（普通对象）⇒ null，**不是**空数组', () => {
    expect(thumbBytesOf({ 0: 82, 1: 73 })).toBeNull()
    expect(thumbBytesOf(undefined)).toBeNull()
    expect(thumbBytesOf(null)).toBeNull()
    expect(thumbBytesOf('RIFF')).toBeNull()
  })

  it('★ 坏 thumb 会被判成"该补" ⇒ 补图逻辑重新生成并覆盖（自愈）', () => {
    expect(needsThumb({ id: 'a', mime: 'image/png', bytes: new Uint8Array([1]), thumb: { 0: 82 } })).toBe(true)
  })
})
