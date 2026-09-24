import { describe, it, expect } from 'vitest'
import {
  candidateDownstream,
  hasRunnableDownstream,
  loopUpstreamAssets,
  loopUpstreamPrompts,
  planLoopRounds,
} from './loopRun'
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

  /**
   * ★★ 承载节点不算「下游生成节点」（用户 2026-09-24 实测踩到）。
   *
   * 批量 / 循环跑完一次后，会新增承载 generation 节点并连一条
   * `分发器 → 承载` 的线（§6.8）。承载节点带着源节点的 `sourceData`，
   * 渠道 / 模型齐全 —— 若只看「下游 + 可运行」，它就会被误认成用户接的下游，
   * 按钮随即被劫持到那个空提示词的承载节点上，点下去什么都不发生。
   *
   * 判据是落位时打的 `__carrierOf` 标记（`canvasPlacement.begin`）。
   * 注意**不能**用「父节点是谁」：顶层分发器自己的 `parentId` 是 null，
   * 它产出的承载节点同样落成顶层（实测 `parentId: null`）。
   */
  it('★★ 自己产出的承载节点（带 __carrierOf）不算下游 → 不可运行', () => {
    const loop = loopNode()
    const g = graph(
      [{ source: 'loop-1', target: 'carrier-1' }],
      [
        loop,
        {
          id: 'carrier-1',
          type: 'generation',
          parentId: null,
          data: { channelId: 'ch-1', model: 'm-1', __carrierOf: 'loop-1' },
        },
      ] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(loop, g)).toBe(false)
  })

  /** 承载节点之外还接了真的下游生成节点 → 仍然可运行（排除不能误伤） */
  it('★ 承载节点 + 真的下游生成节点 → 仍可运行，且候选不含承载节点', () => {
    const loop = loopNode()
    const g = graph(
      [
        { source: 'loop-1', target: 'carrier-1' },
        { source: 'loop-1', target: 'gen-1' },
      ],
      [
        loop,
        {
          id: 'carrier-1',
          type: 'generation',
          data: { channelId: 'ch-1', model: 'm-1', __carrierOf: 'loop-1' },
        },
        { id: 'gen-1', type: 'generation', data: { channelId: 'ch-1', model: 'm-1' } },
      ] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(loop, g)).toBe(true)
    expect(candidateDownstream(loop, g).map((n) => n.id)).toEqual(['gen-1'])
  })

  /**
   * 别人产出的承载节点**不该**被排除：`__carrierOf` 指向的是别的节点，
   * 那它对本节点而言就是普通下游。判据按 id 比较，不是「带没带这个字段」。
   */
  it('★ 别的节点产出的承载节点（__carrierOf 指向他人）仍算下游', () => {
    const loop = loopNode()
    const g = graph(
      [{ source: 'loop-1', target: 'carrier-x' }],
      [
        loop,
        {
          id: 'carrier-x',
          type: 'generation',
          data: { channelId: 'ch-1', model: 'm-1', __carrierOf: 'other-node' },
        },
      ] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(loop, g)).toBe(true)
  })
})

/**
 * 批量节点接下游生成节点（用户 2026-09-24）：
 *
 * > 「批量节点的下游需要链接生图节点，所用的参数就是生图节点的参数，
 * >  点击一键生成的时候参考普通节点生成的逻辑」
 *
 * 批量与循环走同一份判据（都是「下游有配好的生成节点」），
 * 所以这里只锁「批量节点也能用这套判据」+「自己产出的承载节点同样要排除」。
 */
describe('hasRunnableDownstream · 批量节点的下游判据', () => {
  function graph(edges: { source: string; target: string }[], nodes: NodeSnapshot[]): GraphSnapshot {
    return {
      projectId: 'p1',
      nodes,
      edges: edges.map((e, i) => ({ id: `e${i}`, ...e })),
    } as GraphSnapshot
  }

  function batchNode(overrides: Record<string, unknown> = {}): NodeSnapshot {
    return {
      id: 'batch-1',
      type: 'batch',
      x: 0,
      y: 0,
      w: 240,
      h: 192,
      parentId: null,
      data: {
        mode: 'image',
        prompt: '统一要求',
        childIds: [],
        hiddenIds: [],
        channelId: 'ch-1',
        model: 'm-1',
        ...overrides,
      },
    } as unknown as NodeSnapshot
  }

  it('★ 批量 → 配好的生成节点：判定可运行（按钮文案据此说「生成下游节点」）', () => {
    const g = graph(
      [{ source: 'batch-1', target: 'gen-1' }],
      [
        batchNode(),
        { id: 'gen-1', type: 'generation', data: { channelId: 'ch-1', model: 'm-1' } },
      ] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(batchNode(), g)).toBe(true)
  })

  it('★ 批量只有自己跑出来的承载节点 → 不可运行（不劫持到空提示词的承载节点）', () => {
    const g = graph(
      [{ source: 'batch-1', target: 'carrier-1' }],
      [
        batchNode(),
        {
          id: 'carrier-1',
          type: 'generation',
          data: { channelId: 'ch-1', model: 'm-1', __carrierOf: 'batch-1' },
        },
      ] as unknown as NodeSnapshot[],
    )
    expect(hasRunnableDownstream(batchNode(), g)).toBe(false)
  })

  it('★ 批量没有下游 → 不可运行（退回「在批量面板点生成」那条老路）', () => {
    expect(hasRunnableDownstream(batchNode(), graph([], [batchNode()]))).toBe(false)
  })
})
