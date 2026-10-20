import { describe, it, expect } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createChannelRepository } from './channelRepository'

describe('channelRepository', () => {
  it('create / list / get / update', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    const ch = await repo.create({ name: 'A', protocol: 'mock', baseUrl: 'https://a' })
    expect(ch.credentialRef).toBeTruthy()

    expect(await repo.list()).toHaveLength(1)
    expect((await repo.get(ch.id))?.name).toBe('A')

    const upd = await repo.update(ch.id, { name: 'B', enabled: true })
    expect(upd.name).toBe('B')
    expect(upd.enabled).toBe(true)
  })

  it('saveToken / loadToken 往返', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    const ch = await repo.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await repo.saveToken(ch.credentialRef!, 'sk-test')
    expect(await repo.loadToken(ch.credentialRef!)).toBe('sk-test')
  })

  it('remove 同时清理凭据', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    const ch = await repo.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await repo.saveToken(ch.credentialRef!, 'sk')
    await repo.remove(ch.id)
    expect(await repo.get(ch.id)).toBeNull()
    expect(await repo.loadToken(ch.credentialRef!)).toBeNull()
  })

  it('removeToken 只清密文，渠道与凭据槽位保留（可再存）', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    const ch = await repo.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    await repo.saveToken(ch.credentialRef!, 'sk-1234567890abcd')
    await repo.removeToken(ch.credentialRef!)
    expect(await repo.loadToken(ch.credentialRef!)).toBeNull()
    expect(await repo.get(ch.id)).not.toBeNull()
    await repo.saveToken(ch.credentialRef!, 'sk-1234567890wxyz')
    expect(await repo.loadToken(ch.credentialRef!)).toBe('sk-1234567890wxyz')
  })

  it('create 分配递增排序位（新渠道排在末尾）', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    const a = await repo.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    const b = await repo.create({ name: 'B', protocol: 'mock', baseUrl: '' })
    expect(a.order).toBe(0)
    expect(b.order).toBe(1)
    expect((await repo.list()).map((c) => c.name)).toEqual(['A', 'B'])
  })

  it('reorder 重编号并落库；未列出的渠道不动、未知 id 忽略', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    const a = await repo.create({ name: 'A', protocol: 'mock', baseUrl: '' })
    const b = await repo.create({ name: 'B', protocol: 'mock', baseUrl: '' })
    const c = await repo.create({ name: 'C', protocol: 'mock', baseUrl: '' })
    await repo.reorder([c.id, 'nope', a.id, b.id])
    expect((await repo.list()).map((ch) => ch.name)).toEqual(['C', 'A', 'B'])
  })

  it('排序位取值相同时回落创建时间倒序（老数据全是 0，行为与加排序前一致）', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    // 直接写三行 order 为 0 的「老数据」
    await p.storage.put('channels', { id: 'old-1', name: '旧1', createdAt: 100, order: 0 })
    await p.storage.put('channels', { id: 'old-2', name: '旧2', createdAt: 300, order: 0 })
    await p.storage.put('channels', { id: 'old-3', name: '旧3', createdAt: 200, order: 0 })
    expect((await repo.list()).map((c) => c.name)).toEqual(['旧2', '旧3', '旧1'])
  })

  it('models 缺省的老行读回回落为全部缓存；显式空数组不回落', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    const cache = [{ id: 'gpt-image-2', category: 'image', inputTypes: [] }]
    // 加 models 字段之前写下的行：没有 models 键
    await p.storage.put('channels', { id: 'legacy', name: '老', modelCache: cache, order: 0 })
    expect((await repo.get('legacy'))!.models).toEqual(cache)
    // 用户在选择面板里取消全选后的行：键在、值是空数组，必须保持为空
    await p.storage.put('channels', { id: 'cleared', name: '清空', modelCache: cache, models: [], order: 1 })
    expect((await repo.get('cleared'))!.models).toEqual([])
  })

  it('已勾选模型的能力元数据跟随最新 modelCache 刷新', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    const cached = [
      { id: 'gemini-3.1-flash-image', category: 'image', inputTypes: ['text', 'image'] },
    ]
    await p.storage.put('channels', {
      id: 'ch-category-refresh',
      name: 'Comfly',
      protocol: 'comfly',
      baseUrl: 'https://ai.comfly.org',
      enabled: true,
      models: [{ id: 'gemini-3.1-flash-image', category: 'chat', inputTypes: ['text'] }],
      modelCache: cached,
      order: 1,
      createdAt: 1,
    } as never)
    const channel = await repo.get('ch-category-refresh')
    expect(channel?.models.map((model) => [model.id, model.category])).toEqual([
      ['gemini-3.1-flash-image', 'image'],
    ])
  })

  it('老行读回补 tokenTail / lastTest* 为 null，不炸', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    await p.storage.put('channels', { id: 'legacy', name: '老' })
    const ch = (await repo.get('legacy'))!
    expect(ch.tokenTail).toBeNull()
    expect(ch.lastTestAt).toBeNull()
    expect(ch.lastTestLatency).toBeNull()
    expect(ch.models).toEqual([])
  })

  /**
   * 对账 #517 的零迁移判据：老行没有 `hasToken` 这一列。
   *
   * - 有尾号的老行 ⇒ 一定存过 ⇒ `hasToken` 回落 `true`；
   * - 什么都没有的老行 ⇒ `false`。
   * 这样"存过但没尾号"只有新写入的那一行会带上，老数据行为不变。
   */
  it('★ 老行没有 hasToken 列：有尾号 ⇒ 存过；没尾号 ⇒ 没存过', async () => {
    const p = createMemoryPlatform()
    const repo = createChannelRepository(p.storage, p.credentials)
    await p.storage.put('channels', { id: 'withTail', name: '有尾号', tokenTail: '3f2a' })
    await p.storage.put('channels', { id: 'bare', name: '空行' })
    expect((await repo.get('withTail'))!.hasToken).toBe(true)
    expect((await repo.get('bare'))!.hasToken).toBe(false)
    /* 备用槽同一条口径 */
    await p.storage.put('channels', { id: 'alt', name: '备用槽', altTokenTail: 'abcd' })
    expect((await repo.get('alt'))!.hasAltToken).toBe(true)
  })
})
