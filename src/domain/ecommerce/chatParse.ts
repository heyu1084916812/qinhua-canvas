import { extractJsonBlock } from '../shared/jsonBlock'
import { ECOMMERCE_PLATFORMS, type EcommercePlatform } from './platforms'
import { ECOMMERCE_NOTE_MAX } from './prompt'
import {
  ECOMMERCE_COUNT_MAX,
  ECOMMERCE_FORM_USAGES,
  ECOMMERCE_LANGUAGES,
  ECOMMERCE_RATIOS,
  languageLabel,
  usageLabel,
  type EcommerceLanguage,
  type EcommerceUsage,
} from './types'

/**
 * **电商工作台 · 一句话 → 待确认方案**（对账 #422，#380b 的第一块对话入口）。
 *
 * 用户原话（2026-10-11）：「先说清楚它听懂了什么，确认了再填表」——
 * 所以这条链路切成三段，各管一段：
 *
 * 1. **提问**：系统指令 = 一份机器可读的输出契约；用户正文 = 那句话 + 可用平台 / 语言清单；
 * 2. **解析**：`parseEcommerceIntent` 只认**白名单里的值**（用途 / 平台 / 语言 / 比例 / 张数），
 *    认不出来的**一个字都不猜**，也**不落库、不改表单**；
 * 3. **确认**：界面把"听懂了什么"逐条摆出来，用户点「应用到表单」才真的填。
 *
 * 为什么这一层是纯函数：它决定"什么东西能进用户表单"。表单是**唯一真相**，
 * 对话只产**草稿** —— 这条边界必须被单测钉死，而不是靠界面自觉。
 */

/**
 * 契约里的识别标记。
 *
 * 它进的是**真实提示词**（不是测试专用字符串），同时被离线 mock 用来认出
 * "这一问是电商需求解析" —— 与拆镜 / 拆集那两条同一种手法：假数据的保真度决定断言的上限。
 */
export const ECOMMERCE_INTENT_MARKER = '【电商需求解析】'

/** 解析出来的**草稿**：只放听出来的那几项，没听出来的键**不存在**（不是默认值） */
export interface EcommerceIntentDraft {
  usage?: EcommerceUsage
  platformId?: string
  language?: EcommerceLanguage
  count?: number
  ratio?: string
  /** 补进表单「补充要求」的那一句（模型摘要优先，没有就用用户原话） */
  note?: string
}

/** 待确认卡片上的一行：**人话 + 值**（顺序固定，界面与断言都按它来） */
export interface EcommerceIntentRow {
  label: string
  value: string
}

export type EcommerceIntentParse =
  | { ok: true; draft: EcommerceIntentDraft; rows: readonly EcommerceIntentRow[] }
  | { ok: false; error: string }

/**
 * 系统指令 = 契约。
 *
 * 与拆镜那条的差别：拆镜的系统正文取**内置技能**（改技能即改行为），
 * 这里没有对应的技能 —— 「把一句话翻成表单参数」是解析任务，不是策划任务，
 * 内置的「电商详情页策划」技能干的是另一件事，拿来用只会让它跑偏。
 */
export function buildIntentSystem(): string {
  return `你是一名电商出图助手，负责把用户随口说的一句话翻译成**表单参数**。

${ECOMMERCE_INTENT_MARKER}输出契约（必须严格遵守）
1. 只输出一个 JSON 对象，不要解释、不要客套；可以用 \`\`\`json 代码块包住。
2. 只允许下面这几个键，**没听出来的键就不要写**（不许猜、不许替用户填默认值）：
   {"usage":"主图|白底图|详情页|套图|爆款复刻","platformId":"平台 id","language":"语言代码","count":张数,"ratio":"比例","note":"补充要求"}
3. usage 只能写那五个中文词之一；platformId 只能写"可用平台"里给出的 id；
   language 只能写"可用语言"里给出的代码；ratio 只能写 1:1 / 3:4 / 4:3 / 16:9 / 21:9 / 9:16 / smart（智能比例只用于套图）。
4. count 是 1–${ECOMMERCE_COUNT_MAX} 的整数。
5. note 写用户对画面的补充要求（用原话里的词，不要自己发挥）；没有就写空字符串。
6. 用户没说的，键就**不要出现** —— 表单里已有别的值，你猜错一个，用户就要多改一处。`
}

