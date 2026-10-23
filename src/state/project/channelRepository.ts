import type { StoragePort, CredentialPort, RowOf, TableName } from '../../platform/ports'
import type {
  Channel,
  ChannelCredentialGroup,
  CreateChannelInput,
} from '../../domain/project/channel'
import { createChannel } from '../../domain/project/channel'
import {
  BUILTIN_CHANNEL_IDS,
  BUILTIN_CHANNELS,
  RETIRED_BUILTIN_CHANNEL_IDS,
  createBuiltinChannel,
  isBuiltinChannelId,
  builtinSpecOf,
} from '../../domain/project/builtinChannels'
import { createId } from '../../shared/id'
import { normalizeModelMap } from '../../domain/project/modelMapping'
import { ROUTE_STRATEGIES } from '../../domain/project/modelRouting'

/**
 * channels 表仓储（架构 §5.10：渠道不是图数据，直连 platform.storage，不走 dispatch / undo 栈）。
 * 与 projects 仓储同源：入参是已拿到的 StoragePort / CredentialPort，不依赖运行时。
 * 位置在 state/ 而非 domain/：仓储要 import platform 端口，会触发 domain-pure 守卫。
 */
export interface ChannelRepository {
  list(): Promise<Channel[]>
  /** 补齐**常驻内置渠道**后返回整表（用户第 20 批起：它们常驻列表最上方） */
  seedBuiltins(): Promise<Channel[]>
  get(id: string): Promise<Channel | null>
  create(input: CreateChannelInput): Promise<Channel>
  update(id: string, patch: Partial<Channel>): Promise<Channel>
  /** 拖动排序（§7.2）：按给定 id 顺序重新编号，只写 `order` 位 */
  reorder(orderedIds: string[]): Promise<Channel[]>
  remove(id: string): Promise<void>
  /** 明文令牌只经凭据层加密存储，业务代码不持有 */
  saveToken(ref: string, token: string): Promise<void>
  loadToken(ref: string): Promise<string | null>
  /** 删除令牌（§7.3 令牌旁的「删除」）：只清密文，渠道与 credentialRef 保留（可再存） */
  removeToken(ref: string): Promise<void>
}

