import { createStore as createVanilla } from 'zustand/vanilla'
import type { PlatformKit } from '../../platform/ports'
import type { Channel, CreateChannelInput } from '../../domain/project/channel'
import type { ChannelCredentialGroup } from '../../domain/project/channel'
import { channelIsRoutable, requiresBaseUrl, tokenTailOf } from '../../domain/project/channel'
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
import {
  buildDefaultModelMap,
  resolveUpstreamModel,
  setModelMapping,
} from '../../domain/project/modelMapping'
import type { RouteStrategy } from '../../domain/project/modelRouting'
import {
  NO_RECIPE,
  rememberRecipe,
  resolveForNode,
} from '../../domain/project/generationPreset'
import type { ModelCapability } from '../../domain/shared/capability'
import {
  PRESET_MODELS,
  type PresetModel,
  type PresetVendor,
} from '../../domain/project/modelPresets'
import { createChannelRepository, type ChannelRepository } from '../project/channelRepository'
import { BUILTIN_CHANNEL_IDS, isBuiltinChannelId } from '../../domain/project/builtinChannels'
import type { CredentialSlot } from '../../domain/project/channel'
import { createPresetStore, type PresetStore } from '../project/presetStore'
import {
  createChannelAdapter,
  type ResolvedChannelConfig,
} from '../../platform/channels/registry'
import type {
  GeneratedAsset,
  SpeechRunRequest,
  TextResult,
  VideoRunRequest,
  VerifyResult,
} from '../../platform/channels/types'
import type { ChatMessage, NodeInput, ToolDeclaration } from '../../domain/shared/execution/types'
import { describeError, asAppError } from '../../shared/result'
import { createId } from '../../shared/id'

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
  /**
   * 「记住上次参数」是否生效（对账 #386 的 E4）。
   *
   * 开（默认）= 现状：画布上改一次参数，下一个新节点就继承它。
   * 关 = 默认值只认「设置 → 默认参数」里那一份，随手改动不再带走它。
   */
  recipeMemory: boolean
  /** 用户自建协议（内置协议不在这里，见 domain/project/protocol 的目录） */
  customProtocols: ProtocolDefinition[]
  /** 用户新增的全局前端模型；内置 `PRESET_MODELS` 不允许删除。 */
  customModels: PresetModel[]
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
  globalModelsOf(category: PresetModel['category']): PresetModel[]
  globalModelOf(name: string): PresetModel | undefined
  addGlobalModel(input: {
    name: string
    category: PresetModel['category']
    vendor: PresetVendor
  }): Promise<PresetModel>
  removeGlobalModel(name: string): Promise<void>
  /** 拖动排序（§7.2）：整表重编号 */
  reorder(orderedIds: string[]): Promise<void>
  /**
   * 存 / 删 / 查令牌（§7.3）。`slot` 缺省 = **主槽**（老调用方零改动）；
   * `'alt'` = **备用槽** —— 声明了多把凭据的协议（RunningHub：金额 Key + 币 Key）才用得到。
   */
  saveToken(id: string, token: string, slot?: CredentialSlot): Promise<void>
  /**
   * 读回**明文**（用户 2026-10-08 第 5 条：「渠道的令牌显示功能是不生效的」）。
   *
   * 为什么以前没有它：界面上那个「显示」按钮只切换了输入框的 `type`，而已存的令牌
   * 一直只以**打码后的占位符**出现（明文从不进界面）⇒ 按了等于没按。
   * 现在「显示」按下去**真去凭据层读一次**；读到的明文只放进当前这一次渲染的输入框，
   * **不落库、不进日志**，切回「隐藏」时立刻丢掉。
   */
  loadToken(id: string, slot?: CredentialSlot): Promise<string | null>
  /** 删除令牌（§7.3）：只清密文，渠道保留、可再存 */
  removeToken(id: string, slot?: CredentialSlot): Promise<void>
  /** 新增一个 Key 分组；模型目录初始为空，等待用这把 Key 拉取。 */
  addCredentialGroup(id: string, name?: string): Promise<ChannelCredentialGroup>
  renameCredentialGroup(id: string, groupId: string, name: string): Promise<void>
  setCredentialGroupPriority(id: string, groupId: string, priority: number): Promise<void>
  removeCredentialGroup(id: string, groupId: string): Promise<void>
  saveCredentialGroupToken(id: string, groupId: string, token: string): Promise<void>
  loadCredentialGroupToken(id: string, groupId: string): Promise<string | null>
  removeCredentialGroupToken(id: string, groupId: string): Promise<void>
  setEnabled(id: string, enabled: boolean): Promise<void>
  /** 「应用到模型列表」（§7.4）：把面板勾选结果写进 `models` */
  setModels(id: string, models: ModelCapability[], groupId?: string): Promise<void>
  /** 用户手动修正某个模型的分类；保留站点原始分类供追溯。 */
  setModelCategory(
    id: string,
    modelId: string,
    category: ModelCapability['category'],
    groupId?: string,
  ): Promise<void>
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
  hasToken(id: string, slot?: CredentialSlot): Promise<boolean>
  /** 「验证地址」（§7.3）：只测通不通 + 延迟，不碰 models / modelCache */
  verify(id: string, groupId?: string): Promise<void>
  /**
   * 「验证协议」（§7.3）：按候选表逐个试打，第一个通过的写回 `protocol` 并落库。
   * @returns 命中的协议 value；全失败返回 null（状态行给最后一条失败原因）
   */
  detectProtocol(id: string, groupId?: string): Promise<string | null>
  /** 「拉取模型」（§7.4）：把该地址的全部模型写进 `modelCache`（选择面板的数据源） */
  refreshModels(id: string, groupId?: string): Promise<void>
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
  /** 切换「记住上次参数」；会立刻落库（下次启动还认这个选择） */
  setRecipeMemory(enabled: boolean): Promise<void>
  /**
   * **显式**设定某条渠道的默认配方（设置 → 默认参数里的"保存"）。
   *
   * 与 `rememberRecipe` 的区别：那是"随手改动顺便记住"，受「记住上次参数」开关管；
   * 这是用户在设置里**明确点保存**，开关关掉时也要生效 ——
   * 否则"关掉记忆"就等于"再也改不动默认值"，那明显不是用户要的。
   */
  setDefaultRecipe(channelId: string, model: string, params: Record<string, unknown>): Promise<void>
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
    /** 调用方已经解析过渠道映射；电商对话会显式传上游 ID，避免二次翻译 */
    modelIsUpstream?: boolean
    tools: readonly ToolDeclaration[]
    messages: readonly ChatMessage[]
    /**
     * 随本轮对话附带的视觉素材。电商商品分析必须真正把原图发给模型，
     * 只写文件名或节点 id 不算“看过图”。
     */
    inputs?: readonly NodeInput[]
    signal: AbortSignal
    /** 单次调用的等待上限；不给走 Agent 的默认值（见 `AGENT_CHAT_TIMEOUT_MS`） */
    timeoutMs?: number
  }): Promise<TextResult>
  /** 单次 TTS：文本 → 音频字节；调用方负责把产物写进 assets。 */
  generateSpeech(
    req: SpeechRunRequest & { signal: AbortSignal },
  ): Promise<GeneratedAsset>
  /** 单次视频调用；给不经过画布节点的直连工作流（如漫剧数字人口播）使用。 */
  generateVideo(
    req: VideoRunRequest & { signal: AbortSignal },
  ): Promise<GeneratedAsset[]>
}

