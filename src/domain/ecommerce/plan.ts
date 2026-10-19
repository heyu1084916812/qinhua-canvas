/**
 * 电商请求 → 执行计划（对账 #384 / #380a）。
 *
 * 「计划」在这里只回答一个问题：**这一次要出几张、按什么提示词出**。
 * 真正的执行交给画布既有的生成节点与 `runEngine` —— 这个模块不碰 IO、不碰 React。
 *
 * 校验口径：**非法输入一律抛错，不静默兜底**。
 * 静默兜底（把 0 张改成 1 张、把非法比例换成 1:1）会让用户遇到"我明明填了 A、出来的是 B"，
 * 而这种缺陷在界面上看起来"功能正常"。
 */
import { buildEcommercePrompts, type BuildPromptOptions } from './prompt'
import { platformById, type EcommercePlatform } from './platforms'
import {
  ECOMMERCE_COUNT_MAX,
  ECOMMERCE_LANGUAGES,
  ECOMMERCE_RATIOS,
  ECOMMERCE_USAGES,
  type EcommerceRequest,
} from './types'
import { isUpscaleScale } from './upscale'

/** 用途 → 默认张数（表单初值；用户可改，改完仍要过校验） */
export const ECOMMERCE_DEFAULT_COUNT: Record<EcommerceRequest['usage'], number> = {
  main: 1,
  'white-bg': 1,
  detail: 4,
  set: 8,
  recreate: 4,
  edit: 1,
}

export interface EcommercePlan {
  /** 这一次要出几张（= 请求里的 count，校验通过后原样带出） */
  count: number
  ratio: string
  /** 选中的平台；白底图可以不选 ⇒ null */
  platform: EcommercePlatform | null
  /** 第 1 张的提示词（单张场景 / 老调用方用；与 `prompts[0]` 同值） */
  prompt: string
  /**
   * **逐张提示词**（用户 2026-10-10 #10）：长度恒等于 `count`。
   *
   * 白底图 N 条完全相同（抽卡语义，用户明确说这样没问题）；
   * 主图 / 详情页 / 套图按镜头脚本逐张不同（见 `prompt.ecommerceShots`）。
   */
  prompts: readonly string[]
  /** 参考图：去掉重复、去掉与产品图相同的那个 */
  referenceNodeIds: string[]
}

/** 输入不合法时抛这个 —— 界面据此把话原样说给用户听 */
export class EcommerceRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EcommerceRequestError'
  }
}

export function buildEcommercePlan(
  request: EcommerceRequest,
  options: BuildPromptOptions = {},
): EcommercePlan {
  if (!request.productNodeId) {
    throw new EcommerceRequestError('先上传一张产品图 —— 没有产品图就没有可改的主体')
  }
  if (
    request.usage === 'recreate' &&
    !request.referenceNodeIds.some((id) => id && id !== request.productNodeId)
  ) {
    throw new EcommerceRequestError('爆款复刻要先把那张参考图上传到「参考图」')
  }
  if (!ECOMMERCE_USAGES.includes(request.usage)) {
    throw new EcommerceRequestError(`不认识的用途：${String(request.usage)}`)
  }
  if (request.usage === 'edit' && !request.note?.trim()) {
    throw new EcommerceRequestError('AI 编辑要写清这一张具体改什么 —— 空指令不会发请求')
  }
  if (request.usage === 'edit' && request.count !== 1) {
    throw new EcommerceRequestError('AI 编辑一次只改一张；要改多张请逐张操作')
  }
  if (request.scale !== undefined && (!isUpscaleScale(request.scale) || request.usage !== 'edit')) {
    throw new EcommerceRequestError('AI 超清只支持 2x / 4x / 6x，并且只能用于结果图编辑')
  }
  if (!ECOMMERCE_LANGUAGES.includes(request.language)) {
    throw new EcommerceRequestError(`不认识的文案语言：${String(request.language)}`)
  }
  if (!Number.isInteger(request.count) || request.count < 1 || request.count > ECOMMERCE_COUNT_MAX) {
    throw new EcommerceRequestError(
      `张数要填 1–${ECOMMERCE_COUNT_MAX} 之间的整数（现在是 ${String(request.count)}）`,
    )
  }
  if (!ECOMMERCE_RATIOS.includes(request.ratio)) {
    throw new EcommerceRequestError(
      `比例只支持 ${ECOMMERCE_RATIOS.join(' / ')}（现在是 ${String(request.ratio)}）`,
    )
  }

  const platforms = options.platforms
  const platform = platforms
    ? (platforms.find((p) => p.id === request.platformId) ?? null)
    : platformById(request.platformId)
  if (request.platformId && !platform) {
    throw new EcommerceRequestError(`平台清单里没有这条：${request.platformId}`)
  }

  const referenceNodeIds = [...new Set(request.referenceNodeIds)].filter(
    (id) => id && id !== request.productNodeId,
  )
  const prompts = buildEcommercePrompts(request, options)

  return {
    count: request.count,
    ratio: request.ratio,
    platform,
    prompt: prompts[0] ?? '',
    prompts,
    referenceNodeIds,
  }
}