/** 用户消息：那句话 + 可用平台 / 语言清单（白名单写进提示词，模型才知道边界） */
export function buildIntentText(
  text: string,
  platforms: readonly EcommercePlatform[] = ECOMMERCE_PLATFORMS,
): string {
  const lines = [
    '用户这句话：',
    text.trim(),
    '',
    '可用平台（platformId 只能写这里的 id）：',
  ]
  for (const p of platforms) lines.push(`- ${p.id}（${p.name}）`)
  lines.push('', '可用语言（language 只能写这里的代码）：')
  lines.push(ECOMMERCE_LANGUAGES.map((l) => `${l}（${languageLabel(l)}）`).join('、'))
  return lines.join('\n')
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 用途：认 id 也认中文名，别的**一律不认** */
function pickUsage(value: unknown): EcommerceUsage | undefined {
  const s = trimmed(value)
  if (!s) return undefined
  return (
    ECOMMERCE_FORM_USAGES.find((u) => u === s) ??
    ECOMMERCE_FORM_USAGES.find((u) => usageLabel(u) === s)
  )
}

/** 平台：认 id（大小写不敏感），也认清单里的**显示名**；都不中就不认 */
function pickPlatform(value: unknown, platforms: readonly EcommercePlatform[]): string | undefined {
  const s = trimmed(value)
  if (!s) return undefined
  const byId = platforms.find((p) => p.id.toLowerCase() === s.toLowerCase())
  if (byId) return byId.id
  return platforms.find((p) => p.name.toLowerCase() === s.toLowerCase())?.id
}

/** 语言：认代码，也认界面上的显示名（如「English」/「中文简体」） */
function pickLanguage(value: unknown): EcommerceLanguage | undefined {
  const s = trimmed(value)
  if (!s) return undefined
  return (
    ECOMMERCE_LANGUAGES.find((l) => l.toLowerCase() === s.toLowerCase()) ??
    ECOMMERCE_LANGUAGES.find((l) => languageLabel(l) === s)
  )
}

/**
 * 比例：只认表单白名单；智能比例只接受明确的 smart / 智能比例。
 *
 * 这里**顺手接受全角冒号**（`３:４` 这类输入在中文输入法下很常见），
 * 归一到半角后仍要与档位**完全相等**才算认出来 —— 不做"最接近的一档"，
 * 那等于替用户改参数。
 */
function pickRatio(value: unknown): string | undefined {
  const s = trimmed(value).replace(/：/g, ':')
  if (!s) return undefined
  if (s === '智能比例' || s === '智能') return 'smart'
  return ECOMMERCE_RATIOS.find((r) => r === s)
}

/** 张数：整数、1..上限。数字字符串也收（模型偶尔会用引号包住数字） */
function pickCount(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN
  if (!Number.isFinite(n)) return undefined
  const rounded = Math.round(n)
  return rounded >= 1 && rounded <= ECOMMERCE_COUNT_MAX ? rounded : undefined
}

/**
 * 把模型的回复解析成草稿。
 *
 * **一条都没认出来 = 失败**（不是"空草案"）：空草案会让界面弹出一张什么都没写的
 * 确认卡，用户以为模型听懂了。宁可如实说"这句话里没有能对上表单的项"。
 */
export function parseEcommerceIntent(
  raw: string,
  options: {
    platforms?: readonly EcommercePlatform[]
    /** 用户原话：模型没给 note 时兜底用它（表单里的"补充要求"照样可改） */
    fallbackNote?: string
  } = {},
): EcommerceIntentParse {
  const platforms = options.platforms ?? ECOMMERCE_PLATFORMS
  const json = extractJsonBlock(raw)
  const row = asRecord(json)
  if (!row) {
    return {
      ok: false,
      error: '没解析出参数：模型回的不是一个 JSON 对象（可能是段文字）。换个说法再试一次。',
    }
  }

  const draft: EcommerceIntentDraft = {}
  const usage = pickUsage(row.usage)
  if (usage) draft.usage = usage
  const platformId = pickPlatform(row.platformId, platforms)
  if (platformId) draft.platformId = platformId
  const language = pickLanguage(row.language)
  if (language) draft.language = language
  const count = pickCount(row.count)
  if (count !== undefined) draft.count = count
  const ratio = pickRatio(row.ratio)
  if (ratio) draft.ratio = ratio

  const modelNote = trimmed(row.note)
  const fallbackNote = trimmed(options.fallbackNote)
  const note = (modelNote || fallbackNote).slice(0, ECOMMERCE_NOTE_MAX)
  if (note) draft.note = note

  const rows = intentRows(draft, platforms)
  /** 只有 note 认出来也**不算**听懂：那句话本身就是要塞进 note 的兜底 */
  if (rows.length <= (draft.note ? 1 : 0)) {
    return {
      ok: false,
      error:
        '没解析出参数：这句话里没有能对上表单的项（用途 / 平台 / 语言 / 张数 / 比例）。直接填表单更快。',
    }
  }
  return { ok: true, draft, rows }
}

/**
 * 草稿 → 待确认卡片上的一行行。
 *
 * 顺序固定（用途 → 平台 → 语言 → 张数 → 比例 → 补充要求）：同一份草稿每次摆出来一样，
 * 否则用户改一个字就会看到整块重排，看不出到底改了什么。
 */
export function intentRows(
  draft: EcommerceIntentDraft,
  platforms: readonly EcommercePlatform[] = ECOMMERCE_PLATFORMS,
): EcommerceIntentRow[] {
  const rows: EcommerceIntentRow[] = []
  if (draft.usage) rows.push({ label: '用途', value: usageLabel(draft.usage) })
  if (draft.platformId) {
    const name = platforms.find((p) => p.id === draft.platformId)?.name ?? draft.platformId
    rows.push({ label: '平台', value: name })
  }
  if (draft.language) rows.push({ label: '文案语言', value: languageLabel(draft.language) })
  if (draft.count !== undefined) rows.push({ label: '张数', value: `${draft.count} 张` })
  if (draft.ratio) rows.push({ label: '比例', value: draft.ratio })
  if (draft.note) rows.push({ label: '补充要求', value: draft.note })
  return rows
}
