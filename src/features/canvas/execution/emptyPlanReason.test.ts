import { describe, it, expect } from 'vitest'
import { emptyPlanReason } from './emptyPlanReason'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { Channel } from '../../../domain/project/channel'

/**
 * 「点了没反应」的兜底解释（用户 2026-09-23）。
 *
 * 这一组断言的价值不在于覆盖率高，而在于**把「不许静默」钉成契约**：
 * 每种会让执行计划为空的状态，都必须能说出一句用户看得懂、且指向下一步动作的理由。
 * 故障注入方式是把某一档的返回改成 null ⇒ 对应用例立刻红。
 */

const GEN = 'node-gen'
const PROMPT = 'node-prompt'

function genNode(overrides: Record<string, unknown> = {}): NodeSnapshot {
  return {
    id: GEN,
    type: 'generation',
    x: 0,
    y: 0,
    w: 320,
    h: 240,
    parentId: null,
    data: {
      mode: 'image',
      prompt: '一只猫',
      channelId: 'ch-1',
      model: 'relay-img',
      count: 1,
      ...overrides,
    },
  } as NodeSnapshot
}

function graph(nodes: NodeSnapshot[], edges: GraphSnapshot['edges'] = []): GraphSnapshot {
  return { projectId: 'p1', nodes, edges } as GraphSnapshot
}

function channel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'ch-1',
    name: '中转站',
    protocol: 'openai-images',
    baseUrl: 'https://relay.example.com',
    credentialRef: null,
    enabled: true,
    models: [],
    modelCache: [],
    createdAt: 1,
    ...overrides,
  } as Channel
}

describe('emptyPlanReason · 计划为空时必须给出可读理由', () => {
  it('一个渠道都没建 → 指出去配置渠道', () => {
    const node = genNode()
    expect(emptyPlanReason(node, [], graph([node]))).toBe('还没有配置任何渠道')
  })

  it('渠道存在但未启用 → 与「没建过」分开说（后者最容易被误以为已配好）', () => {
    const node = genNode()
    expect(emptyPlanReason(node, [channel({ enabled: false })], graph([node]))).toBe(
      '已配置的渠道都未启用',
    )
  })

  it('节点还没选渠道 → 说「还没有选择渠道」，而不是笼统的无法生成', () => {
    const node = genNode({ channelId: '' })
    expect(emptyPlanReason(node, [channel()], graph([node]))).toBe('还没有选择渠道')
  })

  it('所选渠道已停用（节点上留的是旧 id）→ 说得出来', () => {
    const node = genNode({ channelId: 'ch-gone' })
    expect(emptyPlanReason(node, [channel()], graph([node]))).toBe('所选渠道已停用')
  })

  it('渠道在、但没选模型 → 指向「去勾选模型」', () => {
    const node = genNode({ model: '' })
    expect(emptyPlanReason(node, [channel()], graph([node]))).toBe('该渠道还没勾选模型')
  })

  it('模型齐备但正文与上游都没有提示词 → 说「还没有写提示词」', () => {
    const node = genNode({ prompt: '' })
    expect(emptyPlanReason(node, [channel()], graph([node]))).toBe('还没有写提示词')
  })

  it('★ 只连了上游提示词节点、自己正文为空 → 不诬告缺提示词（那条路是通的）', () => {
    const node = genNode({ prompt: '' })
    const prompt: NodeSnapshot = {
      id: PROMPT,
      type: 'prompt',
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      parentId: null,
      data: { text: '上游写好的提示词' },
    } as NodeSnapshot
    const edges = [{ id: 'e1', source: PROMPT, target: GEN }] as GraphSnapshot['edges']
    expect(emptyPlanReason(node, [channel()], graph([node, prompt], edges))).not.toBe(
      '还没有写提示词',
    )
  })

  it('上游提示词节点是空的 → 仍然算「没内容可发」', () => {
    const node = genNode({ prompt: '' })
    const prompt: NodeSnapshot = {
      id: PROMPT,
      type: 'prompt',
      x: 0,
      y: 0,
      w: 200,
      h: 120,
      parentId: null,
      data: { text: '   ' },
    } as NodeSnapshot
    const edges = [{ id: 'e1', source: PROMPT, target: GEN }] as GraphSnapshot['edges']
    expect(emptyPlanReason(node, [channel()], graph([node, prompt], edges))).toBe(
      '还没有写提示词',
    )
  })

  it('节点不存在 → 返回 null（由调用方决定是否提示，不编理由）', () => {
    expect(emptyPlanReason(undefined, [channel()], graph([]))).toBeNull()
  })
})
