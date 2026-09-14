import { createContext, useContext, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PlatformKit } from '../../platform/ports'
import { createPlatform, type RuntimeId } from '../../platform'

/**
 * 平台注入（架构 §5.6）：业务代码只接触 PlatformKit 端口，
 * 替换 Web / 内存 / 桌面壳实现时上层零改动。
 * runtime 默认 web；测试与无 DOM 环境可传 memory 走内存实现。
 *
 * create：可选工厂。陈列室需要一个「内存平台 + 离线网络层」的组合，
 * 在不新增 RuntimeId 的前提下用工厂注入，避免把测试专用实现塞进 platform/index。
 */
const PlatformContext = createContext<PlatformKit | null>(null)

export function PlatformProvider({
  children,
  runtime = 'web',
  create,
}: {
  children?: ReactNode
  runtime?: RuntimeId
  create?: () => PlatformKit
}) {
  const platform = useMemo(() => create?.() ?? createPlatform(runtime), [create, runtime])
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
}

export function usePlatform(): PlatformKit {
  const p = useContext(PlatformContext)
  if (!p) throw new Error('PlatformProvider 未挂载')
  return p
}
