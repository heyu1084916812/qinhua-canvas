export interface HsvColor {
  h: number
  s: number
  v: number
}

/** 3 位或 6 位 HEX 统一成小写 6 位；非法值返回 null。 */
export function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const raw = value.trim().replace(/^#/, '')
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) return null
  const expanded =
    raw.length === 3
      ? raw
          .split('')
          .map((part) => `${part}${part}`)
          .join('')
      : raw
  return `#${expanded.toLowerCase()}`
}

export function hexToHsv(value: string): HsvColor {
  const hex = normalizeHex(value) ?? '#000000'
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min
  let h = 0

  if (delta > 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = (b - r) / delta + 2
    else h = (r - g) / delta + 4
    h *= 60
    if (h < 0) h += 360
  }

  return {
    h,
    s: max === 0 ? 0 : delta / max,
    v: max,
  }
}

export function hsvToHex({ h, s, v }: HsvColor): string {
  const hue = ((h % 360) + 360) % 360
  const saturation = Math.min(1, Math.max(0, s))
  const brightness = Math.min(1, Math.max(0, v))
  const chroma = brightness * saturation
  const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1))
  const m = brightness - chroma
  const [r, g, b] =
    hue < 60
      ? [chroma, x, 0]
      : hue < 120
        ? [x, chroma, 0]
        : hue < 180
          ? [0, chroma, x]
          : hue < 240
            ? [0, x, chroma]
            : hue < 300
              ? [x, 0, chroma]
              : [chroma, 0, x]
  const channel = (part: number) =>
    Math.round((part + m) * 255)
      .toString(16)
      .padStart(2, '0')
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** 在色块上放文字时，按相对亮度选深色或浅色前景。 */
export function readableTextColor(value: string): '#ffffff' | '#171717' {
  const hex = normalizeHex(value) ?? '#000000'
  const channel = (start: number) => {
    const part = Number.parseInt(hex.slice(start, start + 2), 16) / 255
    return part <= 0.04045 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return luminance > 0.179 ? '#171717' : '#ffffff'
}

export const HUE_GRADIENT =
  'linear-gradient(90deg, #ff0000 0%, #ffff00 16.66%, #00ff00 33.33%, #00ffff 50%, #0000ff 66.66%, #ff00ff 83.33%, #ff0000 100%)'
