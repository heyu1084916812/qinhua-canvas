import type { PlatformKit } from './ports'
import { createMemoryPlatform, type MemorySeed } from './memory/index'
import { createWebPlatform } from './web/index'

export type RuntimeId = 'web' | 'memory'

/**
 * 平台选择：业务代码只接触端口，替换实现时上层零改动（架构 §5.6）。
 * 桌面壳（Tauri）后续接入时在这里增加一个分支即可。
 */
export function createPlatform(runtime: RuntimeId = 'web', seed?: MemorySeed): PlatformKit {
  return runtime === 'memory' ? createMemoryPlatform(seed) : createWebPlatform()
}

export type { PlatformKit }