export type ChannelStore = MiniStore<ChannelStoreState> & ChannelStoreActions

/**
 * Agent 多轮对话的等待上限，**比普通文本调用的 60s 长**。
 *
 * 2026-10-14 实测：跑完 9 个节点后把结果回填给模型的那一轮，请求超过 60 秒默认值，
 * 用户看到「连不上：等太久，超时了」，而图其实已经出好了。那一轮要读工具结果 +
 * 整轮历史，天然比「优化一句提示词」重。只放宽走 `completeWithTools` 的这条路，
 * 普通文本调用仍是 60 秒。
 */
const AGENT_CHAT_TIMEOUT_MS = 180_000

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
    altApiKey: null,
  }
}

/**
 * @param opts.seedBuiltins 读表时是否补齐**常驻内置渠道**（默认 `true`，用户第 20 批）。
 *   测试里那几条"一个渠道都没有"的用例传 `false` —— 它们测的是空态，不该被内置渠道填满；
 *   真实运行时永远用默认值（内置渠道必须常驻）。
 */
export function createChannelStore(
  platform: PlatformKit,
  opts: { seedBuiltins?: boolean } = {},
): ChannelStore {
  const seedBuiltins = opts.seedBuiltins !== false
  const repo: ChannelRepository = createChannelRepository(platform.storage, platform.credentials)
  const presets: PresetStore = createPresetStore(platform.storage)
  const store = createVanillaStore<ChannelStoreState>(() => ({
    channels: [],
    routeStrategy: 'priority',
    recipeMemory: true,
    customProtocols: [],
    customModels: [],
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
    const [loadedChannels, customRows, customModels, routeStrategy, recipeMemory] = await Promise.all([
      /**
       * ★ 读表时**补齐常驻内置渠道**（用户第 20 批起）：它们常驻、置顶、不可删。
       * 补齐放在仓储里（写行的唯一入口），这里只负责取"补完之后的整表"。
       */
      seedBuiltins ? repo.seedBuiltins() : repo.list(),
      platform.storage.query('customProtocols', {}),
      presets.loadCustomModels(),
      presets.loadRoutingStrategy(),
      presets.loadRecipeMemory(),
    ])
    let channels = loadedChannels
    const staleRunningHub = channels.filter(
      (c) =>
        c.protocol === 'runninghub-api' &&
        !c.hasToken &&
        (c.modelCache.length > 0 || c.models.length > 0),
    )
    if (staleRunningHub.length > 0) {
      const cleared = await Promise.all(
        staleRunningHub.map((c) =>
          repo.update(c.id, {
            modelCache: [],
            models: [],
            credentialGroups: c.credentialGroups.map((group) => ({
              ...group,
              modelCache: [],
              models: [],
            })),
          }),
        ),
      )
      const clearedById = new Map(cleared.map((c) => [c.id, c]))
      channels = channels.map((c) => clearedById.get(c.id) ?? c)
    }
    const customProtocols = customRows
      .map((r) => toCustomDefinition(r as Record<string, unknown>))
      .filter((p): p is ProtocolDefinition => p !== null)
    store.setState({
      channels,
      customProtocols,
      customModels,
      routeStrategy,
      recipeMemory,
      loaded: true,
    })
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
    try {
      await repo.remove(id)
    } catch (error) {
      // 删除可能已经把渠道写成停用态后才因凭据清理失败；重新读表，
      // 让界面立即反映真实状态，不能继续显示一条实际已不可用的旧行。
      store.setState({ channels: await repo.list() })
      throw error
    }
    store.setState((s) => ({ channels: s.channels.filter((c) => c.id !== id) }))
  }

  const globalModelsOf: ChannelStoreActions['globalModelsOf'] = (category) =>
    [...PRESET_MODELS, ...store.getState().customModels].filter(
      (model) => model.category === category,
    )

  const globalModelOf: ChannelStoreActions['globalModelOf'] = (name) => {
    const key = name.trim()
    return [...PRESET_MODELS, ...store.getState().customModels].find(
      (model) => model.id === key,
    )
  }

  const addGlobalModel: ChannelStoreActions['addGlobalModel'] = async (input) => {
    const name = input.name.trim()
    if (!name) throw new Error('模型名称不能为空')
    if (globalModelOf(name)) throw new Error(`前端模型「${name}」已经存在`)
    const model: PresetModel = {
      id: name,
      category: input.category,
      vendor: input.vendor,
    }
    const next = [...store.getState().customModels, model]
    await presets.saveCustomModels(next)
    store.setState({ customModels: next })
    return model
  }

  const removeGlobalModel: ChannelStoreActions['removeGlobalModel'] = async (name) => {
    const key = name.trim()
    if (!store.getState().customModels.some((model) => model.id === key)) {
      throw new Error('内置前端模型不能删除')
    }
    const next = store.getState().customModels.filter((model) => model.id !== key)
    await presets.saveCustomModels(next)
    store.setState({ customModels: next })
  }

  const reorder: ChannelStoreActions['reorder'] = async (orderedIds) => {
    /**
     * **内置渠道永远在最前**（用户第 20 批：「那三个渠道是一直在最上面」）：
     * 把传入的顺序按"内置在前、其余照用户拖的次序"重排一遍 ——
     * 用户拖不动它们，别人也挤不到它们上面。
     */
    const front = [...BUILTIN_CHANNEL_IDS]
    const rest = orderedIds.filter((id) => !isBuiltinChannelId(id))
    const channels = await repo.reorder([...front, ...rest])
    store.setState({ channels })
  }

  /**
   * 槽位 → 该槽在渠道行上存的引用、**尾号字段**与**存过标记字段**
   * （见 `Channel` 的 `altCredentialRef` / `hasToken` 注释）。
   */
  const slotFields = (ch: Channel, slot: CredentialSlot) =>
    slot === 'alt'
      ? {
          ref: ch.altCredentialRef,
          tail: 'altTokenTail' as const,
          has: 'hasAltToken' as const,
        }
      : { ref: ch.credentialRef, tail: 'tokenTail' as const, has: 'hasToken' as const }

  /** 两把明文 Key 一起读：合并协议按能力各自使用，普通协议只读主槽。 */
  const loadKeys = async (ch: Channel) => ({
    apiKey: ch.credentialRef ? await repo.loadToken(ch.credentialRef) : null,
    altApiKey: ch.altCredentialRef ? await repo.loadToken(ch.altCredentialRef) : null,
  })

  const saveToken: ChannelStoreActions['saveToken'] = async (id, token, slot = 'primary') => {
    const ch = await repo.get(id)
    const f = ch ? slotFields(ch, slot) : null
    if (!ch || !f?.ref) throw new Error(`[channelStore] 渠道无凭据引用：${id}`)
    await repo.saveToken(f.ref, token)
    /**
     * 明文此刻唯一一次在手：顺手把尾号算出来存下，供设置页显示「存的是哪把钥匙」。
     * 之后再没有任何路径能拿到明文（除非用户重新输入）。
     *
     * **“存过”必须与尾号分开记**（对账 #517）：短令牌没有尾号，只写尾号的话
     * 界面会把它读成「没存过」，显示 / 删除两个按钮也一起置灰。
     */
    let group = [...ch.credentialGroups].sort(
      (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
    )[slot === 'alt' ? 1 : 0]
    if (!group && slot === 'alt') {
      group = {
        id: createId('credgroup'),
        name: '备用分组',
        credentialRef: f.ref,
        tokenTail: null,
        hasToken: false,
        priority: 0,
        models: [],
        modelCache: [],
        createdAt: Date.now(),
      }
      await update(id, { credentialGroups: [...ch.credentialGroups, group] })
    }
    if (group) {
      await patchCredentialGroup(id, group.id, {
        tokenTail: tokenTailOf(token),
        hasToken: true,
      })
      if (slot === 'alt') {
        await update(id, { altTokenTail: tokenTailOf(token), hasAltToken: true })
      }
    } else {
      await update(id, { [f.tail]: tokenTailOf(token), [f.has]: true })
    }
  }

  const removeToken: ChannelStoreActions['removeToken'] = async (id, slot = 'primary') => {
    const ch = await repo.get(id)
    const f = ch ? slotFields(ch, slot) : null
    if (!ch || !f?.ref) return
    await repo.removeToken(f.ref)
    const group = [...ch.credentialGroups].sort(
      (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
    )[slot === 'alt' ? 1 : 0]
    if (group) {
      await patchCredentialGroup(id, group.id, { tokenTail: null, hasToken: false })
      if (slot === 'alt') {
        await update(id, { altTokenTail: null, hasAltToken: false })
      }
    } else {
      await update(id, { [f.tail]: null, [f.has]: false })
    }
  }

  /**
   * 读回明文（只服务「显示」那一个动作）。
   *
   * ⚠️ 调用方（设置页的令牌行）用完就丢：不写进任何持久化状态、也不 console.log。
   * 读不到（没存过 / 凭据层不可用）如实回 `null`，由界面说清"这一槽没存过"。
   */
  const loadToken: ChannelStoreActions['loadToken'] = async (id, slot = 'primary') => {
    const ch = await repo.get(id)
    const ref = ch ? slotFields(ch, slot).ref : null
    return ref ? repo.loadToken(ref) : null
  }

  const credentialGroupOf = (ch: Channel, groupId?: string): ChannelCredentialGroup => {
    const group = groupId
      ? ch.credentialGroups.find((item) => item.id === groupId)
      : [...ch.credentialGroups].sort(
          (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
        )[0]
    if (!group) throw new Error(`[channelStore] 渠道没有可用的 Key 分组：${ch.name}`)
    return group
  }

  const patchCredentialGroup = async (
    id: string,
    groupId: string,
    patch: Partial<ChannelCredentialGroup>,
  ): Promise<void> => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    if (!ch.credentialGroups.some((group) => group.id === groupId)) {
      throw new Error(`[channelStore] Key 分组不存在：${groupId}`)
    }
    await update(id, {
      credentialGroups: ch.credentialGroups.map((group) =>
        group.id === groupId ? { ...group, ...patch, id: group.id } : group,
      ),
    })
  }

  const addCredentialGroup: ChannelStoreActions['addCredentialGroup'] = async (
    id,
    name,
  ) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    const group: ChannelCredentialGroup = {
      id: createId('credgroup'),
      name: name?.trim() || `Key 分组 ${ch.credentialGroups.length + 1}`,
      credentialRef: createId('cred'),
      tokenTail: null,
      hasToken: false,
      priority: 0,
      models: [],
      modelCache: [],
      createdAt: Date.now(),
    }
    await update(id, { credentialGroups: [...ch.credentialGroups, group] })
    return group
  }

  const renameCredentialGroup: ChannelStoreActions['renameCredentialGroup'] = async (
    id,
    groupId,
    name,
  ) => {
    await patchCredentialGroup(id, groupId, { name: name.trim() || '未命名分组' })
  }

  const setCredentialGroupPriority: ChannelStoreActions['setCredentialGroupPriority'] =
    async (id, groupId, priority) => {
      await patchCredentialGroup(id, groupId, {
        priority: Number.isFinite(priority) ? Math.trunc(priority) : 0,
      })
    }

  const removeCredentialGroup: ChannelStoreActions['removeCredentialGroup'] = async (
    id,
    groupId,
  ) => {
    const ch = await repo.get(id)
    if (!ch) return
    if (ch.credentialGroups.length <= 1) {
      throw new Error('至少要保留一个 Key 分组；不想使用这个渠道可以停用或删除渠道')
    }
    const target = ch.credentialGroups.find((group) => group.id === groupId)
    if (!target) return
    await update(id, {
      credentialGroups: ch.credentialGroups.filter((group) => group.id !== groupId),
    })
    await repo.removeToken(target.credentialRef)
  }

  const saveCredentialGroupToken: ChannelStoreActions['saveCredentialGroupToken'] = async (
    id,
    groupId,
    token,
  ) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    const group = ch.credentialGroups.find((item) => item.id === groupId)
    if (!group) throw new Error(`[channelStore] Key 分组不存在：${groupId}`)
    await repo.saveToken(group.credentialRef, token)
    await patchCredentialGroup(id, groupId, {
      tokenTail: tokenTailOf(token),
      hasToken: true,
    })
  }

  const loadCredentialGroupToken: ChannelStoreActions['loadCredentialGroupToken'] = async (
    id,
    groupId,
  ) => {
    const ch = await repo.get(id)
    const group = ch?.credentialGroups.find((item) => item.id === groupId)
    return group ? repo.loadToken(group.credentialRef) : null
  }

  const removeCredentialGroupToken: ChannelStoreActions['removeCredentialGroupToken'] =
    async (id, groupId) => {
      const ch = await repo.get(id)
      const group = ch?.credentialGroups.find((item) => item.id === groupId)
      if (!group) return
      await repo.removeToken(group.credentialRef)
      await patchCredentialGroup(id, groupId, { tokenTail: null, hasToken: false })
    }

  /**
   * 启用开关：**先改内存，再落库**（乐观更新，2026-10-08 修）。
   *
   * ## 为什么不能直接 `await update(...)`
   *
   * 开关是**受控**的（`checked={ch.enabled}` 读的是 store）。走 `update` 时
   * 「点击改 DOM → 等 IndexedDB 写完 → 才 setState」这段窗口里，任何一次
   * 无关的重渲染（实测：点开关会顺带冒泡触发列表项的 `setSelectedId`）
   * 都会拿**还没更新的** `ch.enabled` 把 DOM 写回去 —— 表现为开关"弹回去再弹过来"，
   * 用户看到的是闪一下；自动化 `check()/uncheck()` 更直接：它们在点击后**立刻**
   * 读状态，读到回弹那一帧就判定"点了没变"，重试到超时（G69 实测卡死 30s）。
   *
   * 落库失败则**回滚**并把错误抛出去 —— 乐观更新只提前"显示"，不吞掉失败。
   */
  const setEnabled: ChannelStoreActions['setEnabled'] = async (id, enabled) => {
    const flip = (value: boolean) =>
      store.setState((s) => ({
        channels: s.channels.map((c) => (c.id === id ? { ...c, enabled: value } : c)),
      }))
    flip(enabled)
    try {
      await update(id, { enabled })
    } catch (e) {
      flip(!enabled)
      throw e
    }
  }

  const setModels: ChannelStoreActions['setModels'] = async (id, models, groupId) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    if (ch.credentialGroups.length === 0) {
      await update(id, { models })
      return
    }
    const group = credentialGroupOf(ch, groupId)
    await patchCredentialGroup(id, group.id, { models })
  }

  const setModelCategory: ChannelStoreActions['setModelCategory'] = async (
    id,
    modelId,
    category,
    groupId,
  ) => {
    const ch = await repo.get(id)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${id}`)
    const targetGroup = ch.credentialGroups.length
      ? credentialGroupOf(ch, groupId)
      : undefined
    const patchModel = (model: ModelCapability): ModelCapability =>
      model.id === modelId
        ? {
            ...model,
            category,
            upstreamCategory:
              model.upstreamCategory ??
              (model.category === 'unknown' ? undefined : model.category),
            categoryManual: true,
          }
        : model
    if (!targetGroup) {
      await update(id, {
        models: ch.models.map(patchModel),
        modelCache: ch.modelCache.map(patchModel),
      })
      return
    }
    await update(id, {
      credentialGroups: ch.credentialGroups.map((group) =>
        group.id === targetGroup.id
          ? {
              ...group,
              models: group.models.map(patchModel),
              modelCache: group.modelCache.map(patchModel),
            }
          : group,
      ),
    })
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

  const hasToken: ChannelStoreActions['hasToken'] = async (id, slot = 'primary') => {
    const ch = await repo.get(id)
    const ref = ch ? slotFields(ch, slot).ref : null
    if (!ref) return false
    return (await repo.loadToken(ref)) != null
  }

  const verify: ChannelStoreActions['verify'] = async (id, groupId) => {
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
      const group =
        ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
      const groupKey = group ? await repo.loadToken(group.credentialRef) : null
      const { apiKey: legacyApiKey, altApiKey: legacyAltApiKey } = await loadKeys(ch)
      const apiKey = groupKey ?? legacyApiKey
      const altApiKey =
        ch.protocol === '65535' && group?.models.every((model) => model.category !== 'chat')
          ? (groupKey ?? legacyAltApiKey)
          : legacyAltApiKey
      const config: ResolvedChannelConfig = {
        ...toSafeConfig(ch, catalog()),
        ...(group
          ? { credentialRef: group.credentialRef, modelCache: group.modelCache }
          : {}),
        apiKey,
        altApiKey,
      }
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

  const detectProtocol: ChannelStoreActions['detectProtocol'] = async (id, groupId) => {
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
    const group =
      ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
    const apiKey = group
      ? await repo.loadToken(group.credentialRef)
      : ch.credentialRef
        ? await repo.loadToken(ch.credentialRef)
        : null
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

  const refreshModels: ChannelStoreActions['refreshModels'] = async (id, groupId) => {
    const ch = await repo.get(id)
    if (!ch) return
    store.setState({ models: { status: 'checking' } })
    try {
      const group =
        ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
      const apiKey = group
        ? await repo.loadToken(group.credentialRef)
        : (await loadKeys(ch)).apiKey
      const altApiKey = group ? null : (await loadKeys(ch)).altApiKey
      const config: ResolvedChannelConfig = {
        ...toSafeConfig(ch, catalog()),
        ...(group
          ? {
              credentialRef: group.credentialRef,
              modelCache: group.modelCache,
            }
          : {}),
        apiKey,
        altApiKey,
      }
      const adapter = createChannelAdapter(config, platform)
      let pulled: ModelCapability[]
      try {
        pulled = await adapter.listModels(config, timeoutSignal(10_000))
      } catch (error) {
        if (ch.protocol !== '65535' || !group) throw error
        const taskDefinition = protocolById('65535-task', catalog())
        const taskConfig: ResolvedChannelConfig = {
          ...config,
          protocol: '65535-task',
          protocolDefinition: taskDefinition,
          baseUrl:
            taskDefinition?.defaultBaseUrl ?? 'https://task-api-1.65535.space',
        }
        pulled = await createChannelAdapter(taskConfig, platform).listModels(
          taskConfig,
          timeoutSignal(10_000),
        )
      }
      const manualById = new Map(
        [...(group?.modelCache ?? ch.modelCache), ...(group?.models ?? ch.models)]
          .filter((model) => model.categoryManual)
          .map((model) => [model.id, model]),
      )
      const models = pulled.map((model) => {
        const manual = manualById.get(model.id)
        return manual
          ? {
              ...model,
              category: manual.category,
              upstreamCategory:
                model.category === 'unknown' ? undefined : model.category,
              categoryManual: true,
            }
          : model
      })
      /**
       * 拉取后**顺带建默认映射**（§7.4.1）：上游 ID 与逻辑名同名的自动补成恒等映射，
       * 不同名的留空待用户填。
       *
       * 为什么在这里做而不是等用户点保存：映射表的键是「逻辑名」，而逻辑名的全集
       * 正是此刻刚拉回来的这份 + 用户已勾选的那份；错过这一次，用户就得先手动
       * 想起来有哪些名字。补的是**同名恒等**项，行为与不写完全一致，零风险。
       */
      const logicalNames = [
        ...new Set([
          ...models.map((model) => model.id),
          ...(group?.models ?? ch.models).map((model) => model.id),
        ]),
      ]
      /**
       * 已勾选模型的选择集合不变，但能力元数据必须跟着最新目录刷新。
       * Comfly 旧缓存曾把 `gemini-3.1-flash-image` 误判为 chat；只更新
       * `modelCache` 会让它继续以“Nano Banana 2”出现在对话模型里。
       */
      const refreshedSelection = (group?.models ?? ch.models).map(
        (selected) => models.find((model) => model.id === selected.id) ?? selected,
      )
      const nextGroups = group
        ? ch.credentialGroups.map((item) =>
            item.id === group.id
              ? { ...item, modelCache: models, models: refreshedSelection }
              : item,
          )
        : ch.credentialGroups
      const updated = await repo.update(id, {
        ...(group ? { credentialGroups: nextGroups } : { modelCache: models, models: refreshedSelection }),
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
      if (app?.kind === 'channel' && app.detail === 'missingKey') {
        const group =
          ch.credentialGroups.length > 0 ? credentialGroupOf(ch, groupId) : undefined
        const cleared = await repo.update(
          id,
          group
            ? {
                credentialGroups: ch.credentialGroups.map((item) =>
                  item.id === group.id ? { ...item, modelCache: [], models: [] } : item,
                ),
              }
            : { modelCache: [], models: [] },
        )
        store.setState((s) => ({
          channels: s.channels.map((c) => (c.id === id ? cleared : c)),
          models: { status: 'error', message },
        }))
        return
      }
      store.setState({ models: { status: 'error', message } })
    }
  }

  const enabledChannels = (): Channel[] => store.getState().channels.filter((c) => c.enabled)
  /**
   * 默认定点只允许“现在真能发请求”的渠道。
   * 启用但没令牌、也没填地址的内置渠道不能抢默认模型；否则全新库第一次生成
   * 会选到 RunningHub 之类未配置的站点，任务停在 pending。
   *
   * mock 与 CLI 不需要 HTTP 令牌；localhost 端点允许无令牌（本地模型）。
   */
  const routableChannels = (): Channel[] =>
    store.getState().channels.filter((channel) => channelIsRoutable(channel, catalog()))
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

  /** 写默认配方的唯一实现（内存缓存 + 落库，两处调用方共用） */
  const writeDefaultRecipe = async (
    channelId: string,
    model: string,
    params: Record<string, unknown>,
  ): Promise<void> => {
    const next = rememberRecipe(channelId, model, params, nextRecipeAt())
    if (!next) return
    recipeCache.set(channelId, next)
    await presets.save(next)
  }

  const setDefaultRecipe: ChannelStoreActions['setDefaultRecipe'] = writeDefaultRecipe

  const rememberRecipeOfChannel: ChannelStoreActions['rememberRecipe'] = async (
    channelId,
    model,
    params,
  ) => {
    /**
     * 「记住上次参数」关掉时**整个跳过**：既不落库、也不更新内存里的配方缓存。
     *
     * 只跳过落库是不够的 —— `resolveForNode` 读的就是这份缓存，
     * 不跳过的话"本次会话里默认值还是被带走了"，而用户明明关了开关。
     */
    if (!store.getState().recipeMemory) return
    await writeDefaultRecipe(channelId, model, params)
  }

  const setRecipeMemory: ChannelStoreActions['setRecipeMemory'] = async (enabled) => {
    store.setState({ recipeMemory: enabled })
    await presets.saveRecipeMemory(enabled)
  }

  const defaultForNewNode: ChannelStoreActions['defaultForNewNode'] = async (node, category) => {
    await ensureRecipes()
    /**
     * 只拿**已启用**的渠道参与解析：把没启用的当默认值，用户一生成就报
     * 「平台未启用」，比空着更让人困惑。
     */
    const usable = routableChannels()
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
    modelIsUpstream = false,
    tools,
    messages,
    inputs = [],
    signal,
    timeoutMs,
  }) => {
    const ch = store.getState().channels.find((c) => c.id === channelId)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${channelId}`)
    const { apiKey, altApiKey } = await loadKeys(ch)
    const config: ResolvedChannelConfig = {
      ...toSafeConfig(ch, catalog()),
      apiKey,
      altApiKey,
    }
    const adapter = createChannelAdapter(config, platform)
    /**
     * 逻辑名 → 上游 ID（M7-4 同一条映射）：调用方发的是**前端显示名**
     * （「GPT-6 Astra」「Agnes 2.5 Pro」这种），真正发给上游的必须是渠道
     * 映射后的真实 ID。图片 / 视频链路早就在 `toRunRequest` 里做这一步，
     * 文本这条此前漏了 —— 直接把显示名当上游 ID 发出去。
     */
    /**
     * `resolveUpstreamModel` 的 null 只发生在「传入的是空串」这一种情况；
     * 上面已经拦过空模型，这里兜一层保持类型收窄 —— 不静默换模型。
     */
    const upstreamModel = modelIsUpstream
      ? model
      : (resolveUpstreamModel(ch.modelMap, model) ?? model)
    return adapter.completeText(
      {
        kind: 'text',
        channelId,
        model: upstreamModel,
        prompt: '',
        inputs: [...inputs],
        params: {},
        tools,
        messages,
        /** 调用方不给就用 Agent 的默认上限；探测会显式传一个更短的 */
        timeoutMs: timeoutMs ?? AGENT_CHAT_TIMEOUT_MS,
      },
      signal,
    )
  }

  const generateSpeech: ChannelStoreActions['generateSpeech'] = async ({
    signal,
    channelId,
    model,
    text,
    voice,
    speed,
    responseFormat,
    timeoutMs,
  }) => {
    const ch = store.getState().channels.find((c) => c.id === channelId)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${channelId}`)
    const { apiKey, altApiKey } = await loadKeys(ch)
    const config: ResolvedChannelConfig = {
      ...toSafeConfig(ch, catalog()),
      apiKey,
      altApiKey,
    }
    const adapter = createChannelAdapter(config, platform)
    if (!adapter.generateSpeech) {
      throw new Error('[channelStore] 当前渠道未实现配音能力')
    }
    const upstreamModel = resolveUpstreamModel(ch.modelMap, model) ?? model
    return adapter.generateSpeech(
      {
        channelId,
        model: upstreamModel,
        text,
        voice,
        ...(speed !== undefined ? { speed } : {}),
        ...(responseFormat ? { responseFormat } : {}),
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
      },
      signal,
    )
  }

  const generateVideo: ChannelStoreActions['generateVideo'] = async ({
    signal,
    ...request
  }) => {
    const ch = store.getState().channels.find((c) => c.id === request.channelId)
    if (!ch) throw new Error(`[channelStore] 渠道不存在：${request.channelId}`)
    const { apiKey, altApiKey } = await loadKeys(ch)
    const config: ResolvedChannelConfig = {
      ...toSafeConfig(ch, catalog()),
      apiKey,
      altApiKey,
    }
    const adapter = createChannelAdapter(config, platform)
    const upstreamModel = resolveUpstreamModel(ch.modelMap, request.model) ?? request.model
    return adapter.generateVideo({ ...request, model: upstreamModel }, signal)
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
    globalModelsOf,
    globalModelOf,
    addGlobalModel,
    removeGlobalModel,
    reorder,
    saveToken,
    loadToken,
    removeToken,
    addCredentialGroup,
    renameCredentialGroup,
    setCredentialGroupPriority,
    removeCredentialGroup,
    saveCredentialGroupToken,
    loadCredentialGroupToken,
    removeCredentialGroupToken,
    setEnabled,
    setModels,
    setModelCategory,
    setModelMapping: setModelMappingAction,
    setRouteTuning,
    setRouteStrategy,
    hasToken,
    verify,
    detectProtocol,
    refreshModels,
    enabledChannels,
    rememberRecipe: rememberRecipeOfChannel,
    setRecipeMemory,
    setDefaultRecipe,
    defaultForNewNode,
    completeWithTools,
    generateSpeech,
    generateVideo,
  }
}
