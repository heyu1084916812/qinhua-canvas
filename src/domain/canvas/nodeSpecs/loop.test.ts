/**
 * 循环节点规格的单测（§6.22）。
 *
 * 重点钉住两条**结构性质**：
 * 1. 它**不能生成**（自己不产图，`generate` 必须缺席）；
 * 2. 它**转发上游输入**（下游连上它就能拿到本轮那份素材/提示词）。
 *
 * 轮次展开的正确性在 `domain/canvas/loop/loopPlan.test.ts`（20 项），
 * 这里只管「接进节点体系」这一层。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import type { GraphSnapshot } from '../model/graph'
import type { Edge } from '../model/edge'
import { resetSpecs, getSpec } from './registry'
import { registerAllSpecs } from './index'
import { canConnect } from '../graph/canConnect'
import type { NodeSnapshot } from '../model/node'

function node(id: string, type: NodeSnapshot['type'], data: Partial<NodeSnapshot['data']> = {}): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type,
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 192,
    title: id,
    disabled: false,
    data: data as NodeSnapshot['data'],
  }
}

const edge = (id: string, source: string, target: string): Edge => ({
  id,
  projectId: 'p1',
  source,
  target,
})

function graph(nodes: NodeSnapshot[], edges: Edge[] = []): GraphSnapshot {
  return { projectId: 'p1', nodes, edges }
}

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

describe('loopSpec / 结构', () => {
  it('注册了循环节点规格', () => {
    expect(getSpec('loop')).toBeTruthy()
    expect(getSpec('loop')?.label).toBe('循环节点')
  })

  it('★ 不能生成（循环节点自己不产图，`generate` 必须缺席）', () => {
    const spec = getSpec('loop')!
    expect(spec.generate).toBeUndefined()
    expect(spec.toRunRequest).toBeUndefined()
  })

  it('有进有出（下游靠连它拿到本轮输入）', () => {
    const spec = getSpec('loop')!
    expect(spec.ports).toEqual({ input: true, output: true })
  })

  it('默认数据可用：3 轮、串行、两个开关都开', () => {
    const d = getSpec('loop')!.createDefaultData()
    expect(d).toMatchObject({ count: 3, loopStart: 1, batch: 1, mode: 'serial' })
    expect(d).toMatchObject({ useImageInput: true, usePrompt: true })
    expect(Array.isArray((d as { prompts: string[] }).prompts)).toBe(true)
  })
})

describe('loopSpec / collectInputs 转发上游', () => {
  it('开着 usePrompt 时，把上游提示词转发出去', () => {
    const g = graph([
      node('p', 'prompt', { text: '一只猫' } as never),
      node('l', 'loop', getSpec('loop')!.createDefaultData()),
    ], [edge('e1', 'p', 'l')])
    const spec = getSpec('loop')!
    const inputs = spec.collectInputs({ node: g.nodes[1], graph: g })
    expect(inputs).toEqual([{ kind: 'text', nodeId: 'p', text: '一只猫' }])
  })

  it('★ 关掉 usePrompt 时不转发提示词', () => {
    const d = { ...getSpec('loop')!.createDefaultData(), usePrompt: false }
    const g = graph([
      node('p', 'prompt', { text: '一只猫' } as never),
      node('l', 'loop', d),
    ], [edge('e1', 'p', 'l')])
    expect(getSpec('loop')!.collectInputs({ node: g.nodes[1], graph: g })).toEqual([])
  })

  it('空白提示词不转发（不产生空输入项）', () => {
    const g = graph([
      node('p', 'prompt', { text: '   ' } as never),
      node('l', 'loop', getSpec('loop')!.createDefaultData()),
    ], [edge('e1', 'p', 'l')])
    expect(getSpec('loop')!.collectInputs({ node: g.nodes[1], graph: g })).toEqual([])
  })
})

describe('循环节点的连线合法性', () => {
  it('上游可以连进循环节点', () => {
    const g = graph([
      node('g1', 'generation'),
      node('l', 'loop', getSpec('loop')!.createDefaultData()),
    ])
    expect(canConnect(g.nodes[0], g.nodes[1], g)).toEqual({ ok: true })
  })

  it('循环节点可以连到下游生成节点', () => {
    const g = graph([
      node('l', 'loop', getSpec('loop')!.createDefaultData()),
      node('g1', 'generation'),
    ])
    expect(canConnect(g.nodes[0], g.nodes[1], g)).toEqual({ ok: true })
  })

  it('★ 不能连成环（循环节点的下游不能再连回它自己）', () => {
    const g = graph(
      [
        node('l', 'loop', getSpec('loop')!.createDefaultData()),
        node('g1', 'generation'),
      ],
      [edge('e1', 'l', 'g1')],
    )
    // g1 → l 会形成环 l → g1 → l
    const r = canConnect(g.nodes[1], g.nodes[0], g)
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toContain('环路')
  })
})
