import { describe, it, expect } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createSkillStore } from './skillStore'

/**
 * 技能库的读写（用户 2026-09-24）。
 *
 * 重点在**与生成配方共用 `presets` 表**这件事上：两类数据同表不同前缀，
 * 越界读/写会让「技能」凭空出现在配方里、或反之 —— 那是数据层的事故，
 * 不是显示问题。所以这组的第一条就钉住隔离。
 */
function store() {
  return createSkillStore(createMemoryPlatform().storage)
}

describe('SkillStore · 新建与读取', () => {
  it('新建后能读回，字段完整', async () => {
    const s = store()
    await s.create({ name: '详情页策划', content: '你是资深策划……', description: '五段结构' })
    const list = await s.loadAll()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({
      name: '详情页策划',
      content: '你是资深策划……',
      description: '五段结构',
      inputMode: 'text',
    })
    expect(list[0].id).toMatch(/^skill/)
  })

  it('★ 按更新时间倒序（刚改的排最前）', async () => {
    const s = store()
    const a = await s.create({ name: 'A', content: 'a' })
    await new Promise((r) => setTimeout(r, 2))
    const b = await s.create({ name: 'B', content: 'b' })
    expect((await s.loadAll())[0].id).toBe(b.id)
    await new Promise((r) => setTimeout(r, 2))
    await s.save({ ...a, content: 'a2' })
    expect((await s.loadAll())[0].id).toBe(a.id)
  })

  it('★ 不合规的输入直接抛错（由界面转成提示，不静默存进去）', async () => {
    const s = store()
    await expect(s.create({ name: '', content: 'x' })).rejects.toThrow(/名称/)
    await expect(s.create({ name: 'a', content: '  ' })).rejects.toThrow(/正文/)
    expect(await s.loadAll()).toHaveLength(0)
  })

  it('删除后读不到', async () => {
    const s = store()
    const a = await s.create({ name: 'A', content: 'a' })
    await s.remove(a.id)
    expect(await s.loadAll()).toHaveLength(0)
  })
})

describe('SkillStore · 与生成配方同表隔离', () => {
  it('★ 配方行（recipe: 前缀）不会被当成技能读出来', async () => {
    const platform = createMemoryPlatform()
    // 模拟一条生成配方行（presetStore 的写入形状）
    await platform.storage.put('presets', {
      id: 'recipe:ch-1',
      channelId: 'ch-1',
      model: 'img-1',
      params: {},
      savedAt: 1,
    } as never)
    const s = createSkillStore(platform.storage)
    await s.create({ name: '技能', content: 'x' })
    const list = await s.loadAll()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('技能')
  })

  it('★ 技能行不会污染配方（id 带 skill: 前缀，与 recipe: 不冲突）', async () => {
    const platform = createMemoryPlatform()
    const s = createSkillStore(platform.storage)
    await s.create({ name: '技能', content: 'x' })
    const recipes = await platform.storage.query('presets', {})
    // 表里只有技能那一行，且它的 id 是 skill: 开头
    expect(recipes).toHaveLength(1)
    expect(String((recipes[0] as { id: string }).id)).toMatch(/^skill:/)
  })

  it('字段残缺的行被丢弃，不产出半份技能', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('presets', { id: 'skill:broken', skillId: 'broken' } as never)
    const s = createSkillStore(platform.storage)
    expect(await s.loadAll()).toHaveLength(0)
  })
})
