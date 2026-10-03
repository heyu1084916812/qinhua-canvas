import { describe, expect, it, vi, beforeEach } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../../platform/memory'
import { createCanvasStore, type CanvasStore } from '../../../state/workbenches/canvas/store'
import {
  AGENT_TOOLS,
  executeConfirmedTool,
  executeReadTool,
  readAssetInfo,
  readGraphSummary,
  readResults,
  type AgentToolContext,
} from './tools'

/**
 * 工具集（设计文档 §5）。
 *
 * 除了功能，这里盯一条结构性的规矩：**读类与写类是分开的执行器** ——
 * 循环只能拿到读那个，所以「边想边把画布改了」在代码上就写不出来。
 */

beforeEach(() => registerAllSpecs())

function setup() {
  const store: CanvasStore = createCanvasStore({
    platform: createMemoryPlatform() as never,
    projectId: 'p1',
  })
  const runNodes = vi.fn(async (ids: string[]) => ids.map((nodeId) => ({ nodeId, ok: true })))
  const ctx: AgentToolContext = { store, origin: { x: 0, y: 0 }, runNodes }
  return { store, ctx, runNodes }
}

const addNode = (
  store: CanvasStore,
  type: 'prompt' | 'generation',
  data: Record<string, unknown> = {},
) => {
  store.dispatch({ kind: 'node.create', projectId: 'p1', type, at: { x: 0, y: 0 }, data })
  return store.getSnapshot().nodes.at(-1)!.id
}

describe('工具声明', () => {
  it('★ 六个工具都在，且都带参数 schema（模型据此决定怎么调）', () => {
    expect(AGENT_TOOLS.map((t) => t.name).sort()).toEqual([
      'applyPlan',
      'readAsset',
      'readGraph',
      'readResult',
      'runNode',
      'updateNode',
    ])
    for (const t of AGENT_TOOLS) expect(t.parameters).toMatchObject({ type: 'object' })
  })
})

describe('读类工具', () => {
  it('★ readGraph 报出节点、连线和「出过图没有」', async () => {
    const { store, ctx } = setup()
    const p = addNode(store, 'prompt', { text: '橘猫' })
    const g = addNode(store, 'generation', { mode: 'image', assetHash: 'h1' })
    store.dispatch({ kind: 'edge.connect', source: p, target: g })

    const s = readGraphSummary(store, 'all')
    expect(s.nodes).toHaveLength(2)
    expect(s.nodes.find((n) => n.id === g)?.hasOutput).toBe(true)
    expect(s.nodes.find((n) => n.id === p)?.hasOutput).toBe(false)
    expect(s.edges).toEqual([{ source: p, target: g, sourcePort: 'output', targetPort: 'input' }])

    // 通过执行器调也一样（循环走的就是这个入口）
    expect(await executeReadTool('readGraph', { scope: 'all' }, ctx)).toMatchObject({
      nodes: expect.any(Array),
    })
  })

  it('★★ readAsset 只报节点记下来的真实像素，没记就不编', async () => {
    const { store, ctx } = setup()
    const withSize = addNode(store, 'generation', {
      mode: 'image',
      naturalSize: { width: 1024, height: 768 },
    })
    const noSize = addNode(store, 'generation', { mode: 'image' })

    const out = readAssetInfo(store, [withSize, noSize, 'nope'])
    expect(out[0]).toMatchObject({ nodeId: withSize, width: 1024, height: 768 })
    // 没记录尺寸 → 不出现 width/height（编一个会让 agent 判断错）
    expect(out[1]!.width).toBeUndefined()
    expect(out[2]!.mime).toBe('unknown')

    expect(await executeReadTool('readAsset', { nodeIds: [withSize] }, ctx)).toMatchObject({
      assets: expect.any(Array),
    })
  })

  it('★ readResult：有产物就是 ok，没有就是 empty，节点不存在就 missing', () => {
    const { store } = setup()
    const ok = addNode(store, 'generation', { mode: 'image', assetHash: 'h1' })
    const empty = addNode(store, 'generation', { mode: 'image' })
    const out = readResults(store, [ok, empty, 'gone'])
    expect(out.map((r) => r.status)).toEqual(['ok', 'empty', 'missing'])
  })
})

