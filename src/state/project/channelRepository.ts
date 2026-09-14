import type { StoragePort, CredentialPort, RowOf, TableName } from '../../platform/ports'
import type { Channel, CreateChannelInput } from '../../domain/project/channel'
import { createChannel } from '../../domain/project/channel'
import { createId } from '../../shared/id'

/**
 * channels 表仓储（架构 §5.10：渠道不是图数据，直连 platform.storage，不走 dispatch / undo 栈）。
 * 与 projects 仓储同源：入参是已拿到的 StoragePort / CredentialPort，不依赖运行时。
 * 位置在 state/ 而非 domain/：仓储要 import platform 端口，会触发 domain-pure 守卫。
 */
export interface ChannelRepository {
  list(): Promise<Channel[]>
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
    protocol: (row.protocol as string) ?? 'mock',
    baseUrl: (row.baseUrl as string) ?? '',
    credentialRef: (row.credentialRef as string | null) ?? null,
    tokenTail: (row.tokenTail as string | null) ?? null,
    enabled: (row.enabled as boolean) ?? false,
    // `models` 引入前写下的行没有这个键 → 读回**回落为全部缓存**，即「沿用旧行为」：
    // 加本字段之前，画布 / 漫画的模型下拉列的就是 modelCache 全集。
    // 键一旦存在（哪怕值是 []）就以它为准——用户在面板里取消全选也是合法状态，不能被回落覆盖。
    // 与 comic 的 `normalizeComicProject` 同一条口径：**只补不删**。
    models: row.models === undefined ? modelCache : ((row.models as Channel['models']) ?? []),
    modelCache,
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

  const create = async (input: CreateChannelInput): Promise<Channel> => {
    // 新渠道排在**末尾**（排序位取最大 +1），位置与下方「+ 新增渠道」按钮一致，
    // 也不去和用户手工拖出来的顺序抢位置。
    const existing = await list()
    const order = existing.length === 0 ? 0 : Math.max(...existing.map((c) => c.order)) + 1
    const ch = createChannel({ ...input, order })
    ch.credentialRef = createId('cred')
    await storage.put('channels', ch as unknown as RowOf<TableName>)
    return ch
  }

  const update = async (id: string, patch: Partial<Channel>): Promise<Channel> => {
    const existing = await get(id)
    if (!existing) throw new Error(`[channelRepo] 渠道不存在：${id}`)
    const next: Channel = { ...existing, ...patch, id }
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

  return { list, get, create, update, reorder, remove, saveToken, loadToken, removeToken }
}
