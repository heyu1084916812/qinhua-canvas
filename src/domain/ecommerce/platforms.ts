/**
 * 电商平台规则库（对账 #381 / #384 的 D2）。
 *
 * ## 先说清楚这份数据的**性质**
 *
 * 这不是平台官方规则，而是**通用建议**：每条都带 `updatedAt` 与 `sourceNote`，
 * 界面上必须让它看得见"这是什么时候写的、依据是什么"。
 *
 * 为什么不做成"每个平台一份 skill 文件"：28 个平台就是 28 份要跟的提示词，
 * 平台改版谁也追不上（《轻画-方向调研与可行性判断.md》§4.1 的结论）。
 * 正确形态是**一份技能 + 一份结构化规则数据**，生成时拼进提示词。
 *
 * 也**不许**写"符合平台审核规范"这类承诺：没有官方规则源，写了就是假承诺。
 */
import type { EcommerceLanguage } from './types'

export type EcommercePlatformGroup = 'cross-border' | 'china'

export interface EcommercePlatform {
  id: string
  name: string
  group: EcommercePlatformGroup
  /** 主图常见比例（表单会把它排在前面，但不禁用别的档） */
  ratios: readonly string[]
  /** 常用文案语言 */
  languages: readonly EcommerceLanguage[]
  /** 张数建议（**建议**，不是硬规则） */
  countHint: string
  /** 规则正文：会被拼进提示词，所以写成给模型看的短句 */
  rules: string
  /** 这一条最后一次核对的时间（ISO 日期） */
  updatedAt: string
  /** 依据：官方页面 / 商家帮助中心 / 还是"通用建议" */
  sourceNote: string
}

/** 未核实的一律用这句话 —— 界面与提示词里都不许把它说成官方规则 */
export const GENERIC_SOURCE = '通用建议：未核实官方规则，按常见做法整理'

function platformEntry(input: {
  id: string
  name: string
  group: EcommercePlatformGroup
  ratios?: readonly string[]
  languages?: readonly EcommerceLanguage[]
  countHint?: string
  rules?: string
}): EcommercePlatform {
  return {
    id: input.id,
    name: input.name,
    group: input.group,
    ratios: input.ratios ?? ['1:1', '3:4'],
    languages: input.languages ?? ['zh-CN', 'en'],
    countHint: input.countHint ?? '主图 1 张；套图常见 5-9 张',
    rules:
      input.rules ??
      '以商品图为主体，版式、文字比例和卖点表达跟随站点常见做法；具体规范以商家后台为准。',
    updatedAt: '2026-10-20',
    sourceNote: GENERIC_SOURCE,
  }
}

/** 下拉显示顺序按用户参考图固定 */
export const ECOMMERCE_PLATFORM_ORDER: readonly string[] = [
  'amazon',
  'taobao',
  '1688',
  'temu',
  'tiktok-shop',
  'pinduoduo',
  'douyin',
  'ozon',
  'independent',
  'shopee',
  'alibaba',
  'aliexpress',
  'shein',
  'jd',
  'mercadolibre',
  'coupang',
  'wayfair',
  'lazada',
  'ebay',
]

