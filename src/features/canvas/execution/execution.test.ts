import { describe, it, expect, beforeEach } from 'vitest'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../../platform/memory/index'
import { createMockChannel } from '../../../platform/channels/mock'
import { createCanvasStore, type CanvasStore } from '../../../state/workbenches/canvas/store'
import type { Command } from '../../../state/commands'
import type { TransactionBoundary } from '../../../state/shared/types'
import { fingerprintHex } from '../../../domain/shared/hash'
import { imageSizeFromHeader } from '../../../domain/shared/imageSize'
import { solidPng } from '../../../platform/channels/mockPng'
import type { ChannelAdapter, GeneratedAsset } from '../../../platform/channels/types'
import { RESULT_CELL } from '../../../domain/canvas/layout/constants'
import { generationSpec } from '../../../domain/canvas/nodeSpecs/generation'
import type { GenerationData } from '../../../domain/canvas/model/node'
import { buildRunPlan, type CanvasRunTask } from './buildRunPlan'
import { createCanvasPlacement } from './canvasPlacement'
// 引擎上移共享层（M6-5 路径 B）；画布测试通过注入 CanvasPlacement 复现原行为
import { runEngine, type RunEngineDeps } from '../../shared/execution/runEngine'
import { pixelSummaryOf } from '../../../domain/shared/execution/runRecord'

/**
 * M0-11 契约验证点：渠道配置 → 生成节点 → buildRunPlan → runEngine → 结果写回 → RunRecord 落库。
 * 全部在 node 环境跑：内存平台 + mock 渠道 + 真实 store，不需要浏览器。
 *
 * M2-2 扩展：生图成功除写回来源/目标节点外，还会落地「结果组 + 逐张子节点 + 素材本体」，
 * 因此断言里节点数量要算上结果组子节点（每条成功生图 +1 个子节点）。
 */
const PROMPT_TEXT = '一只在屋顶的猫'

/** 生成类节点（含分组 / 批量）的完整默认数据：模型层字段齐全，避免 toRunRequest 读到 undefined */
function genDefaults(over: Partial<GenerationData> = {}): GenerationData {
  return { ...(generationSpec.createDefaultData() as GenerationData), ...over }
}

function setup() {
  const platform = createMemoryPlatform()
  const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
  const promptId = 'n-prompt'
  const genId = 'n-gen'
  store.dispatch({
    kind: 'node.create',
    projectId: 'p1',
    type: 'prompt',
    at: { x: 0, y: 0 },
    id: promptId,
    data: { text: PROMPT_TEXT, upstreamPromptLinked: false },
  })
  store.dispatch({
    kind: 'node.create',
    projectId: 'p1',
    type: 'generation',
    at: { x: 400, y: 0 },
    id: genId,
    data: {
      mode: 'image',
      prompt: '',
      linkedPromptNodeIds: [],
      channelId: 'ch-mock',
      model: 'mock-image-1',
      thumbOrder: [],
      upstreamHidden: [],
    },
  })
  store.dispatch({ kind: 'edge.connect', source: promptId, target: genId })
  return { platform, store, promptId, genId }
}

/** 宿主侧的 writeBack：把 runEngine 的命令与事务边界原样转交给 store */
function host(store: CanvasStore) {
  return (commands: Command[], tx?: TransactionBoundary): void => {
    if (tx?.mode === 'multi-step') store.beginPlan(tx.planId, tx.label)
    for (const c of commands) store.dispatch(c, tx)
  }
}

function deps(
  store: CanvasStore,
  channel: ChannelAdapter,
  overrides: Partial<RunEngineDeps<CanvasRunTask, Command>> = {},
): RunEngineDeps<CanvasRunTask, Command> {
  return {
    signal: new AbortController().signal,
    projectId: 'p1',
    channelResolver: () => channel,
    writeBack: host(store),
    placement: createCanvasPlacement(() => 'p1'),
    now: () => 0,
    wait: () => Promise.resolve(),
    ...overrides,
  }
}

