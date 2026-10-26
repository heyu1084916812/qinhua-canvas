import { useEffect, useRef, type ReactNode } from 'react'
import { interruptGuardedRunsForRemovedChannels } from '../state/shared/runChannelGuard'
import { useChannels } from './providers/ChannelStoreProvider'

/**
 * 应用级渠道删除守卫。
 *
 * 渠道只能在设置页删除，而画布执行 Provider 会随路由卸载；把监听留在画布里
 * 会让“生成中删除渠道”只在单测和同一页面内成立。本组件常驻路由之外，
 * 只负责把渠道 ID 的消失转交给共享运行登记表。
 */
export function ChannelRemovalGuard({ children }: { children: ReactNode }) {
  const channels = useChannels()
  const knownIdsRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    const sync = () => {
      const nextIds = new Set(channels.getState().channels.map((channel) => channel.id))
      const previous = knownIdsRef.current
      knownIdsRef.current = nextIds
      if (!previous) return
      const removed = new Set([...previous].filter((id) => !nextIds.has(id)))
      interruptGuardedRunsForRemovedChannels(removed)
    }
    sync()
    return channels.subscribe(sync)
  }, [channels])

  return children
}
