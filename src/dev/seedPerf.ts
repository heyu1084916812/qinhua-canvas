import type { CanvasStore } from '../state/workbenches/canvas/store'
import type { NodeType } from '../domain/canvas/model/node'
import { createId } from '../shared/id'

/**
 * 300 节点 / 500 连线性能基准种子（§1.6 画布性能目标的真机验证数据源）。
 * 仅 DEV 挂到 `window.__seedPerfGraph`（CanvasPage 动态 import，生产构建不打包）。
 *
 * 拓扑合法性：generation 接受 prompt / generation 上游（nodeSpecs/generation.ts），
 * 因此按 [prompt, generation] 交替布点，只连「指向 generation」的边。
 */
export function seedPerfGraph(
  store: CanvasStore,
  nodeCount = 300,
  edgeCount = 500,
): { nodes: number; edges: number } {
  const projectId = store.getSnapshot().projectId
  const COLS = 20
  const DX = 240
  const DY = 200

  const types: NodeType[] = []
  const ids: string[] = []
  for (let i = 0; i < nodeCount; i++) {
    const type: NodeType = i % 2 === 0 ? 'prompt' : 'generation'
    const col = i % COLS
    const row = Math.floor(i / COLS)
    const id = createId('node')
    types.push(type)
    ids.push(id)
    store.dispatch({
      kind: 'node.create',
      projectId,
      type,
      at: { x: 40 + col * DX, y: 40 + row * DY },
      id,
    })
  }

  const seen = new Set<string>()
  let made = 0
  outer: for (let span = 1; span <= 4; span++) {
    for (let i = 0; i < nodeCount; i++) {
      const j = (i + span) % nodeCount
      if (types[j] !== 'generation') continue
      // 丢弃回绕边（尾部连到头部），拓扑更真实
      if (i + span >= nodeCount) continue
      const key = `${ids[i]}>${ids[j]}`
      if (seen.has(key)) continue
      seen.add(key)
      store.dispatch({ kind: 'edge.connect', source: ids[i]!, target: ids[j]! })
      made++
      if (made >= edgeCount) break outer
    }
  }
  return { nodes: nodeCount, edges: made }
}
