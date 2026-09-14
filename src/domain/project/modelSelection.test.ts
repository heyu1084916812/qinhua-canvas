import { describe, it, expect } from 'vitest'
import type { ModelCapability } from '../shared/capability'
import {
  applySelection,
  filterModels,
  groupModelsByCategory,
  initialChecked,
  removeModel,
} from './modelSelection'

const m = (id: string, category: ModelCapability['category']): ModelCapability => ({
  id,
  category,
  inputTypes: ['text'],
})

const CACHE: ModelCapability[] = [
  m('gpt-image-2', 'image'),
  m('flux-1', 'image'),
  m('gpt-5.6', 'chat'),
  m('veo-3', 'video'),
  m('Seedream-4', 'image'),
]

describe('filterModels', () => {
  it('分类筛选按能力，不按名称猜', () => {
    expect(filterModels(CACHE, 'image', '').map((x) => x.id)).toEqual(['gpt-image-2', 'flux-1', 'Seedream-4'])
    expect(filterModels(CACHE, 'chat', '').map((x) => x.id)).toEqual(['gpt-5.6'])
    expect(filterModels(CACHE, 'video', '').map((x) => x.id)).toEqual(['veo-3'])
  })

  it('「全部」不过滤分类', () => {
    expect(filterModels(CACHE, 'all', '')).toHaveLength(5)
  })

  it('关键字大小写不敏感、两端去空白', () => {
    expect(filterModels(CACHE, 'all', 'FLUX').map((x) => x.id)).toEqual(['flux-1'])
    expect(filterModels(CACHE, 'all', '  seed  ').map((x) => x.id)).toEqual(['Seedream-4'])
  })

  it('分类与关键字同时生效（是「与」不是「或」）', () => {
    // flux 是 image，按 chat 筛应当为空——若实现写成「或」，这里会漏出一个错分类的模型
    expect(filterModels(CACHE, 'chat', 'flux')).toEqual([])
  })

  it('保持输入顺序，不做二次排序', () => {
    expect(filterModels(CACHE, 'image', '').map((x) => x.id)).toEqual(['gpt-image-2', 'flux-1', 'Seedream-4'])
  })
})

describe('groupModelsByCategory', () => {
  it('固定三组、顺序稳定（生图 / 对话 / 视频），空组也返回', () => {
    const groups = groupModelsByCategory([m('a', 'video')])
    expect(groups.map((g) => g.category)).toEqual(['image', 'chat', 'video'])
    expect(groups.map((g) => g.label)).toEqual(['生图', '对话', '视频'])
    expect(groups[0].models).toEqual([])
    expect(groups[2].models.map((x) => x.id)).toEqual(['a'])
  })
})

describe('applySelection', () => {
  it('勾选结果按缓存顺序产出', () => {
    const out = applySelection([], CACHE, new Set(['gpt-5.6', 'gpt-image-2']))
    expect(out.map((x) => x.id)).toEqual(['gpt-image-2', 'gpt-5.6'])
  })

  it('命中缓存的以缓存为准（能力参数更新要吃到）', () => {
    const stale: ModelCapability = { id: 'flux-1', category: 'image', inputTypes: [] }
    const out = applySelection([stale], CACHE, new Set(['flux-1']))
    expect(out[0]).toBe(CACHE[1])
    expect(out[0].inputTypes).toEqual(['text'])
  })

  it('缓存里已消失但仍勾着的保留——上游改名不该静默清掉用户的选择', () => {
    const orphan = m('retired-model', 'image')
    const out = applySelection([orphan], CACHE, new Set(['retired-model']))
    expect(out.map((x) => x.id)).toEqual(['retired-model'])
  })

  it('取消勾选即移除', () => {
    expect(applySelection([CACHE[0]], CACHE, new Set())).toEqual([])
  })

  it('不产生重复项（同时在缓存与已选里）', () => {
    const out = applySelection([CACHE[0], CACHE[1]], CACHE, new Set(['gpt-image-2', 'flux-1']))
    expect(out.map((x) => x.id)).toEqual(['gpt-image-2', 'flux-1'])
  })
})

describe('initialChecked / removeModel', () => {
  it('打开面板时此前已选的保持勾上', () => {
    const set = initialChecked([CACHE[0], CACHE[4]])
    expect([...set].sort()).toEqual(['Seedream-4', 'gpt-image-2'])
  })

  it('× 删除按 id 移除且不动其它项', () => {
    expect(removeModel(CACHE, 'flux-1').map((x) => x.id)).toEqual(['gpt-image-2', 'gpt-5.6', 'veo-3', 'Seedream-4'])
  })

  it('删除不存在的 id 不报错、原样返回', () => {
    expect(removeModel(CACHE, 'nope')).toHaveLength(5)
  })
})
