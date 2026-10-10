import type { CanvasStore } from './store'

/**
 * **一个项目 = 一个 store 实例**（画布页与电商页共用这一份缓存）。
 *
 * ## 为什么必须缓存（用户 2026-10-06 报的）
 *
 * 原来 `CanvasProject` 被路由上的 `key={projectId}` 整棵重挂，store 随之重建 ——
 * 而**正在跑的生成并没有停**：它带着旧 store 的引用继续跑完、把结果写进旧实例。
 * 于是切走再回来时，看到的是一个「什么都没发生」的新实例：既没有转圈，也等不到那张图，
 * 用户无从判断到底停了没（原话：「生成状态会消失，不知道是否停止了还是怎么回事」）。
 *
 * ## 为什么从两个页面各自的 Map 收成同一份（2026-10-10，对账 #411）
 *
 * 电商页（`pages/EcommercePage`）与画布页（`pages/CanvasPage`）原本**各有一个 Map**，
 * 于是同一个项目会有**两个活着的 store**。实测到的后果（冒烟 G116 ⑦）：
 * 在电商页出一套图 → 点「在画布里打开」→ 画布页的撤销按钮是**灰的** ——
 * 因为那一批操作记在**另一个实例**的撤销栈上。用户按不出撤销，也看不到自己刚做的事还有历史。
 *
 * 两份实例还会各存一份内存图：在画布页改完再回电商页，电商页可能还拿着**旧快照**
 * （两边的 `hydrated` 各自独立，谁都不知道对方改过）。
 *
 * ⇒ 收成这一份：**同一项目无论从哪个入口进来，都是同一个 store**。
 * 运行状态那半边在 `CanvasExecutionProvider`（按 projectId 分桶），与本文件同一条口径。
 *
 * `hydrated` 也一起记：回来时**不要**再从库里 hydrate 一次 —— 那会把内存里正在跑的写入
 * （比如运行刚建出来的承载节点）盖回旧状态。
 */
export interface CachedCanvasStore {
  store: CanvasStore
  hydrated: boolean
}

const cache = new Map<string, CachedCanvasStore>()

/**
 * 取（必要时建）某个项目的 store。
 *
 * `create` 只在**第一次**被调用 —— 调用方把"怎么造这个 store"交给它，缓存本身不关心
 * workbench 之类的参数（画布页与电商页传进来的那份是一样的）。
 */
export function canvasStoreFor(projectId: string, create: () => CanvasStore): CachedCanvasStore {
  const hit = cache.get(projectId)
  if (hit) return hit
  const entry: CachedCanvasStore = { store: create(), hydrated: false }
  cache.set(projectId, entry)
  return entry
}

/**
 * 项目**真的被删掉**时把这条缓存丢掉（否则再建一个同 id 的项目会拿回旧实例）。
 * 现在还没人调用它 —— 留着是给"彻底删除"那条路一个明确的落点，而不是让它去猜。
 */
export function forgetCanvasStore(projectId: string): void {
  cache.delete(projectId)
}

/** 当前缓存了几个项目（诊断与单测用） */
export function canvasStoreCacheSize(): number {
  return cache.size
}

/** 清空缓存（单测用；应用里不该调 —— 清了就等于把运行中的写入丢了） */
export function resetCanvasStoreCache(): void {
  cache.clear()
}
