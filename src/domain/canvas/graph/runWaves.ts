import type { EdgeLike } from '../model/graph'

/**
 * 把「这一批要运行的节点」按**依赖**切成几波：同一波里的节点互不依赖，可以同时跑；
 * 下一波必须等上一波结束。
 *
 * 用户 2026-10-05 第 2 条：「我并行的要求没有给我实现，应该是同时生成的，但是他是
 * 先生成一个再生成另外一个」 —— agent 一次 `runNode([A, B])` 时，`A → B` 有依赖就
 * 只能按顺序；**没有依赖的（两个各自独立的生成）本该同时发请求**，之前那条 `for` 循环
 * 把它们也串起来跑了，一倍的时间白白花掉。
 *
 * 规则：
 * - 只在这些 id **内部**看依赖（集合外的节点不参与，也管不着）；
 * - 同一波内保持传入顺序（结果可预期、可断言）；
 * - 有环时把剩下的当作最后一波（不卡死 —— 环本身该由别处拦，这里只负责「别停住」）。
 */
export function runWaves(ids: readonly string[], edges: readonly EdgeLike[]): string[][] {
  const wanted = new Set(ids)
  const preds = new Map<string, string[]>()
  for (const id of ids) preds.set(id, [])
  for (const e of edges) {
    if (!wanted.has(e.source) || !wanted.has(e.target)) continue
    preds.get(e.target)!.push(e.source)
  }

  const waves: string[][] = []
  const done = new Set<string>()
  let rest = [...ids]
  while (rest.length > 0) {
    const ready = rest.filter((id) => preds.get(id)!.every((p) => done.has(p)))
    if (ready.length === 0) {
      /** 环：剩下的当一波，交给执行层去报各自的错，别在这里空转 */
      waves.push(rest)
      break
    }
    waves.push(ready)
    for (const id of ready) done.add(id)
    rest = rest.filter((id) => !done.has(id))
  }
  return waves
}