/**
 * 造一个「请求像素与实际像素故意不同」的 stub 渠道。
 *
 * 存在的理由：mock 渠道按请求比例造图，于是两个数天然相等 —— 而**相等正是
 * 「实际照抄请求」这个错误实现的表现**。要区分「真采集」与「抄了一遍」，
 * 必须有一个两侧不等的渠道，故有此 stub（见下方 §6.18 的 ★ 用例）。
 */
function stubChannel(
  bytes: Uint8Array,
  requested: { requestedWidth?: number; requestedHeight?: number },
): ChannelAdapter {
  const image = async (): Promise<GeneratedAsset[]> => [
    {
      hash: fingerprintHex('stub'),
      mime: 'image/png',
      bytes,
      ...(imageSizeFromHeader(bytes) ?? {}),
      ...requested,
    },
  ]
  return {
    protocol: 'stub',
    verify: async () => ({ ok: true, models: [] }),
    listModels: async () => [],
    generateImage: image,
    generateVideo: image,
    completeText: async () => ({ text: '' }),
  }
}

function dataOf(store: CanvasStore, id: string): Record<string, unknown> {
  return store.getSnapshot().nodes.find((n) => n.id === id)!.data as unknown as Record<string, unknown>
}

beforeEach(() => {
  registerAllSpecs()
})

describe('buildRunPlan（单点生成）', () => {
  it('提示词节点发起：任务落在下游生成节点，提示词取上游文本', () => {
    const { store, promptId, genId } = setup()
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.nodeId).toBe(genId)
    expect(plan.tasks[0]!.request.prompt).toBe(PROMPT_TEXT)
    expect(plan.tasks[0]!.request.kind).toBe('image')
    // 落位：BFS 找到下游那个空的生成节点，直接复用
    expect(plan.tasks[0]!.slot).toEqual({ kind: 'reuse', nodeId: genId })
  })

  it('single-alt 解析为 single + newDownstream，落位改为铺新下游节点', () => {
    const { store, promptId } = setup()
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single-alt')
    expect(plan.mode).toBe('single')
    expect(plan.newDownstream).toBe(true)
    expect(plan.tasks[0]!.slot.kind).toBe('new')
  })

  it('渠道或模型未配置的节点不入计划', () => {
    const { store, promptId } = setup()
    store.dispatch({
      kind: 'node.updateData',
      id: 'n-gen',
      patch: { model: '' },
    })
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    expect(plan.tasks).toHaveLength(0)
  })

  it('refreshStale 只收 stale 集合内的节点', () => {
    const { store, promptId, genId } = setup()
    const g = store.getSnapshot()
    expect(buildRunPlan('node', { originNodeId: promptId }, g, 'refreshStale', new Set()).tasks).toHaveLength(0)
    expect(
      buildRunPlan('node', { originNodeId: promptId }, g, 'refreshStale', new Set([genId])).tasks,
    ).toHaveLength(1)
  })
})

/**
 * §6.19.1 四种执行模式的区间差异都在这里锁死：
 * 单点 = 触发节点、整条流程 = 触发节点 + 全部下游、仅刷新陈旧 = 陈旧子集、
 * 全图重跑 = 无触发节点的全图。
 */
