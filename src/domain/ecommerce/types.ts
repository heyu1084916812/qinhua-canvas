/**
 * 电商工作台（A 版）的请求契约（对账 #384 / #380a）。
 *
 * 纯数据、无 React、无 IO —— 表单收集到的就是这一份，提示词拼装与张数计算都吃它。
 * 素材**传节点 id 不传文件对象**：视图不拥有素材，素材属于画布
 * （上传动作仍走既有的 `importAssetFile` + `createAssetNode`）。
 */

import type { EcommerceUpscaleScale } from './upscale'

/**
 * 用途：主图 / 白底图 / 详情页 / 套图 / 爆款复刻 / 结果图定向编辑。
 *
 * `edit` 是**结果卡上的后续动作**，不是新建任务表单里的第六个用途：
 * 它必须有一张现成结果作为上游，且每次只改一张。表单可选用途见
 * `ECOMMERCE_FORM_USAGES`。
 */
export type EcommerceUsage = 'main' | 'white-bg' | 'detail' | 'set' | 'recreate' | 'edit'

/** 文案语言：覆盖当前电商工作台出现的全部语言 */
export type EcommerceLanguage =
  | 'zh-CN'
  | 'en'
  | 'ru'
  | 'ja'
  | 'ko'
  | 'de'
  | 'fr'
  | 'es'
  | 'pt'
  | 'th'
  | 'ms'
  | 'ar'

export type EcommerceModeOptionValue =
  | string
  | string[]
  | Record<string, number>

export type EcommerceModeOptions = Record<string, EcommerceModeOptionValue>

export interface EcommerceRequest {
  /** 这次生产图片还是视频；历史任务缺省按图片处理 */
  mediaKind?: 'image' | 'video'
  /** 当前工作台功能名（用于历史与原样回填，不参与提示词白名单判断） */
  modeLabel?: string
  /** 功能自带的约束，与用户手写 note 分开保存，避免回填时重复。 */
  modePrompt?: string
  /** 当前功能专属参数；值使用稳定 id，展示文案可随时替换。 */
  modeOptions?: EcommerceModeOptions
  usage: EcommerceUsage
  /** 平台 id，来自 platforms.ts；做白底图时可以不选（白底是通用要求） */
  platformId?: string
  language: EcommerceLanguage
  /** 生成张数：主图 1 张 / 详情页 N 张 / 套图 8 张（默认值见 plan.ts） */
  count: number
  /** 比例：'1:1' | '3:4' | '4:3' | '16:9' | '9:16' */
  ratio: string
  /**
   * 图片清晰度档位：自动 / 512 / 1K / 2K / 3K / 4K，或模型支持的像素尺寸。
   * 空串 / 'auto' = 不向渠道指定。
   */
  resolution?: string
  /** GPT Image 等模型的质量档位；空串 / 'auto' = 不向渠道指定。 */
  quality?: string
  /** 产品图：走节点 id（与画布同源） */
  productNodeId: string
  /** 多角度产品图；`productNodeId` 仍是第一张。旧任务可缺省。 */
  productNodeIds?: string[]
  /** 参考图：0..N 张 */
  referenceNodeIds: string[]
  /** 用户自由补充的一句需求（可空） */
  note?: string
  /**
   * 出图模型（前端显示名；用户 2026-10-10：「电商出图左边的参数栏没有模型相关的参数选择」）。
   *
   * **空 = 走默认**：由 `channels.defaultForNewNode` 解析出来的那一个。
   * 渠道不在这里选 —— 与画布同一条口径：由选路按"谁提供这个模型"决定
   *（见 `domain/project/modelRouting.ts`）。
   */
  model?: string
  /** 实际解析并发送给渠道的上游模型 / 渠道；用于任务追溯，不回填表单。 */
  resolvedModel?: string
  resolvedChannelId?: string
  /** AI 超清等专项结果操作使用固定渠道，避免只换模型却还落在原渠道 */
  channelId?: string
  /** Topaz 超分放大倍数；只有 AI 超清动作会写 */
  scale?: EcommerceUpscaleScale
  /** 视频生成时长；只在 mediaKind='video' 时使用 */
  durationSec?: number
}

/** 新建电商任务时可选的用途；刻意不包含 `edit`。 */
export const ECOMMERCE_FORM_USAGES: readonly EcommerceUsage[] = [
  'main',
  'white-bg',
  'detail',
  'set',
  'recreate',
]
/** 整个电商领域认识的用途；包含结果卡后续动作 `edit`。 */
export const ECOMMERCE_USAGES: readonly EcommerceUsage[] = [...ECOMMERCE_FORM_USAGES, 'edit']
export const ECOMMERCE_LANGUAGES: readonly EcommerceLanguage[] = [
  'en',
  'zh-CN',
  'ja',
  'ko',
  'es',
  'ru',
  'de',
  'fr',
  'pt',
  'th',
  'ms',
  'ar',
]

