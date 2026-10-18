/**
 * 电商工作台（A 版）的请求契约（对账 #384 / #380a）。
 *
 * 纯数据、无 React、无 IO —— 表单收集到的就是这一份，提示词拼装与张数计算都吃它。
 * 素材**传节点 id 不传文件对象**：视图不拥有素材，素材属于画布
 * （上传动作仍走既有的 `importAssetFile` + `createAssetNode`）。
 */

/** 用途：主图 / 白底图 / 详情页 / 套图 / 爆款复刻 */
export type EcommerceUsage = 'main' | 'white-bg' | 'detail' | 'set' | 'recreate'

/** 文案语言：跨境常去的八种 + 中文 */
export type EcommerceLanguage = 'zh-CN' | 'en' | 'ru' | 'ja' | 'ko' | 'de' | 'es' | 'ar'

export interface EcommerceRequest {
  usage: EcommerceUsage
  /** 平台 id，来自 platforms.ts；做白底图时可以不选（白底是通用要求） */
  platformId?: string
  language: EcommerceLanguage
  /** 生成张数：主图 1 张 / 详情页 N 张 / 套图 8 张（默认值见 plan.ts） */
  count: number
  /** 比例：'1:1' | '3:4' | '4:3' | '16:9' | '9:16' */
  ratio: string
  /** 产品图：走节点 id（与画布同源） */
  productNodeId: string
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
}

export const ECOMMERCE_USAGES: readonly EcommerceUsage[] = [
  'main',
  'white-bg',
  'detail',
  'set',
  'recreate',
]
export const ECOMMERCE_LANGUAGES: readonly EcommerceLanguage[] = [
  'zh-CN',
  'en',
  'ru',
  'ja',
  'ko',
  'de',
  'es',
  'ar',
]

/** 通用比例档（平台的 ratios 是它的子集；表单在没选平台时用这一份） */
export const ECOMMERCE_RATIOS: readonly string[] = ['1:1', '3:4', '4:3', '16:9', '9:16']

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
          : '爆款复刻'
}

export function languageLabel(language: EcommerceLanguage): string {
  const map: Record<EcommerceLanguage, string> = {
    'zh-CN': '中文简体',
    en: 'English',
    ru: 'Русский',
    ja: '日本語',
    ko: '한국어',
    de: 'Deutsch',
    es: 'Español',
    ar: 'العربية',
  }
  return map[language]
}
