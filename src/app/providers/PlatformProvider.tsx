import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { PlatformKit } from '../../platform/ports'
import { createPlatform, detectRuntime, type RuntimeId } from '../../platform'

/**
 * 平台注入（架构 §5.6）：业务代码只接触 PlatformKit 端口，
 * 替换 Web / 内存 / 桌面壳实现时上层零改动。
 * runtime **不传就自动判别**（壳里 = desktop，否则 web；见 `createPlatform` / `detectRuntime`）；
 * 测试与无 DOM 环境可显式传 memory 走内存实现。
 *
 * create：可选工厂。陈列室需要一个「内存平台 + 离线网络层」的组合，
 * 在不新增 RuntimeId 的前提下用工厂注入，避免把测试专用实现塞进 platform/index。
 */
const PlatformContext = createContext<PlatformKit | null>(null)

export function PlatformProvider({
  children,
  runtime,
  create,
}: {
  children?: ReactNode
  runtime?: RuntimeId
  create?: () => PlatformKit
}) {
  /**
   * 最终用的是哪一档实现，落到 `<html data-platform>` 上。
   *
   * 为什么要有这个锚点：桌面壳里"看得见"的那半（画布、素材、导入）**自动化进不去**，
   * 而"壳里到底选的是哪一档平台"是 P1 唯一必须被证明的事 —— 有了它，用 WebView2 的
   * 远程调试端口接上去就能断言（`probe-tauri-shell.mjs`）。
   * 与 `data-canvas-engine="rf"` 同一套做法：环境事实写进 DOM，而不是靠"看起来对"。
   */
  const resolved: RuntimeId = runtime ?? detectRuntime()
  const platform = useMemo(() => create?.() ?? createPlatform(resolved), [create, resolved])
  useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.platform = resolved
  }, [resolved])
  return <PlatformContext.Provider value={platform}>{children}</PlatformContext.Provider>
}

export function usePlatform(): PlatformKit {
  const p = useContext(PlatformContext)
  if (!p) throw new Error('PlatformProvider 未挂载')
  return p
}
