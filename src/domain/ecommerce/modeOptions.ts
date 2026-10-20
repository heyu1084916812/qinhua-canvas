import type { EcommerceModeOptions } from './types'

export interface EcommerceOption {
  id: string
  label: string
}

export const PRODUCT_SET_COUNT_OPTIONS: readonly EcommerceOption[] = [
  { id: 'whiteBg', label: '白底图' },
  { id: 'scene', label: '场景图' },
  { id: 'sellingPoint', label: '卖点图' },
  { id: 'detail', label: '细节图' },
  { id: 'other', label: '其他图' },
]

export const DETAIL_HIGHLIGHT_OPTIONS: readonly EcommerceOption[] = [
  { id: 'hero', label: '首屏主视觉' },
  { id: 'coreSelling', label: '核心卖点图' },
  { id: 'usageScene', label: '使用场景图' },
  { id: 'multiAngle', label: '多角度图' },
  { id: 'brandStory', label: '品牌故事图' },
  { id: 'comparison', label: '效果对比图' },
  { id: 'craft', label: '工艺制作图' },
  { id: 'sizeChart', label: '尺寸尺码图' },
  { id: 'specTable', label: '规格参数表' },
  { id: 'accessories', label: '配件/赠品图' },
  { id: 'series', label: '系列展示图' },
  { id: 'ingredients', label: '商品成分图' },
  { id: 'warranty', label: '售后保障图' },
  { id: 'usageGuide', label: '使用建议图' },
]

export const RETOUCH_OPTIONS: readonly EcommerceOption[] = [
  { id: 'gloss', label: '增强产品光泽' },
  { id: 'repair', label: '修复瑕疵' },
  { id: 'clarity', label: '提升清晰度' },
  { id: 'color', label: '色彩校正' },
  { id: 'perspective', label: '修正透视变形' },
]

export const VIDEO_TYPE_OPTIONS: readonly EcommerceOption[] = [
  { id: 'ugc', label: 'UGC 种草' },
  { id: 'demo', label: '产品演示' },
  { id: 'reaction', label: '反应展示' },
  { id: 'drama', label: '带货短剧' },
  { id: 'tvc', label: 'TVC 广告' },
  { id: 'painPoint', label: '痛点解决' },
  { id: 'unboxing', label: '开箱种草' },
  { id: 'voiceover', label: '产品口播' },
]

export const WEAR_TYPE_OPTIONS: readonly EcommerceOption[] = [
  { id: 'whiteRetouch', label: '白底精修图' },
  { id: 'threeD', label: '3D 立体效果图' },
  { id: 'mannequin', label: '人台图' },
  { id: 'detail', label: '细节特写图' },
  { id: 'sellingPoint', label: '卖点图' },
]

export const WEAR_DETAIL_OPTIONS: readonly EcommerceOption[] = [
  { id: 'collar', label: '领口' },
  { id: 'cuff', label: '袖口' },
  { id: 'stitching', label: '走线' },
  { id: 'fabric', label: '面料' },
  { id: 'silhouette', label: '版型' },
]

export const GENDER_OPTIONS: readonly EcommerceOption[] = [
  { id: 'female', label: '女性' },
  { id: 'male', label: '男性' },
  { id: 'unisex', label: '中性' },
]

export const AGE_OPTIONS: readonly EcommerceOption[] = [
  { id: 'child', label: '儿童' },
  { id: 'young', label: '青年' },
  { id: 'middle', label: '中年' },
  { id: 'senior', label: '老年' },
]

export const ETHNICITY_OPTIONS: readonly EcommerceOption[] = [
  { id: 'asian', label: '亚洲人' },
  { id: 'white', label: '欧美白人' },
  { id: 'black', label: '非裔' },
  { id: 'latin', label: '拉丁裔' },
]

export const BODY_OPTIONS: readonly EcommerceOption[] = [
  { id: 'slim', label: '纤细' },
  { id: 'standard', label: '标准' },
  { id: 'curvy', label: '丰满' },
  { id: 'muscular', label: '肌肉型' },
]

const DEFAULT_SET_COUNTS: Record<string, number> = {
  whiteBg: 1,
  scene: 1,
  sellingPoint: 2,
  detail: 2,
  other: 0,
}

const DEFAULT_PERSON: EcommerceModeOptions = {
  modelSource: 'ai',
  modelGender: 'female',
  modelAge: 'young',
  modelEthnicity: 'asian',
  modelBody: 'standard',
  modelDetails: '',
}

