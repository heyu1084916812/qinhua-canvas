import { describe, it, expect } from 'vitest'
import { createMemoryPlatform } from '../../../platform/memory/index'
import { createMockChannel } from '../../../platform/channels/mock'
import { createComicStore, type ComicStore } from '../../../state/workbenches/comic/store'
import type { ComicCommand } from '../../../state/workbenches/comic/reducer'
import type { TransactionBoundary } from '../../../state/shared/types'
import type { GeneratedAsset } from '../../../platform/channels/types'
import { mockImageHash } from '../../../platform/channels/mock'
import { buildPanelRunPlan, panelPromptOf } from '../../../domain/comic/panel/panelRun'
import { findPanel } from '../../../domain/comic/model/comicProject'
import { createComicPlacement } from './comicPlacement'
// 与画布**同一个**引擎（M6-5 路径 B）：comic 只注入自己的落位适配器
import { runEngine, type RunEngineDeps } from '../../shared/execution/runEngine'
import type { RunTask } from '../../../domain/shared/execution/plan'

/**
 * M6-5d 契约验证点：格（画面描述 + 镜头 + 角色）→ buildPanelRunPlan → runEngine
 * → ComicPlacement 写回 → 素材落 assets 表。
 *
 * 这是**路径 B 的第二个端到端证明**：与画布 `execution.test.ts` 共用同一个 runEngine，
 * 唯一差异是注入的 `ExecutionPlacement`。全部在 node 环境跑，不需要浏览器。
 *
 * 收口标准三条在这里逐条落锁：
 *   ① 格能生成出图 —— `panel.assetHash` 等于 mock 渠道的确定性输出，且素材真的进了 assets 表；
 *   ② 重生成不丢对白 —— 再跑一次换掉底图，`balloons` 原样保留；
 *   ③ canvas 不动 —— 画布侧的 runEngine 行为由 canvasPlacement 单测 + 冒烟各自保证。
 */
const SCENE = '雨夜的霓虹街道'
const MODEL = 'mock-image-1'

/** 建一个「一话一页一格」的最小项目，格配好生成配置并挂一条对白 */
function setup(): { platform: ReturnType<typeof createMemoryPlatform>; store: ComicStore; panelId: string } {
  const platform = createMemoryPlatform()
  const store = createComicStore({ platform, projectId: 'c1', debounceMs: 0 })

  store.dispatch({ kind: 'episode.add' })
  const epId = store.getProject().episodes[0]!.id
  store.dispatch({ kind: 'page.add', episodeId: epId })
  const pageId = store.getProject().episodes[0]!.pages[0]!.id
  store.dispatch({ kind: 'page.instantiate', episodeId: epId, pageId })
  const panelId = store.getProject().episodes[0]!.pages[0]!.panels[0]!.id

  store.dispatch({
    kind: 'panel.update',
    panelId,
    patch: { scene: SCENE, channelId: 'ch-mock', model: MODEL, shot: { framing: 'wide', angle: 'low' } },
  })
  store.dispatch({ kind: 'balloon.add', panelId, type: 'speech' })
  const balloonId = store.getProject().episodes[0]!.pages[0]!.panels[0]!.balloons[0]!.id
  store.dispatch({ kind: 'balloon.update', panelId, balloonId, patch: { text: '别回头。' } })

  return { platform, store, panelId }
}

function panelOf(store: ComicStore, panelId: string) {
  const p = findPanel(store.getProject(), panelId)
  if (!p) throw new Error('panel not found')
  return p
}

/** 宿主侧 writeBack：命令原样转交 comic store（事务边界被 comic 忽略） */
function host(store: ComicStore) {
  return (commands: ComicCommand[], tx?: TransactionBoundary): void => {
    for (const c of commands) store.dispatch(c, tx)
  }
}

/** 组装引擎依赖：comic 落位适配器 + 直接写 assets 表（模拟宿主注入的 putAsset） */
function deps(
  platform: ReturnType<typeof createMemoryPlatform>,
  store: ComicStore,
  channel: ReturnType<typeof createMockChannel>,
): RunEngineDeps<RunTask, ComicCommand> {
  return {
    signal: new AbortController().signal,
    projectId: 'c1',
    channelResolver: () => channel,
    writeBack: host(store),
    placement: createComicPlacement({
      putAsset: (a: GeneratedAsset) => {
        void platform.storage.put('assets', { ...a, id: a.hash } as never)
      },
    }),
    now: () => 0,
    wait: () => Promise.resolve(),
  }
}

describe('格 → RunRequest（提示词三层组装）', () => {
  it('画面描述 + 景别 + 机位 组装进 prompt；对白不进提示词', () => {
    const { store, panelId } = setup()
    const panel = panelOf(store, panelId)
    const req = panelPromptOf(store.getProject(), panel)
    expect(req).toBe(`${SCENE}，wide shot，low angle`)
    // 对白「别回头。」绝不出现——它是不烘进图的贴纸
    expect(req).not.toContain('别回头')
  })
})

