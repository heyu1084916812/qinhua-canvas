import type { AssetKind } from './assetLibrary'

export const PALETTE_UNAVAILABLE = '暂不可用'

export interface PalettePixels {
  data: Uint8ClampedArray
  width: number
  height: number
}

export type PaletteDecoder = (url: string) => Promise<PalettePixels>

/**
 * 从像素里提取一组稳定的主色。
 *
 * 这里不追求色彩科学上的精确聚类，只需要给用户一眼能认出画面的配色。
 * 因而采用固定分桶计数，而不是逐像素唯一色统计：照片里轻微渐变的几万种
 * 近似颜色会互相稀释，最后反而看不出真正的画面主色。
 */
export function paletteFromPixels(data: Uint8ClampedArray): string[] {
  if (data.length < 4) return []
  const pixelCount = Math.floor(data.length / 4)
  const step = Math.max(1, Math.floor(pixelCount / 8192))
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()

  for (let pixel = 0; pixel < pixelCount; pixel += step) {
    const i = pixel * 4
    const alpha = data[i + 3] ?? 255
    if (alpha < 160) continue
    const r = data[i] ?? 0
    const g = data[i + 1] ?? 0
    const b = data[i + 2] ?? 0
    const qr = r >> 5
    const qg = g >> 5
    const qb = b >> 5
    const key = (qr << 10) | (qg << 5) | qb
    const found = buckets.get(key)
    if (found) {
      found.count += 1
      found.r += r
      found.g += g
      found.b += b
    } else {
      buckets.set(key, { count: 1, r, g, b })
    }
  }

  return [...buckets.values()]
    .sort((a, b) => b.count - a.count || colorDistance(b) - colorDistance(a))
    .slice(0, 5)
    .map((bucket) =>
      rgbToHex(
        Math.round(bucket.r / bucket.count),
        Math.round(bucket.g / bucket.count),
        Math.round(bucket.b / bucket.count),
      ),
    )
}

export async function extractPaletteFromUrl(
  url: string | null | undefined,
  decoder: PaletteDecoder = decodeWithBrowser,
): Promise<string[]> {
  if (!url) return []
  try {
    const pixels = await decoder(url)
    if (!pixels.width || !pixels.height) return []
    return paletteFromPixels(pixels.data)
  } catch {
    return []
  }
}

export function paletteTextFor(kind: AssetKind, colors: readonly string[]): string {
  if (kind === 'video') return PALETTE_UNAVAILABLE
  return colors.length > 0 ? colors.join(' / ') : PALETTE_UNAVAILABLE
}

async function decodeWithBrowser(url: string): Promise<PalettePixels> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('当前环境不支持图片解码')
  }
  const img = new Image()
  img.decoding = 'async'
  img.src = url
  if (typeof img.decode === 'function') {
    await img.decode()
  } else {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('图片解码失败'))
    })
  }
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建取色画布')
  ctx.drawImage(img, 0, 0)
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return { data: imageData.data, width: canvas.width, height: canvas.height }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function toHex(value: number): string {
  const v = Math.max(0, Math.min(255, value))
  return v.toString(16).padStart(2, '0')
}

function colorDistance(color: { r: number; g: number; b: number; count: number }): number {
  const r = color.r / color.count
  const g = color.g / color.count
  const b = color.b / color.count
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max - min
}
