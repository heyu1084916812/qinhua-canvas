import {
  normalizeRoutePolicy,
  routeCandidateKey,
  type RouteCapability,
  type RouteCandidateRef,
  type RoutePolicy,
} from '../../domain/project/routePlan'
import type { StoragePort } from '../../platform/ports'

export const ROUTING_POLICY_ROW_ID = 'routing:policy:v1'
export const ROUTING_CURSOR_ROW_ID = 'routing:cursor:v1'

export type RoutingPolicyStore = {
  load(): Promise<RoutePolicy>
  save(policy: RoutePolicy): Promise<void>
  /**
   * 为一次新请求原子领取轮询游标。
   *
   * 游标按“逻辑模型 + 能力”隔离；同一模型的不同能力不能互相推进。
   */
  nextCursor(logicalModel: string, capability: RouteCapability, modulus: number): Promise<number>
}

function normalizeCandidate(value: unknown): RouteCandidateRef | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const channelId = typeof row.channelId === 'string' ? row.channelId.trim() : ''
  if (!channelId) return null
  const credentialGroupId =
    typeof row.credentialGroupId === 'string' && row.credentialGroupId.trim()
      ? row.credentialGroupId.trim()
      : undefined
  return {
    channelId,
    ...(credentialGroupId ? { credentialGroupId } : {}),
  }
}

function normalizePolicy(row: unknown): RoutePolicy {
  if (!row || typeof row !== 'object') return normalizeRoutePolicy(undefined)
  const value = row as Record<string, unknown>
  const allowedCandidates = Array.isArray(value.allowedCandidates)
    ? [...new Map(
        value.allowedCandidates
          .map(normalizeCandidate)
          .filter((candidate): candidate is RouteCandidateRef => candidate !== null)
          .map((candidate) => [routeCandidateKey(candidate), candidate]),
      ).values()]
    : []
  return normalizeRoutePolicy({
    ...(typeof value.strategy === 'string'
      ? { strategy: value.strategy as RoutePolicy['strategy'] }
      : {}),
    ...(typeof value.maxAttempts === 'number'
      ? { maxAttempts: value.maxAttempts }
      : {}),
    allowedCandidates,
  })
}

function cursorKey(logicalModel: string, capability: RouteCapability): string {
  return `${logicalModel.trim()}\u0000${capability}`
}

export function createRoutingPolicyStore(storage: StoragePort): RoutingPolicyStore {
  return {
    async load() {
      try {
        const rows = await storage.query('presets', { id: ROUTING_POLICY_ROW_ID })
        return normalizePolicy(rows[0])
      } catch {
        return normalizeRoutePolicy(undefined)
      }
    },

    async save(policy) {
      const normalized = normalizePolicy(policy)
      await storage.put('presets', {
        id: ROUTING_POLICY_ROW_ID,
        strategy: normalized.strategy,
        maxAttempts: normalized.maxAttempts,
        allowedCandidates: normalized.allowedCandidates,
        updatedAt: Date.now(),
      } as never)
    },

    async nextCursor(logicalModel, capability, modulus) {
      const limit = Math.max(1, Math.trunc(modulus))
      const key = cursorKey(logicalModel, capability)
      return storage.transaction(['presets'], async (tx) => {
        const rows = await tx.query('presets', { id: ROUTING_CURSOR_ROW_ID })
        const row = rows[0] as { cursors?: unknown } | undefined
        const cursors =
          row?.cursors && typeof row.cursors === 'object'
            ? { ...(row.cursors as Record<string, number>) }
            : {}
        const raw = cursors[key]
        const current =
          typeof raw === 'number' && Number.isFinite(raw)
            ? ((Math.trunc(raw) % limit) + limit) % limit
            : 0
        cursors[key] = (current + 1) % limit
        await tx.put('presets', {
          id: ROUTING_CURSOR_ROW_ID,
          cursors,
          updatedAt: Date.now(),
        } as never)
        return current
      })
    },
  }
}