const toChannel = (row: Record<string, unknown>): Channel => {
  const modelCache = (row.modelCache as Channel['modelCache']) ?? []
  const cacheById = new Map(modelCache.map((model) => [model.id, model]))
  const storedModels =
    row.models === undefined ? modelCache : ((row.models as Channel['models']) ?? [])
  const protocol = (row.protocol as string) ?? 'mock'
  const credentialRef = (row.credentialRef as string | null) ?? null
  const altCredentialRef = (row.altCredentialRef as string | null) ?? null
  const tokenTail = (row.tokenTail as string | null) ?? null
  const altTokenTail = (row.altTokenTail as string | null) ?? null
  const hasToken =
    (row.hasToken as boolean | undefined) ?? tokenTail !== null
  const hasAltToken =
    (row.hasAltToken as boolean | undefined) ?? altTokenTail !== null
  const models = storedModels.map((selected) => cacheById.get(selected.id) ?? selected)
  const rawGroups = Array.isArray(row.credentialGroups)
    ? (row.credentialGroups as ChannelCredentialGroup[])
    : []
  const credentialGroups =
    rawGroups.length > 0
      ? rawGroups.map((group) => ({
          ...group,
          tokenTail: group.tokenTail ?? null,
          hasToken: group.hasToken ?? group.tokenTail !== null,
          priority: Number.isFinite(group.priority) ? Math.trunc(group.priority) : 0,
          models: (group.models ?? []).map(
            (selected) => cacheById.get(selected.id) ?? selected,
          ),
          modelCache: group.modelCache ?? [],
          createdAt: group.createdAt ?? 0,
        }))
      : credentialRef
        ? [
            {
              id: `legacy-primary-${String(row.id)}`,
              name: protocol === '65535' ? '对话分组' : '默认分组',
              credentialRef,
              tokenTail,
              hasToken,
              priority: 0,
              models:
                protocol === '65535'
                  ? models.filter((model) => model.category === 'chat')
                  : models,
              modelCache:
                protocol === '65535'
                  ? modelCache.filter((model) => model.category === 'chat')
                  : modelCache,
              createdAt: (row.createdAt as number) ?? 0,
            },
            ...(altCredentialRef
              ? [
                  {
                    id: `legacy-alt-${String(row.id)}`,
                    name: protocol === '65535' ? '生图分组' : '备用 Key',
                    credentialRef: altCredentialRef,
                    tokenTail: altTokenTail,
                    hasToken: hasAltToken,
                    priority: -1,
                    models:
                      protocol === '65535'
                        ? models.filter((model) => model.category !== 'chat')
                        : [],
                    modelCache:
                      protocol === '65535'
                        ? modelCache.filter((model) => model.category !== 'chat')
                        : [],
                    createdAt: (row.createdAt as number) ?? 0,
                  },
                ]
              : []),
          ]
        : []
  return {
    id: String(row.id),
    name: (row.name as string) || '新建渠道',
    /** 图标（用户第 19 批 #4/#5）：老行没有这一键 → null = 用内置矢量图标 */
    icon: (row.icon as string | null) ?? null,
    protocol,
    baseUrl: (row.baseUrl as string) ?? '',
    credentialRef,
    tokenTail,
    /**
     * 「存过没有」（对账 #517）：老行没有这一键，但**有尾号 ⇒ 一定存过**，
     * 于是缺省回落到 `tokenTail !== null` 就是零迁移；短令牌那种"存过但没尾号"
     * 由新写入的这一列补上。
     */
    hasToken,
    /** 第二把钥匙（第 22 批 #358）：老行没有这两键 → null（= 只用主槽） */
    altCredentialRef,
    altTokenTail,
    hasAltToken,
    credentialGroups,
    enabled: (row.enabled as boolean) ?? false,
    // `models` 引入前写下的行没有这个键 → 读回**回落为全部缓存**，即「沿用旧行为」：
    // 加本字段之前，画布 / 漫画的模型下拉列的就是 modelCache 全集。
    // 键一旦存在（哪怕值是 []）就以它为准——用户在面板里取消全选也是合法状态，不能被回落覆盖。
    // 口径：**只补不删**（缺字段补默认值，多余字段不动）。
    /**
     * `models` 只保存“用户勾了谁”，能力元数据以最新 `modelCache` 为准。
     * 否则上游模型分类修正后，已勾选行仍会带着旧 category，
     * 典型现象是生图模型继续出现在“对话模型”下拉里。
     */
    models,
    modelCache,
    /**
     * M7 三项（映射 / 优先度 / 权重）：老行没有这些键 → 补**缺省值**。
     *
     * 缺省值的语义必须与「加功能之前」完全一致，这是零迁移的关键：
     *  - 空映射 = 恒等映射（逻辑名原样发出去）
     *  - 优先度 0 / 权重 0 = 所有渠道同档、按权重均摊
     * 即老渠道读回后，选路结果不变、行为不变。
     * 口径同 `models`：**只补不删**。
     */
    modelMap: normalizeModelMap(row.modelMap),
    priority: (row.priority as number) ?? 0,
    weight: (row.weight as number) ?? 0,
    // 未知策略值回落 'priority'：宁可退到「手工排的优先度」，
    // 也不要让一个认不出来的值把选路搞成未定义行为。
    routeStrategy: ROUTE_STRATEGIES.some((s) => s.value === row.routeStrategy)
      ? (row.routeStrategy as Channel['routeStrategy'])
      : 'priority',
    order: (row.order as number) ?? 0,
    lastTestAt: (row.lastTestAt as number | null) ?? null,
    lastTestLatency: (row.lastTestLatency as number | null) ?? null,
    createdAt: (row.createdAt as number) ?? 0,
  }
}

function initialCredentialGroup(
  channel: Channel,
  credentialRef: string,
  createdAt = channel.createdAt,
): ChannelCredentialGroup {
  return {
    id: createId('credgroup'),
    name: channel.protocol === '65535' ? '对话分组' : '默认分组',
    credentialRef,
    tokenTail: null,
    hasToken: false,
    priority: 0,
    models: channel.models,
    modelCache: channel.modelCache,
    createdAt,
  }
}

function withGroupAggregates(channel: Channel): Channel {
  const groups = [...channel.credentialGroups].sort(
    (a, b) => b.priority - a.priority || a.createdAt - b.createdAt,
  )
  if (groups.length === 0) return { ...channel, credentialGroups: groups }

  const merge = (key: 'models' | 'modelCache') => {
    const byId = new Map<string, Channel['models'][number]>()
    for (const group of groups) {
      for (const model of group[key]) if (!byId.has(model.id)) byId.set(model.id, model)
    }
    return [...byId.values()]
  }
  const [primary, alt] = groups
  const syncAltSlot = channel.protocol === '65535' || channel.protocol === 'runninghub-api'
  return {
    ...channel,
    credentialGroups: groups,
    credentialRef: primary?.credentialRef ?? channel.credentialRef,
    tokenTail: primary?.tokenTail ?? null,
    hasToken: primary?.hasToken ?? false,
    altCredentialRef: syncAltSlot
      ? (alt?.credentialRef ?? channel.altCredentialRef)
      : channel.altCredentialRef,
    altTokenTail: syncAltSlot ? (alt?.tokenTail ?? null) : channel.altTokenTail,
    hasAltToken: syncAltSlot ? (alt?.hasToken ?? false) : channel.hasAltToken,
    models: merge('models'),
    modelCache: merge('modelCache'),
  }
}