describe('buildRunPlan · 按范围的执行模式（§6.19.1）', () => {
  it('单点生成只收触发节点这一跳，不碰下游', () => {
    const { store, promptId, genId } = setup()
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 800, y: 0 },
      id: 'n-gen2',
      data: {
        mode: 'image',
        prompt: '',
        linkedPromptNodeIds: [],
        channelId: 'ch-mock',
        model: 'mock-image-1',
        thumbOrder: [],
        upstreamHidden: [],
      },
    })
    store.dispatch({ kind: 'edge.connect', source: genId, target: 'n-gen2' })
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    // 提示词发起 → 只落到最近的生成节点，不再往它的下游跑
    expect(plan.tasks.map((t) => t.nodeId)).toEqual([genId])
  })

  it('整条流程重新运行（rerun）：触发节点 + 全部下游，按拓扑序', () => {
    const { store, promptId, genId } = setup()
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 800, y: 0 },
      id: 'n-gen2',
      data: {
        mode: 'image',
        // 自己的提示词：否则 toRunRequest 返回 null（无提示词），会被过滤掉而看不到下游
        prompt: '第二段提示词',
        linkedPromptNodeIds: [],
        channelId: 'ch-mock',
        model: 'mock-image-1',
        thumbOrder: [],
        upstreamHidden: [],
      },
    })
    store.dispatch({ kind: 'edge.connect', source: genId, target: 'n-gen2' })
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'rerun')
    expect(plan.mode).toBe('rerun')
    expect(plan.tasks.map((t) => t.nodeId)).toEqual([genId, 'n-gen2'])
  })

  it('仅刷新陈旧：无触发节点 = 全图（顶栏口径），只收陈旧集合内的节点', () => {
    const { store, genId } = setup()
    const g = store.getSnapshot()
    expect(buildRunPlan('global', { originNodeId: null }, g, 'refreshStale', new Set()).tasks).toHaveLength(0)
    const plan = buildRunPlan('global', { originNodeId: null }, g, 'refreshStale', new Set([genId]))
    expect(plan.scope).toBe('global')
    expect(plan.tasks.map((t) => t.nodeId)).toEqual([genId])
  })

  it('全图重跑（rerunAll）：无触发节点，从源头收全图', () => {
    const { store, genId } = setup()
    const plan = buildRunPlan('global', { originNodeId: null }, store.getSnapshot(), 'rerunAll')
    expect(plan.mode).toBe('rerunAll')
    expect(plan.tasks.map((t) => t.nodeId)).toEqual([genId])
  })
})

