/**
 * 电商提示词拼装（对账 #384 / #380a）。
 *
 * 纯函数：进请求 + 平台，出一段写进生成节点的提示词。**可单测**是它的主要价值 ——
 * 提示词是这套功能里最容易被"看起来对"蒙混过去的一环。
 *
 * 三条口径：
 * 1. **参数写进提示词，不写进技能**：技能是"怎么做"（方法论），平台 / 语言 / 张数是
 *    "这次要什么"（参数）。把参数写进技能会让同一个技能出现 N 个副本 ——
 *    #381 明确否定的做法；
 * 2. **硬约束必须每次都在**：不改产品外观、不编造参数/认证/功效 —— 这三条是 AIGC
 *    电商图最常见的翻车方式，不给模型"这次可以编"的机会；
 * 3. **没选平台就说没选**：不编一个通用平台名，也不套别家的规则。
 */
import { platformById, platformRuleSummary, type EcommercePlatform } from './platforms'
import { languageLabel, usageLabel, type EcommerceRequest, type EcommerceUsage } from './types'

/** 单次请求里 note 允许的最大长度（再长应当写进提示词节点，而不是这个表单） */
export const ECOMMERCE_NOTE_MAX = 500

/** 每一次都要带上的硬约束（顺序固定，判据好写） */
export const ECOMMERCE_HARD_RULES: readonly string[] = [
  '不改产品的外观、颜色、材质与结构（以产品图为准）',
  '不编造参数、认证、功效与价格',
  '画面文字只用指定语言，不出现乱码与拼写错误',
]

/** 用途给模型的一句提示（与平台的规则摘要互补：一个说"要什么"，一个说"注意什么"） */
const USAGE_HINTS: Record<EcommerceUsage, string> = {
  main: '主图：产品为画面主体，构图干净、留白得当',
  'white-bg': '白底图：纯白背景、不要场景道具、产品边缘干净',
  detail: '详情页：按卖点分段表达，信息层级清楚',
  set: '套图：主图 + 场景图 + 细节图 + 卖点图，整套风格统一',
}

export interface BuildPromptOptions {
  /** 平台清单（默认用内置那份；测试可以喂一份假的） */
  platforms?: readonly EcommercePlatform[]
}

export function buildEcommercePrompt(
  request: EcommerceRequest,
  options: BuildPromptOptions = {},
): string {
  const platform = options.platforms
    ? (options.platforms.find((p) => p.id === request.platformId) ?? null)
    : platformById(request.platformId)

  const lines: string[] = []
  const note = (request.note ?? '').trim().slice(0, ECOMMERCE_NOTE_MAX)
  if (note) lines.push(note)

  lines.push(`用途：${usageLabel(request.usage)} —— ${USAGE_HINTS[request.usage]}`)
  lines.push(`目标平台：${platformRuleSummary(platform)}`)
  lines.push(`文案语言：${languageLabel(request.language)}`)
  lines.push(`输出：${request.count} 张，比例 ${request.ratio}`)
  lines.push(`硬约束：${ECOMMERCE_HARD_RULES.join('；')}`)

  return lines.join('\n')
}
