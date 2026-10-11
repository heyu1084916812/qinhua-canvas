/**
 * 电商「为您推荐」（对账 #434；#380b 会话壳件最后一件）。
 *
 * ## 它是什么：三条**确定性**的起手式
 *
 * 按用户此刻在表单里选的平台 / 语言，给出三句可以直接拿去解析的话
 * （主图 / 详情页 / 套图各一条）。改平台，推荐跟着改。
 *
 * ## 它不是什么（这条比上面那条重要）
 *
 * **不是"AI 推荐"**：那要么再花用户一次对话额度，要么拿规则装智能。
 * 这里解决的问题只有一个 —— **省一次打字**，让不知道从哪写起的用户有个起点。
 * 卖点该写什么是他自己的事（那正是「补充要求」那一格的用途），所以推荐句里
 * **只写平台 / 语言 / 用途 / 张数**这些确定性事实，不替他想卖点。
 */
import { ECOMMERCE_PLATFORMS, type EcommercePlatform } from './platforms'
import { languageLabel, usageLabel, type EcommerceLanguage, type EcommerceUsage } from './types'

export interface EcommerceSuggestion {
  id: string
  usage: EcommerceUsage
  /**
   * 按钮上那行**短标签**（`主图 · 1 张`）。
   *
   * 为什么不把整句话铺在按钮上：左栏只有一列宽，三句 20 字的话会各占一行、
   * 把表单往下顶一屏。整句放 `text`（点一下就填进输入框，用户**当场看见**它长什么样）
   * 与 `title`（悬停能看全），信息一样不缺。
   */
  label: string
  /** 直接填进「一句话生成方案」输入框的那句话 */
  text: string
}

/**
 * 三条起手式的**固定张数**（主图 1 / 详情页 4 / 套图 6）。
 *
 * 为什么不按平台的 `countHint` 现算：那串是给人看的区间（"套图常见 6–8 张"），
 * 拆成数字要再定一套"取中位数还是取上限"的规则，而这条推荐只是**起点** ——
 * 用户看一眼觉得该 8 张，改一个数字就行。
 */
const SUGGESTION_COUNTS: readonly { usage: EcommerceUsage; count: number }[] = [
  { usage: 'main', count: 1 },
  { usage: 'detail', count: 4 },
  { usage: 'set', count: 6 },
]

/** 生成三句起手式（平台找不到名字时用平台 id —— 不编一个好听的名字出来） */
export function buildSuggestions(args: {
  platforms?: readonly EcommercePlatform[]
  platformId: string
  language: EcommerceLanguage
}): EcommerceSuggestion[] {
  const list = args.platforms ?? ECOMMERCE_PLATFORMS
  const platform = list.find((p) => p.id === args.platformId)
  /* 平台名可能拿不到（没选 / 扩展包给的 id 不在清单里）：那就**不写它**，
     而不是拼出一个空档或编一个好听的名字 */
  const name = (platform?.name ?? args.platformId).trim()
  const lang = languageLabel(args.language)
  return SUGGESTION_COUNTS.map(({ usage, count }) => {
    const what = `${lang}${usageLabel(usage)}`
    /* 空格只在真有那一段时才加：`给我做一套  英文主图` 这种双空格会一路带进提示词 */
    const head = ['给我做一套', name, what].filter(Boolean).join(' ')
    return {
      id: `suggest-${usage}`,
      usage,
      label: `${usageLabel(usage)} · ${count} 张`,
      text: `${head}，${count} 张`,
    }
  })
}
