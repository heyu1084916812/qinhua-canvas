import type { StoragePort, CredentialPort, RowOf, TableName } from '../../platform/ports'
import type { Channel, CreateChannelInput } from '../../domain/project/channel'
import { createChannel } from '../../domain/project/channel'
import { BUILTIN_CHANNELS, createBuiltinChannel, isBuiltinChannelId, builtinSpecOf } from '../../domain/project/builtinChannels'
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
  /** 补齐**三条内置渠道**后返回整表（用户第 20 批：它们常驻列表最上方） */
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
  return {
    id: String(row.id),
    name: (row.name as string) || '新建渠道',
    /** 图标（用户第 19 批 #4/#5）：老行没有这一键 → null = 用内置矢量图标 */
    icon: (row.icon as string | null) ?? null,
    protocol: (row.protocol as string) ?? 'mock',
    baseUrl: (row.baseUrl as string) ?? '',
    credentialRef: (row.credentialRef as string | null) ?? null,
    tokenTail: (row.tokenTail as string | null) ?? null,
    /** 第二把钥匙（第 22 批 #358）：老行没有这两键 → null（= 只用主槽） */
    altCredentialRef: (row.altCredentialRef as string | null) ?? null,
    altTokenTail: (row.altTokenTail as string | null) ?? null,
    enabled: (row.enabled as boolean) ?? false,
    // `models` 引入前写下的行没有这个键 → 读回**回落为全部缓存**，即「沿用旧行为」：
    // 加本字段之前，画布 / 漫画的模型下拉列的就是 modelCache 全集。
    // 键一旦存在（哪怕值是 []）就以它为准——用户在面板里取消全选也是合法状态，不能被回落覆盖。
    // 口径：**只补不删**（缺字段补默认值，多余字段不动）。
    models: row.models === undefined ? modelCache : ((row.models as Channel['models']) ?? []),
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

export function createChannelRepository(storage: StoragePort, credentials: CredentialPort): ChannelRepository {
  const list = async (): Promise<Channel[]> => {
    const rows = await storage.query('channels', {})
    // 用户排序位升序；同值（老数据全是 0）回落到创建时间倒序，与加排序前完全一致。
    return rows.map(toChannel).sort((a, b) => a.order - b.order || b.createdAt - a.createdAt)
  }

  const get = async (id: string): Promise<Channel | null> => {
    const rows = await storage.query('channels', { id })
    return rows[0] ? toChannel(rows[0]) : null
  }

  /**
   * 补齐三条内置渠道（**只补不改**）：缺哪条建哪条，已存在的一律原样留着
   *（用户配过的令牌 / 启用 / 地址都不动）。返回补完之后的整表。
   */
  const seedBuiltins = async (): Promise<Channel[]> => {
    const current = await list()
    const have = new Set(current.map((c) => c.id))
    const missing = BUILTIN_CHANNELS.filter((spec) => !have.has(spec.id))
    if (missing.length === 0) return current
    for (const spec of missing) {
      const ch = createBuiltinChannel(spec, BUILTIN_CHANNELS.indexOf(spec))
      /** 凭据引用走与普通渠道同一条路（不然"存令牌"没有落点） */
      ch.credentialRef = createId('cred')
      ch.altCredentialRef = createId('cred')
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
    const next: Channel = { ...existing, ...safe, id }
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
    if (ch?.credentialRef) await credentials.remove(ch.credentialRef)
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
