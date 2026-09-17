import { describe, it, expect, beforeEach } from 'vitest'
import { registerAllSpecs } from '../nodeSpecs'
import { getSpec } from '../nodeSpecs/registry'
import { fingerprintOf } from '../graph/fingerprint'
import { generationSpec } from '../nodeSpecs/generation'
import type { GraphSnapshot } from '../model/graph'
import type { GenerationData, NodeSnapshot, PromptData } from '../model/node'
import { staleNodeFingerprints, staleReport } from './staleNodes'

/**
 * 陈旧标记计算（§6.19.5）：只验证「当前指纹 vs 成功基线」这一条式子。
 *
 * 刻意**不碰 store / platform**：domain 层测试用字面图构造输入，
 * 这样这一条判定式子不依赖命令层与持久化，回归时定位范围最小
 * （对账 / 落库那一半见 CanvasExecutionProvider）。
 */

function genData(over: Partial<GenerationData> = {}): GenerationData {
  return {
    ...(generationSpec.createDefaultData() as GenerationData),
    channelId: 'ch',
    model: 'm',
    ...over,
  }
}

/** 标准样本：提示词 → 生成（一条边） */
function build(promptText: string, gen: Partial<GenerationData> = {}): GraphSnapshot {
  const p: NodeSnapshot<PromptData> = {
    id: 'p',
    projectId: 'p1',
    type: 'prompt',
    parentId: null,
    x: 0,
    y: 0,
    w: 200,
    h: 120,
    title: '提示词',
    disabled: false,
    data: { text: promptText, upstreamPromptLinked: false },
  }
  const g: NodeSnapshot<GenerationData> = {
    id: 'g',
    projectId: 'p1',
    type: 'generation',
    parentId: null,
    x: 400,
    y: 0,
    w: 240,
    h: 200,
    title: '生成',
    disabled: false,
    data: genData(gen),
  }
  return {
    projectId: 'p1',
    nodes: [p, g],
    edges: [{ id: 'e1', projectId: 'p1', source: 'p', target: 'g' }],
    
  }
}

/** 替换某个节点的 data（保持其余字段不变） */
function withData(
  graph: GraphSnapshot,
  id: string,
  patch: Record<string, unknown>,
): GraphSnapshot {
  return {
    ...graph,
    nodes: graph.nodes.map((n) =>
      n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as NodeSnapshot) : n,
    ),
  }
}

/** 引擎落库的指纹口径：计划构建时 `fingerprintOf(节点, 那一刻的输入)` */
function liveOf(graph: GraphSnapshot, nodeId: string): string {
  const node = graph.nodes.find((n) => n.id === nodeId)!
  return fingerprintOf(node, getSpec(node.type)!.collectInputs({ node, graph }))
}

beforeEach(() => {
  registerAllSpecs()
})

