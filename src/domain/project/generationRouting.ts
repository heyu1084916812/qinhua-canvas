import {
  channelIsRoutable,
  type Channel,
} from './channel'
import type { ModelCapability } from '../shared/capability'
import { resolveUpstreamModel } from './modelMapping'
import {
  resolveRouteFor,
  routeCandidatesFor,
  type RouteChannelSource,
  type RouteStrategy,
} from './modelRouting'
import type { ProtocolCatalog } from './protocol'

export type GenerationMediaKind = 'image' | 'video'

export interface GenerationRoutingRecipe {
  channelId?: string
  model?: string
}

export interface GenerationRoutingTarget {
  channelId: string
  /** 前端逻辑模型名；节点仍保存这一份，渠道适配器负责再映射到上游 ID。 */
  logicalModel: string
  /** 当前渠道最终要发送的模型 ID，供诊断和后续日志使用。 */
  upstreamModel: string
  usedMock: boolean
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