describe('comic 落位 · 端到端出图（runEngine + ComicPlacement）', () => {
  it('完整跑通一次：assetHash 写回格，素材落 assets 表，对白原样保留', async () => {
    const { platform, store, panelId } = setup()
    const plan = buildPanelRunPlan(store.getProject(), panelId)!
    expect(plan.tasks).toHaveLength(1)
    // 单格生成：scope=node / mode=single，落点由适配器解读为「就是这一格」
    expect(plan.scope).toBe('node')
    expect(plan.tasks[0]!.nodeId).toBe(panelId)
    expect(plan.tasks[0]!.request.kind).toBe('image')

    const channel = createMockChannel()
    const summary = await runEngine(plan, deps(platform, store, channel))

    expect(summary.succeeded).toBe(1)
    expect(summary.failed).toBe(0)

    // ① 出图：hash = 产物字节的内容指纹（口径由 mock 渠道自己给出）
    const expected = mockImageHash({
      model: MODEL,
      prompt: panelPromptOf(store.getProject(), panelOf(store, panelId)),
    })
    expect(panelOf(store, panelId).assetHash).toBe(expected)

    // ② 素材本体真的进了 assets 表（hash 即主键）
    const assets = await platform.storage.query('assets', {})
    expect(assets).toHaveLength(1)
    expect(assets[0]!.id).toBe(expected)

    // ③ 对白原样保留（对白不丢的第一次证明）
    const panel = panelOf(store, panelId)
    expect(panel.balloons).toHaveLength(1)
    expect(panel.balloons[0]!.text).toBe('别回头。')

    // ④ 留痕落进格内（M6-15）：同一 id 与引擎记录对得上，版本从 1 起
    expect(summary.records).toHaveLength(1)
    expect(summary.records[0]).toMatchObject({ nodeId: panelId, status: 'succeeded', outputHashes: [expected] })
    expect(panel.runs).toHaveLength(1)
    expect(panel.runs[0]!).toMatchObject({
      id: summary.records[0]!.id,
      version: 1,
      status: 'succeeded',
      outputHashes: [expected],
      scene: SCENE,
      channelId: 'ch-mock',
      model: MODEL,
    })
  })

  it('重生成：换掉底图 hash，对白与画面描述都不受影响（「重生成不丢对白」）', async () => {
    const { platform, store, panelId } = setup()
    // 第一次
    const once = buildPanelRunPlan(store.getProject(), panelId)!
    await runEngine(once, deps(platform, store, createMockChannel()))
    const firstHash = panelOf(store, panelId).assetHash!

    // 改画面描述 → 重生成
    store.dispatch({ kind: 'panel.update', panelId, patch: { scene: '清晨空无一人的站台' } })
    const twice = buildPanelRunPlan(store.getProject(), panelId)!
    await runEngine(twice, deps(platform, store, createMockChannel()))
    const secondHash = panelOf(store, panelId).assetHash!

    // 底图确实换了
    expect(secondHash).not.toBe(firstHash)
    // 对白纹丝不动
    const panel = panelOf(store, panelId)
    expect(panel.balloons).toHaveLength(1)
    expect(panel.balloons[0]!.text).toBe('别回头。')
    expect(panel.scene).toBe('清晨空无一人的站台')
    // 两张素材都在库里（content-addressable，旧图不删）
    const assets = await platform.storage.query('assets', {})
    expect(assets).toHaveLength(2)
    // 两版历史都在格内（旧版不删——产品文档 §6.21）；旧图虽被换下，指针仍在留痕里
    expect(panel.runs.map((r) => [r.version, r.outputHashes[0]])).toEqual([
      [1, firstHash],
      [2, secondHash],
    ])
  })

  it('同一格重复生成相同输入：hash 幂等，setAsset 判无变化不重写；留痕仍各记一条', async () => {
    const { platform, store, panelId } = setup()
    const plan = buildPanelRunPlan(store.getProject(), panelId)!
    await runEngine(plan, deps(platform, store, createMockChannel()))
    const before = panelOf(store, panelId).assetHash

    const again = buildPanelRunPlan(store.getProject(), panelId)!
    await runEngine(again, deps(platform, store, createMockChannel()))
    // 同 model + prompt → 同 hash；reducer 对同值 setAsset 返回原引用（不产生空写）
    expect(panelOf(store, panelId).assetHash).toBe(before)
    // 但「发生过两次生成」是事实：留痕各记一条（只增不减），只是产物同 hash
    expect(panelOf(store, panelId).runs).toHaveLength(2)
  })

  it('配置不全的格不入计划（缺渠道 / 模型 / 画面描述）', () => {
    const { store, panelId } = setup()
    store.dispatch({ kind: 'panel.update', panelId, patch: { channelId: '' } })
    expect(buildPanelRunPlan(store.getProject(), panelId)).toBeNull()
  })

  it('渠道失败超过重试上限：记为失败，不写回 assetHash', async () => {
    const { platform, store, panelId } = setup()
    const plan = buildPanelRunPlan(store.getProject(), panelId)!
    const channel = createMockChannel({ failTimes: 99 })
    const summary = await runEngine(plan, {
      ...deps(platform, store, channel),
      policy: { maxRetries: 1, backoffBase: 1 },
    })
    expect(summary.failed).toBe(1)
    const panel = panelOf(store, panelId)
    expect(panel.assetHash).toBeUndefined()
    expect(await platform.storage.query('assets', {})).toHaveLength(0)
    // 失败也如实留痕（M6-15：历史是「发生过的事」），但没有产物 → 界面不给回退入口
    expect(panel.runs).toHaveLength(1)
    expect(panel.runs[0]!).toMatchObject({ version: 1, status: 'failed', outputHashes: [] })
  })
})
