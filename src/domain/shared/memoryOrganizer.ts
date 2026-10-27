import {
  contextMemorySecretReason,
  normalizeContextMemoryKey,
  normalizeContextMemoryKind,
  type ContextMemoryKind,
  type ContextMemoryScope,
} from './context'
import type { WorkbenchId } from './workbench'

export interface MemoryCandidate {
  kind: ContextMemoryKind
  text: string
  scope: ContextMemoryScope
  workbench?: WorkbenchId
  projectId?: string
  sessionId?: string
  key?: string
  expiresAt?: number
  replaceMemoryId?: string
  confidence: number
  reason: string
}

export interface MemoryCandidateContext {
  workbench?: WorkbenchId
  projectId?: string
  sessionId?: string
  now?: number
}

const EPHEMERAL = /(?:这次|本次|这一张|当前这张|今天先|临时|暂时|先这样|仅此一次)/
const PERSISTENT =
  /(?:记住|以后|每次|始终|长期|默认|不要再|必须|禁止|我的.{0,12}(?:是|叫|为))/

export function isEphemeralMemoryText(text: string): boolean {
  return EPHEMERAL.test(text) && !/(?:以后|每次|始终|长期|记住)/.test(text)
}

export function inferMemoryKind(text: string): ContextMemoryKind {
  if (/(?:不要|禁止|必须|只能|不能|务必|不得)/.test(text)) return 'constraint'
  if (/(?:决定|确定|采用|就用|定稿|最终用)/.test(text)) return 'decision'
  if (
    /(?:我的|我是|品牌|项目|产品|名称|尺寸|比例|语言|主色|字体|Logo)/i.test(text)
  ) {
    return 'fact'
  }
  return 'preference'
}

export function inferMemoryKey(text: string): string | undefined {
  const pairs: [RegExp, string][] = [
    [/(?:品牌名|品牌名称)/, 'brand.name'],
    [/(?:品牌主色|主色|品牌色)/, 'brand.primaryColor'],
    [/(?:品牌字体|标题字体|正文字体|字体)/, 'brand.font'],
    [/(?:品牌语言|语言)/, 'brand.language'],
    [/(?:项目尺寸|画布尺寸|成品尺寸|尺寸|比例)/, 'project.size'],
    [/(?:产品名|产品名称)/, 'product.name'],
  ]
  return pairs.find(([pattern]) => pattern.test(text))?.[1]
}

export function inferMemoryScope(
  text: string,
  context: MemoryCandidateContext = {},
): ContextMemoryScope {
  if (/(?:这个项目|本项目)/.test(text) && context.projectId) return 'project'
  if (/(?:这次对话|当前会话|本会话)/.test(text) && context.sessionId) {
    return 'session'
  }
  if (/(?:以后|每次|所有项目|长期|默认)/.test(text)) return 'global'
  return context.workbench ? 'workbench' : 'global'
}

export function memoryCandidateFromText(
  rawText: string,
  context: MemoryCandidateContext = {},
): MemoryCandidate | null {
  const text = rawText.trim()
  if (!text || !PERSISTENT.test(text) || isEphemeralMemoryText(text)) return null
  if (contextMemorySecretReason(text)) return null
  const scope = inferMemoryScope(text, context)
  return {
    kind: inferMemoryKind(text),
    text,
    scope,
    ...(scope === 'workbench' && context.workbench
      ? { workbench: context.workbench }
      : {}),
    ...(scope === 'project' && context.projectId
      ? { projectId: context.projectId }
      : {}),
    ...(scope === 'session' && context.sessionId
      ? { sessionId: context.sessionId, ...(context.projectId ? { projectId: context.projectId } : {}) }
      : {}),
    ...(inferMemoryKey(text) ? { key: inferMemoryKey(text) } : {}),
    confidence: /记住/.test(text) ? 0.9 : 0.72,
    reason: /记住/.test(text) ? '用户明确要求记住' : '检测到长期偏好或约束',
  }
}

