import { createStore as createVanilla } from 'zustand/vanilla'
import type { PlatformKit } from '../../platform/ports'
import type { Channel, CreateChannelInput } from '../../domain/project/channel'
import { requiresBaseUrl, tokenTailOf } from '../../domain/project/channel'
import {
  buildProtocolCatalog,
  protocolById,
  stationProtocolForUrl,
  validateCustomProtocol,
  PROBE_VERSION_PATHS,
  type CustomProtocolInput,
  type CustomProtocolValidation,
  type ProtocolCatalog,
  type ProtocolDefinition,
} from '../../domain/project/protocol'
import { buildDefaultModelMap, setModelMapping } from '../../domain/project/modelMapping'
import type { RouteStrategy } from '../../domain/project/modelRouting'
import {
  NO_RECIPE,
  rememberRecipe,
  resolveForNode,
} from '../../domain/project/generationPreset'
import type { ModelCapability } from '../../domain/shared/capability'
import { createChannelRepository, type ChannelRepository } from '../project/channelRepository'
import { createPresetStore, type PresetStore } from '../project/presetStore'
import {
  createChannelAdapter,
  type ResolvedChannelConfig,
} from '../../platform/channels/registry'
import type { TextResult, VerifyResult } from '../../platform/channels/types'
import type { ChatMessage, ToolDeclaration } from '../../domain/shared/execution/types'
import { describeError, asAppError } from '../../shared/result'

/**
 * zustand 5 的 createStore 类型与本项目装好的 TypeScript 6 泛型推断冲突（见 state/workbenches/canvas/store.ts）。
 * 收敛成等价的极简工厂签名（运行时仍是 zustand，行为一致）。
 */
type MiniStore<T> = {
  getState: () => T
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void
  subscribe: (listener: () => void) => () => void
}
type StoreFactory = <T>(init: () => T) => MiniStore<T>
const createVanillaStore = createVanilla as unknown as StoreFactory

/**
 * 「验证地址」的结果（§7.3）：**只回答地址通不通 + 往返延迟**。
 * 刻意没有 modelCount —— 拉模型是「拉取模型」的职责，不是验证的副产品。
 */
export interface ChannelVerify {
  status: 'idle' | 'checking' | 'ok' | 'error'
  message?: string
  /** 本次「验证地址」的往返延迟（ms），供状态行展示（§7.3） */
  latency?: number
}

/**
 * 「拉取模型」的结果（§7.4）：与验证分开描述，因为它关心的不是通不通、而是拿到了几个模型。
 */
export interface ChannelModelsResult {
  status: 'idle' | 'checking' | 'ok' | 'error'
  message?: string
  modelCount?: number
}

/**
 * 「验证协议」的结果（§7.3）：逐个试打候选协议，命中即写回渠道。
 * 与 verify 分开是因为二者回答的不是同一个问题——verify 问「这个地址活着吗」，
 * detect 问「这个地址说哪种协议」，后者有协议这个额外产物与「全失败」这一额外结局。
 */
export interface ChannelDetect {
  status: 'idle' | 'checking' | 'ok' | 'error'
  /** 探测命中的协议 value；全失败为 null */
  protocol: string | null
  /** 全失败时留最后一条失败原因，供状态行展示 */
  message?: string
}

export interface ChannelStoreState {
  channels: Channel[]
  /**
   * 全局选路策略（用户 2026-09-29 第 12 轮）：跨渠道比较共用的一把尺子。
   *
   * 从渠道字段迁出到这里，是因为「同一个模型在多条渠道都能出图」天然是
   * 全局问题；放进每条渠道的表单会变成「用哪条渠道的策略」这种说不清的问题。
   */
  routeStrategy: RouteStrategy
  /** 用户自建协议（内置协议不在这里，见 domain/project/protocol 的目录） */
  customProtocols: ProtocolDefinition[]
  loaded: boolean
  verify: ChannelVerify
  models: ChannelModelsResult
  detect: ChannelDetect
}

