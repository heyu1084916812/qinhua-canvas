import { createStore as createVanilla } from 'zustand/vanilla'
import type { PlatformKit } from '../../platform/ports'
import type { Channel, CreateChannelInput } from '../../domain/project/channel'
import { PROBE_PROTOCOLS, requiresBaseUrl, tokenTailOf } from '../../domain/project/channel'
import {
  NO_PRESET,
  rememberPreset as rememberPresetOf,
  resolvePreset,
} from '../../domain/project/generationPreset'
import type { ModelCapability } from '../../domain/shared/capability'
import { createChannelRepository, type ChannelRepository } from '../project/channelRepository'
import { createPresetStore, type PresetStore } from '../project/presetStore'
import {
  createChannelAdapter,
  type ResolvedChannelConfig,
} from '../../platform/channels/registry'
import type { VerifyResult } from '../../platform/channels/types'
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
  loaded: boolean
  verify: ChannelVerify
  models: ChannelModelsResult
  detect: ChannelDetect
}

export interface ChannelStoreActions {
  load(): Promise<void>
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
   * 记住「这次用的渠道 + 模型」，作为**新建生成 / 批量节点时的默认值**（用户 2026-09-17）。
   *
   * 记录时机由调用方决定（面板里选完的那一刻），这里只负责写库与维护内存态。
   */
  rememberPreset(channelId: string, model: string): Promise<void>
  /**
   * 新建节点时该填的渠道 + 模型。
   *
   * 预设失效（渠道已被删 / 模型已被取消勾选）时按用户选的口径**自动挑该渠道第一个
   * 已勾选模型**，而不是留空让人重选；`substituted` 标明这是兜底值，供调用方提示。
   */
  defaultForNewNode(): Promise<{ channelId: string; model: string; substituted: boolean } | null>
}

export type ChannelStore = MiniStore<ChannelStoreState> & ChannelStoreActions

function timeoutSignal(ms: number): AbortSignal {
  return typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { timeout?: unknown }).timeout === 'function'
    ? AbortSignal.timeout(ms)
    : new AbortController().signal
}

function toSafeConfig(ch: Channel): ResolvedChannelConfig {
  return {
    id: ch.id,
    protocol: ch.protocol,
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
    loaded: false,
    verify: { status: 'idle' },
    models: { status: 'idle' },
    detect: { status: 'idle', protocol: null },
  }))

  const load: ChannelStoreActions['load'] = async () => {
    const [channels, preset] = await Promise.all([repo.list(), presets.load()])
    presetRef.current = preset
    store.setState({ channels, loaded: true })
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
    if (requiresBaseUrl(ch.protocol) && !ch.baseUrl.trim()) {
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
      const adapter = createChannelAdapter({ ...toSafeConfig(ch), apiKey }, platform)
      const res: VerifyResult = await adapter.verify(toSafeConfig(ch), timeoutSignal(10_000))
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
    // 逐个试打到第一个成功为止。候选表**不含离线协议**（见 domain/PROBE_PROTOCOLS）：
    // 一旦混入一个恒成功的协议，探测会在任何地址上都命中它，自动选中就成了假动作。
    let lastMessage = ''
    for (const probe of PROBE_PROTOCOLS) {
      const startedAt = Date.now()
      const elapsed = () => Date.now() - startedAt
      // 用探测协议覆盖当前协议：verify 打的是「这个协议在这台机器上长什么样」的端点。
      const config: ResolvedChannelConfig = { ...toSafeConfig(ch), protocol: probe.value }
      try {
        const adapter = createChannelAdapter({ ...config, apiKey }, platform)
        const res: VerifyResult = await adapter.verify(config, timeoutSignal(10_000))
        if (res.ok) {
          // 命中即落库：`protocol` 是用户本来就要在协议下拉里手选的那一格，
          // 探测只是替他把这一格填对。同时刷新 lastTest*，与「验证地址」共用同一份「上次往返」记录。
          const updated = await repo.update(id, {
            protocol: probe.value,
            lastTestAt: Date.now(),
            lastTestLatency: elapsed(),
          })
          store.setState((s) => ({
            channels: s.channels.map((c) => (c.id === id ? updated : c)),
            detect: { status: 'ok', protocol: probe.value },
          }))
          return probe.value
        }
        lastMessage = res.message ?? describeError(res.error)
      } catch (e) {
        const app = asAppError(e)
        lastMessage = app ? describeError(app) : e instanceof Error ? e.message : String(e)
      }
    }
    store.setState({
      detect: { status: 'error', protocol: null, message: lastMessage || '所有候选协议均未通过' },
    })
    return null
  }

  const refreshModels: ChannelStoreActions['refreshModels'] = async (id) => {
    const ch = await repo.get(id)
    if (!ch) return
    store.setState({ models: { status: 'checking' } })
    try {
      const apiKey = ch.credentialRef ? await repo.loadToken(ch.credentialRef) : null
      const adapter = createChannelAdapter({ ...toSafeConfig(ch), apiKey }, platform)
      const models = await adapter.listModels(toSafeConfig(ch), timeoutSignal(10_000))
      const updated = await repo.update(id, { modelCache: models })
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
   * 预设的两个动作放在这里，是因为**兜底解析需要渠道列表**（它有哪些已勾选模型），
   * 而这个 store 正是列表的持有者。规则本身仍在 domain 的纯函数里，
   * 这里只把列表喂给它——不复制那份判断。
   */
  /** 内存态：避免每次建节点都读一次库 */
  const presetRef = { current: NO_PRESET }

  const rememberPreset: ChannelStoreActions['rememberPreset'] = async (channelId, model) => {
    const next = rememberPresetOf(channelId, model, Date.now())
    if (!next) return
    presetRef.current = next
    await presets.save(next)
  }

  const defaultForNewNode: ChannelStoreActions['defaultForNewNode'] = async () => {
    if (presetRef.current === NO_PRESET) presetRef.current = await presets.load()
    return resolvePreset(presetRef.current, store.getState().channels)
  }

  return {
    ...store,
    load,
    create,
    update,
    remove,
    reorder,
    saveToken,
    removeToken,
    setEnabled,
    setModels,
    hasToken,
    verify,
    detectProtocol,
    refreshModels,
    enabledChannels,
    rememberPreset,
    defaultForNewNode,
  }
}
