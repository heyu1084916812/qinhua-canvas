import { describe, expect, it } from 'vitest'
import type { AgentPlan } from '../../../domain/agent/plan'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { buildLandingCommand } from './buildLandingCommand'

/**
 * 计划 → 落地命令（设计文档 §3 / §6）。
 *
 * 重点在两件容易做错的事：**复用节点不重复建**、**连线能接到已有节点上**
 * （后者正是不能拿 `node.paste` 顶替的原因）。
 */

registerAllSpecs()

const graph = (nodes: NodeSnapshot[] = []) => ({
  projectId: 'p1',
  nodes,
  edges: [] as { source: string; target: string }[],
})

const existing = (id: string, type: NodeSnapshot['type'], x = 0, y = 0): NodeSnapshot => ({
  id,
  projectId: 'p1',
  type,
  parentId: null,
  x,
  y,
  w: 200,
  h: 120,
  title: id,
  disabled: false,
  data: {},
})

let seq = 0
const newId = () => `new-${++seq}`

describe('buildLandingCommand', () => {
  it('★ 两个新节点 + 一条连线 → 一条命令，idOf 两项', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: '提示词 → 生成',
      nodes: [
        { localId: 'p1', type: 'prompt', data: { text: '橘猫' }, order: 0 },
        { localId: 'g1', type: 'generation', data: {}, order: 1 },
      ],
      edges: [{ source: 'p1', target: 'g1' }],
    }
    const r = buildLandingCommand({ plan, graph: graph(), origin: { x: 0, y: 0 }, newId })

    expect(r.command.kind).toBe('agent.applyPlan')
    expect(r.command.nodes).toHaveLength(2)
    expect(r.command.edges).toEqual([{ source: r.idOf.p1, target: r.idOf.g1 }])
    expect(r.command.nodes[0]!.data).toMatchObject({ text: '橘猫' })
    expect(r.command.nodes[0]!.title).toBeTruthy()
  })

  it('★★ 复用已有节点时不重复建，且连线接到那个已有节点上', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: '把已有素材接到新的生成节点',
      nodes: [
        { localId: 'src', type: 'generation', data: {}, order: 0 },
        { localId: 'g1', type: 'generation', data: {}, order: 1 },
      ],
      edges: [{ source: 'src', target: 'g1' }],
      attach: [{ localId: 'src', existingNodeId: 'old-1' }],
    }
    const r = buildLandingCommand({
      plan,
      graph: graph([existing('old-1', 'generation')]),
      origin: { x: 0, y: 0 },
      newId,
    })

    expect(r.command.nodes).toHaveLength(1)
    expect(r.command.nodes[0]!.id).toBe(r.idOf.g1)
    // 连线从**已有节点**发出 —— 这条边的 source 不在本批 nodes 里
    expect(r.command.edges[0]!.source).toBe('old-1')
    expect(r.idOf.src).toBe('old-1')
  })

  it('★ 计划没给的字段用 spec 默认值补齐（不建半残节点）', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: 'x',
      nodes: [{ localId: 'g1', type: 'generation', data: { ratio: '16:9' }, order: 0 }],
      edges: [],
    }
    const r = buildLandingCommand({ plan, graph: graph(), origin: { x: 0, y: 0 }, newId })
    const data = r.command.nodes[0]!.data as Record<string, unknown>
    expect(data.ratio).toBe('16:9')
    expect(data.mode).toBeTruthy()
  })

  it('★ 落点避开已有节点（不叠上去）', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: 'x',
      nodes: [{ localId: 'g1', type: 'generation', data: {}, order: 0 }],
      edges: [],
    }
    const r = buildLandingCommand({
      plan,
      graph: graph([existing('old-1', 'prompt', 0, 0)]),
      origin: { x: 0, y: 0 },
      newId,
    })
    expect(r.command.nodes[0]!.y).toBeGreaterThan(0)
  })

  /**
   * ★★ **容器里的子节点也要被避开**（用户 2026-10-05 第五批第 3 条：
   * 「生成的节点覆盖了第二张图片原有的位置」）。
   *
   * 子节点的 `x/y` 是**局部坐标**：它自己写 (0,0)、父分组在世界坐标 (0,0) 时，
   * 拿 local 去比会得出「没撞」；父分组挪到 (600,0) 之后，那张图其实就在
   * 新节点要落的那一列上。判据取**世界坐标**：新节点必须被让到它下方。
   */
  it('★★ 避让用世界坐标：分组里的子节点也躲开（局部坐标会漏判）', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: 'x',
      nodes: [{ localId: 'g1', type: 'generation', data: {}, order: 0 }],
      edges: [],
    }
    /**
     * 父分组落在 **(600,−500)、尺寸 200×400**（自身矩形 y ∈ [−500,−100]，不压 origin）；
     * 子节点**局部 (0,500)** ⇒ 世界矩形 **(600,0,200,120)**，正好压住 origin。
     *
     * 这样两边就能区分开：按局部坐标判 =「(0,500) 不撞 (600,0)」（漏判）；
     * 按世界坐标判 =「(600,0) 撞 (600,0)」（必须让开）。
     */
    const parent = { ...existing('grp-1', 'group', 600, -500), w: 200, h: 400 }
    const child = { ...existing('child-1', 'generation', 0, 500), parentId: 'grp-1' }
    const r = buildLandingCommand({
      plan,
      graph: graph([parent, child]),
      origin: { x: 600, y: 0 },
      newId,
    })
    /** 若按局部坐标判，这里会是 y=0（正压在那张图上）；按世界坐标必须落到它下方 */
    expect(r.command.nodes[0]!.y).toBeGreaterThanOrEqual(120)
  })

  it('★★ dataFor 补上默认渠道 / 模型（不补的话 agent 建的节点点了生成没反应）', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: 'x',
      nodes: [{ localId: 'g1', type: 'generation', data: {}, order: 0 }],
      edges: [],
    }
    const r = buildLandingCommand({
      plan,
      graph: graph(),
      origin: { x: 0, y: 0 },
      newId,
      dataFor: () => ({ channelId: 'ch-1', model: 'relay-img' }),
    })
    const data = r.command.nodes[0]!.data as Record<string, unknown>
    expect(data.channelId).toBe('ch-1')
    expect(data.model).toBe('relay-img')
    expect(data.mode).toBeTruthy() // spec 默认值也还在
  })
})

