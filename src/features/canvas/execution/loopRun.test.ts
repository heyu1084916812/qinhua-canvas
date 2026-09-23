import { describe, it, expect } from 'vitest'
import { loopUpstreamAssets, loopUpstreamPrompts, planLoopRounds, hasRunnableDownstream } from './loopRun'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import type { LoopData } from '../../../domain/canvas/model/node'

/**
 * 循环节点的「一键运行」展开（用户 2026-09-23）。
 *
 * 这是执行侧的核心计算：第 N 轮该用哪些图、哪条提示词（变量是否替换对）。
 * 全是纯函数，所以能在 node 下逐轮断言 —— 而**边界**（最后一轮不够取、
 * 起始越界、提示词取模回绕）恰恰是最容易算错、也最难在界面上一眼看出的地方。
 */

function loopNode(overrides: Record<string, unknown> = {}): NodeSnapshot<LoopData> {
  return {
    id: 'loop-1',
    type: 'loop',
    x: 0,
    y: 0,
    w: 240,
    h: 380,
    parentId: null,
    data: {
      count: 2,
      loopStart: 1,
      batch: 1,
      mode: 'serial',
      useImageInput: true,
      usePrompt: false,
      prompts: [],
      ...overrides,
    },
  } as unknown as NodeSnapshot<LoopData>
}

describe('planLoopRounds · 逐轮展开', () => {
  it('★ 批次 1、起始 2、2 轮 → 分别取第 2、3 张', () => {
    const rounds = planLoopRounds(loopNode({ loopStart: 2, count: 2 }), ['a', 'b', 'c', 'd'], [])
    expect(rounds.map((r) => r.assetHashes)).toEqual([['b'], ['c']])
    expect(rounds.map((r) => r.index)).toEqual([2, 3])
  })

  it('★ 批次 2、2 轮 → 第 1 轮前两张、第 2 轮后两张', () => {
    const rounds = planLoopRounds(loopNode({ batch: 2, count: 2 }), ['a', 'b', 'c', 'd'], [])
    expect(rounds.map((r) => r.assetHashes)).toEqual([['a', 'b'], ['c', 'd']])
  })

  it('★ 最后一轮不够 batch 时只给剩下的（不补空、不重复）', () => {
    // 5 张、每轮 2 张、跑 3 轮 → 第 3 轮只剩 1 张
    const rounds = planLoopRounds(loopNode({ batch: 2, count: 3 }), ['a', 'b', 'c', 'd', 'e'], [])
    expect(rounds.map((r) => r.assetHashes)).toEqual([['a', 'b'], ['c', 'd'], ['e']])
  })

  it('★ 起始超出素材数时该轮拿不到图（不是抛错、也不是回绕取第一张）', () => {
    const rounds = planLoopRounds(loopNode({ loopStart: 9, count: 2 }), ['a', 'b'], [])
    expect(rounds.every((r) => r.assetHashes.length === 0)).toBe(true)
  })

  it('关掉图片通道时不取素材（只循环提示词）', () => {
    const rounds = planLoopRounds(
      loopNode({ useImageInput: false, usePrompt: true, prompts: ['p'] }),
      ['a', 'b'],
      [],
    )
    expect(rounds.every((r) => r.assetHashes.length === 0)).toBe(true)
  })

  it('★ 提示词按轮次取模轮换：3 条跑 5 轮 → 1,2,3,1,2', () => {
    const rounds = planLoopRounds(
      loopNode({ usePrompt: true, count: 5, prompts: ['p1', 'p2', 'p3'] }),
      [],
      [],
    )
    expect(rounds.map((r) => r.prompt)).toEqual(['p1', 'p2', 'p3', 'p1', 'p2'])
  })

  it('★ 变量替换：计数 / 总数 / 进度 都替换成实际值', () => {
    const rounds = planLoopRounds(
      loopNode({
        usePrompt: true,
        count: 3,
        loopStart: 2,
        prompts: ['第[计数]个，共[总数]，进度[进度]'],
      }),
      [],
      [],
    )
    // 起始 2 ⇒ 计数从 2 起；总数是「轮数」3
    expect(rounds[0].prompt).toBe('第2个，共3，进度2/3')
    expect(rounds[2].prompt).toBe('第4个，共3，进度4/3')
  })

  it('★ 全角写法《计数》同样替换（中文输入法的习惯）', () => {
    const rounds = planLoopRounds(
      loopNode({ usePrompt: true, count: 1, prompts: ['第《计数》个'] }),
      [],
      [],
    )
    expect(rounds[0].prompt).toBe('第1个')
  })

  it('上游提示词与本节点提示词合并成一个池子', () => {
    const rounds = planLoopRounds(
      loopNode({ usePrompt: true, count: 3, prompts: ['mine'] }),
      [],
      ['up1', 'up2'],
    )
    expect(rounds.map((r) => r.prompt)).toEqual(['up1', 'up2', 'mine'])
  })

  it('参数越界先归一化（count=0 当作 1 轮）', () => {
    const rounds = planLoopRounds(loopNode({ count: 0 }), ['a', 'b'], [])
    expect(rounds).toHaveLength(1)
  })
})

