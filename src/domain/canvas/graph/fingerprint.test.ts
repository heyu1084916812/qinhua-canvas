import { describe, it, expect } from 'vitest'
import { fingerprintOf } from './fingerprint'
import type { NodeSnapshot, GenerationData, PromptData } from '../model/node'

function genNode(overrides: Partial<GenerationData> = {}): NodeSnapshot<GenerationData> {
  return {
    id: 'g1',
    projectId: 'p1',
    type: 'generation',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 240,
    title: '生成',
    disabled: false,
    data: {
      mode: 'image',
      prompt: '一只猫',
      linkedPromptNodeIds: [],
      channelId: 'ch1',
      model: 'm1',
      thumbOrder: [],
      upstreamHidden: [],
      ...overrides,
    },
  }
}

function promptNode(text: string): NodeSnapshot<PromptData> {
  return {
    id: 'p1',
    projectId: 'p1',
    type: 'prompt',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    title: '提示词',
    disabled: false,
    data: { text, upstreamPromptLinked: false },
  }
}

describe('节点指纹', () => {
  it('同样的参数与输入得到同样的指纹', () => {
    const inputs = [{ kind: 'text' as const, nodeId: 'p1', text: '你好' }]
    expect(fingerprintOf(genNode(), inputs)).toBe(fingerprintOf(genNode(), inputs))
  })

  it('参数变化 / 上游文本变化都会改变指纹', () => {
    const inputs = [{ kind: 'text' as const, nodeId: 'p1', text: '你好' }]
    const base = fingerprintOf(genNode(), inputs)
    expect(fingerprintOf(genNode({ prompt: '一只狗' }), inputs)).not.toBe(base)
    const otherInputs = [{ kind: 'text' as const, nodeId: 'p1', text: '世界' }]
    expect(fingerprintOf(genNode(), otherInputs)).not.toBe(base)
  })

  it('产物与展示态字段不参与指纹：assetHash / thumbOrder 变化不算输入变了', () => {
    const inputs = [{ kind: 'text' as const, nodeId: 'p1', text: '你好' }]
    const base = fingerprintOf(genNode(), inputs)
    expect(fingerprintOf(genNode({ assetHash: 'abc' }), inputs)).toBe(base)
    expect(fingerprintOf(genNode({ thumbOrder: ['a', 'b'] }), inputs)).toBe(base)
  })

  /**
   * §6.16：产物真实像素是**写回时**才有的，若计入指纹，「生成成功」那一刻
   * 就会把自己标成陈旧（写回 → 指纹变 → 与刚落库的基线不符）。冒烟 G41 实测到。
   */
  it('naturalSize 不参与指纹：写回产物像素不算输入变了', () => {
    const inputs = [{ kind: 'text' as const, nodeId: 'p1', text: '你好' }]
    const base = fingerprintOf(genNode(), inputs)
    expect(fingerprintOf(genNode({ naturalSize: { width: 64, height: 36 } }), inputs)).toBe(base)
  })

  it('data 的键顺序不影响指纹（稳定序列化）', () => {
    const a = genNode()
    const b = genNode()
    const reordered = {
      thumbOrder: [],
      model: 'm1',
      prompt: '一只猫',
      mode: 'image' as const,
      channelId: 'ch1',
      linkedPromptNodeIds: [],
      upstreamHidden: [],
    }
    b.data = reordered as GenerationData
    expect(fingerprintOf(b, [])).toBe(fingerprintOf(a, []))
  })
})

/**
 * 指纹的用途随陈旧标记下线而变化：它现在服务于「同一节点多次生成是否输入相同」
 * （批量集合共用指纹、避免刚生成完就把自己标成新的一次），不再用于「要不要重跑」。
 * 下面锁的是**指纹本身的稳定性规则**——那是去重与批量语义的地基。
 */
describe('指纹随输入变化', () => {
  it('上游提示词改了 → 生成节点指纹随之改变', () => {
    const node = genNode()
    const before = fingerprintOf(node, [
      { kind: 'text', nodeId: 'p1', text: promptNode('猫').data.text },
    ])
    const after = fingerprintOf(node, [
      { kind: 'text', nodeId: 'p1', text: promptNode('狗').data.text },
    ])
    expect(before).not.toBe(after)
  })

  it('同一输入两次计算 → 同一指纹（去重依赖这一点）', () => {
    const node = genNode()
    const inputs = [{ kind: 'text' as const, nodeId: 'p1', text: promptNode('猫').data.text }]
    expect(fingerprintOf(node, inputs)).toBe(fingerprintOf(node, inputs))
  })
})
