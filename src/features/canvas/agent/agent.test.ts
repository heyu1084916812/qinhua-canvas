import { describe, it, expect } from 'vitest'
import {
  assertAllowed,
  isToolAllowed,
  isNodeEditable,
  requiresConfirm,
  targetNodeIdsOf,
  assertWithinSteps,
  type AgentScope,
  type ToolCall,
} from './scopeGuard'

function makeScope(over: Partial<AgentScope> = {}): AgentScope {
  return {
    projectId: 'p1',
    editableNodeIds: ['n1', 'n2'],
    allowedTools: ['createNode', 'connectNodes', 'updateParams'],
    maxSteps: 10,
    requireConfirm: ['deleteNode', 'runGeneration'],
    ...over,
  }
}

describe('agent scopeGuard', () => {
  it('isToolAllowed / requiresConfirm 按白名单判定', () => {
    const s = makeScope()
    expect(isToolAllowed(s, 'createNode')).toBe(true)
    expect(isToolAllowed(s, 'deleteNode')).toBe(false)
    expect(requiresConfirm(s, 'deleteNode')).toBe(true)
    expect(requiresConfirm(s, 'createNode')).toBe(false)
  })

  it('isNodeEditable 支持 all 与白名单', () => {
    expect(isNodeEditable(makeScope(), 'n1')).toBe(true)
    expect(isNodeEditable(makeScope(), 'n9')).toBe(false)
    expect(isNodeEditable(makeScope({ editableNodeIds: 'all' }), 'n9')).toBe(true)
  })

  it('targetNodeIdsOf 兼容 nodeId / nodeIds', () => {
    expect(targetNodeIdsOf({ id: 't', name: 'createNode', args: { nodeId: 'a' } })).toEqual(['a'])
    expect(targetNodeIdsOf({ id: 't', name: 'createNode', args: { nodeIds: ['a', 'b'] } })).toEqual([
      'a',
      'b',
    ])
    expect(targetNodeIdsOf({ id: 't', name: 'createNode', args: {} })).toEqual([])
  })

  it('assertAllowed 通过：白名单工具 + 节点在范围内', () => {
    expect(() =>
      assertAllowed(makeScope(), { id: 't', name: 'createNode', args: { nodeId: 'n1' } }),
    ).not.toThrow()
  })

  it('assertAllowed 抛错：工具未授权', () => {
    const call: ToolCall = { id: 't', name: 'deleteNode', args: { nodeId: 'n1' } }
    expect(() => assertAllowed(makeScope(), call)).toThrow(/未被允许/)
  })

  it('assertAllowed 抛错：节点越权', () => {
    const call: ToolCall = { id: 't', name: 'createNode', args: { nodeId: 'n9' } }
    expect(() => assertAllowed(makeScope(), call)).toThrow(/不在可编辑范围/)
  })

  it('assertWithinSteps 越界抛错', () => {
    expect(() => assertWithinSteps(makeScope({ maxSteps: 3 }), 3)).toThrow(/最大步数/)
    expect(() => assertWithinSteps(makeScope({ maxSteps: 3 }), 2)).not.toThrow()
  })
})
