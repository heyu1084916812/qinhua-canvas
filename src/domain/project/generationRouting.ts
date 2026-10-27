import {
  channelIsRoutable,
  type Channel,
} from './channel'
import type { ModelCapability } from '../shared/capability'
import type {
  RunRequest,
  RunRouteCandidate,
} from '../shared/execution/types'
import { resolveUpstreamModel } from './modelMapping'
import {
  resolveRouteFor,
  routeCandidatesFor,
  type RouteChannelSource,
  type RouteStrategy,
} from './modelRouting'
import type { ProtocolCatalog } from './protocol'
import {
  buildRoutePlan,
  type RoutePlan,
  type RoutePlanResult,
  type RoutePolicy,
} from './routePlan'

export type GenerationMediaKind = 'image' | 'video'
export type GenerationRouteKind = GenerationMediaKind | 'chat'

export interface GenerationRoutingRecipe {
  channelId?: string
  model?: string
}

export interface GenerationRoutingTarget {
  channelId: string
  credentialGroupId?: string
  /** 同渠道内按优先级排好的可用 Key 分组；执行器为每个 attempt 建对应适配器。 */
  credentialGroupIds?: string[]
  /** 前端逻辑模型名；节点仍保存这一份，渠道适配器负责再映射到上游 ID。 */
  logicalModel: string
  /** 当前渠道最终要发送的模型 ID，供诊断和后续日志使用。 */
  upstreamModel: string
  usedMock: boolean
}

export interface GenerationAvailability {
  ready: boolean
  reason: string | null
}

/**
 * 生成任务的 RoutePlan 入口。
 *
 * 这里不决定是否换组；只把候选和轮询顺序算成不可变计划。
 */
export function buildGenerationRoutePlan(opts: {
  channels: readonly Channel[]
  category: GenerationRouteKind
  logicalModel: string
  policy?: Partial<RoutePolicy>
  cursor?: number
  random?: number
}): RoutePlanResult {
  return buildRoutePlan({
    channels: opts.channels.map((channel) => ({
      id: channel.id,
      enabled: channel.enabled,
      hasToken: channel.hasToken,
      priority: channel.priority,
      weight: channel.weight,
      lastTestLatency: channel.lastTestLatency,
      models: channel.models,
      modelMap: channel.modelMap,
      credentialGroups: channel.credentialGroups.map((group) => ({
        id: group.id,
        hasToken: group.hasToken,
        priority: group.priority,
        models: group.models,
      })),
    })),
    logicalModel: opts.logicalModel,
    capability: opts.category,
    policy: opts.policy,
    cursor: opts.cursor,
    random: opts.random,
  })
}

export type GenerationRoutePlan = RoutePlan

export function runRouteCandidatesOf(
  plan: RoutePlan,
): RunRouteCandidate[] {
  return plan.candidates.map((candidate) => ({
    channelId: candidate.channelId,
    ...(candidate.credentialGroupId
      ? { credentialGroupId: candidate.credentialGroupId }
      : {}),
    model: candidate.upstreamModel,
  }))
}

/**
 * 把冻结的 RoutePlan 写进请求。
 *
 * 第一个候选同时成为旧宿主读取的 `channelId / model / credentialGroupId`，
 * 让未升级的预检和日志仍能看到本次首选；执行引擎会按 `routeCandidates` 逐次尝试。
 */
export function applyRoutePlanToRequest(
  request: RunRequest,
  plan: RoutePlan,
  routePlanId = `${plan.logicalModel}:${plan.capability}:${plan.strategy}`,
): RunRequest {
  const routeCandidates = runRouteCandidatesOf(plan)
  const first = routeCandidates[0]
  if (!first) return request
  return {
    ...request,
    channelId: first.channelId,
    model: first.model,
    logicalModel: request.logicalModel ?? plan.logicalModel,
    routePlanId,
    routeCandidates,
    ...(first.credentialGroupId
      ? { credentialGroupId: first.credentialGroupId }
      : { credentialGroupId: undefined }),
  }
}

/**
 * 给 Agent 看的生成渠道可用性。
 *
 * `resolveGenerationTarget()` 要具体模型才能选路；Agent 在建图前只需要知道
 * 当前类别有没有一条**现在真能发请求**的渠道。没有这条信息时，执行层会在
 * 计划为空时静默 return，模型只能看到“没有运行记录”，于是把缺渠道误判成
 * 渠道排队或延迟。
 */
export function generationAvailabilityOf(
  channels: readonly Channel[],
  category: GenerationMediaKind,
  catalog?: ProtocolCatalog,
): GenerationAvailability {
  const label = category === 'video' ? '视频' : '图片'
  if (channels.length === 0) {
    return { ready: false, reason: '还没有配置任何渠道' }
  }
  const enabled = channels.filter((channel) => channel.enabled)
  if (enabled.length === 0) {
    return { ready: false, reason: '已配置的渠道都未启用' }
  }
  const routable = enabled.filter((channel) => channelIsRoutable(channel, catalog))
  if (routable.length === 0) {
    return { ready: false, reason: '已启用的渠道缺少有效令牌、地址或可用协议' }
  }
  if (!routable.some((channel) => channel.models.some((model) => model.category === category))) {
    return { ready: false, reason: `可路由的渠道里还没有勾选${label}模型` }
  }
  return { ready: true, reason: null }
}

