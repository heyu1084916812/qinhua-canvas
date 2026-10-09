import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import type { ExtensionPack } from '../../domain/pack/pack'
import { createPackStore, packSkillRowId } from './packStore'
import { createSkillStore } from './skillStore'

/**
 * 扩展包安装 / 卸载（对账 #386 阶段一）。
 *
 * 判据全部落在**回读**上：装完从库里读技能、读平台规则、读已装清单；
 * 卸载后再读一遍确认"只删了包内的东西"。这类功能最容易出的问题就是
 * "卸载把用户自己写的技能一起删了"，而那种缺陷在界面上完全看不出来。
 */
function makePack(overrides: Partial<ExtensionPack> = {}): ExtensionPack {
  return {
    format: 'qinghua.pack',
    version: 1,
    id: 'pack.demo',
    displayName: '演示包',
    contents: {
      skills: [
        { id: 'skill-a', name: '技能 A', content: '正文 A', inputMode: 'text' },
        { id: 'skill-b', name: '技能 B', content: '正文 B', inputMode: 'any' },
      ],
      ecommercePlatforms: [
        {
          id: 'demo-platform',
          name: '演示平台',
          group: 'china',
          ratios: ['1:1'],
          languages: ['zh-CN'],
          rules: '白底、产品居中。',
          updatedAt: '2026-10-09',
          sourceNote: '通用建议：未核实官方规则，按常见做法整理',
        },
      ],
    },
    permissions: [],
    ...overrides,
  }
}

describe('扩展包安装与卸载', () => {
  it('★ 装进去之后能从库里读回技能 / 平台规则 / 已装清单', async () => {
    const storage = createMemoryStorage()
    const store = createPackStore(storage)
    const outcome = await store.install(makePack(), 'skip')

    expect(outcome.installedSkills).toBe(2)
    expect(outcome.installedPlatforms).toBe(1)
    const skills = await createSkillStore(storage).loadUser()
    expect(skills.map((s) => s.id).sort()).toEqual([
      packSkillRowId('pack.demo', 'skill-a'),
      packSkillRowId('pack.demo', 'skill-b'),
    ])
    expect(skills.find((s) => s.name === '技能 A')?.content).toBe('正文 A')
    expect((await store.platforms()).map((p) => p.id)).toEqual(['demo-platform'])
    expect((await store.listInstalled()).map((p) => p.id)).toEqual(['pack.demo'])
  })

  it('★★ 冲突策略三档都按用户选的走：skip / overwrite / copy', async () => {
    const storage = createMemoryStorage()
    const store = createPackStore(storage)
    const rowA = packSkillRowId('pack.demo', 'skill-a')

    await store.install(makePack(), 'overwrite')
    // 用户改了装进来的那条
    const skillStore = createSkillStore(storage)
    const rows = await skillStore.loadUser()
    const a = rows.find((s) => s.id === rowA)!
    await skillStore.save({ ...a, content: '用户改过的正文' })

    // skip：保留用户改过的
    await store.install(makePack(), 'skip')
    expect((await skillStore.loadUser()).find((s) => s.id === rowA)?.content).toBe('用户改过的正文')

    // overwrite：被包里的正文覆盖
    await store.install(makePack(), 'overwrite')
    expect((await skillStore.loadUser()).find((s) => s.id === rowA)?.content).toBe('正文 A')

    // copy：多出一份副本，原来的还在
    const outcome = await store.install(makePack(), 'copy')
    expect(outcome.copied.some((c) => c.from === rowA)).toBe(true)
    const ids = (await skillStore.loadUser()).map((s) => s.id)
    expect(ids).toContain(rowA)
    expect(ids.some((id) => id.startsWith(`${rowA}.copy`))).toBe(true)
  })

  it('★ 安装前预览：会新增 / 会覆盖 / 会跳过，与策略一致', async () => {
    const storage = createMemoryStorage()
    const store = createPackStore(storage)
    const fresh = await store.preview(makePack(), 'skip')
    expect(fresh.adds).toHaveLength(2)
    expect(fresh.replaces).toHaveLength(0)

    await store.install(makePack(), 'overwrite')
    const again = await store.preview(makePack(), 'skip')
    expect(again.skips).toHaveLength(2)
    const overwrite = await store.preview(makePack(), 'overwrite')
    expect(overwrite.replaces).toHaveLength(2)
  })

  it('★★ 卸载只删这个包装的东西：用户自己写的技能与别的包都在', async () => {
    const storage = createMemoryStorage()
    const store = createPackStore(storage)
    const skillStore = createSkillStore(storage)

    await skillStore.create({ name: '我自己写的', content: '别动我' })
    await store.install(makePack(), 'overwrite')
    await store.install(makePack({ id: 'pack.other', displayName: '另一个包' }), 'overwrite')

    expect(await store.uninstall('pack.demo')).toBe(true)
    const left = await skillStore.loadUser()
    expect(left.some((s) => s.name === '我自己写的')).toBe(true)
    expect(left.some((s) => s.id.startsWith('pack.pack.other.'))).toBe(true)
    expect(left.some((s) => s.id.startsWith('pack.pack.demo.'))).toBe(false)
    expect((await store.listInstalled()).map((p) => p.id)).toEqual(['pack.other'])
    // 再卸一次：没了就是没了，返回 false（不假装成功）
    expect(await store.uninstall('pack.demo')).toBe(false)
  })

  it('★ 两个包声明同一平台规则：卸掉一个，规则仍在（另一个还拥有它）', async () => {
    const storage = createMemoryStorage()
    const store = createPackStore(storage)
    const shared = makePack().contents.ecommercePlatforms
    await store.install(makePack(), 'overwrite')
    await store.install(
      makePack({ id: 'pack.other', contents: { skills: [], ecommercePlatforms: shared } }),
      'overwrite',
    )
    await store.uninstall('pack.demo')
    expect((await store.platforms()).map((p) => p.id)).toEqual(['demo-platform'])
    await store.uninstall('pack.other')
    expect(await store.platforms()).toEqual([])
  })
})