describe('runEngine · mock 渠道出图', () => {  it('完整跑通一次：结果写回节点，RunRecord 落库', async () => {
    const { platform, store, promptId, genId } = setup()
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    const channel = createMockChannel()

    const summary = await runEngine(plan, deps(store, channel))
    store.endPlan()

    expect(summary.succeeded).toBe(1)
    expect(summary.failed).toBe(0)
    expect(summary.canceled).toBe(0)
    expect(summary.taskResults[0]!.state.kind).toBe('succeeded')

    // 结果写回：assetHash 与 mock 渠道的确定性输出一致
    const expected = fingerprintHex(`mock-image-1|${PROMPT_TEXT}|0`)
    expect(dataOf(store, genId).assetHash).toBe(expected)

    // §6.16：单一产物**不建结果组**——生成节点自己就是那张图的落点
    expect(store.getSnapshot().resultGroups).toHaveLength(0)
    // 产物写实：hash / 缩略图顺序 / 真实像素都落在生成节点自己身上
    expect(dataOf(store, genId).thumbOrder).toEqual([expected])
    expect(dataOf(store, genId).naturalSize).toEqual({ width: 64, height: 64 })

    // RunRecord：版本历史落库
    expect(summary.records).toHaveLength(1)
    expect(summary.records[0]).toMatchObject({
      nodeId: genId,
      status: 'succeeded',
      outputHashes: [expected],
    })
    await store.flush()
    const rows = await platform.storage.query('runRecords', {})
    // M2-2：素材本体随 flush 落库（persist 在 flush 时写存储，不在内存快照里）
    const assets = await platform.storage.query('assets', {})
    expect(assets).toHaveLength(1)
    expect(rows).toHaveLength(1)
    expect(rows[0]!.id).toBe(summary.records[0]!.id)
  })

  it('§6.18 日志「请求 / 实际」像素：两侧分别进 RunRecord（mock 16:9 → 64×36）', async () => {
    const { store, promptId, genId } = setup()
    // 16:9 → mock 按该比例造 64×36 的 PNG
    store.dispatch({ kind: 'node.updateData', id: genId, patch: { ratio: '16:9' } })
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    const summary = await runEngine(plan, deps(store, createMockChannel()))
    store.endPlan()

    const record = summary.records[0]!
    expect(record).toMatchObject({
      requestedWidth: 64,
      requestedHeight: 36,
      outputWidth: 64,
      outputHeight: 36,
    })
    expect(pixelSummaryOf(record)).toBe('请求64x36  实际64x36')
  })

  /**
   * ★ engine 层「实际像素 ≠ 请求像素」的**非恒等**证明。
   *
   * 上面那条用例里两个数恰好相等（mock 按请求比例造图），把实现改成
   * 「实际照抄请求」它也照样绿——**故障注入实测确认过这一点**。
   * 因此这里另给一个 stub 渠道：请求 1024×1024、产物字节却是 7×3，
   * 两个数必须分别落在各自的字段上。缺了这条，「采集了」与「抄了一遍」无从区分。
   */
  it('★ §6.18 实际像素不照抄请求：请求 1024×1024 / 产物 7×3 时两数并存', async () => {
    const { store, promptId } = setup()
    const stub = stubChannel(solidPng(7, 3, [0x00, 0x00, 0x00]), {
      requestedWidth: 1024,
      requestedHeight: 1024,
    })
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    const summary = await runEngine(plan, deps(store, stub))
    store.endPlan()

    const record = summary.records[0]!
    expect(record).toMatchObject({ requestedWidth: 1024, requestedHeight: 1024 })
    expect(record).toMatchObject({ outputWidth: 7, outputHeight: 3 })
    expect(pixelSummaryOf(record)).toBe('请求1024x1024  实际7x3')
  })

  it('§6.18 失败 / 取消不留像素（没有产物就没有尺寸）', async () => {
    const { store, promptId } = setup()
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    const summary = await runEngine(plan, deps(store, createMockChannel({ failTimes: 99 })))
    store.endPlan()

    expect(summary.records[0]!.status).toBe('failed')
    expect(summary.records[0]!.requestedWidth).toBeUndefined()
    expect(summary.records[0]!.outputWidth).toBeUndefined()
    expect(pixelSummaryOf(summary.records[0]!)).toBeNull()
  })

  it('整次生成合并为一个撤销单元：undo 一次回到生成前', async () => {
    const { store, promptId, genId } = setup()
    const before = store.getSnapshot().nodes.length
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    await runEngine(plan, deps(store, createMockChannel()))
    store.endPlan()

    expect(store.canUndo()).toBe(true)
    store.undo()
    expect(dataOf(store, genId).assetHash).toBeUndefined()
    expect(store.getSnapshot().nodes).toHaveLength(before)
    // 结果组也随撤销回滚
    expect(store.getSnapshot().resultGroups).toHaveLength(0)
  })

  it('single-alt 把结果铺到新下游节点，旧节点不动', async () => {
    const { store, promptId, genId } = setup()
    const before = store.getSnapshot().nodes.length
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single-alt')
    const summary = await runEngine(plan, deps(store, createMockChannel()))
    store.endPlan()

    expect(summary.succeeded).toBe(1)
    // §6.16：单一产物不建结果组 → 净增 1（只有新铺的下游节点）
    expect(store.getSnapshot().nodes).toHaveLength(before + 1)
    expect(store.getSnapshot().resultGroups).toHaveLength(0)
    const created = store.getSnapshot().nodes.find((n) => n.title === '提示词的输出1')
    expect(created).toBeDefined()
    expect((created!.data as unknown as Record<string, unknown>).assetHash).toBeDefined()
    expect(dataOf(store, genId).assetHash).toBeUndefined()
  })

  it('§6.16 单一产物：不建结果组，节点按产物真实比例（16:9 → 427×240）', async () => {
    const { store, promptId, genId } = setup()
    store.dispatch({ kind: 'node.updateData', id: genId, patch: { ratio: '16:9' } })
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    await runEngine(plan, deps(store, createMockChannel()))
    store.endPlan()

    // mock 按请求比例出图：16:9 → 64×36
    expect(dataOf(store, genId).naturalSize).toEqual({ width: 64, height: 64 * (9 / 16) })
    const node = store.getSnapshot().nodes.find((n) => n.id === genId)!
    // 240（最小高）→ 等比 427×240：比例 ≈ 16/9，而不是方框的 1
    expect(node.h).toBe(240)
    expect(Math.round(node.w / node.h * 100) / 100).toBeCloseTo(16 / 9, 1)
    expect(store.getSnapshot().resultGroups).toHaveLength(0)
  })

  it('§6.16 多张产物：进结果组，组内统一格位（与产物比例无关）', async () => {
    const { store, promptId, genId } = setup()
    store.dispatch({ kind: 'node.updateData', id: genId, patch: { ratio: '16:9', count: 2 } })
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    await runEngine(plan, deps(store, createMockChannel()))
    store.endPlan()

    const groups = store.getSnapshot().resultGroups
    expect(groups).toHaveLength(1)
    const children = store.getSnapshot().nodes.filter((n) => n.parentId === groups[0]!.id)
    expect(children).toHaveLength(2)
    // 组内一律统一格位；真实像素仍记在 data 上，供拖出 / 复制出时恢复比例
    for (const c of children) {
      expect([c.w, c.h]).toEqual([RESULT_CELL.w, RESULT_CELL.h])
      expect((c.data as unknown as Record<string, unknown>).naturalSize).toEqual({
        width: 64,
        height: 36,
      })
    }
  })

  it('§6.8 容器运行：N=1 也建结果组（产物属于那次容器运行，不该写回容器内某个子节点）', async () => {
    const { store, promptId, genId } = setup()
    const snap = store.getSnapshot()
    // 子图里只有容器内的节点、不含容器自己（boardSubgraph 就是这么切的），
    // 故「这是不是容器运行」必须靠调用方声明 —— 这条用例锁的就是这个契约。
    const sub = {
      ...snap,
      nodes: snap.nodes.filter((n) => n.id === genId || n.id === promptId),
      edges: snap.edges,
    }
    const plan = buildRunPlan('board', { subgraph: sub, containerKind: 'board' }, snap, 'rerunAll')
    const summary = await runEngine(plan, deps(store, createMockChannel()))
    store.endPlan()

    expect(summary.succeeded).toBe(1)
    expect(store.getSnapshot().resultGroups).toHaveLength(1)
  })

  it('可重试错误按退避重试，最终成功', async () => {
    const { store, promptId } = setup()
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    const channel = createMockChannel({ failTimes: 2 })
    const summary = await runEngine(plan, deps(store, channel, { policy: { maxRetries: 2, backoffBase: 1 } }))
    store.endPlan()

    expect(channel.callCount).toBe(3)
    expect(summary.succeeded).toBe(1)
  })

  it('超过重试上限记为失败，并留下 failed 版本的 RunRecord', async () => {
    const { store, promptId } = setup()
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    const channel = createMockChannel({ failTimes: 99 })
    const summary = await runEngine(plan, deps(store, channel, { policy: { maxRetries: 1, backoffBase: 1 } }))
    store.endPlan()

    expect(channel.callCount).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.records[0]!.status).toBe('failed')
  })

  it('执行前已取消：任务跳过，不产生调用与结果', async () => {
    const { store, promptId, genId } = setup()
    const plan = buildRunPlan('node', { originNodeId: promptId }, store.getSnapshot(), 'single')
    const controller = new AbortController()
    controller.abort()
    const channel = createMockChannel()
    const summary = await runEngine(
      plan,
      deps(store, channel, { signal: controller.signal }),
    )
    store.endPlan()

    expect(summary.canceled).toBe(1)
    expect(summary.succeeded).toBe(0)
    expect(channel.callCount).toBe(0)
    expect(dataOf(store, genId).assetHash).toBeUndefined()
  })
})

