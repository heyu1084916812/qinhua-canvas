import { upstreamAliasesOf } from './modelPresets'

/**
 * 路由计划：把“逻辑模型 + 能力”展开成有顺序的真实候选。
 *
 * 这里只计划，不发请求。执行器必须依据发送阶段决定能不能继续尝试；
 * 超时、408、响应丢失等不可安全重发的错误不能因为计划里还有候选就换目标。
 */
export type RoutePlanStrategy = 'priority' | 'performance' | 'balanced' | 'round_robin'

export const ROUTE_PLAN_STRATEGIES: {
  value: RoutePlanStrategy
  label: string
  hint: string
}[] = [
  { value: 'priority', label: '优先度', hint: '优先度高的渠道和分组先跑' },
  { value: 'performance', label: '性能优先', hint: '最近验证延迟低的先跑' },
  { value: 'balanced', label: '均衡分摊', hint: '按渠道权重分摊请求' },
  { value: 'round_robin', label: '轮询', hint: '同优先档内按顺序轮换起点' },
]

export type RouteCapability = 'chat' | 'image' | 'video' | 'audio' | 'embedding'

export interface RoutePlanModel {
  id: string
  category: string
}

export interface RoutePlanGroup {
  id: string
  hasToken: boolean
  priority: number
  models: readonly RoutePlanModel[]
}

/**
 * 最小渠道视图。
 *
 * `credentialGroups` 为空时沿用渠道级模型和令牌；有分组时只能从分组里选，
 * 空分组不能冒充渠道可用。
 */
export interface RoutePlanChannel {
  id: string
  enabled: boolean
  hasToken: boolean
  priority: number
  weight: number
  lastTestLatency: number | null
  models: readonly RoutePlanModel[]
  modelMap: Readonly<Record<string, string>> | null | undefined
  credentialGroups: readonly RoutePlanGroup[]
}

export interface RouteCandidateRef {
  channelId: string
  credentialGroupId?: string
}

export interface RoutePlanCandidate extends RouteCandidateRef {
  key: string
  logicalModel: string
  upstreamModel: string
  capability: RouteCapability
  priority: number
  groupPriority: number
  weight: number
  latencyMs: number | null
}

export interface RoutePolicy {
  strategy: RoutePlanStrategy
  maxAttempts: number
  /** 为空表示沿用旧行为：全部可用候选参与；非空时只允许这些渠道/分组。 */
  allowedCandidates: readonly RouteCandidateRef[]
}

export interface RoutePlan {
  logicalModel: string
  capability: RouteCapability
  strategy: RoutePlanStrategy
  maxAttempts: number
  cursor: number
  nextCursor: number
  /** round_robin 的次数模数；其它策略恒为 1。 */
  cursorModulus: number
  candidates: RoutePlanCandidate[]
}

export type RoutePlanResult =
  | { ok: true; plan: RoutePlan }
  | {
      ok: false
      reason: 'model_missing' | 'no_token' | 'policy_excluded'
    }

export const DEFAULT_ROUTE_POLICY: RoutePolicy = {
  strategy: 'priority',
  maxAttempts: 3,
  allowedCandidates: [],
}

const ROUTE_PLAN_STRATEGY_VALUES = new Set(
  ROUTE_PLAN_STRATEGIES.map((strategy) => strategy.value),
)

export function normalizeRoutePolicy(value: Partial<RoutePolicy> | null | undefined): RoutePolicy {
  const strategy =
    value?.strategy && ROUTE_PLAN_STRATEGY_VALUES.has(value.strategy)
      ? value.strategy
      : DEFAULT_ROUTE_POLICY.strategy
  const maxAttempts =
    typeof value?.maxAttempts === 'number' && Number.isFinite(value.maxAttempts)
      ? Math.min(5, Math.max(1, Math.trunc(value.maxAttempts)))
      : DEFAULT_ROUTE_POLICY.maxAttempts
  const allowedCandidates = Array.isArray(value?.allowedCandidates)
    ? [
        ...new Map(
          value.allowedCandidates
            .map((candidate) => {
              const channelId = candidate.channelId?.trim()
              if (!channelId) return null
              const credentialGroupId = candidate.credentialGroupId?.trim()
              return {
                channelId,
                ...(credentialGroupId ? { credentialGroupId } : {}),
              } satisfies RouteCandidateRef
            })
            .filter((candidate): candidate is RouteCandidateRef => candidate !== null)
            .map((candidate) => [routeCandidateKey(candidate), candidate]),
        ).values(),
      ]
    : []
  return { strategy, maxAttempts, allowedCandidates }
}

export function routeCandidateKey(ref: RouteCandidateRef): string {
  return `${ref.channelId}\u0000${ref.credentialGroupId ?? ''}`
}

function categoryMatches(model: RoutePlanModel, capability: RouteCapability): boolean {
  return model.category === capability
}

function supportsModel(
  models: readonly RoutePlanModel[],
  capability: RouteCapability,
  logicalModel: string,
): boolean {
  return models.some(
    (model) =>
      categoryMatches(model, capability) &&
      (model.id === logicalModel || upstreamAliasesOf(logicalModel).includes(model.id)),
  )
}

function upstreamOf(
  channel: RoutePlanChannel,
  models: readonly RoutePlanModel[],
  logicalModel: string,
): string | null {
  const mapped = channel.modelMap?.[logicalModel]?.trim()
  if (mapped) return mapped
  if (models.some((model) => model.id === logicalModel)) return logicalModel
  return upstreamAliasesOf(logicalModel).find((alias) =>
    models.some((model) => model.id === alias),
  ) ?? null
}

