/**
 * 电商「历史方案」（对账 #433；#380b 会话壳件的第一块）。
 *
 * ## 解决的是什么
 *
 * 「用一句话生成方案」原来只活在**组件状态**里：刷新、切走、关掉再回来，那条方案就没了 ——
 * 用户昨天想好的"亚马逊英文详情页 4 张、突出防水材质"今天得重打一遍。
 *
 * ## 存在哪：复用 `agentSessions`，不新建表
 *
 * 那张表本来就是**项目级会话**（`projectId` 过滤、`messages` 存历史、`title` 存名字），
 * 电商左栏这个"一句话 → 方案"与画布 agent 的对话是同一类东西。新建一张表要动
 * `TableName` 联合 + Dexie 版本 + 备份白名单 + 回收站级联（四处），而收益只是换个表名。
 *
 * 代价与边界一起写清：**一行会话 = 一次成功的解析**。草稿以 JSON 存在**最后一条 assistant
 * 消息**里（那是模型那一侧的输出，语义正好对上）；读不回来的行**不进列表** ——
 * 点了没反应的入口一个都不摆（画布 agent 的会话与本页共用一张表，过滤掉它们靠的就是这条）。
 */
import { extractJsonBlock } from '../shared/jsonBlock'
import type { ChatMessage } from '../shared/execution/types'
import type { EcommerceIntentDraft } from './chatParse'
import { ECOMMERCE_LANGUAGES, ECOMMERCE_USAGES } from './types'

/** 标题最多几个字（列表一行放得下；长了用省略号，鼠标悬停能看全） */
export const PLAN_TITLE_MAX = 24
/** 历史上留最近几条（再多也是噪音；要清理自己删） */
export const PLAN_HISTORY_LIMIT = 6

/** 会话里那一条方案（页面与工作台之间就用它传） */
export interface EcommercePlanSession {
  id: string
  title: string
  draft: EcommerceIntentDraft
  createdAt: number
  updatedAt: number
}

/** 一句话 → 标题：压平空白、截断、空则「未命名方案」 */
export function planTitleOf(text: string): string {
  const flat = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!flat) return '未命名方案'
  return flat.length > PLAN_TITLE_MAX ? `${flat.slice(0, PLAN_TITLE_MAX)}…` : flat
}

/**
 * 一次成功的解析 → 会话消息。
 *
 * user 放**用户原话**（以后要看"我当时怎么说的"），assistant 放**草稿 JSON**
 * （机器可读的那一份，读回来就是那张确认卡）。两样都留着，是因为它们回答的是两个问题。
 */
export function toPlanMessages(text: string, draft: EcommerceIntentDraft): ChatMessage[] {
  return [
    { role: 'user', content: String(text ?? '').trim() },
    { role: 'assistant', content: JSON.stringify(draft) },
  ]
}

/** 只留契约里那几个键；认不出的**一个字都不猜**（与 `parseEcommerceIntent` 同一条口径） */
function asDraft(value: unknown): EcommerceIntentDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const draft: EcommerceIntentDraft = {}
  if (typeof row.usage === 'string' && (ECOMMERCE_USAGES as readonly string[]).includes(row.usage)) {
    draft.usage = row.usage as EcommerceIntentDraft['usage']
  }
  if (typeof row.platformId === 'string' && row.platformId.trim()) draft.platformId = row.platformId.trim()
  if (
    typeof row.language === 'string' &&
    (ECOMMERCE_LANGUAGES as readonly string[]).includes(row.language)
  ) {
    draft.language = row.language as EcommerceIntentDraft['language']
  }
  if (typeof row.count === 'number' && Number.isInteger(row.count) && row.count > 0) {
    draft.count = row.count
  }
  if (typeof row.ratio === 'string' && row.ratio.trim()) draft.ratio = row.ratio.trim()
  if (typeof row.note === 'string' && row.note.trim()) draft.note = row.note.trim()
  /* 一个字段都没认出来 ⇒ 这不是一份方案（别塞一条点了什么都不发生的记录进列表） */
  return Object.keys(draft).length > 0 ? draft : null
}

/** 从会话消息里把草稿读回来（**最后一条** assistant 的 JSON）；读不出返回 null */
export function draftFromMessages(messages: readonly ChatMessage[]): EcommerceIntentDraft | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message || message.role !== 'assistant') continue
    const draft = asDraft(extractJsonBlock(String(message.content ?? '')))
    if (draft) return draft
  }
  return null
}

/** `agentSessions` 一行的宽松形状（这一层只读它需要的四个字段） */
export interface PlanSessionRowLike {
  id?: unknown
  title?: unknown
  messages?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/**
 * 会话行 → 历史里那一条。**读不出草稿就返回 null**（调用方过滤掉）——
 * 画布 agent 的会话也在这张表里，它们的正文不是草稿 JSON，过滤靠的就是这一条。
 */
export function toPlanSession(row: PlanSessionRowLike): EcommercePlanSession | null {
  const id = typeof row.id === 'string' ? row.id : ''
  if (!id) return null
  const messages = Array.isArray(row.messages) ? (row.messages as ChatMessage[]) : []
  const draft = draftFromMessages(messages)
  if (!draft) return null
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const title =
    typeof row.title === 'string' && row.title.trim()
      ? row.title.trim()
      : planTitleOf(String(lastUser?.content ?? ''))
  const createdAt = typeof row.createdAt === 'number' ? row.createdAt : 0
  const updatedAt = typeof row.updatedAt === 'number' ? row.updatedAt : createdAt
  return { id, title, draft, createdAt, updatedAt }
}

/** 最近 N 条（新的在前；同一时刻按 id 排，保证顺序稳定） */
export function recentPlanSessions(
  list: readonly EcommercePlanSession[],
  limit = PLAN_HISTORY_LIMIT,
): EcommercePlanSession[] {
  return [...list]
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, limit))
}
