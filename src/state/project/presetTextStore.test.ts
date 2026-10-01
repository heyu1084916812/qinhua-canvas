import { describe, it, expect } from 'vitest'
import { createMemoryPlatform } from '../../platform/memory'
import { createPresetTextStore } from './presetTextStore'
import { createSkillStore } from './skillStore'
import { DEFAULT_PRESET_TEXT, PRESET_TEXT_MAX } from '../../domain/prompt/presetText'

/**
 * 功能预设词的读写（后台中枢，用户 2026-09-25）。
 *
 * 重点在 `presets` 仍与生成配方共表这件事上：两类数据同表不同 id 前缀，
 * 越界读写会把配方当预设词读出来，所以这组专门钉住隔离，以及「写坏值不进库」。
 * 技能从 2026-10-01 起已迁到独立 `skills` 表，旧 `skill:` 行只作为迁移输入。
 */
function store() {
  return createPresetTextStore(createMemoryPlatform().storage)
}

describe('PresetTextStore · 读回与回落', () => {
  it('从没写过 → 空覆盖（三条约等于默认）', async () => {
    expect(await store().load()).toEqual({})
  })

  it('保存一条后能读回', async () => {
    const s = store()
    await s.save('optimize', '只输出十个字以内的结果')
    expect(await s.load()).toEqual({ optimize: '只输出十个字以内的结果' })
  })

  it('保存另一条不冲掉上一条（整行覆盖时不能丢字段）', async () => {
    const s = store()
    await s.save('optimize', 'A')
    await s.save('translate', 'B')
    expect(await s.load()).toEqual({ optimize: 'A', translate: 'B' })
  })

  it('★ 恢复默认（传 null）会清掉该项，且不影响其它项', async () => {
    const s = store()
    await s.save('optimize', 'A')
    await s.save('translate', 'B')
    await s.save('optimize', null)
    expect(await s.load()).toEqual({ translate: 'B' })
  })

  it('★ 空白内容被拒（不能把该动作写成空指令）', async () => {
    const s = store()
    await expect(s.save('optimize', '   ')).rejects.toThrow(/不能为空/)
    expect(await s.load()).toEqual({})
  })

  it('★ 超限内容被拒', async () => {
    const s = store()
    await expect(s.save('optimize', 'x'.repeat(PRESET_TEXT_MAX + 1))).rejects.toThrow(/最多/)
    expect(await s.load()).toEqual({})
  })
})

describe('PresetTextStore · 与技能 / 配方同表互不干扰', () => {
  it('★ 技能写了很多条，预设词读回来仍是空（前缀隔离）', async () => {
    const platform = createMemoryPlatform()
    const skills = createSkillStore(platform.storage)
    const presets = createPresetTextStore(platform.storage)
    await skills.create({ name: '详情页策划', content: '你是资深策划' })
    await skills.create({ name: '周报', content: '你是主管' })
    expect(await presets.load()).toEqual({})
  })

  it('★ 预设词写过之后，技能列表不受影响', async () => {
    const platform = createMemoryPlatform()
    const skills = createSkillStore(platform.storage)
    const presets = createPresetTextStore(platform.storage)
    await presets.save('describe', '只看构图与光线')
    // 预设词的行没有 skillId / name / content 字段，skillStore 应当把它丢弃
    expect(await skills.loadAll()).toEqual([])
  })

  it('两类数据并存时各读各的', async () => {
    const platform = createMemoryPlatform()
    const skills = createSkillStore(platform.storage)
    const presets = createPresetTextStore(platform.storage)
    await skills.create({ name: '详情页策划', content: '你是资深策划' })
    await presets.save('optimize', '精简到一句话')
    expect(await presets.load()).toEqual({ optimize: '精简到一句话' })
    expect(await skills.loadAll()).toHaveLength(1)
  })
})

describe('PresetTextStore · 坏数据不产出半份状态', () => {
  it('库里存了空白 / 超限值时，读回时被丢弃（回落默认）', async () => {
    const platform = createMemoryPlatform()
    // 直接写一行坏值（模拟老版本或手改库）
    await platform.storage.put('presets', {
      id: 'presetText:tools',
      values: {
        optimize: '   ',
        translate: 'x'.repeat(PRESET_TEXT_MAX + 1),
        describe: '有效的一条',
      },
    } as never)
    const loaded = await createPresetTextStore(platform.storage).load()
    expect(loaded).toEqual({ describe: '有效的一条' })
    // 于是界面把它显示成默认 —— 而不是显示成空指令
    expect(DEFAULT_PRESET_TEXT.optimize).toMatch(/清晰度/)
  })
})
