import { describe, it, expect } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createSkillStore } from './skillStore'

function store() {
  return createSkillStore(createMemoryPlatform().storage)
}

describe('SkillStore · 用户技能 CRUD', () => {
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
      source: 'user',
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

  it('★ 不合规的输入直接抛错，不静默存进去', async () => {
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

describe('SkillStore · 内置与用户分表', () => {
  it('★★ 启动时同步内置技能，且内置只出现在 builtinSkills 表', async () => {
    const platform = createMemoryPlatform()
    const s = createSkillStore(platform.storage)
    const builtins = await s.loadBuiltin()
    expect(builtins.length).toBeGreaterThanOrEqual(11)
    expect(builtins.every((x) => x.source === 'builtin')).toBe(true)
    expect(await platform.storage.query('builtinSkills', {})).toHaveLength(builtins.length)
    expect(await platform.storage.query('skills', {})).toHaveLength(0)
  })

  it('★★ 随包内置技能含即梦 Skill 包 7 个（名称与正文都带过来）', async () => {
    const s = createSkillStore(createMemoryPlatform().storage)
    const builtins = await s.loadBuiltin()
    const byName = new Map(builtins.map((x) => [x.name, x]))
    for (const name of [
      'TVC 商业广告视频创作流程',
      '创作分镜',
      '即梦视频创作标准工作流程',
      '品牌 Logo 设计与生图',
      '电商产品套图设计与生图',
      '营销海报设计与生图',
      '视频反解',
    ]) {
      const hit = byName.get(name)
      expect(hit, `缺少内置技能「${name}」`).toBeTruthy()
      expect(hit!.content.length).toBeGreaterThan(200)
      expect(hit!.source).toBe('builtin')
    }
  })

  it('★★ 复制内置技能：只生成一个用户副本，重复点击不重复建', async () => {
    const platform = createMemoryPlatform()
    const s = createSkillStore(platform.storage)
    const builtin = (await s.loadBuiltin())[0]!
    const first = await s.copyBuiltin(builtin)
    const second = await s.copyBuiltin(builtin)
    expect(second.id).toBe(first.id)
    expect(first).toMatchObject({ source: 'user', builtinId: builtin.id, name: builtin.name })
    expect(await platform.storage.query('skills', {})).toHaveLength(1)
    expect(await platform.storage.query('builtinSkills', {})).toHaveLength(
      (await s.loadBuiltin()).length,
    )
  })

  it('★★ 恢复默认只覆盖用户副本，不改内置正文', async () => {
    const platform = createMemoryPlatform()
    const s = createSkillStore(platform.storage)
    const builtin = (await s.loadBuiltin())[0]!
    const copy = await s.copyBuiltin(builtin)
    await s.save({ ...copy, name: '被用户改过', content: '被用户改过' })
    const restored = await s.restoreBuiltin(builtin)
    expect(restored.name).toBe(builtin.name)
    expect(restored.content).toBe(builtin.content)
    expect((await s.loadUser())[0]).toMatchObject({ name: builtin.name, content: builtin.content })
    expect((await s.loadBuiltin())[0]).toMatchObject({ name: builtin.name, content: builtin.content })
  })
})

describe('SkillStore · 旧数据迁移与表隔离', () => {
  it('★★ 旧版 presets 里的 skill: 行自动搬到 skills，不丢内容', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('presets', {
      id: 'skill:legacy-1',
      skillId: 'legacy-1',
      name: '旧技能',
      description: '',
      content: '旧正文',
      inputMode: 'text',
      tags: [],
      updatedAt: 1,
    } as never)
    const s = createSkillStore(platform.storage)
    const list = await s.loadUser()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ id: 'legacy-1', name: '旧技能', content: '旧正文' })
    expect(await platform.storage.query('presets', {})).toHaveLength(0)
    expect(await platform.storage.query('skills', { id: 'legacy-1' })).toHaveLength(1)
  })

  it('配方行不会被当成技能；新建技能也不会写回 presets', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('presets', {
      id: 'recipe:ch-1',
      channelId: 'ch-1',
      model: 'img-1',
      params: {},
      savedAt: 1,
    } as never)
    const s = createSkillStore(platform.storage)
    await s.create({ name: '技能', content: 'x' })
    expect(await s.loadUser()).toHaveLength(1)
    expect(await platform.storage.query('presets', {})).toHaveLength(1)
    expect(await platform.storage.query('skills', {})).toHaveLength(1)
  })

  it('字段残缺的旧行被丢弃，不产出半件技能', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('presets', { id: 'skill:broken', skillId: 'broken' } as never)
    const s = createSkillStore(platform.storage)
    expect(await s.loadUser()).toHaveLength(0)
  })
})