export function defaultEcommerceModeOptions(modeId: string): EcommerceModeOptions {
  if (modeId === 'product-set') {
    return { setStrategy: 'smart', setCounts: { ...DEFAULT_SET_COUNTS } }
  }
  if (modeId === 'product-detail') {
    return { detailHighlights: ['hero', 'coreSelling', 'usageScene', 'multiAngle'] }
  }
  if (modeId === 'product-recreate') return { recreateLevel: 'style' }
  if (modeId === 'product-white') return { whiteStyle: 'standard' }
  if (modeId === 'product-retouch') return { retouchActions: ['gloss', 'repair', 'clarity'] }
  if (modeId === 'product-recolor') {
    return { targetColor: '#ff6b00', colorTolerance: '60' }
  }
  if (modeId === 'video-recreate') {
    return { ...DEFAULT_PERSON, videoReplicateMode: 'full' }
  }
  if (modeId === 'video-commerce') {
    return { ...DEFAULT_PERSON, videoTypes: ['ugc'] }
  }
  if (modeId === 'wear-set') {
    return {
      wearTypes: ['whiteRetouch', 'threeD', 'mannequin'],
      wearSide: 'front',
    }
  }
  if (modeId === 'wear-model') return { ...DEFAULT_PERSON }
  if (modeId === 'wear-tryon') {
    return { ...DEFAULT_PERSON, personPreserve: 'high', outfitPreserve: 'on' }
  }
  if (modeId === 'wear-detail') {
    return { wearDetails: ['collar', 'cuff', 'stitching', 'fabric'] }
  }
  return {}
}

function normalizedString(value: unknown, max = 180): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function normalizedStringArray(value: unknown, maxItems = 20): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((item) => normalizedString(item, 80))
        .filter(Boolean),
    ),
  ].slice(0, maxItems)
}

function normalizedCountMap(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, number> = {}
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 20)) {
    const key = normalizedString(rawKey, 40)
    if (!key || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue
    out[key] = Math.min(Math.max(Math.round(rawValue), 0), 20)
  }
  return out
}

export function normalizeEcommerceModeOptions(value: unknown): EcommerceModeOptions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: EcommerceModeOptions = {}
  for (const [rawKey, rawValue] of Object.entries(value).slice(0, 24)) {
    const key = normalizedString(rawKey, 48)
    if (!key) continue
    if (typeof rawValue === 'string') {
      const text = normalizedString(rawValue)
      if (text) out[key] = text
      continue
    }
    if (Array.isArray(rawValue)) {
      const items = normalizedStringArray(rawValue)
      if (items.length > 0) out[key] = items
      continue
    }
    const counts = normalizedCountMap(rawValue)
    if (Object.keys(counts).length > 0) out[key] = counts
  }
  return out
}

export function modeOptionString(
  options: EcommerceModeOptions,
  key: string,
  fallback = '',
): string {
  const value = options[key]
  return typeof value === 'string' ? value : fallback
}

export function modeOptionStrings(options: EcommerceModeOptions, key: string): string[] {
  const value = options[key]
  return Array.isArray(value) ? value : []
}

