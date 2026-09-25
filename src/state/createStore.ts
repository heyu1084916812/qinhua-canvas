import type { PlatformKit } from '../platform/ports'
import type { GraphSnapshot } from '../domain/canvas/model/graph'
import { createCanvasStore, type CanvasStore, type CanvasStoreOptions } from './workbenches/canvas/store'

/**
 * 工厂公共选项。
 *
 * 2026-09-25：漫画剧（comic）工作台已移除，这里不再有按 workbench 的重载分支。
 * `workbench` 字段与分支结构**刻意保留**（而不是直接内联成 createCanvasStore）：
 * 它是「多工作台」这个骨架的最后一段，下一个工作台（漫剧）接入时只需加一条 case。
 */
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

/**
 * 工厂而非模块级单例（架构 §4.3）：每个工作台页面挂载时调用一次，
 * 注入本工作台的私有切片与命令。共享切片随工厂闭包被引用，
 * 工作台私有切片随路由生命周期创建销毁。
 *
 * 按 workbench 重载返回类型（架构 §5.10）：跨工作台不共用命令联合，
 * 这里是唯一的按 workbench 分支点，返回类型随 workbench 收窄，
 * 调用方无需再手动断言。
 */
export function createStore(opts: CanvasCreateOptions): CanvasStore {
  switch (opts.workbench) {
    case 'canvas':
      return createCanvasStore(opts as CanvasStoreOptions)
    default:
      throw new Error(`未实现的工作台：${(opts as { workbench: string }).workbench}`)
  }
}