export interface ChannelStoreActions {
  load(): Promise<void>
  /** 当前目录：内置协议 + 已加载的自建协议（渠道解析 / 界面共用一份） */
  protocolCatalog(): ProtocolCatalog
  /** 新增自建协议；返回校验结果，`ok:false` 时界面可直接展示原因 */
  createCustomProtocol(input: CustomProtocolInput): Promise<CustomProtocolValidation>
  /** 删除自建协议；仍被渠道引用时抛错（不静默改指） */
  removeCustomProtocol(id: string): Promise<void>
  create(input: CreateChannelInput): Promise<Channel>
  update(id: string, patch: Partial<Channel>): Promise<Channel>
  remove(id: string): Promise<void>
  /** 拖动排序（§7.2）：整表重编号 */
  reorder(orderedIds: string[]): Promise<void>
  saveToken(id: string, token: string): Promise<void>
  /** 删除令牌（§7.3）：只清密文，渠道保留、可再存 */
  removeToken(id: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** 「应用到模型列表」（§7.4）：把面板勾选结果写进 `models` */
  setModels(id: string, models: ModelCapability[]): Promise<void>
  /**
   * 写一条模型映射（§7.4.1，M7-2）：`逻辑名 → 该站上游 ID`。
   * 上游 ID 传空串即**删除**该条映射（回到恒等），不存空串。
   */
  setModelMapping(id: string, logicalName: string, upstreamId: string): Promise<void>
  /**
   * 渠道级选路参数（M7-2）：优先度（越大越优先）与权重（同档内加权随机）。
   * 与 `modelMap` 一样住在渠道行上——它们衡量的是「这条渠道本身」。
   */
  setRouteTuning(id: string, patch: { priority?: number; weight?: number }): Promise<void>
  /** 全局选路策略（跨渠道比较用的那把尺子），落库到 `presets` 的保留行 */
  setRouteStrategy(strategy: RouteStrategy): Promise<void>
  hasToken(id: string): Promise<boolean>
  /** 「验证地址」（§7.3）：只测通不通 + 延迟，不碰 models / modelCache */
  verify(id: string): Promise<void>
  /**
   * 「验证协议」（§7.3）：按候选表逐个试打，第一个通过的写回 `protocol` 并落库。
   * @returns 命中的协议 value；全失败返回 null（状态行给最后一条失败原因）
   */
  detectProtocol(id: string): Promise<string | null>
  /** 「拉取模型」（§7.4）：把该地址的全部模型写进 `modelCache`（选择面板的数据源） */
  refreshModels(id: string): Promise<void>
  /** 已启用渠道：供创作面板的平台下拉使用（M2-2 接入） */
  enabledChannels(): Channel[]
  /**
   * 记住「**这次生成**实际用的渠道 + 模型 + 参数」，作为该渠道新建节点的默认值
   * （用户 2026-09-18，2026-09-18 晚收口为按渠道）。调用方是**生成成功那一刻**，
   * 不是选参数的瞬间——用户要的是「最后一次生成用的那套」，选了却没生成的不该影响默认值。
   */
  rememberRecipe(
    channelId: string,
    model: string,
    params: Record<string, unknown>,
  ): Promise<void>
  /**
   * 给节点解析「该填的渠道 / 模型 / 参数」。
   *
   * 解析链（与 domain/project/generationPreset.resolveForNode 同源）：
   * 1. 节点自身已带的渠道 / 模型（`node` 参数，用户手动选过的最优先）
   * 2. 该渠道上次记录（模型失效时兜底该渠道第一个可用模型）
   * 3. 第一个可用渠道的第一个可用模型
   * 4. 都没有 → `null`（调用方给出可诊断的解释）
   *
   * - `category`：提示词节点只要文本模型（生成节点不需要传）
   *
   * 为什么带 `node` 参数：面板打开时节点可能已经带了渠道 / 模型，
   * 但也可能是「创建那刻没算出来」的空节点——此时面板用同一条解析链现算，
   * 不再留一个空下拉。这是修「明明配好渠道，新建节点还是空的」的关键。
   */
  defaultForNewNode(
    node: { channelId?: string; model?: string },
    category?: string,
  ): Promise<{ channelId: string; model: string; params: Record<string, unknown>; substituted: boolean } | null>
  /**
   * Agent 的带工具多轮调用（设计文档 §4）。
   *
   * 与 `CanvasExecutionProvider.completeText`（优化 / 翻译 / 反推那条）的分工：
   * 那是「一段系统指令 + 一段正文」的单次调用，给提示词节点用；
   * 这个要的是**完整消息数组 + 工具声明**，给 agent 循环用。
   * 两者共用同一套适配器解析（渠道 → 令牌 → registry），不重复那份逻辑。
   */
  completeWithTools(req: {
    channelId: string
    model: string
    tools: readonly ToolDeclaration[]
    messages: readonly ChatMessage[]
    signal: AbortSignal
  }): Promise<TextResult>
}

export type ChannelStore = MiniStore<ChannelStoreState> & ChannelStoreActions

function timeoutSignal(ms: number): AbortSignal {
  return typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { timeout?: unknown }).timeout === 'function'
    ? AbortSignal.timeout(ms)
    : new AbortController().signal
}

