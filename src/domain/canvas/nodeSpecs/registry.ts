import type { NodeType, NodeData } from '../model/node'
import type { NodeSpec } from './types'

const specs = new Map<NodeType, NodeSpec<NodeData>>()

export function registerSpec(spec: NodeSpec<NodeData>): void {
  if (specs.has(spec.type)) {
    throw new Error(`[nodeSpecs] 重复注册：${spec.type}`)
  }
  specs.set(spec.type, spec)
}

export function getSpec(type: NodeType): NodeSpec<NodeData> | null {
  return specs.get(type) ?? null
}

export function allSpecs(): NodeSpec<NodeData>[] {
  return [...specs.values()]
}

/** 测试与启动时校验用 */
export function registeredTypes(): NodeType[] {
  return [...specs.keys()]
}

export function resetSpecs(): void {
  specs.clear()
}
