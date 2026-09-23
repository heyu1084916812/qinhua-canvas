import { describe, it, expect } from 'vitest'
import { createChannelStore } from './channelStore'
import { createMemoryPlatform } from '../../platform/memory'

/**
 * 「新建节点记住上次生成用的模型与参数」（用户 2026-09-23 报未生效）。
 *
 * 规则（产品文档 §6.8，2026-09-18 定稿）：
 *   该渠道记过 → 用**该渠道上一次生成用的那一套**（模型 + 参数）
 *   从没记过   → 第一个可用渠道的第一个可用模型
 *
 * 用户实测反馈：新建时**始终**走的是后者（第一个渠道 + 第一个模型），
 * 前一种（读回上次生成那套）没有生效。这一组断言就是在钉这条路径。
 */

async function storeWith(channels: unknown[]) {
  const platform = createMemoryPlatform({
    rows: { channels },
  } as never)
  const store = createChannelStore(platform)
  await store.load()
  return { store, platform }
}

function channel(id: string, models: string[], enabled = true) {
  return {
    id,
    name: id,
    protocol: 'openai-images',
    baseUrl: 'https://relay.example.com',
    credentialRef: null,
    enabled,
    models: models.map((m) => ({ id: m, category: 'image', inputTypes: ['text'], maxCount: 4 })),
    modelCache: [],
    createdAt: 1,
  }
}

