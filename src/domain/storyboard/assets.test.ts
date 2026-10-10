import { describe, expect, it } from 'vitest'
import {
  assetIdOf,
  extractAssets,
  findAssetByName,
  normalizeName,
  resolveDraftBindings,
} from './assets'
import type { DramaCharacter, DramaScene } from './storyboard'

const character = (
  id: string,
  name: string,
  aliases: string[] = [],
  description = '',
): DramaCharacter => ({ id, name, description, aliases })

const scene = (id: string, name: string, aliases: string[] = []): DramaScene => ({
  id,
  name,
  description: '',
  aliases,
})

describe('normalizeName', () => {
  it('去空白（含全角）并折大小写 —— 归并判据只有这一份', () => {
    expect(normalizeName(' 林 轩 ')).toBe('林轩')
    expect(normalizeName('Lin　Xuan')).toBe('linxuan')
    expect(normalizeName('LIN XUAN')).toBe(normalizeName('lin　xuan'))
  })
})

describe('extractAssets（抽取 + 归并去重）', () => {
  it('模型声明的资产带着别名与描述一起落库', () => {
    const out = extractAssets({
      shots: [],
      characters: [{ name: '林轩', aliases: ['林公子'], description: '二十岁，送货骑手' }],
      scenes: [{ name: '雨夜街道', description: '霓虹、积水' }],
    })
    expect(out.characters).toHaveLength(1)
    expect(out.characters[0]).toMatchObject({ name: '林轩', aliases: ['林公子'] })
    expect(out.characters[0]!.description).toBe('二十岁，送货骑手')
    expect(out.scenes[0]!.name).toBe('雨夜街道')
  })

  it('★★ 别名归并：模型把两种叫法写成一条（name = 库里那条，aliases 带别的叫法）⇒ 合成一条', () => {
    const existing = [character('c1', '林轩')]
    const out = extractAssets({
      shots: [{ characterNames: ['林公子', '林轩'], locationNames: [] }],
      characters: [{ name: '林轩', aliases: ['林公子', '小林'], description: '' }],
      existingCharacters: existing,
    })
    expect(out.characters).toHaveLength(1)
    expect(out.characters[0]!.id).toBe('c1')
    expect(out.characters[0]!.aliases).toEqual(expect.arrayContaining(['林公子', '小林']))
  })

  it('★ 模型把两种叫法拆成两条：第二条按别名并进第一条（确定性归并，不靠共现猜）', () => {
    const out = extractAssets({
      shots: [],
      characters: [
        { name: '林公子', aliases: ['林轩'] },
        { name: '林轩' },
      ],
    })
    expect(out.characters).toHaveLength(1)
    expect(out.characters[0]!.name).toBe('林公子')
  })

  it('同一条镜头里出现两个角色**不会**被当成同一个人（共现不是同一性的证据）', () => {
    const out = extractAssets({
      shots: [{ characterNames: ['林轩', '王叔'], locationNames: [] }],
    })
    expect(out.characters.map((c) => c.name)).toEqual(['林轩', '王叔'])
  })

  it('★★ 已有资产只增不减：模型这一轮没提到，也不许把它删掉', () => {
    const out = extractAssets({
      shots: [{ characterNames: [], locationNames: [] }],
      existingCharacters: [character('c1', '林轩')],
      existingScenes: [scene('s1', '雨夜街道')],
    })
    expect(out.characters.map((c) => c.id)).toEqual(['c1'])
    expect(out.scenes.map((s) => s.id)).toEqual(['s1'])
  })

  it('★ 描述只补空：用户改过的描述不被模型的下一轮冲掉', () => {
    const out = extractAssets({
      shots: [],
      characters: [{ name: '林轩', description: '模型写的' }],
      existingCharacters: [character('c1', '林轩', [], '用户确认过的样子')],
    })
    expect(out.characters[0]!.description).toBe('用户确认过的样子')
    const filled = extractAssets({
      shots: [],
      characters: [{ name: '林轩', description: '模型补的' }],
      existingCharacters: [character('c1', '林轩')],
    })
    expect(filled.characters[0]!.description).toBe('模型补的')
  })

  it('★ 镜头提到、模型没声明：补一条最小资产（§6.3 的"从分镜汇总产物"）', () => {
    const out = extractAssets({
      shots: [
        { characterNames: ['路人甲', '林轩'], locationNames: ['十五楼走廊'] },
        { characterNames: ['路人甲'], locationNames: [] },
      ],
    })
    expect(out.characters.map((c) => c.name)).toEqual(['路人甲', '林轩'])
    expect(out.scenes.map((s) => s.name)).toEqual(['十五楼走廊'])
    expect(out.characters[0]!.description).toBe('')
  })

  it('空白名字与重复名字不会造出空资产 / 重复资产', () => {
    const out = extractAssets({
      shots: [{ characterNames: ['', '  ', '林轩', ' 林 轩 '], locationNames: [] }],
    })
    expect(out.characters).toHaveLength(1)
    expect(out.characters[0]!.name).toBe('林轩')
  })

  it('纯函数：不改动传进来的既有资产（复制一份再改）', () => {
    const existing = [character('c1', '林轩', ['小林'])]
    extractAssets({
      shots: [],
      characters: [{ name: '林公子', aliases: ['林轩'] }],
      existingCharacters: existing,
    })
    expect(existing[0]!.aliases).toEqual(['小林'])
  })
})

describe('assetIdOf / findAssetByName / resolveDraftBindings', () => {
  it('按 name 或 alias 都能找到；认不出来返回 undefined（不编 id）', () => {
    const list = [character('c1', '林轩', ['林公子'])]
    expect(assetIdOf(list, '林轩')).toBe('c1')
    expect(assetIdOf(list, '林公子')).toBe('c1')
    expect(assetIdOf(list, '张三')).toBeUndefined()
    expect(findAssetByName(list, '林公子')?.id).toBe('c1')
  })

  it('镜头绑定：一镜一个场景（取第一个地点名）+ 去重后的出场角色', () => {
    const bindings = resolveDraftBindings(
      { characterNames: ['林轩', '林公子', '张三'], locationNames: ['雨夜街道', '十五楼'] },
      [character('c1', '林轩', ['林公子'])],
      [scene('s1', '雨夜街道')],
    )
    expect(bindings.sceneId).toBe('s1')
    expect(bindings.characterIds).toEqual(['c1'])
  })

  it('一个名字都对不上时不硬编 id（空绑定就是空绑定）', () => {
    expect(resolveDraftBindings({ characterNames: ['张三'], locationNames: ['月球'] }, [], [])).toEqual({})
  })
})