/**
 * ★★ 「你 @ 的那张图当时用什么模型、什么参数，这次就照它来」（用户 2026-10-06 定口径）。
 *
 * 用户原话：「先读我提供的节点素材是什么生成模型就用什么生成模型，是什么参数就用什么参数；
 * 如果需要其他的模型生成的话，用户会在对话框中输入模型和参数；如果用户只提供了另外的模型的话，
 * 参数就按照之前的模型的参数来设置」。
 *
 * 这三条正是三种覆盖关系，一条都不能少：
 *   ① 计划什么都没写 → 模型与整套参数都沿用那张图；
 *   ② 只点名换了模型 → 模型用新的，**其余参数照样沿用**（这条最容易做错成「全丢」）；
 *   ③ 连参数一起说了 → 以用户说的为准。
 */
describe('buildLandingCommand：沿用被引用节点的模型与参数', () => {
  const SRC_RECIPE = {
    channelId: 'ch-a',
    model: 'Nano Banana 2',
    ratio: '1:1',
    resolution: '2k',
    quality: 'high',
    count: 2,
  }

  const srcNode = (): NodeSnapshot =>
    ({ ...existing('old-1', 'generation'), data: { ...SRC_RECIPE } }) as NodeSnapshot

  const planWith = (planned: Record<string, unknown>): AgentPlan => ({
    summary: '改材质',
    nodes: [
      { localId: 'src', type: 'generation', data: {}, order: 0 },
      { localId: 'g1', type: 'generation', data: planned, order: 1 },
    ],
    edges: [{ source: 'src', target: 'g1' }],
    attach: [{ localId: 'src', existingNodeId: 'old-1' }],
  })

  const landed = (planned: Record<string, unknown>) => {
    seq = 0
    const r = buildLandingCommand({
      plan: planWith(planned),
      graph: graph([srcNode()]),
      origin: { x: 0, y: 0 },
      newId,
    })
    return r.command.nodes[0]!.data as Record<string, unknown>
  }

  it('★★ 计划什么都没写 → 模型与整套参数都沿用那张图（不是渠道默认）', () => {
    expect(landed({})).toMatchObject(SRC_RECIPE)
  })

  it('★★ 只点名换了模型 → 模型用新的，其余参数照样沿用', () => {
    const data = landed({ model: 'GPT Image 2' })
    expect(data.model).toBe('GPT Image 2')
    expect(data.ratio).toBe('1:1')
    expect(data.quality).toBe('high')
    expect(data.count).toBe(2)
    expect(data.resolution).toBe('2k')
  })

  it('★★ 连参数一起说了 → 以用户说的为准，没说的仍然沿用', () => {
    const data = landed({ model: 'GPT Image 2', ratio: '16:9' })
    expect(data.model).toBe('GPT Image 2')
    expect(data.ratio).toBe('16:9')
    expect(data.quality).toBe('high')
  })

  it('★★ 继承压在渠道默认**之上**：dataFor 给的那套不该盖掉那张图的参数', () => {
    seq = 0
    const r = buildLandingCommand({
      plan: planWith({}),
      graph: graph([srcNode()]),
      origin: { x: 0, y: 0 },
      newId,
      dataFor: () => ({ channelId: 'ch-def', model: '默认模型', ratio: '9:16' }),
    })
    const data = r.command.nodes[0]!.data as Record<string, unknown>
    expect(data.model).toBe('Nano Banana 2')
    expect(data.ratio).toBe('1:1')
  })

  it('★ 没有 attach（纯文生图）时不继承，照旧走 dataFor 的默认', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: 'x',
      nodes: [{ localId: 'g1', type: 'generation', data: {}, order: 0 }],
      edges: [],
    }
    const r = buildLandingCommand({
      plan,
      graph: graph(),
      origin: { x: 0, y: 0 },
      newId,
      dataFor: () => ({ channelId: 'ch-def', model: '默认模型' }),
    })
    expect(r.command.nodes[0]!.data).toMatchObject({ channelId: 'ch-def', model: '默认模型' })
  })
})