describe('staleNodeFingerprints（§6.19.5 陈旧判定）', () => {
  it('基线一致 → 不陈旧', () => {
    const g0 = build('一只猫')
    expect(staleNodeFingerprints(g0, new Map([['g', liveOf(g0, 'g')]])).size).toBe(0)
  })

  it('上游产出变了 → 下游陈旧（「任一上游产生新结果，下游指纹失效」）', () => {
    const g0 = build('一只猫')
    const live = new Map([['g', liveOf(g0, 'g')]])
    const g1 = withData(g0, 'p', { text: '一只狗' })
    expect([...staleNodeFingerprints(g1, live).keys()]).toEqual(['g'])
  })

  it('上游素材变了（图生图）→ 下游陈旧；但自己换产物不算「输入变了」', () => {
    // 提示词 → 生成 g（有产物）→ 生成 g2（把 g 的产物当图像输入，M6-12 图生图）
    const base = build('一只猫', { assetHash: 'h1' })
    const chain: GraphSnapshot = {
      ...base,
      nodes: [
        ...base.nodes,
        {
          id: 'g2',
          projectId: 'p1',
          type: 'generation',
          parentId: null,
          x: 800,
          y: 0,
          w: 240,
          h: 200,
          title: '生成2',
          disabled: false,
          data: genData({ prompt: '再来一张' }),
        } as NodeSnapshot,
      ],
      edges: [...base.edges, { id: 'e2', projectId: 'p1', source: 'g', target: 'g2' }],
    }
    const live = new Map([
      ['g', liveOf(chain, 'g')],
      ['g2', liveOf(chain, 'g2')],
    ])
    const stale = staleNodeFingerprints(withData(chain, 'g', { assetHash: 'h2' }), live)
    expect(stale.has('g2')).toBe(true) // 下游：图像输入变了 → 陈旧
    expect(stale.has('g')).toBe(false) // 自己：产物本体变化不算输入变化（DATA_EXCLUDED）
  })

  it('自身参数改了 → 自己陈旧', () => {
    const g0 = build('一只猫')
    const live = new Map([['g', liveOf(g0, 'g')]])
    expect(staleNodeFingerprints(withData(g0, 'g', { count: 4 }), live).has('g')).toBe(true)
  })

  it('纯展示态字段变化不算「输入变了」（拖缩略图顺序不会标陈旧）', () => {
    const g0 = build('一只猫')
    const live = new Map([['g', liveOf(g0, 'g')]])
    expect(staleNodeFingerprints(withData(g0, 'g', { thumbOrder: ['a', 'b'] }), live).size).toBe(0)
  })

  it('「隐藏上游」是真输入变化（勾掉上游即不参与请求）→ 标陈旧', () => {
    const g0 = build('一只猫')
    const live = new Map([['g', liveOf(g0, 'g')]])
    // generationSpec.collectInputs 会跳过 upstreamHidden 里的上游，输入集变了 → 指纹变了
    expect(staleNodeFingerprints(withData(g0, 'g', { upstreamHidden: ['p'] }), live).has('g')).toBe(true)
  })

  it('无成功基线（从未生成过）→ 不陈旧', () => {
    const g0 = build('一只猫')
    expect(staleNodeFingerprints(g0, new Map()).size).toBe(0)
    expect(staleNodeFingerprints(g0, new Map([['g', null]])).size).toBe(0)
  })

  it('返回值是该节点**当前**指纹（供「手动清除过陈旧」的豁免判定）', () => {
    const g0 = build('一只猫')
    const live = new Map([['g', liveOf(g0, 'g')]])
    const g1 = withData(g0, 'g', { count: 2 })
    expect(staleNodeFingerprints(g1, live).get('g')).toBe(liveOf(g1, 'g'))
  })
})

/**
 * `fresh` 集合是「清除陈旧标记」的唯一依据（§6.19.5）：
 * 只清**能被证明已回到基线**的节点，而不是「凡不在陈旧里就清」。
 * 两组断言把它与「无基线」的节点区分开——后者必须两边都不在。
 */
describe('staleReport.fresh（可证明已新鲜，清除标记的依据）', () => {
  it('有基线且一致 → 在 fresh、不在 stale', () => {
    const g0 = build('一只猫')
    const r = staleReport(g0, new Map([['g', liveOf(g0, 'g')]]))
    expect(r.fresh.has('g')).toBe(true)
    expect(r.stale.has('g')).toBe(false)
  })

  it('无基线（从未成功生成过）→ 既不在 fresh 也不在 stale', () => {
    const g0 = build('一只猫')
    const empty = staleReport(g0, new Map())
    expect(empty.fresh.has('g')).toBe(false)
    expect(empty.stale.has('g')).toBe(false)

    const nullable = staleReport(g0, new Map([['g', null]]))
    expect(nullable.fresh.has('g')).toBe(false)
    expect(nullable.stale.has('g')).toBe(false)
  })

  it('上游变了 → 下游进 stale 退出 fresh，上游自己仍留在 fresh（两个集合互斥）', () => {
    const g0 = build('一只猫')
    const live = new Map([['g', liveOf(g0, 'g')]])
    const r = staleReport(withData(g0, 'p', { text: '一只狗' }), live)
    expect(r.stale.has('g')).toBe(true)
    expect(r.fresh.has('g')).toBe(false)
    // 无基线的提示词节点 p 依旧两边都不在
    expect(r.stale.has('p')).toBe(false)
    expect(r.fresh.has('p')).toBe(false)
  })

  it('自身参数改了 → 进 stale 退出 fresh（清除它就没有依据，只能靠重跑）', () => {
    const g0 = build('一只猫')
    const live = new Map([['g', liveOf(g0, 'g')]])
    const r = staleReport(withData(g0, 'g', { count: 4 }), live)
    expect(r.stale.has('g')).toBe(true)
    expect(r.fresh.has('g')).toBe(false)
  })
})