/**
 * M3-3 批量节点（§6.12）：批量作为上游 → 下游生成节点逐个素材各生成一次。
 *
 * 四种典型场景里「批量套图」（集合内 N 张）与「批量 + 外部上游」都在这里锁死：
 * 每个集合项一次调用，全部结果进**同一个**结果组。
 */
describe('buildRunPlan + runEngine · 批量节点集合展开（§6.12）', () => {
  /** 批量节点（装 N 个生成子节点）→ 生成节点 */
  function batchSetup(assetHashes: string[]) {
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    const childIds: string[] = []
    assetHashes.forEach((hash, i) => {
      const id = `bp-c${i + 1}`
      childIds.push(id)
      store.dispatch({
        kind: 'node.create',
        projectId: 'p1',
        type: 'generation',
        at: { x: 0, y: 0 },
        id,
        parentId: 'bp',
        data: genDefaults({ assetHash: hash }),
      })
    })
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'batch',
      at: { x: 0, y: 0 },
      id: 'bp',
      data: { ...genDefaults(), contentType: 'media', childIds, hiddenIds: [] },
    })
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'generation',
      at: { x: 500, y: 0 },
      id: 'gen',
      data: genDefaults({ channelId: 'ch-mock', model: 'mock-image-1', prompt: '批量套图' }),
    })
    store.dispatch({ kind: 'edge.connect', source: 'bp', target: 'gen' })
    return { platform, store }
  }

  it('批量 2 张 → 展开 2 个 task，结果落同一个结果组（2 个子节点）', async () => {
    const { store } = batchSetup(['ha', 'hb'])
    const plan = buildRunPlan('node', { originNodeId: 'gen' }, store.getSnapshot(), 'single')

    // 一个下游节点因集合展开成 2 次调用
    expect(plan.tasks).toHaveLength(2)
    expect(plan.tasks.map((t) => t.nodeId)).toEqual(['gen', 'gen'])
    expect(plan.tasks.map((t) => t.seq)).toEqual([0, 1])
    // 每次调用只带自己的那一个集合项（不再整包）
    expect(plan.tasks.map((t) => t.request.inputs)).toEqual([
      [{ kind: 'asset', nodeId: 'bp-c1', assetHash: 'ha', mime: 'image/png', collectionItemId: 'bp-c1' }],
      [{ kind: 'asset', nodeId: 'bp-c2', assetHash: 'hb', mime: 'image/png', collectionItemId: 'bp-c2' }],
    ])
    // 溯源：每次调用对应哪个集合项
    expect(plan.tasks.map((t) => t.collectionItemId)).toEqual(['bp-c1', 'bp-c2'])
    // 指纹含完整集合，逐项共用（集合内容变了才算输入变了）
    expect(plan.tasks[0]!.fingerprint).toBe(plan.tasks[1]!.fingerprint)

    const summary = await runEngine(plan, deps(store, createMockChannel()))
    store.endPlan()

    expect(summary.succeeded).toBe(2)
    // 场景 1 关键断言：批量 2 张 → 右侧**一个**结果组含 2 个结果节点
    const groups = store.getSnapshot().resultGroups
    expect(groups).toHaveLength(1)
    // 注意：批量节点自身的 2 个子节点也带 parentId，这里只为结果组的子节点计数
    const children = store.getSnapshot().nodes.filter((n) => n.parentId === groups[0]!.id)
    expect(children).toHaveLength(2)
    const hashes = children.map((c) => (c.data as unknown as Record<string, unknown>).assetHash)
    expect(new Set(hashes).size).toBe(2)
  })

  it('批量节点**自己**点生成也展开成 N 次调用（§6.12「批量文生图」入口）', async () => {
    // 批量集合内有 2 条提示词：批量节点自己发起生成时，应出 2 份结果（不是 1 份）。
    // 这条与「批量作为上游」是两条独立通路，都必须展开。
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    const childIds: string[] = []
    for (const [i, text] of ['清晨的咖啡馆', '雨夜的霓虹街道'].entries()) {
      const id = `bp-p${i + 1}`
      childIds.push(id)
      store.dispatch({
        kind: 'node.create',
        projectId: 'p1',
        type: 'prompt',
        at: { x: 0, y: 0 },
        id,
        parentId: 'bp',
        data: { text, upstreamPromptLinked: false },
      })
    }
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'batch',
      at: { x: 0, y: 0 },
      id: 'bp',
      data: {
        ...genDefaults({ channelId: 'ch-mock', model: 'mock-image-1' }),
        contentType: 'prompt',
        childIds,
        hiddenIds: [],
      },
    })

    const plan = buildRunPlan('node', { originNodeId: 'bp' }, store.getSnapshot(), 'single')
    expect(plan.tasks).toHaveLength(2)
    // 每次调用携带自己那条提示词
    expect(plan.tasks.map((t) => t.request.prompt)).toEqual(['清晨的咖啡馆', '雨夜的霓虹街道'])

    const summary = await runEngine(plan, deps(store, createMockChannel()))
    store.endPlan()

    expect(summary.succeeded).toBe(2)
    const groups = store.getSnapshot().resultGroups
    expect(groups).toHaveLength(1)
    const results = store.getSnapshot().nodes.filter((n) => n.parentId === groups[0]!.id)
    expect(results).toHaveLength(2)
    // 两条提示词不同 → 素材必然不同
    const hashes = results.map((r) => (r.data as unknown as Record<string, unknown>).assetHash)
    expect(new Set(hashes).size).toBe(2)
  })

  it('批量结论：集合为空时不产生任何调用', () => {
    const platform = createMemoryPlatform()
    const store = createCanvasStore({ platform, projectId: 'p1', debounceMs: 0 })
    store.dispatch({
      kind: 'node.create',
      projectId: 'p1',
      type: 'batch',
      at: { x: 0, y: 0 },
      id: 'bp',
      data: {
        ...genDefaults({ channelId: 'ch-mock', model: 'mock-image-1', prompt: '' }),
        contentType: 'media',
        childIds: [],
        hiddenIds: [],
      },
    })
    const plan = buildRunPlan('node', { originNodeId: 'bp' }, store.getSnapshot(), 'single')
    expect(plan.tasks).toHaveLength(0)
  })

  it('批量内容变化会让指纹变化（重新生成判定为过期）', () => {
    const { store } = batchSetup(['ha', 'hb'])
    const before = buildRunPlan('node', { originNodeId: 'gen' }, store.getSnapshot(), 'single')
    store.dispatch({
      kind: 'node.updateData',
      id: 'bp-c2',
      patch: { assetHash: 'hc' },
    })
    const after = buildRunPlan('node', { originNodeId: 'gen' }, store.getSnapshot(), 'single')
    expect(after.tasks[0]!.fingerprint).not.toBe(before.tasks[0]!.fingerprint)
  })

  it('隐藏的集合项不参与展开（§6.12「隐藏的素材不计入」）', () => {
    const { store } = batchSetup(['ha', 'hb'])
    store.dispatch({ kind: 'node.updateData', id: 'bp', patch: { hiddenIds: ['bp-c1'] } })
    const plan = buildRunPlan('node', { originNodeId: 'gen' }, store.getSnapshot(), 'single')
    expect(plan.tasks).toHaveLength(1)
    expect(plan.tasks[0]!.request.inputs).toEqual([
      { kind: 'asset', nodeId: 'bp-c2', assetHash: 'hb', mime: 'image/png', collectionItemId: 'bp-c2' },
    ])
  })
})
