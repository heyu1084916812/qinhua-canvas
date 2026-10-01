import { describe, expect, it, beforeEach } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import type { AgentPlan } from '../../../domain/agent/plan'
import { createCanvasStore } from '../../../state/workbenches/canvas/store'
import { createMemoryPlatform } from '../../../platform/memory'
import { applyAgentPlan, toGraphView } from './applyAgentPlan'

/**
 * 落地 + 自检的端到端（设计文档 §6.1）。
 *
 * 用户 2026-10-01：「每次落地完，我需要你验证」。这组测试要证明的正是
 * **落地之后画布上的图与计划一致**，而不是「命令没抛错」。
 */

beforeEach(() => registerAllSpecs())

function store() {
  return createCanvasStore({ platform: createMemoryPlatform() as never, projectId: 'p1' })
}

const twoStep: AgentPlan = {
  summary: '提示词 → 生成',
  nodes: [
    { localId: 'p1', type: 'prompt', data: { text: '一只橘猫' }, order: 0 },
    { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
  ],
  edges: [{ source: 'p1', target: 'g1' }],
}

describe('applyAgentPlan · 落地并自检', () => {
  it('★★ 说一句话的计划 → 画布上真的多出两个节点和一条连线，且自检通过', () => {
    const s = store()
    const r = applyAgentPlan(s, twoStep, { x: 0, y: 0 })

    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
    expect(r.createdNodeIds).toHaveLength(2)

    // 回读画布核对 —— 这才是「验证」的实据，不是命令没报错
    const g = s.getSnapshot()
    expect(g.nodes).toHaveLength(2)
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]!.source).toBe(r.createdNodeIds[0])
    expect(g.edges[0]!.target).toBe(r.createdNodeIds[1])
  })

  it('★★ 一次撤销把整份计划全回退（不是点了两次各撤各的）', () => {
    const s = store()
    applyAgentPlan(s, twoStep, { x: 0, y: 0 })
    expect(s.getSnapshot().nodes).toHaveLength(2)

    s.undo()
    expect(s.getSnapshot().nodes).toHaveLength(0)
    expect(s.getSnapshot().edges).toHaveLength(0)
  })

  it('★★ 计划要连到画布上已有的节点 → 连线真的接上（node.paste 做不到这条）', () => {
    const s = store()
    // 先手建一个素材节点，模拟「用户先放了一张图」
    s.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 0, y: 0 },
      data: { mode: 'image' },
    })
    const srcId = s.getSnapshot().nodes[0]!.id

    const plan: AgentPlan = {
      summary: '把已有素材接到新生成节点',
      nodes: [
        { localId: 'src', type: 'generation', data: {}, order: 0 },
        { localId: 'g2', type: 'generation', data: { mode: 'image' }, order: 1 },
      ],
      edges: [{ source: 'src', target: 'g2' }],
      attach: [{ localId: 'src', existingNodeId: srcId }],
    }
    const r = applyAgentPlan(s, plan, { x: 400, y: 0 })

    expect(r.ok).toBe(true)
    const g = s.getSnapshot()
    expect(g.nodes).toHaveLength(2) // 复用的那个不重造
    expect(g.edges).toHaveLength(1)
    expect(g.edges[0]!.source).toBe(srcId)
  })

  it('★ 非法连线（连到自己 / 类型不允许）→ 命令抛错，画布不被改脏', () => {
    const s = store()
    const bad: AgentPlan = {
      summary: 'x',
      nodes: [
        { localId: 'a', type: 'prompt', data: {}, order: 0 },
        { localId: 'b', type: 'prompt', data: {}, order: 1 },
      ],
      // 目标口不存在：提示词节点没有 `patch` 这个输入口（那是融合节点的）
      edges: [{ source: 'a', target: 'b', targetPort: 'patch' }],
    }
    expect(() => applyAgentPlan(s, bad, { x: 0, y: 0 })).toThrow(/不合法/)
    expect(s.getSnapshot().nodes).toHaveLength(0)
  })

  it('toGraphView 只取自检要的字段', () => {
    const s = store()
    applyAgentPlan(s, twoStep, { x: 0, y: 0 })
    const v = toGraphView(s.getSnapshot())
    expect(Object.keys(v.nodes[0]!).sort()).toEqual(['h', 'id', 'type', 'w', 'x', 'y'])
  })

  /**
   * ★★ 补默认配方。
   *
   * 背景（本轮修的真 bug）：别的建节点入口都走 `createNodeWithDefaults`，会带上
   * 默认渠道 + 模型；agent 这条只写 `spec.createDefaultData()`，于是建出来的生成
   * 节点 `channelId` / `model` 是空的 —— `toRunRequest` 见空渠道返回 null ⇒ 节点
   * 不进执行计划 ⇒ 用户点「生成」只看到「还没选择渠道」。
   * 断言到**节点数据**上，而不是「函数被调过」：数据里没有渠道，功能就是坏的。
   */
  it('★★ 落地时把渠道和模型补进节点（不补的话 agent 建的节点点了生成没反应）', () => {
    const s = store()
    applyAgentPlan(s, twoStep, { x: 0, y: 0 }, {
      dataFor: (type) =>
        type === 'generation'
          ? { channelId: 'ch-1', model: 'relay-img', ratio: '1:1' }
          : { channelId: 'ch-2', model: 'relay-chat' },
    })

    const nodes = s.getSnapshot().nodes
    const gen = nodes.find((n) => n.type === 'generation')!.data as Record<string, unknown>
    const prompt = nodes.find((n) => n.type === 'prompt')!.data as Record<string, unknown>
    expect(gen.channelId).toBe('ch-1')
    expect(gen.model).toBe('relay-img')
    // spec 默认值也还在（不是被默认配方整份顶掉）
    expect(gen.mode).toBe('image')
    expect(prompt.channelId).toBe('ch-2')
    expect(prompt.model).toBe('relay-chat')
  })

  it('★ 计划自己点了渠道 / 模型时，以计划为准（默认值只是打底）', () => {
    const s = store()
    const withModel: AgentPlan = {
      ...twoStep,
      nodes: [
        twoStep.nodes[0]!,
        { localId: 'g1', type: 'generation', data: { channelId: 'ch-x', model: 'MJ' }, order: 1 },
      ],
    }
    applyAgentPlan(s, withModel, { x: 0, y: 0 }, {
      dataFor: () => ({ channelId: 'ch-default', model: 'default-model' }),
    })

    const gen = s.getSnapshot().nodes.find((n) => n.type === 'generation')!.data as Record<
      string,
      unknown
    >
    expect(gen.channelId).toBe('ch-x')
    expect(gen.model).toBe('MJ')
  })
})
