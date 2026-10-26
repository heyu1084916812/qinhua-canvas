import {
  protocolNeedsNoToken,
  type Channel,
  type ChannelCredentialGroup,
} from '../../domain/project/channel'
import { resolveUpstreamModel } from '../../domain/project/modelMapping'
import { upstreamAliasesOf } from '../../domain/project/modelPresets'
import type { ProtocolCatalog } from '../../domain/project/protocol'
import type { PlatformKit } from '../ports'
import type {
  ChannelAdapter,
  GeneratedAsset,
  ImageRunRequest,
  SpeechRunRequest,
  TextResult,
  TextRunRequest,
  VideoRunRequest,
} from '../channels/types'
import { ChannelError } from '../channels/types'
import {
  createChannelAdapter,
  type ResolvedChannelConfig,
} from '../channels/registry'
import { asAppError, errorTextOf, type AppError } from '../../shared/result'
import { resolvedChannelConfig } from './channelAdapterConfig'

export interface GenerationHints {
  /**
   * 调用方已经完成逻辑名 -> 上游 ID 映射时置 true。
   * 网关不会再按映射表翻译第二次。
   */
  modelIsUpstream?: boolean
  /** 已完成选路时命中的分组。显式给出后不再猜其他分组。 */
  credentialGroupId?: string
  /** 同一渠道内按优先级排好的分组候选。网关只选第一个可用项，不自行重试。 */
  credentialGroupIds?: readonly string[]
  /** 只给运行留痕用；不参与渠道执行。 */
  operationId?: string
}

export interface ResolvedGenerationTarget {
  channelId: string
  channelName: string
  protocol: string
  credentialGroupId?: string
  upstreamModel: string
  config: ResolvedChannelConfig
  adapter: ChannelAdapter
}

export interface GenerationAttemptEvent {
  operationId?: string
  kind: 'image' | 'video' | 'text' | 'speech'
  channelId: string
  channelName: string
  credentialGroupId?: string
  requestedModel: string
  sentModel: string
  startedAt: number
  finishedAt: number
  durationMs: number
  status: 'succeeded' | 'failed'
  outputCount?: number
  error?: AppError
  errorText?: string
}

export interface GenerationClientDeps {
  platform: PlatformKit
  /** 每次现取，确保用户刚改的自建协议立即生效。 */
  catalog: () => ProtocolCatalog
  loadToken: (credentialRef: string) => Promise<string | null>
  createAdapter?: (config: ResolvedChannelConfig, platform: PlatformKit) => ChannelAdapter
  now?: () => number
  /** 统一留痕入口；观察器失败不能打断已发出的付费请求。 */
  onAttempt?: (event: GenerationAttemptEvent) => void
}

export interface GenerationClient {
  resolve(args: {
    channel: Channel
    request: { model: string }
    hints?: GenerationHints
    kind: GenerationAttemptEvent['kind']
  }): Promise<ResolvedGenerationTarget>
  completeText(
    args: {
      channel: Channel
      model: string
      request: Omit<TextRunRequest, 'channelId' | 'model'>
      hints?: GenerationHints
    },
    signal: AbortSignal,
  ): Promise<TextResult>
  generateImage(
    args: {
      channel: Channel
      model: string
      request: Omit<ImageRunRequest, 'channelId' | 'model'>
      hints?: GenerationHints
    },
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]>
  generateVideo(
    args: {
      channel: Channel
      model: string
      request: Omit<VideoRunRequest, 'channelId' | 'model'>
      hints?: GenerationHints
    },
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]>
  generateSpeech(
    args: {
      channel: Channel
      model: string
      request: Omit<SpeechRunRequest, 'channelId' | 'model'>
      hints?: GenerationHints
    },
    signal: AbortSignal,
  ): Promise<GeneratedAsset>
}

type GroupSelection =
  | {
      group: ChannelCredentialGroup
      token: string | null
      altToken: string | null
    }
  | {
      group: null
      token: string | null
      altToken: string | null
    }