export const ECOMMERCE_PLATFORMS: readonly EcommercePlatform[] = [
  {
    id: 'amazon',
    name: '亚马逊',
    group: 'cross-border',
    ratios: ['1:1', '3:4', '16:9'],
    languages: ['en', 'de', 'es', 'ja'],
    countHint: '主图 1 张；套图常见 6–8 张',
    rules:
      '主图常见要求：纯白背景、产品占画面主体、不叠加促销文字；副图可含场景与细节；文案语言跟随站点。',
    updatedAt: '2026-10-09',
    sourceNote: GENERIC_SOURCE,
  },
  {
    id: 'temu',
    name: 'Temu',
    group: 'cross-border',
    ratios: ['1:1', '3:4'],
    languages: ['en', 'de', 'es', 'ru'],
    countHint: '主图 1 张；详情常 5–8 张',
    rules:
      '主图常见要求：干净背景、突出产品本身；详情图强调卖点分点表达；避免直接搬运别家素材。',
    updatedAt: '2026-10-09',
    sourceNote: GENERIC_SOURCE,
  },
  {
    id: 'shopee',
    name: 'Shopee',
    group: 'cross-border',
    ratios: ['1:1', '3:4'],
    languages: ['en', 'zh-CN'],
    countHint: '主图 1 张；套图常见 5–9 张',
    rules:
      '主图常见要求：方形、背景简洁；东南亚站点可用浅色底 + 价格/优惠信息的**样式参考**，但不写具体促销数字。',
    updatedAt: '2026-10-09',
    sourceNote: GENERIC_SOURCE,
  },
  {
    id: '1688',
    name: '1688',
    group: 'china',
    ratios: ['1:1', '3:4'],
    languages: ['zh-CN'],
    countHint: '主图 1 张；详情常 5–10 张',
    rules:
      '主图常见要求：白底或浅底、产品清晰；详情页偏"批发/供货"信息表达（起订量、规格、材质），不编造资质。',
    updatedAt: '2026-10-09',
    sourceNote: GENERIC_SOURCE,
  },
  {
    id: 'taobao',
    name: '淘宝天猫',
    group: 'china',
    ratios: ['1:1', '3:4'],
    languages: ['zh-CN'],
    countHint: '主图 1 张；详情常 6–12 张',
    rules:
      '主图常见要求：产品或使用场景为主体、避免大面积文字堆叠；详情页常用"痛点 → 卖点 → 参数 → 场景"的顺序。',
    updatedAt: '2026-10-09',
    sourceNote: GENERIC_SOURCE,
  },
  {
    id: 'jd',
    name: '京东',
    group: 'china',
    ratios: ['1:1', '3:4'],
    languages: ['zh-CN'],
    countHint: '主图 1 张；详情常 6–12 张',
    rules:
      '主图常见要求：白底、产品居中、无夸大促销；详情页强调参数与售后信息，参数必须来自用户提供，不许编造。',
    updatedAt: '2026-10-09',
    sourceNote: GENERIC_SOURCE,
  },
  platformEntry({
    id: 'tiktok-shop',
    name: 'TikTok Shop',
    group: 'cross-border',
    languages: ['en', 'zh-CN', 'ja', 'es', 'th', 'ms'],
  }),
  platformEntry({
    id: 'pinduoduo',
    name: '拼多多',
    group: 'china',
    languages: ['zh-CN'],
  }),
  platformEntry({
    id: 'douyin',
    name: '抖音电商',
    group: 'china',
    languages: ['zh-CN'],
  }),
  platformEntry({
    id: 'ozon',
    name: 'OZON',
    group: 'cross-border',
    languages: ['ru', 'en'],
  }),
  platformEntry({
    id: 'independent',
    name: '独立站',
    group: 'cross-border',
    ratios: ['1:1', '4:3', '16:9', '9:16'],
    languages: ['en', 'zh-CN', 'de', 'fr', 'es', 'pt'],
  }),
  platformEntry({
    id: 'alibaba',
    name: '阿里国际站',
    group: 'cross-border',
    languages: ['en', 'zh-CN', 'es', 'ru'],
  }),
  platformEntry({
    id: 'aliexpress',
    name: '速卖通',
    group: 'cross-border',
    languages: ['en', 'zh-CN', 'ru', 'es', 'pt'],
  }),
  platformEntry({
    id: 'shein',
    name: 'SHEIN',
    group: 'cross-border',
    languages: ['en', 'zh-CN', 'es', 'de', 'fr'],
  }),
  platformEntry({
    id: 'mercadolibre',
    name: '美客多',
    group: 'cross-border',
    languages: ['es', 'pt'],
  }),
  platformEntry({
    id: 'coupang',
    name: 'Coupang',
    group: 'cross-border',
    languages: ['ko', 'en'],
  }),
  platformEntry({
    id: 'wayfair',
    name: 'Wayfair',
    group: 'cross-border',
    ratios: ['1:1', '4:3', '16:9'],
    languages: ['en'],
  }),
  platformEntry({
    id: 'lazada',
    name: 'Lazada',
    group: 'cross-border',
    languages: ['en', 'zh-CN', 'th', 'ms'],
  }),
  platformEntry({
    id: 'ebay',
    name: 'eBay',
    group: 'cross-border',
    languages: ['en', 'de', 'es'],
  }),
]

/** 按 id 取平台；找不到返回 null（白底图不选平台是合法输入，不要在这里抛） */
export function platformById(
  id: string | undefined | null,
  list: readonly EcommercePlatform[] = ECOMMERCE_PLATFORMS,
): EcommercePlatform | null {
  if (!id) return null
  return list.find((p) => p.id === id) ?? null
}

export function platformLabel(id: string | undefined | null): string {
  return platformById(id)?.name ?? '未指定平台'
}

/**
 * 拼进提示词的那一句平台摘要。
 *
 * 没有平台（白底图）时不编一个 —— 如实写"未指定平台"，
 * 并说明按通用电商图要求出图。
 */
export function platformRuleSummary(platform: EcommercePlatform | null): string {
  if (!platform) return '未指定平台（按通用电商图要求处理）'
  return `${platform.name}：${platform.rules}（规则来源：${platform.sourceNote}，更新于 ${platform.updatedAt}）`
}
