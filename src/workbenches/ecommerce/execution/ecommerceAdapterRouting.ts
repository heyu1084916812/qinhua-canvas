import type { RunRequest } from '../../../domain/shared/execution/types'
import type { ChannelAdapter } from '../../../platform/channels/types'

export type EcommerceAdapterMap = ReadonlyMap<string, ChannelAdapter>

export function ecommerceAdapterKey(
  channelId: string,
  credentialGroupId: string | undefined,
  kind: string,
): string {
  return `${channelId}\u0000${credentialGroupId ?? ''}\u0000${kind}`
}

export function ecommerceCredentialGroupForAttempt(
  request: Pick<RunRequest, 'credentialGroupId' | 'credentialGroupIds' | 'routingAttempt'>,
): string | undefined {
  const groupIds = request.credentialGroupIds ?? []
  if (groupIds.length > 0) {
    return groupIds[Math.min(request.routingAttempt ?? 0, groupIds.length - 1)]
  }
  return request.credentialGroupId
}

export function resolveEcommerceAdapter(
  adapters: EcommerceAdapterMap | undefined,
  planId: string,
  request: RunRequest,
): ChannelAdapter {
  const groupId = ecommerceCredentialGroupForAttempt(request)
  const adapter = adapters?.get(
    ecommerceAdapterKey(request.channelId, groupId, request.kind),
  )
  if (!adapter) {
    throw new Error(
      `[ecommerce] 计划 ${planId} 的渠道适配器还没准备好（${request.channelId} / ${request.model}）`,
    )
  }
  return adapter
}