export function createChannelRepository(storage: StoragePort, credentials: CredentialPort): ChannelRepository {
  const builtinPosition = new Map<string, number>(
    BUILTIN_CHANNEL_IDS.map((id, index) => [id, index] as const),
  )

  /**
   * 内置渠道的顺序是**固定契约**，不能让 `order` 列决定。
   *
   * `reorder` 会把整表重编号成 0..N（历史拖拽已经这样写过）；若新增内置渠道
   * 仍带负数排序位，它就会跑到原有内置渠道前面。这里先按
   * `BUILTIN_CHANNEL_IDS` 排内置项，用户渠道再按自己的 `order` 排。
   */
  const compareChannels = (a: Channel, b: Channel): number => {
    const aBuiltin = builtinPosition.get(a.id)
    const bBuiltin = builtinPosition.get(b.id)
    if (aBuiltin !== undefined || bBuiltin !== undefined) {
      if (aBuiltin === undefined) return 1
      if (bBuiltin === undefined) return -1
      return aBuiltin - bBuiltin
    }
    return a.order - b.order || b.createdAt - a.createdAt
  }

  const list = async (): Promise<Channel[]> => {
    const rows = await storage.query('channels', {})
    // 用户排序位升序；同值（老数据全是 0）回落到创建时间倒序，与加排序前完全一致。
    return rows.map(toChannel).sort(compareChannels)
  }

  const get = async (id: string): Promise<Channel | null> => {
    const rows = await storage.query('channels', { id })
    return rows[0] ? toChannel(rows[0]) : null
  }

  /**
   * 补齐常驻内置渠道（**只补不改**）：缺哪条建哪条，已存在的一律原样留着
   *（用户配过的令牌 / 启用 / 地址都不动）。返回补完之后的整表。
   */
  const seedBuiltins = async (): Promise<Channel[]> => {
    let current = await list()
    const retired = new Set<string>(RETIRED_BUILTIN_CHANNEL_IDS)
    for (const channel of current) {
      if (!retired.has(channel.id)) continue
      /**
       * 只清「从未配置过」的退役内置行。用户存过任意一把 Key、或勾过模型，
       * 都说明这条渠道已经参与过真实工作，升级时不能替他删掉。
       */
      if (channel.hasToken || channel.hasAltToken || channel.models.length > 0) continue
      await storage.delete('channels', channel.id)
    }
    current = await list()

    /**
     * 内置渠道的名称与协议是固定契约；旧版本可能把同一个 id 写成拆分协议
     * （例如 `65535-chat`），这里同步回当前目录。**地址不动**——那是用户可改项。
     */
    for (const spec of BUILTIN_CHANNELS) {
      const existing = current.find((channel) => channel.id === spec.id)
      if (!existing || (existing.name === spec.name && existing.protocol === spec.protocol)) continue
      await storage.put('channels', {
        ...existing,
        name: spec.name,
        protocol: spec.protocol,
      } as unknown as RowOf<TableName>)
    }
    current = await list()

    const have = new Set(current.map((c) => c.id))
    const missing = BUILTIN_CHANNELS.filter((spec) => !have.has(spec.id))
    if (missing.length === 0) return current
    for (const spec of missing) {
      const ch = createBuiltinChannel(spec, BUILTIN_CHANNELS.indexOf(spec))
      /** 凭据引用走与普通渠道同一条路（不然"存令牌"没有落点） */
      ch.credentialRef = createId('cred')
      ch.altCredentialRef = createId('cred')
      ch.credentialGroups = [
        initialCredentialGroup(ch, ch.credentialRef),
        ...(ch.protocol === '65535' || ch.protocol === 'runninghub-api'
          ? [
              {
                ...initialCredentialGroup(ch, ch.altCredentialRef),
                name: ch.protocol === '65535' ? '生图分组' : '备用 Key',
                priority: -1,
              },
            ]
          : []),
      ]
      await storage.put('channels', ch as unknown as RowOf<TableName>)
    }
    return list()
  }

  const create = async (input: CreateChannelInput): Promise<Channel> => {
    // 新渠道排在**末尾**（排序位取最大 +1），位置与下方「+ 新增渠道」按钮一致，
    // 也不去和用户手工拖出来的顺序抢位置。
    const existing = await list()
    /**
     * 取 max+1 时**跳过内置渠道的负排序位**（它们恒在最前）——
     * 否则第一条用户渠道会拿到 -999，看起来像"排在内置渠道中间"。
     */
    const mine = existing.filter((c) => !isBuiltinChannelId(c.id))
    const order = mine.length === 0 ? 0 : Math.max(...mine.map((c) => c.order)) + 1
    const ch = createChannel({ ...input, order })
    ch.credentialRef = createId('cred')
    /** 第二把钥匙也要有自己的引用（第 22 批 #358）：不然那个槽位没有落点 */
    ch.altCredentialRef = createId('cred')
    ch.credentialGroups = [
      initialCredentialGroup(ch, ch.credentialRef),
      ...(ch.protocol === '65535' || ch.protocol === 'runninghub-api'
        ? [
            {
              ...initialCredentialGroup(ch, ch.altCredentialRef),
              name: ch.protocol === '65535' ? '生图分组' : '备用 Key',
              priority: -1,
            },
          ]
        : []),
    ]
    await storage.put('channels', ch as unknown as RowOf<TableName>)
    return ch
  }

  const update = async (id: string, patch: Partial<Channel>): Promise<Channel> => {
    const existing = await get(id)
    if (!existing) throw new Error(`[channelRepo] 渠道不存在：${id}`)
    const spec = builtinSpecOf(id)
    /**
     * 内置渠道的**名称与协议固定**（用户第 20 批：「固定字段是的」）：
     * 把这两键从补丁里剔掉，谁调 `update` 都改不动它们 —— 界面禁用只是第一道，
     * 拦在这里才是"改不动"本身。**地址不剔**（用户：「站点地址留口子」）。
     */
    const safe: Partial<Channel> = spec ? { ...patch, name: spec.name, protocol: spec.protocol } : patch
    const next: Channel = withGroupAggregates({ ...existing, ...safe, id })
    await storage.put('channels', next as unknown as RowOf<TableName>)
    return next
  }

  const reorder = async (orderedIds: string[]): Promise<Channel[]> => {
    const current = await list()
    const byId = new Map(current.map((c) => [c.id, c]))
    // 只对**列在 orderedIds 里且顺序确实变了**的行动手：没拖的行不产生写，
    // 避免每次拖拽都把整表重写一遍（也避免把并发编辑的其它字段覆盖回去）。
    let pos = 0
    const writes: Channel[] = []
    for (const id of orderedIds) {
      const ch = byId.get(id)
      if (!ch) continue
      if (ch.order !== pos) writes.push({ ...ch, order: pos })
      pos += 1
    }
    for (const ch of writes) await storage.put('channels', ch as unknown as RowOf<TableName>)
    return list()
  }

  const remove = async (id: string): Promise<void> => {
    /** 内置渠道**不能删**（用户第 20 批）—— 界面禁用之外，这里也拒绝 */
    if (isBuiltinChannelId(id)) throw new Error('这是内置渠道，不能删除')
    const ch = await get(id)
    if (!ch) return

    /**
     * 先把渠道落成停用态，再清凭据，最后删行。
     *
     * 这样任一步中途失败都不会留下“行还在、自动路由仍认为可用”的窗口；
     * 凭据清理覆盖主槽、备用槽，避免删除渠道后还残留可被旧引用读出的 Key。
     */
    await storage.put('channels', { ...ch, enabled: false } as unknown as RowOf<TableName>)
    const refs = new Set(
      [
        ch.credentialRef,
        ch.altCredentialRef,
        ...ch.credentialGroups.map((group) => group.credentialRef),
      ].filter((ref): ref is string => Boolean(ref)),
    )
    for (const ref of refs) await credentials.remove(ref)
    await storage.delete('channels', id)
  }

  const saveToken = async (ref: string, token: string): Promise<void> => {
    await credentials.save(ref, token)
  }

  const loadToken = async (ref: string): Promise<string | null> => credentials.load(ref)

  const removeToken = async (ref: string): Promise<void> => {
    await credentials.remove(ref)
  }

  return { list, seedBuiltins, get, create, update, reorder, remove, saveToken, loadToken, removeToken }
}