describe('loopUpstreamAssets / loopUpstreamPrompts · 上游收集', () => {
  function graphWith(edges: { source: string; target: string }[], nodes: NodeSnapshot[]): GraphSnapshot {
    return {
      projectId: 'p1',
      nodes,
      edges: edges.map((e, i) => ({ id: `e${i}`, ...e })),
    } as GraphSnapshot
  }

  it('★ 只收直接上游、且有 assetHash 的（没出图的节点不该占一个轮次位置）', () => {
    const loop = loopNode()
    const g = graphWith(
      [
        { source: 'gen-a', target: 'loop-1' },
        { source: 'gen-b', target: 'loop-1' },
      ],
      [
        loop,
        { id: 'gen-a', type: 'generation', data: { assetHash: 'hashA' } },
        { id: 'gen-b', type: 'generation', data: {} },
      ] as unknown as NodeSnapshot[],
    )
    expect(loopUpstreamAssets(loop, g)).toEqual(['hashA'])
  })

  it('提示词只收文本非空的', () => {
    const loop = loopNode()
    const g = graphWith(
      [
        { source: 'p1', target: 'loop-1' },
        { source: 'p2', target: 'loop-1' },
      ],
      [
        loop,
        { id: 'p1', type: 'prompt', data: { text: 'hello' } },
        { id: 'p2', type: 'prompt', data: { text: '   ' } },
      ] as unknown as NodeSnapshot[],
    )
    expect(loopUpstreamPrompts(loop, g)).toEqual(['hello'])
  })
})

describe('hasRunnableDownstream · 一键运行的前置条件', () => {
  function graph(edges: { source: string; target: string }[], nodes: NodeSnapshot[]): GraphSnapshot {
    return {
      projectId: 'p1',
      nodes,
      edges: edges.map((e, i) => ({ id: `e${i}`, ...e })),
    } as GraphSnapshot
  }

  it('★ 下游只有提示词节点 → 不可运行（循环不产图，提示词节点也不发请求）', () => {
    const loop = loopNode()
    const g = graph(
      [{ source: 'loop-1', target: 'p1' }],
      [loop, { id: 'p1', type: 'prompt', data: { text: 'x' } }] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(loop, g)).toBe(false)
  })

  it('★ 下游有生成节点 → 可运行', () => {
    const loop = loopNode()
    const g = graph(
      [{ source: 'loop-1', target: 'gen-1' }],
      [
        loop,
        // 判据是「渠道与模型都配好」——只给类型不够（那是早期版本的假通过）
        { id: 'gen-1', type: 'generation', data: { channelId: 'ch-1', model: 'm-1' } },
      ] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(loop, g)).toBe(true)
  })

  it('★★ 下游生成节点**没配渠道 / 模型** → 不可运行（否则按钮亮着、点了空跑）', () => {
    const loop = loopNode()
    const g = graph(
      [{ source: 'loop-1', target: 'gen-1' }],
      [loop, { id: 'gen-1', type: 'generation', data: {} }] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(loop, g)).toBe(false)
  })

  it('★ 下游只有渠道、没选模型 → 不可运行（半份配置跑不起来）', () => {
    const loop = loopNode()
    const g = graph(
      [{ source: 'loop-1', target: 'gen-1' }],
      [
        loop,
        { id: 'gen-1', type: 'generation', data: { channelId: 'ch-1' } },
      ] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(loop, g)).toBe(false)
  })

  it('没有下游 → 不可运行', () => {
    const loop = loopNode()
    expect(hasRunnableDownstream(loop, graph([], [loop]))).toBe(false)
  })
})