/**
 * ★★ 落位与参考图连线（用户 2026-10-06 第七批 #184 / #185）。
 *
 * 用户原话：「节点出现的位置不是在原素材的右边」；
 * 「他没有给我连线……**明确说明作为参考图之后才会有连线**」。
 *
 * 真机（图三）就是这个形态：@ 了一张图 +「加一个小狗在旁边」，模型自己编了个 `cat_gpt`
 * 当连线起点（`第 1 条连线的起点不在计划里: cat_gpt`），结果**一条线都没连上**，
 * 那次生成退化成「照提示词重画一张」——「其余参考参考图保持不变」根本没生效。
 */
describe('buildLandingCommand：落在原素材右边 + 参考图必须有连线', () => {
  const imgNode = (id: string, x: number, y: number): NodeSnapshot =>
    ({
      ...existing(id, 'generation', x, y),
      w: 300,
      h: 300,
      data: { assetHash: 'hash-' + id },
    }) as NodeSnapshot

  const planWith = (edges: AgentPlan['edges'], attachIds: string[]): AgentPlan => ({
    summary: '改图',
    nodes: [
      ...attachIds.map((id, i) => ({
        localId: id,
        type: 'generation' as const,
        data: {},
        order: i,
      })),
      { localId: 'g1', type: 'generation', data: { prompt: '加一只小狗' }, order: attachIds.length },
    ],
    edges,
    attach: attachIds.map((id) => ({ localId: id, existingNodeId: id })),
  })

  it('★★ 复用了既有素材时，新节点落在**它右边**（不再是视口中心）', () => {
    seq = 0
    const r = buildLandingCommand({
      plan: planWith([{ source: 'src', target: 'g1' }], ['src']),
      graph: graph([imgNode('src', 1000, 500)]),
      /** 视口在原点 —— 老实现会落在这儿，与素材差着十万八千里 */
      origin: { x: 0, y: 0 },
      newId,
    })
    const created = r.command.nodes[0]!
    expect(created.x).toBeGreaterThanOrEqual(1000 + 300)
    expect(created.y).toBe(500)
  })

  it('★★ attach 了有图的节点却没有连线 → 自动补上（否则等于没吃参考图）', () => {
    seq = 0
    const r = buildLandingCommand({
      plan: planWith([], ['src']),
      graph: graph([imgNode('src', 0, 0)]),
      origin: { x: 0, y: 0 },
      newId,
    })
    expect(r.command.edges).toEqual([{ source: 'src', target: r.idOf.g1 }])
  })

  it('★ 模型已经连好的边不重复补', () => {
    seq = 0
    const r = buildLandingCommand({
      plan: planWith([{ source: 'src', target: 'g1' }], ['src']),
      graph: graph([imgNode('src', 0, 0)]),
      origin: { x: 0, y: 0 },
      newId,
    })
    expect(r.command.edges).toHaveLength(1)
  })

  it('★★ @ 了两张图、只建一个目标 → 两张都接上（用户 @ 了就是要用）', () => {
    seq = 0
    const r = buildLandingCommand({
      plan: planWith([], ['a', 'b']),
      graph: graph([imgNode('a', 0, 0), imgNode('b', 400, 0)]),
      origin: { x: 0, y: 0 },
      newId,
    })
    expect(r.command.edges).toEqual([
      { source: 'a', target: r.idOf.g1 },
      { source: 'b', target: r.idOf.g1 },
    ])
  })

  it('★ 被 attach 的节点没有图（比如提示词节点）时不乱连线', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: 'x',
      nodes: [
        { localId: 'p1', type: 'prompt', data: { text: '…' }, order: 0 },
        { localId: 'g1', type: 'generation', data: { prompt: 'y' }, order: 1 },
      ],
      edges: [{ source: 'p1', target: 'g1' }],
      attach: [{ localId: 'p1', existingNodeId: 'p-old' }],
    }
    const r = buildLandingCommand({
      plan,
      graph: graph([existing('p-old', 'prompt')]),
      origin: { x: 0, y: 0 },
      newId,
    })
    expect(r.command.edges).toEqual([{ source: 'p-old', target: r.idOf.g1 }])
  })
})
