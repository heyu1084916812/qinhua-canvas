import { describe, expect, it } from 'vitest'
import {
  buildDefaultModelMap,
  isIdentityMapping,
  normalizeModelMap,
  resolveUpstreamModel,
  setModelMapping,
} from './modelMapping'

describe('resolveUpstreamModel', () => {
  it('★ 无映射 = 恒等映射（老渠道零迁移）', () => {
    expect(resolveUpstreamModel({}, 'gpt-image-2')).toBe('gpt-image-2')
    expect(resolveUpstreamModel(null, 'gpt-image-2')).toBe('gpt-image-2')
    expect(resolveUpstreamModel(undefined, 'gpt-image-2')).toBe('gpt-image-2')
  })

  it('有映射时返回该渠道的上游 ID', () => {
    expect(resolveUpstreamModel({ 'image-2': 'gpt-image-2' }, 'image-2')).toBe('gpt-image-2')
  })

  it('★ 显式配成空串 = 未配，退回恒等（不是「映射成空 ID」）', () => {
    expect(resolveUpstreamModel({ 'image-2': '   ' }, 'image-2')).toBe('image-2')
  })

  it('★ 空逻辑名不解析成任何东西（null，交给调用方报错）', () => {
    expect(resolveUpstreamModel({}, '')).toBeNull()
    expect(resolveUpstreamModel({ a: 'b' }, '   ')).toBeNull()
  })
})

describe('buildDefaultModelMap', () => {
  it('★ 同名自动建恒等映射，不同名留空待用户填', () => {
    const out = buildDefaultModelMap({}, ['image-2', 'gpt-4o'], ['image-2', 'claude'])
    expect(out['image-2']).toBe('image-2')
    expect(out['gpt-4o']).toBeUndefined()
  })

  it('★ 只补不删：已有条目（含手填的）原样保留，上游下线的也不清', () => {
    const out = buildDefaultModelMap(
      { 'image-2': 'gpt-image-2', gone: 'old-id' },
      ['image-2', 'gone'],
      ['image-2'],
    )
    expect(out['image-2']).toBe('gpt-image-2') // 用户改过的不被同名覆盖
    expect(out.gone).toBe('old-id') // 上游没了也保留
  })

  it('空输入不炸', () => {
    expect(buildDefaultModelMap(null, [], [])).toEqual({})
  })
})

describe('setModelMapping', () => {
  it('写入映射', () => {
    expect(setModelMapping({}, 'image-2', 'gpt-image-2')).toEqual({ 'image-2': 'gpt-image-2' })
  })

  it('★ 清空 = 删除该条（回到恒等，不存空串）', () => {
    expect(setModelMapping({ 'image-2': 'gpt-image-2' }, 'image-2', '  ')).toEqual({})
  })

  it('空逻辑名不写入', () => {
    expect(setModelMapping({}, '  ', 'x')).toEqual({})
  })
})

describe('normalizeModelMap', () => {
  it('★ 只补不删：非法值（空键 / 空值 / 非字符串）被丢掉', () => {
    const out = normalizeModelMap({
      'image-2': 'gpt-image-2',
      '': 'x',
      bad: '',
      num: 42,
    })
    expect(out).toEqual({ 'image-2': 'gpt-image-2' })
  })

  it('缺字段 / 非对象 → 空对象（恒等映射）', () => {
    expect(normalizeModelMap(undefined)).toEqual({})
    expect(normalizeModelMap(null)).toEqual({})
    expect(normalizeModelMap('x')).toEqual({})
  })

  it('两边空白被去掉', () => {
    expect(normalizeModelMap({ ' a ': ' b ' })).toEqual({ a: 'b' })
  })
})

describe('isIdentityMapping', () => {
  it('同名（含未配）都算恒等', () => {
    expect(isIdentityMapping({}, 'image-2')).toBe(true)
    expect(isIdentityMapping({ 'image-2': 'image-2' }, 'image-2')).toBe(true)
    expect(isIdentityMapping({ 'image-2': 'gpt-image-2' }, 'image-2')).toBe(false)
  })
})
