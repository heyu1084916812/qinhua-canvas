import type { PlatformKit } from '../platform/ports'
import type { GraphSnapshot } from '../domain/canvas/model/graph'
import { createCanvasStore, type CanvasStore, type CanvasStoreOptions } from './workbenches/canvas/store'
import { createComicStore, type ComicStore, type ComicStoreOptions } from './workbenches/comic/store'

/** 工厂公共选项；workbench 决定返回哪个 store 类型（见下方重载） */
export interface CreateStoreOptions {
  platform: PlatformKit
  projectId: string
  /** canvas 专用：初始图快照 */
  initial?: GraphSnapshot
  debounceMs?: number
}

interface CanvasCreateOptions extends CreateStoreOptions {
  workbench: 'canvas'
  initial?: GraphSnapshot
}
interface ComicCreateOptions {
  workbench: 'comic'
  platform: PlatformKit
  projectId: string
}

/**
 * 工厂而非模块级单例（架构 §4.3）：每个工作台页面挂载时调用一次，
 * 注入本工作台的私有切片与命令。共享切片随工厂闭包被引用，
 * 工作台私有切片随路由生命周期创建销毁。
 *
 * 按 workbench 重载返回类型（架构 §5.10）：跨工作台不共用命令联合，
 * 这里是唯一的按 workbench 分支点，返回类型随 workbench 收窄，
 * 调用方无需再手动断言。
 */
export function createStore(opts: CanvasCreateOptions): CanvasStore
export function createStore(opts: ComicCreateOptions): ComicStore
export function createStore(opts: CanvasCreateOptions | ComicCreateOptions): CanvasStore | ComicStore {
  switch (opts.workbench) {
    case 'canvas':
      return createCanvasStore(opts as CanvasStoreOptions)
    case 'comic':
      return createComicStore(opts as unknown as ComicStoreOptions)
    default:
      throw new Error(`未实现的工作台：${(opts as { workbench: string }).workbench}`)
  }
}
