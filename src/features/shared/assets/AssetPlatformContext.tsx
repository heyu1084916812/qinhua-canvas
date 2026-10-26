import { createContext, useContext, type ReactNode } from 'react'
import type { PlatformKit } from '../../../platform/ports'

const AssetPlatformContext = createContext<PlatformKit | null>(null)

export function AssetPlatformProvider({
  platform,
  children,
}: {
  platform: PlatformKit
  children?: ReactNode
}) {
  return (
    <AssetPlatformContext.Provider value={platform}>
      {children}
    </AssetPlatformContext.Provider>
  )
}

export function useAssetPlatform(): PlatformKit {
  const platform = useContext(AssetPlatformContext)
  if (!platform) throw new Error('AssetPlatformProvider is not mounted')
  return platform
}