function groupsByPriority(channel: Channel): ChannelCredentialGroup[] {
  return [...channel.credentialGroups].sort(
    (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
  )
}

function modelIdsOf(
  channel: Channel,
  requestedModel: string,
  modelIsUpstream: boolean,
): string[] {
  const mapped = modelIsUpstream
    ? requestedModel
    : (resolveUpstreamModel(channel.modelMap, requestedModel) ?? requestedModel)
  return [
    requestedModel,
    mapped,
    ...upstreamAliasesOf(requestedModel),
    ...upstreamAliasesOf(mapped),
  ].filter((value, index, all) => value.trim() !== '' && all.indexOf(value) === index)
}

function groupSupportsModel(
  group: ChannelCredentialGroup,
  modelIds: readonly string[],
): boolean {
  const available = new Set(group.models.map((model) => model.id))
  return modelIds.some((modelId) => available.has(modelId))
}

function missingChannel(): ChannelError {
  return new ChannelError({
    kind: 'channel',
    detail: 'missingChannel',
  })
}

function unavailableChannel(channel: Channel): ChannelError {
  return new ChannelError({
    kind: 'validation',
    field: '渠道',
    reason: `「${channel.name}」已停用`,
  })
}

function missingKey(): ChannelError {
  return new ChannelError({ kind: 'channel', detail: 'missingKey' })
}

function missingModel(): ChannelError {
  return new ChannelError({ kind: 'channel', detail: 'missingModel' })
}

function unsupported(): ChannelError {
  return new ChannelError({ kind: 'channel', detail: 'unsupported' })
}

function safeEmit(
  observer: GenerationClientDeps['onAttempt'],
  event: GenerationAttemptEvent,
): void {
  if (!observer) return
  try {
    observer(event)
  } catch {
    // 留痕失败不能把已经成功的生成改写成失败，更不能触发重发。
  }
}

/**
 * 单次生成网关。
 *
 * 只负责四件事：选凭据分组、读 Key、映射模型、创建协议适配器。
 * 它不持有任务状态、不重试、不写 RunRecord；这些仍由 runEngine / 工作台调度器负责。
 */
export function createGenerationClient(
  deps: GenerationClientDeps,
): GenerationClient {
  const now = deps.now ?? (() => Date.now())
  const createAdapter =
    deps.createAdapter ??
    ((config: ResolvedChannelConfig, platform: PlatformKit) =>
      createChannelAdapter(config, platform))

  const tokenAllowsMissing = (channel: Channel): boolean =>
    protocolNeedsNoToken(channel.protocol, deps.platform.cli != null, deps.catalog())

  const chooseGroup = async (
    channel: Channel,
    requestedModel: string,
    hints: GenerationHints | undefined,
  ): Promise<GroupSelection> => {
    if (!channel.id.trim()) throw missingChannel()
    if (!channel.enabled) throw unavailableChannel(channel)

    const modelIds = modelIdsOf(
      channel,
      requestedModel,
      hints?.modelIsUpstream === true,
    )
    const groups = groupsByPriority(channel)
    const legacyAltToken = channel.altCredentialRef
      ? await deps.loadToken(channel.altCredentialRef)
      : null
    const explicitIds =
      hints?.credentialGroupIds?.length
        ? [...hints.credentialGroupIds]
        : hints?.credentialGroupId
          ? [hints.credentialGroupId]
          : []

    if (explicitIds.length > 0) {
      const explicitGroups = explicitIds.map((groupId) =>
        groups.find((group) => group.id === groupId),
      )
      const unknown = explicitIds.find((_, index) => !explicitGroups[index])
      if (unknown) {
        throw new ChannelError({
          kind: 'validation',
          field: 'Key 分组',
          reason: '选中的 Key 分组已经删除',
        })
      }

      let sawMissingToken = false
      for (const group of explicitGroups) {
        if (!group) continue
        const token = await deps.loadToken(group.credentialRef)
        if (!token && !tokenAllowsMissing(channel)) {
          sawMissingToken = true
          continue
        }
        return { group, token, altToken: legacyAltToken }
      }
      if (sawMissingToken) throw missingKey()
      throw missingKey()
    }

    const legacyToken = channel.credentialRef
      ? await deps.loadToken(channel.credentialRef)
      : null
    for (const group of groups) {
      if (!groupSupportsModel(group, modelIds)) continue
      const token = await deps.loadToken(group.credentialRef)
      if (!token && !tokenAllowsMissing(channel)) continue
      return {
        group,
        token,
        altToken: legacyAltToken,
      }
    }

    if (legacyToken || legacyAltToken || tokenAllowsMissing(channel)) {
      return { group: null, token: legacyToken, altToken: legacyAltToken }
    }
    if (
      groups.length > 0 &&
      !groups.some((group) => groupSupportsModel(group, modelIds))
    ) {
      throw missingModel()
    }
    throw missingKey()
  }

  const resolve: GenerationClient['resolve'] = async ({
    channel,
    request,
    hints,
    kind,
  }) => {
    if (!request.model.trim()) throw missingModel()
    const selected = await chooseGroup(channel, request.model, hints)
    const upstreamModel =
      hints?.modelIsUpstream === true
        ? request.model.trim()
        : (resolveUpstreamModel(channel.modelMap, request.model) ?? request.model.trim())

    const ordinaryPrimaryKey = selected.token

    /**
     * 65535 的合并渠道把对话 Key 放主槽、生图/视频 Key 放备用槽。
     * 这里不能靠调用方各自记得；否则画布修好了，漫剧直连仍会拿错 Key。
     */
    const is65535NonText = channel.protocol === '65535' && kind !== 'text'
    const apiKey = is65535NonText ? null : ordinaryPrimaryKey
    const altApiKey = is65535NonText
      ? (ordinaryPrimaryKey ?? selected.altToken)
      : selected.altToken

    const baseConfig = resolvedChannelConfig(
      channel,
      deps.catalog(),
      apiKey,
      altApiKey,
    )
    const config: ResolvedChannelConfig = selected.group
      ? {
          ...baseConfig,
          credentialRef: selected.group.credentialRef,
          modelCache: selected.group.modelCache,
        }
      : baseConfig

    return {
      channelId: channel.id,
      channelName: channel.name,
      protocol: channel.protocol,
      ...(selected.group ? { credentialGroupId: selected.group.id } : {}),
      upstreamModel,
      config,
      adapter: createAdapter(config, deps.platform),
    }
  }

  const attempt = async <T>(
    args: {
      channel: Channel
      request: { model: string }
      hints?: GenerationHints
      kind: GenerationAttemptEvent['kind']
    },
    signal: AbortSignal,
    invoke: (target: ResolvedGenerationTarget) => Promise<T>,
    outputCount: (result: T) => number,
  ): Promise<T> => {
    const startedAt = now()
    let target: ResolvedGenerationTarget | null = null
    try {
      target = await resolve(args)
      if (signal.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new DOMException('Aborted', 'AbortError')
      }
      const result = await invoke(target)
      const finishedAt = now()
      safeEmit(deps.onAttempt, {
        ...(args.hints?.operationId
          ? { operationId: args.hints.operationId }
          : {}),
        kind: args.kind,
        channelId: target.channelId,
        channelName: target.channelName,
        ...(target.credentialGroupId
          ? { credentialGroupId: target.credentialGroupId }
          : {}),
        requestedModel: args.request.model,
        sentModel: target.upstreamModel,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        status: 'succeeded',
        outputCount: outputCount(result),
      })
      return result
    } catch (error) {
      const finishedAt = now()
      safeEmit(deps.onAttempt, {
        ...(args.hints?.operationId
          ? { operationId: args.hints.operationId }
          : {}),
        kind: args.kind,
        channelId: args.channel.id,
        channelName: args.channel.name,
        ...(target?.credentialGroupId
          ? { credentialGroupId: target.credentialGroupId }
          : {}),
        requestedModel: args.request.model,
        sentModel: target?.upstreamModel ?? args.request.model,
        startedAt,
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        status: 'failed',
        ...(asAppError(error) ? { error: asAppError(error)! } : {}),
        errorText: errorTextOf(error),
      })
      throw error
    }
  }

  return {
    resolve,
    completeText: (args, signal) =>
      attempt(
        {
          channel: args.channel,
          request: { model: args.model },
          ...(args.hints ? { hints: args.hints } : {}),
          kind: 'text',
        },
        signal,
        (target) =>
          target.adapter.completeText(
            {
              ...args.request,
              kind: 'text',
              channelId: target.channelId,
              model: target.upstreamModel,
            },
            signal,
          ),
        () => 1,
      ),
    generateImage: (args, signal) =>
      attempt(
        {
          channel: args.channel,
          request: { model: args.model },
          ...(args.hints ? { hints: args.hints } : {}),
          kind: 'image',
        },
        signal,
        (target) =>
          target.adapter.generateImage(
            {
              ...args.request,
              kind: 'image',
              channelId: target.channelId,
              model: target.upstreamModel,
            },
            signal,
          ),
        (result) => result.length,
      ),
    generateVideo: (args, signal) =>
      attempt(
        {
          channel: args.channel,
          request: { model: args.model },
          ...(args.hints ? { hints: args.hints } : {}),
          kind: 'video',
        },
        signal,
        (target) =>
          target.adapter.generateVideo(
            {
              ...args.request,
              kind: 'video',
              channelId: target.channelId,
              model: target.upstreamModel,
            },
            signal,
          ),
        (result) => result.length,
      ),
    generateSpeech: (args, signal) =>
      attempt(
        {
          channel: args.channel,
          request: { model: args.model },
          ...(args.hints ? { hints: args.hints } : {}),
          kind: 'speech',
        },
        signal,
        (target) => {
          if (!target.adapter.generateSpeech) throw unsupported()
          return target.adapter.generateSpeech(
            {
              ...args.request,
              channelId: target.channelId,
              model: target.upstreamModel,
            },
            signal,
          )
        },
        () => 1,
      ),
  }
}