describe('写 / 花钱的工具（只由确认后调用）', () => {
  it('★★ applyPlan 真的把图建出来，并回填自检结果', async () => {
    const { store, ctx } = setup()
    const r = (await executeConfirmedTool(
      'applyPlan',
      {
        /**
         * 一段提示词喂**两个**生成节点：这是「不折」的那种形状（用户在复用这段提示词），
         * 所以这里能同时验到「节点真建了 + 连线真连了 + 自检真跑了」。
         * 单步生成会折掉提示词节点，那一条单独测（见下面那条）。
         */
        summary: '一段提示词出两张图',
        nodes: [
          { localId: 'p1', type: 'prompt', data: { text: '橘猫' }, order: 0 },
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
          { localId: 'g2', type: 'generation', data: { mode: 'image' }, order: 1 },
        ],
        edges: [
          { source: 'p1', target: 'g1' },
          { source: 'p1', target: 'g2' },
        ],
      },
      ctx,
    )) as { ok: boolean; problems: string[]; createdNodeIds: string[] }

    expect(r.ok).toBe(true)
    expect(r.problems).toEqual([])
    expect(r.createdNodeIds).toHaveLength(3)
    expect(store.getSnapshot().nodes).toHaveLength(3)
    expect(store.getSnapshot().edges).toHaveLength(2)
  })

  /**
   * ★★ 用户 2026-10-04 第 4 条：「我用 agent 生图的时候卡在了没有写提示词在流程里面，
   * 单独生成图片应该是直接一个生成节点就可以了，然后把提示词输入进去再向我确认生成，
   * 当前是流程是新建了一个提示词节点和连接的生成节点」。
   *
   * 这条走**完整的落地链**（归一化 → 校验 → 建节点 → 自检），不是只看归一化那一步 ——
   * 用户能看到的只是落地之后的画布。
   */
  it('★★ 单步生成落地**只建一个节点**：提示词写在生成节点上，不留中间那个提示词节点', async () => {
    const { store } = setup()
    const asked: string[][] = []
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async () => []),
      defaultsForNewNode: vi.fn(async (types: readonly string[]) => {
        asked.push([...types])
        return { generation: { channelId: 'ch-1', model: 'relay-img' } }
      }),
    } as unknown as AgentToolContext

    const r = (await executeConfirmedTool(
      'applyPlan',
      {
        summary: '提示词 → 生成',
        nodes: [
          { localId: 'p1', type: 'prompt', data: { text: '橘猫' }, order: 0 },
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
        ],
        edges: [{ source: 'p1', target: 'g1' }],
      },
      ctx,
    )) as { ok: boolean; createdNodeIds: string[] }

    expect(r.ok).toBe(true)
    expect(r.createdNodeIds).toHaveLength(1)
    const g = store.getSnapshot()
    expect(g.nodes).toHaveLength(1)
    expect(g.edges).toHaveLength(0)
    expect(g.nodes[0]!.type).toBe('generation')
    expect((g.nodes[0]!.data as Record<string, unknown>).prompt).toBe('橘猫')
    /** 折掉之后**只会问生成节点那一档**：提示词那条配方根本用不上 */
    expect(asked).toEqual([['generation']])
  })

  it('★★ 计划非法 → 不落地，把逐条错误回填（模型据此改）', async () => {
    const { store, ctx } = setup()
    const r = (await executeConfirmedTool(
      'applyPlan',
      { summary: 'x', nodes: [{ localId: 'a', type: '不存在的类型', data: {}, order: 0 }], edges: [] },
      ctx,
    )) as { ok: boolean; problems: string[] }

    expect(r.ok).toBe(false)
    expect(r.problems.join()).toContain('不认识')
    expect(store.getSnapshot().nodes).toHaveLength(0)
  })

  /**
   * ★★ 落地前先取默认配方。
   *
   * 这条盯的是「agent 建的节点」与「手建的节点」同源：手建的走
   * `createNodeWithDefaults` 会带上默认渠道 + 模型，agent 这条必须问同一件事，
   * 否则建出来的生成节点是空的 —— 用户点生成只会看到「还没选择渠道」。
   */
  it('★★ applyPlan 会先问默认配方（只问计划里真用到的类型），并写进节点', async () => {
    const { store } = setup()
    const asked: string[][] = []
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async (ids: string[]) => ids.map((nodeId) => ({ nodeId, ok: true }))),
      defaultsForNewNode: vi.fn(async (types: readonly string[]) => {
        asked.push([...types])
        return {
          generation: { channelId: 'ch-1', model: 'relay-img', ratio: '16:9' },
          prompt: { channelId: 'ch-2', model: 'relay-chat' },
        }
      }),
    } as unknown as AgentToolContext

    await executeConfirmedTool(
      'applyPlan',
      {
        /** 同上一组：一段提示词喂两个下游 → 不折，于是「提示词」那一档也真的用得上 */
        summary: '一段提示词出两张图',
        nodes: [
          { localId: 'p1', type: 'prompt', data: { text: '橘猫' }, order: 0 },
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
          { localId: 'g2', type: 'generation', data: { mode: 'image' }, order: 1 },
        ],
        edges: [
          { source: 'p1', target: 'g1' },
          { source: 'p1', target: 'g2' },
        ],
      },
      ctx,
    )

    // 两种类型各问一次（去重后一起问，不是逐个节点问）
    expect(asked).toEqual([['prompt', 'generation']])
    const nodes = store.getSnapshot().nodes
    const gen = nodes.find((n) => n.type === 'generation')!.data as Record<string, unknown>
    expect(gen.channelId).toBe('ch-1')
    expect(gen.model).toBe('relay-img')
    expect(gen.ratio).toBe('16:9')
  })

  /**
   * ★★ 用户点选的**图片 / 视频模型**要按节点用途落到节点上
   * （用户 2026-10-03：「我创作面板有什么模型就用什么模型，分了图片和视频…模型有三个
   * 选项」）。两个档位一个都别串：文生图拿图片模型、图生视频拿视频模型。
   */
  it('★★ 图片 / 视频两档模型按节点用途分别落上（不串档）', async () => {
    const { store } = setup()
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async () => []),
      defaultsForNewNode: vi.fn(async () => ({
        generation: { channelId: 'ch-default', model: 'default-model' },
      })),
      recipeForGenerated: (_type: string, node: { data: Record<string, unknown> }) =>
        node.data.mode === 'video'
          ? { channelId: 'ch-v', model: 'Video Model' }
          : { channelId: 'ch-i', model: 'Image Model' },
    } as unknown as AgentToolContext

    await executeConfirmedTool(
      'applyPlan',
      {
        summary: '一张图 + 一段视频',
        nodes: [
          { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 0 },
          { localId: 'g2', type: 'generation', data: { mode: 'video' }, order: 1 },
        ],
        edges: [],
      },
      ctx,
    )

    const dataOf = (mode: string) =>
      store
        .getSnapshot()
        .nodes.filter((n) => n.type === 'generation')
        .map((n) => n.data as Record<string, unknown>)
        .find((d) => d.mode === mode)
    expect(dataOf('image')).toMatchObject({ channelId: 'ch-i', model: 'Image Model' })
    expect(dataOf('video')).toMatchObject({ channelId: 'ch-v', model: 'Video Model' })
  })

  it('★ 计划里自己写了模型时以计划为准（他当场点名的优先，§11）', async () => {
    const { store } = setup()
    const ctx: AgentToolContext = {
      store,
      origin: { x: 0, y: 0 },
      runNodes: vi.fn(async () => []),
      defaultsForNewNode: vi.fn(async () => ({
        generation: { channelId: 'ch-default', model: 'default-model' },
      })),
      recipeForGenerated: () => ({ channelId: 'ch-i', model: 'Image Model' }),
    } as unknown as AgentToolContext

    await executeConfirmedTool(
      'applyPlan',
      {
        summary: 'x',
        nodes: [
          {
            localId: 'g1',
            type: 'generation',
            data: { mode: 'image', model: 'Plan Model' },
            order: 0,
          },
        ],
        edges: [],
      },
      ctx,
    )
    const gen = store
      .getSnapshot()
      .nodes.find((n) => n.type === 'generation')!.data as Record<string, unknown>
    expect(gen.model).toBe('Plan Model')
  })

  it('★ updateNode 改参数；节点不存在则如实报错', async () => {
    const { store, ctx } = setup()
    const id = addNode(store, 'generation', { mode: 'image' })
    expect(await executeConfirmedTool('updateNode', { nodeId: id, data: { ratio: '16:9' } }, ctx)).toEqual(
      { ok: true },
    )
    const r = (await executeConfirmedTool('updateNode', { nodeId: 'gone', data: {} }, ctx)) as {
      ok: boolean
    }
    expect(r.ok).toBe(false)
  })

  it('★★ runNode 走注入的执行层（agent 自己不直接发渠道请求）', async () => {
    const { store, ctx, runNodes } = setup()
    const id = addNode(store, 'generation', { mode: 'image' })
    const r = (await executeConfirmedTool('runNode', { nodeIds: [id] }, ctx)) as { ok: boolean }
    expect(r.ok).toBe(true)
    expect(runNodes).toHaveBeenCalledWith([id])
  })
})