function weightedPick<T extends { weight: number }>(
  candidates: readonly T[],
  random: number,
): T | null {
  if (candidates.length === 0) return null
  const total = candidates.reduce(
    (sum, candidate) => sum + Math.max(0, candidate.weight) + 10,
    0,
  )
  let point = Math.min(Math.max(random, 0), 0.999999) * total
  for (const candidate of candidates) {
    point -= Math.max(0, candidate.weight) + 10
    if (point <= 0) return candidate
  }
  return candidates[candidates.length - 1]!
}

function priorityOrder(
  left: RoutePlanCandidate,
  right: RoutePlanCandidate,
): number {
  return (
    right.priority - left.priority ||
    right.groupPriority - left.groupPriority ||
    left.key.localeCompare(right.key)
  )
}

function performanceOrder(
  left: RoutePlanCandidate,
  right: RoutePlanCandidate,
): number {
  const leftLatency = left.latencyMs ?? Number.POSITIVE_INFINITY
  const rightLatency = right.latencyMs ?? Number.POSITIVE_INFINITY
  return (
    leftLatency - rightLatency ||
    priorityOrder(left, right)
  )
}

/**
 * 生成确定性路由计划。
 *
 * `cursor` 只影响 `round_robin` 的最高渠道优先档。调用方必须把
 * `nextCursor` 持久化；否则每次都会从同一个候选开始，不是轮询。
 */
export function buildRoutePlan(opts: {
  channels: readonly RoutePlanChannel[]
  logicalModel: string
  capability: RouteCapability
  policy?: Partial<RoutePolicy>
  cursor?: number
  random?: number
}): RoutePlanResult {
  const logicalModel = opts.logicalModel.trim()
  if (!logicalModel) return { ok: false, reason: 'model_missing' }
  const policy = normalizeRoutePolicy({
    ...DEFAULT_ROUTE_POLICY,
    ...opts.policy,
  })
  const allowed = new Set(policy.allowedCandidates.map(routeCandidateKey))
  const useAllowList = allowed.size > 0
  let sawModel = false
  let sawToken = false
  let sawAllowed = false

  const expanded = opts.channels.flatMap((channel): RoutePlanCandidate[] => {
    if (!channel.enabled) return []
    const groupSources: Array<{
      id?: string
      hasToken: boolean
      priority: number
      models: readonly RoutePlanModel[]
    }> = channel.credentialGroups.length > 0
      ? channel.credentialGroups.map((group) => ({
          id: group.id,
          hasToken: group.hasToken,
          priority: group.priority,
          models: group.models,
        }))
      : [{
          hasToken: channel.hasToken,
          priority: 0,
          models: channel.models,
        }]

    return groupSources.flatMap((group): RoutePlanCandidate[] => {
      const mapped = channel.modelMap?.[logicalModel]?.trim()
      const supportsMapped = mapped
        ? (!group.id && group.models.length === 0) ||
          group.models.some(
            (model) =>
              categoryMatches(model, opts.capability) &&
              (model.id === mapped || upstreamAliasesOf(mapped).includes(model.id)),
          )
        : false
      if (!supportsModel(group.models, opts.capability, logicalModel) && !supportsMapped) return []
      sawModel = true
      if (!group.hasToken) return []
      sawToken = true
      const ref: RouteCandidateRef = {
        channelId: channel.id,
        ...(group.id ? { credentialGroupId: group.id } : {}),
      }
      const key = routeCandidateKey(ref)
      if (useAllowList && !allowed.has(key)) return []
      sawAllowed = true
      const upstreamModel = upstreamOf(channel, group.models, logicalModel)
      if (!upstreamModel) return []
      return [{
        ...ref,
        key,
        logicalModel,
        upstreamModel,
        capability: opts.capability,
        priority: channel.priority,
        groupPriority: group.priority,
        weight: channel.weight,
        latencyMs: channel.lastTestLatency,
      }]
    })
  })

  const deduped = [...new Map(expanded.map((candidate) => [candidate.key, candidate])).values()]
  if (deduped.length === 0) {
    if (useAllowList && sawModel && !sawAllowed) return { ok: false, reason: 'policy_excluded' }
    if (sawModel && !sawToken) return { ok: false, reason: 'no_token' }
    return { ok: false, reason: 'model_missing' }
  }

  const cursor = Math.max(0, Math.trunc(opts.cursor ?? 0))
  let ordered: RoutePlanCandidate[]
  let nextCursor = 0
  let cursorModulus = 1

  if (policy.strategy === 'performance') {
    ordered = deduped.slice().sort(performanceOrder)
  } else if (policy.strategy === 'balanced') {
    const first = weightedPick(deduped, opts.random ?? 0.5)
    ordered = first
      ? [first, ...deduped.filter((candidate) => candidate.key !== first.key).sort(priorityOrder)]
      : deduped.slice().sort(priorityOrder)
    nextCursor = cursor
  } else if (policy.strategy === 'round_robin') {
    const sorted = deduped.slice().sort(priorityOrder)
    const topPriority = sorted[0]!.priority
    const topTier = sorted.filter((candidate) => candidate.priority === topPriority)
    const lowerTiers = sorted.filter((candidate) => candidate.priority !== topPriority)
    const offset = cursor % topTier.length
    ordered = [
      ...topTier.slice(offset),
      ...topTier.slice(0, offset),
      ...lowerTiers,
    ]
    nextCursor = (offset + 1) % topTier.length
    cursorModulus = topTier.length
  } else {
    ordered = deduped.slice().sort(priorityOrder)
  }

  return {
    ok: true,
    plan: {
      logicalModel,
      capability: opts.capability,
      strategy: policy.strategy,
      maxAttempts: policy.maxAttempts,
      cursor: policy.strategy === 'round_robin' ? cursor : 0,
      nextCursor,
      cursorModulus,
      candidates: ordered.slice(0, policy.maxAttempts),
    },
  }
}