export function memoryCandidateProblems(candidate: MemoryCandidate): string[] {
  const problems: string[] = []
  const text = candidate.text.trim()
  if (!text) problems.push('记忆正文不能为空')
  if (text.length > 800) problems.push('单条记忆不能超过 800 字')
  const secret = contextMemorySecretReason(text)
  if (secret) problems.push(`记忆里不能保存${secret}`)
  if (isEphemeralMemoryText(text)) problems.push('一次性要求不能升级成长期记忆')
  if (candidate.scope === 'workbench' && !candidate.workbench) {
    problems.push('工作台记忆缺少工作台')
  }
  if (candidate.scope === 'project' && !candidate.projectId) {
    problems.push('项目记忆缺少项目')
  }
  if (candidate.scope === 'session' && !candidate.sessionId) {
    problems.push('会话记忆缺少会话')
  }
  const key = normalizeContextMemoryKey(candidate.key)
  if (candidate.key && !key) problems.push('记忆主题键格式不合法')
  return problems
}

export function normalizeMemoryCandidate(
  value: {
    kind?: unknown
    text?: unknown
    scope?: unknown
    workbench?: unknown
    projectId?: unknown
    sessionId?: unknown
    key?: unknown
    expiresAt?: unknown
    expiresInDays?: unknown
    replaceMemoryId?: unknown
    confidence?: unknown
  },
  context: MemoryCandidateContext = {},
): MemoryCandidate {
  const text = typeof value.text === 'string' ? value.text.trim() : ''
  const requestedScope =
    value.scope === 'workbench' ||
    value.scope === 'project' ||
    value.scope === 'session' ||
    value.scope === 'global'
      ? value.scope
      : inferMemoryScope(text, context)
  const scope: ContextMemoryScope = requestedScope
  const projectId =
    typeof value.projectId === 'string' && value.projectId.trim()
      ? value.projectId.trim()
      : context.projectId
  const sessionId =
    typeof value.sessionId === 'string' && value.sessionId.trim()
      ? value.sessionId.trim()
      : context.sessionId
  const workbench =
    value.workbench === 'canvas' ||
    value.workbench === 'ecommerce' ||
    value.workbench === 'storyboard'
      ? value.workbench
      : context.workbench
  const directExpiresAt =
    typeof value.expiresAt === 'number' && Number.isFinite(value.expiresAt) && value.expiresAt > 0
      ? Math.trunc(value.expiresAt)
      : undefined
  const expiresInDays =
    typeof value.expiresInDays === 'number' &&
    Number.isFinite(value.expiresInDays) &&
    value.expiresInDays > 0
      ? Math.min(3650, Math.trunc(value.expiresInDays))
      : undefined
  const expiresAt =
    directExpiresAt ??
    (expiresInDays ? (context.now ?? Date.now()) + expiresInDays * 86_400_000 : undefined)
  const confidence =
    typeof value.confidence === 'number' && Number.isFinite(value.confidence)
      ? Math.min(1, Math.max(0, value.confidence))
      : 0.8
  return {
    kind: normalizeContextMemoryKind(value.kind),
    text,
    scope,
    ...(scope === 'workbench' && workbench ? { workbench } : {}),
    ...(scope === 'project' && projectId ? { projectId } : {}),
    ...(scope === 'session' && sessionId
      ? { sessionId, ...(projectId ? { projectId } : {}) }
      : {}),
    ...(normalizeContextMemoryKey(value.key)
      ? { key: normalizeContextMemoryKey(value.key) }
      : {}),
    ...(expiresAt ? { expiresAt } : {}),
    ...(typeof value.replaceMemoryId === 'string' && value.replaceMemoryId.trim()
      ? { replaceMemoryId: value.replaceMemoryId.trim() }
      : {}),
    confidence,
    reason: 'Agent 提议的记忆',
  }
}