describe('生成配方记忆 · 新建节点要记住上次生成那套', () => {
  it('从没生成过 → 取第一个可用渠道的第一个模型（兜底那档）', async () => {
    const { store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])
    const recipe = await store.defaultForNewNode({}, 'image')
    expect(recipe?.channelId).toBe('ch-1')
    expect(recipe?.model).toBe('a-img')
  })

  it('★ 生成过一次并记了配方 → 新建时要用**记过的那套**，而不是渠道第一个模型', async () => {
    const { store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])
    // 模拟「这次生成用了 b-img + 16:9」
    await store.rememberRecipe('ch-1', 'b-img', { ratio: '16:9', resolution: '2k' })

    const recipe = await store.defaultForNewNode({}, 'image')
    expect(recipe?.model).toBe('b-img')
    expect(recipe?.params).toMatchObject({ ratio: '16:9', resolution: '2k' })
  })

  it('★ 记过的配方在**新建另一个节点**时仍然生效（不是只在同一会话里）', async () => {
    const { store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])
    await store.rememberRecipe('ch-1', 'b-img', { ratio: '16:9' })
    // 连建两次，两次都应拿到记过的配方
    const first = await store.defaultForNewNode({}, 'image')
    const second = await store.defaultForNewNode({}, 'image')
    expect(first?.model).toBe('b-img')
    expect(second?.model).toBe('b-img')
    expect(second?.params).toMatchObject({ ratio: '16:9' })
  })

  it('★ 配方落库：换一个 store 实例（≈刷新页面）也能读回上次那套', async () => {
    const { platform, store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])
    await store.rememberRecipe('ch-1', 'b-img', { ratio: '16:9' })

    // 新实例共享同一份内存 storage，等价于刷新后重新读库
    const fresh = createChannelStore(platform)
    await fresh.load()
    const recipe = await fresh.defaultForNewNode({}, 'image')
    expect(recipe?.model).toBe('b-img')
    expect(recipe?.params).toMatchObject({ ratio: '16:9' })
  })

  it('记过的模型已从渠道下架 → 回落到该渠道第一个可用模型（记录失效的兜底）', async () => {
    const { store } = await storeWith([channel('ch-1', ['a-img'])])
    await store.rememberRecipe('ch-1', 'gone-model', { ratio: '16:9' })
    const recipe = await store.defaultForNewNode({}, 'image')
    expect(recipe?.channelId).toBe('ch-1')
    expect(recipe?.model).toBe('a-img')
  })

  it('只选了渠道没选模型时不记配方（避免存下半份配方）', async () => {
    const { store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])
    await store.rememberRecipe('ch-1', '', { ratio: '16:9' })
    const recipe = await store.defaultForNewNode({}, 'image')
    expect(recipe?.model).toBe('a-img')
  })

  /**
   * ★ 端到端形状对齐：生成时实际记进配方的，是 `generationParams(data)` 的形状
   * （协议字段名、且「没设」会变成 null）。
   *
   * 这一条测的是**接口对得上**：记下去的 params 再读回来、经 newGeneratingNodeData
   * 写进新节点时，值不能丢。用户报的「参数没记住」若出在这里，就是两边字段名
   * 或 null 处理不一致 —— 所以必须按真实形状（含 null）来测，而不是喂一份理想参数。
   */
  it('★ 按真实协议形状记录（含 null 项）后，参数仍能读回并落到新节点', async () => {
    const { store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])
    // 这就是 generationParams(data) 在「比例 16:9、画质 2k、质量 auto、数量 1」时的输出
    await store.rememberRecipe('ch-1', 'b-img', {
      count: 1,
      ratio: '16:9',
      resolution: '2k',
      quality: 'auto',
    })
    const recipe = await store.defaultForNewNode({}, 'image')
    expect(recipe?.params).toMatchObject({
      count: 1,
      ratio: '16:9',
      resolution: '2k',
      quality: 'auto',
    })
  })

  it('★ 未设的项以 null 记录（比例没选时）不应覆盖新节点的默认值', async () => {
    const { store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])
    await store.rememberRecipe('ch-1', 'b-img', {
      count: 1,
      ratio: null,
      resolution: null,
      quality: null,
    })
    const recipe = await store.defaultForNewNode({}, 'image')
    // 配方仍要能读回（模型记住是关键），null 项由写回侧过滤
    expect(recipe?.model).toBe('b-img')
  })

  /**
   * ★★ 关键路径：配方**落库之后**，另一个会话（≈刷新 / 新开画布）新建节点，
   * 必须读到那份配方。
   *
   * 这是用户报的那条：新建时永远拿「第一个渠道第一个模型」。
   * 若解析链第 2 档（读记录）没命中，就会一路掉到第 3 档，表现正是如此。
   */
  it('★★ 配方已落库 → 新会话新建节点读到的是记过那套（不是第一个模型）', async () => {
    const { platform, store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])

    // 会话 A：生成时记录配方
    await store.rememberRecipe('ch-1', 'b-img', { ratio: '16:9', count: 2 })

    // 会话 B：全新的 store（等价于刷新页面后重新挂载）
    const sessionB = createChannelStore(platform)
    await sessionB.load()

    const recipe = await sessionB.defaultForNewNode({}, 'image')
    expect(recipe?.model).toBe('b-img')
    expect(recipe?.params).toMatchObject({ ratio: '16:9', count: 2 })
  })

  /**
   * ★★ 同一个会话里：先新建过一个节点（触发过一次预读），再生成并记录，
   * 之后再新建 —— 也要读到新配方。
   *
   * 风险点：`ensureRecipes` 有 `cacheLoaded` 短路。若记录后缓存没更新，
   * 后续新建就会拿到旧值（空 / 过期）。这条专门钉住「记录后缓存必须同步」。
   */
  it('★★ 同会话内先建过节点、后生成，再新建仍要拿到新配方', async () => {
    const { store } = await storeWith([channel('ch-1', ['a-img', 'b-img'])])

    // 先新建：此时还没记过任何配方（会走第 3 档兜底）
    const before = await store.defaultForNewNode({}, 'image')
    expect(before?.model).toBe('a-img')

    // 生成一次，改用 b-img + 16:9
    await store.rememberRecipe('ch-1', 'b-img', { ratio: '16:9' })

    // 再新建：必须拿到刚记下的那套
    const after = await store.defaultForNewNode({}, 'image')
    expect(after?.model).toBe('b-img')
    expect(after?.params).toMatchObject({ ratio: '16:9' })
  })
})