export function modeOptionCounts(
  options: EcommerceModeOptions,
  key = 'setCounts',
): Record<string, number> {
  const value = options[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {}
}

function labelOf(options: readonly EcommerceOption[], ids: readonly string[]): string[] {
  return ids
    .map((id) => options.find((item) => item.id === id)?.label)
    .filter((label): label is string => !!label)
}

export function ecommerceModeCount(
  modeId: string,
  fallback: number,
  options: EcommerceModeOptions,
): number {
  if (modeId !== 'product-set') return Math.min(Math.max(fallback, 1), 12)
  if (modeOptionString(options, 'setStrategy', 'smart') !== 'custom') return fallback
  const counts = modeOptionCounts(options)
  const total = PRODUCT_SET_COUNT_OPTIONS.reduce(
    (sum, option) => sum + Math.max(0, counts[option.id] ?? 0),
    0,
  )
  return Math.min(Math.max(total || 1, 1), 12)
}

export function buildEcommerceModeOptionsPrompt(
  modeId: string,
  options: EcommerceModeOptions,
): string {
  const lines: string[] = []
  if (modeId === 'product-set') {
    const strategy = modeOptionString(options, 'setStrategy', 'smart')
    lines.push(
      strategy === 'custom'
        ? '套图结构：自定义配置'
        : '套图结构：智能匹配，由当前商品自动选择适合的 Listing 结构',
    )
    if (strategy === 'custom') {
      const counts = modeOptionCounts(options)
      const summary = PRODUCT_SET_COUNT_OPTIONS.filter((item) => (counts[item.id] ?? 0) > 0)
        .map((item) => `${item.label}${counts[item.id]}张`)
        .join('、')
      if (summary) lines.push(`自定义各类型数量：${summary}`)
    }
  }
  if (modeId === 'product-detail') {
    const labels = labelOf(DETAIL_HIGHLIGHT_OPTIONS, modeOptionStrings(options, 'detailHighlights'))
    if (labels.length) lines.push(`详情页优先结构：${labels.join('、')}`)
  }
  if (modeId === 'product-recreate') {
    lines.push(
      `复刻程度：${modeOptionString(options, 'recreateLevel', 'style') === 'high' ? '高度复刻' : '参考风格'}`,
    )
  }
  if (modeId === 'product-white') {
    lines.push(
      `白底类型：${modeOptionString(options, 'whiteStyle', 'standard') === 'multi' ? '多角度白底' : '标准白底'}`,
    )
  }
  if (modeId === 'product-retouch') {
    const labels = labelOf(RETOUCH_OPTIONS, modeOptionStrings(options, 'retouchActions'))
    if (labels.length) lines.push(`精修方向：${labels.join('、')}`)
  }
  if (modeId === 'product-recolor') {
    lines.push(`目标颜色：${modeOptionString(options, 'targetColor', '#ff6b00')}`)
    lines.push(`颜色容差：${modeOptionString(options, 'colorTolerance', '60')}%`)
  }
  if (modeId === 'video-recreate') {
    lines.push(
      `视频复刻模式：${modeOptionString(options, 'videoReplicateMode', 'full') === 'similar' ? '相似复刻' : '完全复刻'}`,
    )
  }
  if (modeId === 'video-recreate' || modeId === 'video-commerce') {
    const region = modeOptionString(options, 'marketRegion', 'us')
    const regionLabel =
      { us: '美国', uk: '英国', eu: '欧洲', sea: '东南亚', me: '中东' }[region] ?? '美国'
    lines.push(`市场地区：${regionLabel}`)
  }
  if (modeId === 'video-commerce') {
    const labels = labelOf(VIDEO_TYPE_OPTIONS, modeOptionStrings(options, 'videoTypes'))
    if (labels.length) lines.push(`视频类型：${labels.join('、')}`)
  }
  if (modeId === 'wear-set') {
    const labels = labelOf(WEAR_TYPE_OPTIONS, modeOptionStrings(options, 'wearTypes'))
    if (labels.length) lines.push(`服装组图类型：${labels.join('、')}`)
    const side = modeOptionString(options, 'wearSide', 'front')
    lines.push(`展示面：${side === 'back' ? '背面' : side === 'both' ? '正面与背面' : '正面'}`)
  }
  if (modeId === 'wear-model' || modeId === 'wear-tryon' || modeId === 'video-recreate' || modeId === 'video-commerce') {
    lines.push(
      `模特来源：${modeOptionString(options, 'modelSource', 'ai') === 'upload' ? '用户上传参考' : 'AI 生成'}`,
    )
    lines.push(
      `模特：${[
        labelOf(GENDER_OPTIONS, [modeOptionString(options, 'modelGender', 'female')])[0],
        labelOf(AGE_OPTIONS, [modeOptionString(options, 'modelAge', 'young')])[0],
        labelOf(ETHNICITY_OPTIONS, [modeOptionString(options, 'modelEthnicity', 'asian')])[0],
        labelOf(BODY_OPTIONS, [modeOptionString(options, 'modelBody', 'standard')])[0],
      ]
        .filter(Boolean)
        .join(' / ')}`,
    )
    const details = modeOptionString(options, 'modelDetails')
    if (details) lines.push(`模特补充：${details}`)
  }
  if (modeId === 'wear-tryon') {
    lines.push(
      `人物保留：${modeOptionString(options, 'personPreserve', 'high') === 'strict' ? '严格保持' : '自然保持'}`,
    )
    lines.push(
      `服装版型保留：${modeOptionString(options, 'outfitPreserve', 'on') === 'off' ? '允许微调' : '严格保持'}`,
    )
  }
  if (modeId === 'wear-detail') {
    const labels = labelOf(WEAR_DETAIL_OPTIONS, modeOptionStrings(options, 'wearDetails'))
    if (labels.length) lines.push(`细节类型：${labels.join('、')}`)
  }
  return lines.join('\n')
}