function toSafeConfig(ch: Channel, catalog: ProtocolCatalog): ResolvedChannelConfig {
  return {
    id: ch.id,
    protocol: ch.protocol,
    protocolDefinition: protocolById(ch.protocol, catalog),
    baseUrl: ch.baseUrl,
    credentialRef: ch.credentialRef,
    modelCache: ch.modelCache,
    apiKey: null,
  }
}

export function createChannelStore(platform: PlatformKit): ChannelStore {
  const repo: ChannelRepository = createChannelRepository(platform.storage, platform.credentials)
  const presets: PresetStore = createPresetStore(platform.storage)
  const store = createVanillaStore<ChannelStoreState>(() => ({
    channels: [],
    routeStrategy: 'priority',
    customProtocols: [],
    loaded: false,
    verify: { status: 'idle' },
    models: { status: 'idle' },
    detect: { status: 'idle', protocol: null },
  }))

  /** 当前目录：内置 + 已加载的自建。每次读取都现算，避免忘了在增删后同步 */
  const catalog = (): ProtocolCatalog =>
    buildProtocolCatalog(store.getState().customProtocols)

  /** 自建协议在存储里就是一条行；只取 ProtocolDefinition 需要的字段（不塞进 UI 字段） */
  const toCustomDefinition = (row: Record<string, unknown>): ProtocolDefinition | null => {
    if (typeof row.id !== 'string') return null
    const capabilities = Array.isArray(row.capabilities)
      ? (row.capabilities.filter((c) => c === 'chat' || c === 'image' || c === 'video') as ProtocolDefinition['capabilities'])
      : []
    return {
      id: row.id,
      name: typeof row.name === 'string' ? row.name : row.id,
      short: typeof row.short === 'string' ? row.short : row.id,
      family: 'openai-compatible',
      kind: 'custom',
      status: 'ready',
      capabilities,
      ...(typeof row.defaultBaseUrl === 'string' ? { defaultBaseUrl: row.defaultBaseUrl } : {}),
      ...(typeof row.versionPath === 'string' ? { versionPath: row.versionPath } : {}),
      ...(typeof row.docUrl === 'string' ? { docUrl: row.docUrl } : {}),
    }
  }

  const load: ChannelStoreActions['load'] = async () => {
    /**
     * 配方**不在这里预读**：它是按项目的，而 store 这一层不知道当前是哪个项目。
     * 改成 `defaultForNewNode(projectId)` 时按需读一次（结果进 recipeCache）。
     */
    const [channels, customRows, routeStrategy] = await Promise.all([
      repo.list(),
      platform.storage.query('customProtocols', {}),
      presets.loadRoutingStrategy(),
    ])
    const customProtocols = customRows
      .map((r) => toCustomDefinition(r as Record<string, unknown>))
      .filter((p): p is ProtocolDefinition => p !== null)
    store.setState({ channels, customProtocols, routeStrategy, loaded: true })
  }

  const createCustomProtocol: ChannelStoreActions['createCustomProtocol'] = async (input) => {
    const result = validateCustomProtocol(input, catalog().all)
    if (!result.ok) return result
    await platform.storage.put('customProtocols', { ...result.value })
    store.setState((s) => ({ customProtocols: [...s.customProtocols, result.value] }))
    return result
  }

  const removeCustomProtocol: ChannelStoreActions['removeCustomProtocol'] = async (id) => {
    const usedBy = store.getState().channels.filter((c) => c.protocol === id)
    if (usedBy.length > 0) {
      throw new Error(`仍有 ${usedBy.length} 条渠道在使用该协议，请先改协议或删除渠道`)
    }
    await platform.storage.delete('customProtocols', id)
    store.setState((s) => ({ customProtocols: s.customProtocols.filter((p) => p.id !== id) }))
  }

  const create: ChannelStoreActions['create'] = async (input) => {
    const ch = await repo.create(input)
    // 落库后**重读整表**，而不是把新渠道 unshift 到内存表头。
    // 列表顺序自 §7.2 起由 `order` 决定（可由用户拖动），新渠道按约定排在末尾；
    // 内存里再自作主张插到最前，就会出现「刷新一下顺序变了」——两套顺序认知。
    store.setState({ channels: await repo.list() })
    return ch
  }

  const update: ChannelStoreActions['update'] = async (id, patch) => {
    const ch = await repo.update(id, patch)
    store.setState((s) => ({ channels: s.channels.map((c) => (c.id === id ? ch : c)) }))
    return ch
  }

  const remove: ChannelStoreActions['remove'] = async (id) => {
    await repo.remove(id)
    store.setState((s) => ({ channels: s.channels.filter((c) => c.id !== id) }))
  }

  const reorder: ChannelStoreActions['reorder'] = async (orderedIds) => {
    const channels = await repo.reorder(orderedIds)
    store.setState({ channels })
  }

  const saveToken: ChannelStoreActions['saveToken'] = async (id, token) => {
    const ch = await repo.get(id)
    if (!ch?.credentialRef) throw new Error(`[channelStore] 渠道无凭据引用：${id}`)
    await repo.saveToken(ch.credentialRef, token)
    // 明文此刻唯一一次在手：顺手把尾号算出来存下，供设置页显示「存的是哪把钥匙」。
    // 之后再没有任何路径能拿到明文（除非用户重新输入）。
    await update(id, { tokenTail: tokenTailOf(token) })
  }

  const removeToken: ChannelStoreActions['removeToken'] = async (id) => {
    const ch = await repo.get(id)
    if (!ch?.credentialRef) return
    await repo.removeToken(ch.credentialRef)
    await update(id, { tokenTail: null })
  }

  const setEnabled: ChannelStoreActions['setEnabled'] = async (id, enabled) => {
    await update(id, { enabled })
  }

  const setModels: ChannelStoreActions['setModels'] = async (id, models) => {
    await update(id, { models })
  }

  const setModelMappingAction: ChannelStoreActions['setModelMapping'] = async (
    id,
    logicalName,
    upstreamId,
  ) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    // 传**当前整张表**进去，由纯函数产出新表：
    // 「空值即删除 / 只补不删 / 去空白」这些口径只有一份实现（domain），
    // 这里再写一遍必然漂移。
    await update(id, { modelMap: setModelMapping(ch.modelMap, logicalName, upstreamId) })
  }

  const setRouteTuning: ChannelStoreActions['setRouteTuning'] = async (id, patch) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    const next: { priority?: number; weight?: number } = {}
    // 优先度是整数档位，权重是非负整数 —— 表单里可能出现 "3.7" 或 "-1"，
    // 直接写进去会让「档位」这个概念失去意义（分档靠相等比较，小数会分出无数档）。
    if (typeof patch.priority === 'number') {
      next.priority = Number.isFinite(patch.priority) ? Math.trunc(patch.priority) : 0
    }
    if (typeof patch.weight === 'number') {
      const w = Number.isFinite(patch.weight) ? Math.trunc(patch.weight) : 0
      next.weight = Math.max(0, w)
    }
    await update(id, next)
  }

  const setRouteStrategy: ChannelStoreActions['setRouteStrategy'] = async (strategy) => {
    // 先落库再改内存。落库失败不抛：偏好类写不进去不该打断使用，
    // 最坏情况是本次能用、下次启动回落 priority（见 presetStore.saveRoutingStrategy）。
    await presets.saveRoutingStrategy(strategy)
    store.setState({ routeStrategy: strategy })
  }

  const hasToken: ChannelStoreActions['hasToken'] = async (id) => {
    const ch = await repo.get(id)
    if (!ch?.credentialRef) return false
    return (await repo.loadToken(ch.credentialRef)) != null
  }

  const verify: ChannelStoreActions['verify'] = async (id) => {
    const ch = await repo.get(id)
    if (!ch) return
    // 地址都没填就别发请求：空地址会让 URL 退化成**相对当前页**的路径（`/v1/models`），
    // 而 dev server / SPA 对任意路径都回 200 的 index.html ——「验证通过」会是纯假象。
    if (requiresBaseUrl(ch.protocol, catalog()) && !ch.baseUrl.trim()) {
      store.setState({ verify: { status: 'error', message: '请先填写地址' } })
      return
    }
    store.setState((s) => ({ verify: { ...s.verify, status: 'checking' } }))
    // 延迟必须由**发起方**测：适配器只管通不通，不知道调用方什么时候开始等的。
    // 记的是「一次 verify 往返」的墙钟时间（含 DNS / TLS / 响应体），与用户按按钮的体感一致。
    const startedAt = Date.now()
    const elapsed = () => Date.now() - startedAt
    try {
      const apiKey = ch.credentialRef ? await repo.loadToken(ch.credentialRef) : null
      const config: ResolvedChannelConfig = { ...toSafeConfig(ch, catalog()), apiKey }
      const adapter = createChannelAdapter(config, platform)
      const res: VerifyResult = await adapter.verify(config, timeoutSignal(10_000))
      if (res.ok) {
        // **刻意不写 `modelCache`**：拉模型是「拉取模型」按钮的职责（§7.4）。
        // 验证顺带把全集缓存回来，会让「验证」的语义从「这个地址通不通」漂成
        // 「顺便替你把模型也备齐了」——用户按的是验证，不该收到一份他没要的缓存。
        const updated = await repo.update(id, { lastTestAt: Date.now(), lastTestLatency: elapsed() })
        store.setState((s) => ({
          channels: s.channels.map((c) => (c.id === id ? updated : c)),
          verify: { status: 'ok', latency: elapsed() },
        }))
      } else {
        await repo.update(id, { lastTestAt: Date.now(), lastTestLatency: elapsed() })
        store.setState({ verify: { status: 'error', message: res.message ?? describeError(res.error), latency: elapsed() } })
      }
    } catch (e) {
      // 见下方 asAppError 的注释：这里不能只认 `instanceof Error`，
      // 否则平台层抛出的 AppError 字面量会被渲染成「[object Object]」。
      const app = asAppError(e)
      const message = app ? describeError(app) : e instanceof Error ? e.message : String(e)
      store.setState({ verify: { status: 'error', message, latency: elapsed() } })
    }
  }

  const detectProtocol: ChannelStoreActions['detectProtocol'] = async (id) => {
    const ch = await repo.get(id)
    if (!ch) return null
    // 候选协议都是「打某个真实端点」的协议，没有地址就没有可打的东西。
    // 若放行空地址，请求会变成相对当前页的 `/v1/models`，被 SPA 的 200 兜底页骗过。
    if (!ch.baseUrl.trim()) {
      store.setState({
        detect: { status: 'error', protocol: null, message: '请先填写地址再验证协议' },
      })
      return null
    }
    store.setState({ detect: { status: 'checking', protocol: null } })
    const apiKey = ch.credentialRef ? await repo.loadToken(ch.credentialRef) : null
    /**
     * 探测只问一件事：这个地址是不是 OpenAI 兼容 HTTP。
     *
     * 改造前是「逐条协议打一遍、第一个通过即命中」，而 `openai-images` 与
     * `openai-chat` 都打 `/v1/models`，同一个中继必然被两条同时命中，协议落在
     * 哪条全看候选表顺序（M6-16）。现在只剩一条通用模板，变的只是版本段：
     * `/v1` 不行再试 Ark 的 `/api/v3`。
     */
    const template = protocolById('openai-compatible', catalog())
    let lastMessage = ''
    for (const versionPath of PROBE_VERSION_PATHS) {
      const startedAt = Date.now()
      const elapsed = () => Date.now() - startedAt
      // 用探测模板覆盖当前协议：verify 打的是「OpenAI 兼容在这台机器上长什么样」的端点。
      const config: ResolvedChannelConfig = {
        ...toSafeConfig(ch, catalog()),
        protocol: 'openai-compatible',
        protocolDefinition: template ? { ...template, versionPath } : undefined,
      }
      try {
        const adapter = createChannelAdapter({ ...config, apiKey }, platform)
        const res: VerifyResult = await adapter.verify(config, timeoutSignal(10_000))
        if (res.ok) {
          /**
           * 命中即落库。探测事实层面只能说「这是 OpenAI 兼容」，但用户是带着站点
           * 心智来的：填了玉玉的地址却看到协议变成「OpenAI 兼容」会以为选错了。
           * 按 host 反查站点协议，让探测结果与用户认知一致；未知站点回落通用模板。
           * 同时刷新 lastTest*，与「验证地址」共用同一份「上次往返」记录。
           */
          const hit = stationProtocolForUrl(ch.baseUrl, catalog())?.id ?? 'openai-compatible'
          const updated = await repo.update(id, {
            protocol: hit,
            lastTestAt: Date.now(),
            lastTestLatency: elapsed(),
          })
          store.setState((s) => ({
            channels: s.channels.map((c) => (c.id === id ? updated : c)),
            detect: { status: 'ok', protocol: hit },
          }))
          return hit
        }
        lastMessage = res.message ?? describeError(res.error)
      } catch (e) {
        const app = asAppError(e)
        lastMessage = app ? describeError(app) : e instanceof Error ? e.message : String(e)
      }
    }
    store.setState({
      detect: { status: 'error', protocol: null, message: lastMessage || '该地址不像 OpenAI 兼容接口' },
    })
    return null
  }

  const refreshModels: ChannelStoreActions['refreshModels'] = async (id) => {
    const ch = await repo.get(id)
    if (!ch) return
    store.setState({ models: { status: 'checking' } })
    try {
      const apiKey = ch.credentialRef ? await repo.loadToken(ch.credentialRef) : null
      const config: ResolvedChannelConfig = { ...toSafeConfig(ch, catalog()), apiKey }
      const adapter = createChannelAdapter(config, platform)
      const models = await adapter.listModels(config, timeoutSignal(10_000))
      /**
       * 拉取后**顺带建默认映射**（§7.4.1）：上游 ID 与逻辑名同名的自动补成恒等映射，
       * 不同名的留空待用户填。
       *
       * 为什么在这里做而不是等用户点保存：映射表的键是「逻辑名」，而逻辑名的全集
       * 正是此刻刚拉回来的这份 + 用户已勾选的那份；错过这一次，用户就得先手动
       * 想起来有哪些名字。补的是**同名恒等**项，行为与不写完全一致，零风险。
       */
      const logicalNames = [
        ...new Set([...models.map((m) => m.id), ...ch.models.map((m) => m.id)]),
      ]
      const updated = await repo.update(id, {
        modelCache: models,
        modelMap: buildDefaultModelMap(ch.modelMap, logicalNames, models.map((m) => m.id)),
      })
      store.setState((s) => ({
        channels: s.channels.map((c) => (c.id === id ? updated : c)),
        models: { status: 'ok', modelCount: models.length },
      }))
    } catch (e) {
      // 「拉取模型」与「验证地址」是并排的两个按钮、打的是同一个端点。
      // 此前它没有 catch：地址错的时候抛成未捕获拒绝，用户点了按钮**什么反应都没有**。
      const app = asAppError(e)
      const message = app ? describeError(app) : e instanceof Error ? e.message : String(e)
      store.setState({ models: { status: 'error', message } })
    }
  }

  const enabledChannels = (): Channel[] => store.getState().channels.filter((c) => c.enabled)
  /**
   * 配方的两个动作放在这里，是因为**解析需要渠道列表**（它有哪些已勾选模型），
   * 而这个 store 正是列表的持有者。规则本身仍在 domain 的纯函数里，
   * 这里只把列表喂给它——不复制那份判断。
   */
  /**
   * 内存缓存：channelId → 配方（避免每次建节点都读一次库）。
   *
   * `cacheLoaded` 区分「还没从库里读过」与「读过但一条都没有」——
   * 否则第二种情况会每次新建都重读一次库。
   */
  const recipeCache = new Map<string, typeof NO_RECIPE>()
  let cacheLoaded = false
  /**
   * 配方时间戳**单调递增**（2026-09-23）。
   *
   * 解析链按 `savedAt` 挑「最近改过的那条」，而 `Date.now()` 只有毫秒精度：
   * 用户连着在两个渠道上改参数（或程序化地连记两次）完全可能落在同一毫秒，
   * 排序结果就不确定了——表现为「明明刚改过，新建却取了另一条」。
   * 这里保证每次记录严格大于上一次，排序因此永远有确定答案。
   */
  let lastRecipeAt = 0
  const nextRecipeAt = (): number => {
    const now = Date.now()
    lastRecipeAt = now > lastRecipeAt ? now : lastRecipeAt + 1
    return lastRecipeAt
  }

  const ensureRecipes = async (): Promise<void> => {
    if (cacheLoaded) return
    recipeCache.clear()
    for (const [channelId, recipe] of await presets.loadAll()) {
      recipeCache.set(channelId, recipe)
      // 从库里读回时也要把水位抬起来，避免与已存记录的时间戳撞上
      if (recipe.savedAt > lastRecipeAt) lastRecipeAt = recipe.savedAt
    }
    cacheLoaded = true
  }

  const rememberRecipeOfChannel: ChannelStoreActions['rememberRecipe'] = async (
    channelId,
    model,
    params,
  ) => {
    const next = rememberRecipe(channelId, model, params, nextRecipeAt())
    if (!next) return
    recipeCache.set(channelId, next)
    await presets.save(next)
  }

  const defaultForNewNode: ChannelStoreActions['defaultForNewNode'] = async (node, category) => {
    await ensureRecipes()
    /**
     * 只拿**已启用**的渠道参与解析：把没启用的当默认值，用户一生成就报
     * 「平台未启用」，比空着更让人困惑。
     */
    const usable = enabledChannels()
    /**
     * 解析链收在 domain 的纯函数里（见 generationPreset.resolveForNode），
     * 面板兜底与创建路径**调的是同一个函数**——两条路各写一份必然漂移。
     */
    return resolveForNode(
      node,
      usable,
      (channelId) => recipeCache.get(channelId) ?? NO_RECIPE,
      category,
    )
  }

  /**
   * Agent 的带工具多轮调用。
   *
   * 复用与 verify / refreshModels 同一套「渠道 → 令牌 → registry」解析，
   * 不另写一份 —— 那两份迟早分叉（比如只在一处补了协议定义）。
   */
  const completeWithTools: ChannelStoreActions['completeWithTools'] = async ({
    channelId,
    model,
    tools,
    messages,
    signal,
  }) => {
    const ch = store.getState().channels.find((c) => c.id === channelId)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${channelId}`)
    const apiKey = ch.credentialRef ? await repo.loadToken(ch.credentialRef) : null
    const config: ResolvedChannelConfig = { ...toSafeConfig(ch, catalog()), apiKey }
    const adapter = createChannelAdapter(config, platform)
    return adapter.completeText(
      { kind: 'text', channelId, model, prompt: '', inputs: [], params: {}, tools, messages },
      signal,
    )
  }

  return {
    ...store,
    load,
    protocolCatalog: catalog,
    createCustomProtocol,
    removeCustomProtocol,
    create,
    update,
    remove,
    reorder,
    saveToken,
    removeToken,
    setEnabled,
    setModels,
    setModelMapping: setModelMappingAction,
    setRouteTuning,
    setRouteStrategy,
    hasToken,
    verify,
    detectProtocol,
    refreshModels,
    enabledChannels,
    rememberRecipe: rememberRecipeOfChannel,
    defaultForNewNode,
    completeWithTools,
  }
}
