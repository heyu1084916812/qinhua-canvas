import { ECOMMERCE_COUNT_MAX, type EcommerceModeOptions } from './types'

export interface EcommerceOption {
  id: string
  label: string
  hint?: string
}

export const PRODUCT_SET_COUNT_OPTIONS: readonly EcommerceOption[] = [
  { id: 'whiteBg', label: '白底图', hint: '白底主体，多角度呈现商品细节' },
  { id: 'scene', label: '场景图', hint: '展示商品的生活使用场景和人物搭配' },
  { id: 'sellingPoint', label: '卖点图', hint: '展示商品的核心卖点及细节特征' },
  { id: 'detail', label: '细节图', hint: '突出材质、工艺和局部细节' },
  { id: 'other', label: '其他图', hint: '对比图、尺寸图等，根据商品智能匹配' },
]

export const DETAIL_HIGHLIGHT_OPTIONS: readonly EcommerceOption[] = [
  { id: 'hero', label: '首屏主视觉', hint: '传递核心价值' },
  { id: 'coreSelling', label: '核心卖点图', hint: '突出差异化优势' },
  { id: 'usageScene', label: '使用场景图', hint: '呈现真实使用场景' },
  { id: 'multiAngle', label: '多角度图', hint: '多角度呈现外观' },
  { id: 'brandStory', label: '品牌故事图', hint: '传递品牌价值' },
  { id: 'comparison', label: '效果对比图', hint: '直观展示使用差异' },
  { id: 'craft', label: '工艺制作图', hint: '展示制作过程' },
  { id: 'sizeChart', label: '尺寸尺码图', hint: '展示规格信息' },
  { id: 'specTable', label: '规格参数表', hint: '展示详细商品数据' },
  { id: 'accessories', label: '配件/赠品图', hint: '明确收货所有物品' },
  { id: 'series', label: '系列展示图', hint: '多色或多 SKU 展示' },
  { id: 'ingredients', label: '商品成分图', hint: '展示配方/材质/成分' },
  { id: 'warranty', label: '售后保障图', hint: '说明售后保障政策' },
  { id: 'usageGuide', label: '使用建议图', hint: '说明保养/使用建议' },
]

export const RETOUCH_OPTIONS: readonly EcommerceOption[] = [
  { id: 'gloss', label: '增强产品光泽' },
  { id: 'repair', label: '修复瑕疵' },
  { id: 'clarity', label: '提升清晰度' },
  { id: 'color', label: '色彩校正' },
  { id: 'perspective', label: '修正透视变形' },
]

export const VIDEO_TYPE_OPTIONS: readonly EcommerceOption[] = [
  { id: 'ugc', label: 'UGC 种草', hint: '用户真实分享体验' },
  { id: 'demo', label: '产品演示', hint: '多角度展示与使用演示' },
  { id: 'reaction', label: '反应展示', hint: '记录真实使用反馈' },
  { id: 'drama', label: '带货短剧', hint: '用剧情承载商品卖点' },
  { id: 'tvc', label: 'TVC 广告', hint: '品牌质感与产品大片' },
  { id: 'painPoint', label: '痛点解决', hint: '从问题切入展示方案' },
  { id: 'unboxing', label: '开箱种草', hint: '第一视角展示开箱体验' },
  { id: 'voiceover', label: '产品口播', hint: '人物讲解核心卖点' },
]

export const WEAR_TYPE_OPTIONS: readonly EcommerceOption[] = [
  { id: 'whiteRetouch', label: '白底精修图', hint: '纯白背景的产品精修展示图' },
  { id: 'threeD', label: '3D 立体效果图', hint: '具有立体感和层次感' },
  { id: 'mannequin', label: '人台图', hint: '使用人台展示服装效果' },
  { id: 'detail', label: '细节特写图', hint: '展示产品细节和材质' },
  { id: 'sellingPoint', label: '卖点图', hint: '突出核心卖点的营销图' },
]