function sourceOf(channel: Channel): RouteChannelSource {
  return {
    id: channel.id,
    enabled: channel.enabled,
    hasToken: true,
    priority: channel.priority,
    weight: channel.weight,
    lastTestLatency: channel.lastTestLatency,
    modelIds: channel.models.map((model) => model.id),
    modelMap: channel.modelMap,
    credentialGroups: channel.credentialGroups.map((group) => ({
      id: group.id,
      hasToken: group.hasToken,
      priority: group.priority,
      modelIds: group.models.map((model) => model.id),
    })),
  }
}

function capableModels(
  channel: Channel,
  category: GenerationMediaKind,
): ModelCapability[] {
  return channel.models.filter((model) => model.category === category)
}

function firstLogicalModel(
  channel: Channel,
  category: GenerationMediaKind,
  recipe: GenerationRoutingRecipe | undefined,
): string | null {
  const models = capableModels(channel, category)
  const recipeModel = recipe?.model?.trim()
  if (
    recipe?.channelId === channel.id &&
    recipeModel &&
    (models.some((model) => model.id === recipeModel) ||
      Boolean(channel.modelMap?.[recipeModel]?.trim()))
  ) {
    return recipeModel
  }
  return models[0]?.id ?? Object.keys(channel.modelMap ?? {})[0] ?? null
}

function directTarget(
  channel: Channel,
  logicalModel: string,
): GenerationRoutingTarget | null {
  const candidate = routeCandidatesFor(
    [sourceOf(channel)],
    logicalModel,
    resolveUpstreamModel,
  )[0]
  if (!candidate?.enabled || !candidate.hasToken || !candidate.upstreamModel) return null
  return {
    channelId: channel.id,
    ...(candidate.credentialGroupId
      ? { credentialGroupId: candidate.credentialGroupId }
      : {}),
    ...(candidate.credentialGroupIds?.length
      ? { credentialGroupIds: [...candidate.credentialGroupIds] }
      : {}),
    logicalModel,
    upstreamModel: candidate.upstreamModel,
    usedMock: channel.protocol === 'mock',
  }
}

/**
 * 生成节点的统一选路。
 *
 * 关键边界：
 * - 用户选了一个逻辑模型时，只允许真实渠道里的同模型候选参与；
 *   只要存在能跑这一类媒体的真实渠道，就绝不回落到 smoke mock。
 * - 仅在隔离测试库「只有 mock 可用」时保留 mock 兜底，避免把冒烟逼成假绿。
 * - 显式渠道仍优先，但依然要满足媒体类别、启用和可路由条件。
 */
export function resolveGenerationTarget(opts: {
  channels: readonly Channel[]
  category: GenerationMediaKind
  catalog: ProtocolCatalog
  strategy?: RouteStrategy
  logicalModel?: string
  channelId?: string
  recipe?: GenerationRoutingRecipe | null
  random?: number
}): GenerationRoutingTarget | null {
  const {
    channels,
    category,
    catalog,
    strategy = 'priority',
    logicalModel,
    channelId,
    recipe,
    random,
  } = opts
  const capable = channels.filter(
    (channel) =>
      capableModels(channel, category).length > 0 &&
      channelIsRoutable(channel, catalog),
  )
  const real = capable.filter((channel) => channel.protocol !== 'mock')
  const pool = real.length > 0 ? real : capable
  if (pool.length === 0) return null

  const requestedModel = logicalModel?.trim() ?? ''
  if (channelId) {
    const explicit = pool.find((channel) => channel.id === channelId)
    if (explicit) {
      const model = requestedModel || firstLogicalModel(explicit, category, recipe ?? undefined)
      const target = model ? directTarget(explicit, model) : null
      if (target) return target
    }
  }

  if (requestedModel) {
    const route = resolveRouteFor(
      pool.map(sourceOf),
      requestedModel,
      { strategy, resolve: resolveUpstreamModel, ...(random !== undefined ? { random } : {}) },
    )
    return route
      ? {
          channelId: route.channelId,
          ...(route.credentialGroupId
            ? { credentialGroupId: route.credentialGroupId }
            : {}),
          ...(route.credentialGroupIds?.length
            ? { credentialGroupIds: [...route.credentialGroupIds] }
            : {}),
          logicalModel: requestedModel,
          upstreamModel: route.upstreamModel,
          usedMock: pool.find((channel) => channel.id === route.channelId)?.protocol === 'mock',
        }
      : null
  }

  const recipeModel = recipe?.model?.trim() ?? ''
  if (recipeModel) {
    const recipeChannel = recipe?.channelId
      ? pool.find((channel) => channel.id === recipe.channelId)
      : undefined
    if (recipeChannel) {
      const target = directTarget(recipeChannel, recipeModel)
      if (target) return target
    }
    const routed = resolveRouteFor(
      pool.map(sourceOf),
      recipeModel,
      { strategy, resolve: resolveUpstreamModel, ...(random !== undefined ? { random } : {}) },
    )
    if (routed) {
      return {
        channelId: routed.channelId,
        ...(routed.credentialGroupId
          ? { credentialGroupId: routed.credentialGroupId }
          : {}),
        ...(routed.credentialGroupIds?.length
          ? { credentialGroupIds: [...routed.credentialGroupIds] }
          : {}),
        logicalModel: recipeModel,
        upstreamModel: routed.upstreamModel,
        usedMock: pool.find((channel) => channel.id === routed.channelId)?.protocol === 'mock',
      }
    }
  }

  for (const channel of pool) {
    const model = firstLogicalModel(channel, category, recipe ?? undefined)
    if (!model) continue
    const target = directTarget(channel, model)
    if (target) return target
  }
  return null
}
