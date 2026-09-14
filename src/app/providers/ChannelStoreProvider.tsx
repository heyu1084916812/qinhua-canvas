import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { usePlatform } from './PlatformProvider'
import { createChannelStore, type ChannelStore } from '../../state/channel/channelStore'

/**
 * 渠道 store 是应用级单例（渠道配置跨项目共享，存 IndexedDB），
 * 由平台端口构造，挂在路由之上供设置页与画布节点消费。
 *
 * 挂载即加载：画布生成节点的「平台下拉」依赖 enabledChannels()，
 * 不能假设用户先逛过设置页；因此在应用启动（Provider 挂载）时统一 load()。
 */
export const ChannelStoreContext = createContext<ChannelStore | null>(null)

export function ChannelStoreProvider({ children }: { children?: ReactNode }) {
  const platform = usePlatform()
  const store = useMemo(() => createChannelStore(platform), [platform])
  useEffect(() => {
    void store.load()
  }, [store])
  return <ChannelStoreContext.Provider value={store}>{children}</ChannelStoreContext.Provider>
}

export function useChannels(): ChannelStore {
  const s = useContext(ChannelStoreContext)
  if (!s) throw new Error('ChannelStoreProvider 未挂载')
  return s
}