export const WEAR_DETAIL_OPTIONS: readonly EcommerceOption[] = [
  { id: 'collar', label: '领口' },
  { id: 'cuff', label: '袖口' },
  { id: 'stitching', label: '走线' },
  { id: 'fabric', label: '面料' },
  { id: 'silhouette', label: '版型' },
]

export const WHITE_BG_ANGLE_OPTIONS: readonly EcommerceOption[] = [
  { id: 'front', label: '正面', hint: '产品正对镜头，完整展示正面结构与比例' },
  { id: 'left45', label: '左45°', hint: '向左转 45°，同时看到正面与左侧面' },
  { id: 'right45', label: '右45°', hint: '向右转 45°，同时看到正面与右侧面' },
  { id: 'side', label: '正侧面', hint: '90° 侧面，展示厚度、轮廓与侧面结构' },
  { id: 'back', label: '背面', hint: '完整背面，展示背部结构与材质' },
  { id: 'top', label: '俯视', hint: '自上而下俯拍，交代整体轮廓与顶部细节' },
  { id: 'bottom', label: '底部', hint: '底部视角，展示底面结构、接触面与材质' },
  { id: 'detail', label: '细节', hint: '贴近拍摄关键材质、工艺与结构细节' },
]

export const DEFAULT_WHITE_BG_COUNTS: Readonly<Record<string, number>> = { front: 1 }

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
  if (modeId === 'product-white') return { whiteBgCounts: { ...DEFAULT_WHITE_BG_COUNTS } }
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

export function whiteBgCountsOf(options: EcommerceModeOptions): Record<string, number> {
  const counts = modeOptionCounts(options, 'whiteBgCounts')
  if (Object.keys(counts).length > 0) return counts
  // 旧草稿的“多角度白底”没有逐角度数量；迁移成八个角度各 1 张，避免直接丢配置。
  if (modeOptionString(options, 'whiteStyle', 'standard') === 'multi') {
    return Object.fromEntries(WHITE_BG_ANGLE_OPTIONS.map((item) => [item.id, 1]))
  }
  return { ...DEFAULT_WHITE_BG_COUNTS }
}

export function batchWhiteOutputError(
  sourceCount: number,
  perSourceCount: number,
): string | null {
  if (sourceCount > 12) return '批量白底一次最多上传 12 张源图。'
  if (sourceCount > 0 && perSourceCount < 1) {
    return '批量白底每张源图至少要选择一个角度、生成 1 张。'
  }
  if (sourceCount * perSourceCount > 36) {
    return `批量白底最多 36 张输出：当前 ${sourceCount} 张源图 × 每张 ${perSourceCount} 张角度图。请减少源图或角度张数。`
  }
  return null
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
  if (modeId === 'product-white') {
    const total = WHITE_BG_ANGLE_OPTIONS.reduce(
      (sum, option) => sum + Math.max(0, whiteBgCountsOf(options)[option.id] ?? 0),
      0,
    )
    return Math.min(Math.max(total || 1, 1), ECOMMERCE_COUNT_MAX)
  }
  if (modeId !== 'product-set') {
    return Math.min(Math.max(fallback, 1), ECOMMERCE_COUNT_MAX)
  }
  if (modeOptionString(options, 'setStrategy', 'smart') !== 'custom') return fallback
  const counts = modeOptionCounts(options)
  const total = PRODUCT_SET_COUNT_OPTIONS.reduce(
    (sum, option) => sum + Math.max(0, counts[option.id] ?? 0),
    0,
  )
  return Math.min(Math.max(total || 1, 1), ECOMMERCE_COUNT_MAX)
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
    const counts = whiteBgCountsOf(options)
    const summary = WHITE_BG_ANGLE_OPTIONS.filter((item) => (counts[item.id] ?? 0) > 0)
      .map((item) => `${item.label}${counts[item.id]}张`)
      .join('、')
    lines.push(`白底角度：${summary || '正面1张'}`)
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