/** 商品套图使用的语言与顺序，按用户参考图固定 */
export const ECOMMERCE_SET_LANGUAGES: readonly EcommerceLanguage[] = [
  'en',
  'zh-CN',
  'ja',
  'ko',
  'es',
  'ru',
  'th',
  'ms',
]

/** 爆款复刻使用的语言与顺序，按用户参考图固定 */
export const ECOMMERCE_RECREATE_LANGUAGES: readonly EcommerceLanguage[] = [
  'en',
  'zh-CN',
  'ja',
  'ko',
  'ru',
  'de',
  'fr',
  'es',
  'pt',
  'th',
  'ms',
]

/** A+ 详情页的版面类型与普通比例共用同一个字段 */
export const ECOMMERCE_A_PLUS_RATIOS: readonly string[] = [
  'aplus-premium-web',
  'aplus-premium-mobile',
  'aplus-standard',
  '1:1',
  '4:3',
  '16:9',
  '9:16',
]

/** 真正可以发给图片模型的宽高比 */
export const ECOMMERCE_BASE_RATIOS: readonly string[] = ['1:1', '3:4', '4:3', '16:9', '9:16']

/** 通用比例档（平台的 ratios 是它的子集；表单在没选平台时用这一份） */
export const ECOMMERCE_RATIOS: readonly string[] = [
  ...ECOMMERCE_BASE_RATIOS,
  ...ECOMMERCE_A_PLUS_RATIOS.filter((ratio) => !ECOMMERCE_BASE_RATIOS.includes(ratio)),
]

/** 张数上限：一次请求最多 12 张（再多就不该走这个表单，该走批量节点） */
export const ECOMMERCE_COUNT_MAX = 12

export function usageLabel(usage: EcommerceUsage): string {
  return usage === 'main'
    ? '主图'
    : usage === 'white-bg'
      ? '白底图'
      : usage === 'detail'
        ? '详情页'
        : usage === 'set'
          ? '套图'
          : usage === 'recreate'
            ? '爆款复刻'
            : 'AI 编辑'
}

export function languageLabel(language: EcommerceLanguage): string {
  const map: Record<EcommerceLanguage, string> = {
    'zh-CN': '中文简体',
    en: 'English',
    ru: 'Русский',
    ja: '日本語',
    ko: '한국어',
    de: 'Deutsch',
    fr: 'Français',
    es: 'Español',
    pt: 'Português',
    th: 'ไทย',
    ms: 'Bahasa Melayu',
    ar: 'العربية',
  }
  return map[language]
}

export function ecommerceLanguagesFor(usage: EcommerceUsage): readonly EcommerceLanguage[] {
  if (usage === 'set') return ECOMMERCE_SET_LANGUAGES
  if (usage === 'recreate') return ECOMMERCE_RECREATE_LANGUAGES
  return ECOMMERCE_LANGUAGES
}

export function ecommerceLanguageOptionLabel(
  language: EcommerceLanguage,
  usage: EcommerceUsage,
): string {
  if (usage !== 'set' && usage !== 'recreate') return languageLabel(language)
  const labels: Partial<Record<EcommerceLanguage, string>> = {
    en: '英文',
    'zh-CN': '中文',
    ja: '日文',
    ko: '韩文',
    es: usage === 'set' ? '西班牙文' : '西班牙语',
    ru: '俄语',
    de: '德语',
    fr: '法语',
    pt: '葡萄牙语',
    th: '泰语',
    ms: '马来语',
  }
  return labels[language] ?? languageLabel(language)
}

export function ecommerceLanguageOptions(usage: EcommerceUsage): Array<{
  value: EcommerceLanguage
  label: string
}> {
  return ecommerceLanguagesFor(usage).map((language) => ({
    value: language,
    label: ecommerceLanguageOptionLabel(language, usage),
  }))
}

export function ecommerceRatioOptions(
  usage: EcommerceUsage,
  mediaKind: 'image' | 'video' = 'image',
): Array<{
  value: string
  label: string
}> {
  const values =
    mediaKind === 'video'
      ? ['9:16', '16:9', '1:1']
      : usage === 'detail'
      ? ECOMMERCE_A_PLUS_RATIOS
      : ECOMMERCE_BASE_RATIOS
  return values.map((value) => ({ value, label: ecommerceRatioLabel(value) }))
}

export function ecommerceRatioLabel(ratio: string): string {
  if (ratio === 'aplus-premium-web') return '高级A+（Web端）'
  if (ratio === 'aplus-premium-mobile') return '高级A+（移动端）'
  if (ratio === 'aplus-standard') return '普通A+'
  return ratio
}

/** A+ 版面需要落到模型能理解的宽高比；普通比例原样返回 */
export function ecommerceAspectRatio(ratio: string): string {
  if (ratio === 'aplus-premium-web') return '16:9'
  if (ratio === 'aplus-premium-mobile') return '9:16'
  if (ratio === 'aplus-standard') return '4:3'
  return ratio
}
