import { extractJsonBlock } from '../shared/jsonBlock'
import { ECOMMERCE_PLATFORMS, platformRuleSummary, type EcommercePlatform } from './platforms'
import { ecommerceShots, type EcommerceShot } from './prompt'
import { languageLabel, usageLabel, type EcommerceRequest } from './types'

/**
 * **电商分镜的「方案 ②」**（对账 #406，#405 确定性脚本的续作）。
 *
 * 问题：套图 / 详情页的镜头脚本（`prompt.ecommerceShots`）是**固定模板** ——
 * 够用、可预期、不依赖任何模型；但「我做一套母婴水杯的详情页」这种需求里，
 * **卖点顺序应该由商品决定**，模板给不了。
 *
 * 做法：起一次对话请求，把用户那句话 + 平台 / 语言 / 张数扩成 N 条分镜 JSON。
 * **三条硬口径**：
 *
 * 1. **永不因为分镜失败而让用户出不了图**：没配对话模型 / 请求失败 / 条数不对
 *    一律**回落确定性脚本**，并且在界面上**如实说回落了、为什么**；
 * 2. **条数必须完全等于请求张数**：少一条就整批回落 —— 硬把 3 条对到 4 张上，
 *    会出现"某一张按上一张的意思画"，比用默认脚本坏得多（与拆集那条同一口径）；
 * 3. **它是一次额外的付费调用**：界面上要在**点生成之前**就把这件事说清楚
 *    （"这一趟会多花一次对话额度"），不许悄悄多花。
 *
 * 为什么这一层是纯函数：它决定"什么东西能变成用户的拍摄要求"，
 * 与 `chatParse` 同一理由 —— 这条边界必须被单测钉死。
 */

/** 契约里的识别标记（进**真实提示词**，离线 mock 也靠它认出"这一问是分镜扩写"） */
export const ECOMMERCE_SHOTS_MARKER = '【电商分镜扩写】'

/** 单条 title / brief 的字符上限（提示词别被一条离谱的长句撑爆） */
export const SHOT_TITLE_MAX = 40
export const SHOT_BRIEF_MAX = 200

/**
 * 这一次值不值得**问模型**。
 *
 * 三条同时成立才问：
 *  - 多张（1 张无所谓"分镜"）；
 *  - 不是白底图（白底是抽卡语义，N 张同一件事，用户明确说这样没问题）；
 *  - 用户真写了要求（没写就没有"理解需求"可谈，直接走脚本）。
 *
 * 抽成纯函数是为了**界面和页面用同一个判据**：确认卡上说"会多花一次对话额度"
 * 与真去调用，必须是同一个条件 —— 两处各写一份迟早对不上（说花了没花 / 花了没说）。
 */
export function shouldExpandShots(request: {
  usage: EcommerceRequest['usage']
  count: number
  note?: string
}): boolean {
  return request.count > 1 && request.usage !== 'white-bg' && (request.note ?? '').trim().length > 0
}

/** 系统指令 = 契约（写法与 `chatParse` / 拆镜那几条保持同一形状） */
export function buildShotsSystem(): string {
  return `你是一名电商视觉导演，负责把一次出图需求拆成"每一张拍什么"的拍摄简报。

${ECOMMERCE_SHOTS_MARKER}输出契约（必须严格遵守）
1. 只输出一个 JSON 对象，不要解释、不要客套；可以用 \`\`\`json 代码块包住。
2. 结构固定为：{"shots":[{"title":"短名","brief":"这一张要什么"}]}
3. **条数必须等于要求的张数**：一条不多、一条不少，顺序就是出图顺序（第 1 条 = 第 1 张）。
4. title 不超过 10 个字（它会写进提示词）；brief 一句话，说清这一张的视角 / 构图 / 卖点。
5. **任意两条不许是同一个意思**（同样的画面换个说法不算不同）。
6. 只能用用户给出的信息与商品类别的常识；**不许编造材质、参数、认证、功效与价格**。
7. 用户的补充要求优先级最高：它说突出什么，就围绕它安排卖点顺序。`
}

/**
 * 用户消息：那句话 + 这次的硬参数 + **默认脚本当结构参考**。
 *
 * 为什么把默认脚本也给模型：它是"第 3 张是细节、第 5 张是卖点"这种结构知识的载体。
 * 给了它，模型是在**改**一份合理的结构，而不是从零编 —— 输出更稳，
 * 也更容易看出它到底有没有按用户那句话调整。
 */
export function buildShotsText(
  request: EcommerceRequest,
  platforms: readonly EcommercePlatform[] = ECOMMERCE_PLATFORMS,
): string {
  const platform = platforms.find((p) => p.id === request.platformId) ?? null
  const lines = [
    `用户的要求：${(request.note ?? '').trim() || '（用户没写补充要求）'}`,
    `用途：${usageLabel(request.usage)}`,
    `目标平台：${platformRuleSummary(platform)}`,
    `文案语言：${languageLabel(request.language)}`,
    `要求张数：${request.count}`,
    `比例：${request.ratio}`,
    '',
    `默认镜头脚本（可作结构参考；请按上面那句要求调整顺序与内容 —— 商品不同，卖点顺序就该不同）：`,
  ]
  for (const shot of ecommerceShots(request.usage, request.count)) {
    lines.push(`- ${shot.title}：${shot.brief}`)
  }
  return lines.join('\n')
}

export type ShotsReplyParse =
  | { ok: true; shots: readonly EcommerceShot[] }
  | { ok: false; error: string }

/**
 * 解析模型的回复。
 *
 * **条数必须严格等于 `count`**；任何一条 brief 为空也判失败（整批回落）。
 * 理由与拆集那条一样：宁可整批用**已知正确**的默认脚本，
 * 也不要让"哪一张对应哪一句"错位 —— 错位的分镜比没有分镜更难发现。
 */
export function parseShotsReply(raw: string, count: number): ShotsReplyParse {
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, error: '要求张数不合法，没法对分镜条数。' }
  }
  const json = extractJsonBlock(raw)
  const list = Array.isArray(json)
    ? json
    : json && typeof json === 'object' && Array.isArray((json as { shots?: unknown }).shots)
      ? (json as { shots: unknown[] }).shots
      : null
  if (!list) {
    return {
      ok: false,
      error: '没解析出分镜：模型回的不是 {"shots":[…]} 这种结构（可能是段文字）。',
    }
  }
  if (list.length !== count) {
    return {
      ok: false,
      error: `分镜条数对不上：要 ${count} 条，模型回了 ${list.length} 条。`,
    }
  }
  const shots: EcommerceShot[] = []
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i]
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: `第 ${i + 1} 条分镜不是对象，整批回落。` }
    }
    const row = item as Record<string, unknown>
    const title = (typeof row.title === 'string' ? row.title.trim() : '').slice(0, SHOT_TITLE_MAX)
    const brief = (typeof row.brief === 'string' ? row.brief.trim() : '').slice(0, SHOT_BRIEF_MAX)
    /* brief 是这一条的**实质**：空的就是这条模型没写，不许拿 title 顶上 */
    if (!brief) return { ok: false, error: `第 ${i + 1} 条分镜没写清楚要什么，整批回落。` }
    shots.push({ title: title || `第 ${i + 1} 张`, brief })
  }
  return { ok: true, shots }
}
