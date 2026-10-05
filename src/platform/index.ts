import { isTauri } from '@tauri-apps/api/core'
import type { PlatformKit } from './ports'
import { createMemoryPlatform, type MemorySeed } from './memory/index'
import { createWebPlatform } from './web/index'
import { createDesktopPlatform } from './desktop/index'

export type RuntimeId = 'web' | 'memory' | 'desktop'

/**
 * 平台选择：业务代码只接触端口，替换实现时上层零改动（架构 §5.6）。
 *
 * `desktop`（Tauri 壳）已接入（方案 §4.3）——**默认自动判别**：跑在壳里就选 desktop，
 * 否则 web。判据用官方 `isTauri()`（壳注入的全局标志），比 UA 可靠，也不需要在构建期分叉。
 */
export function detectRuntime(): RuntimeId {
  return isTauri() ? 'desktop' : 'web'
}

export function createPlatform(runtime: RuntimeId = detectRuntime(), seed?: MemorySeed): PlatformKit {
  if (runtime === 'memory') return createMemoryPlatform(seed)
  if (runtime === 'desktop') return createDesktopPlatform()
  return createWebPlatform()
}

export type { PlatformKit }
