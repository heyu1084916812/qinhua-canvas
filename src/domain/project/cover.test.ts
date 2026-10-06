import { describe, it, expect } from 'vitest'
import { readCoverMark, resolveProjectCover, withCoverMark } from './cover'

/**
 * 项目封面归属规则（对账 #289）。
 *
 * 判据只有一条：**生成**与**上传**两个候选里谁更晚谁当封面。
 * 这里把"更晚"的边界（同毫秒、缺一边、脏数据）逐条钉死 ——
 * 它是用户能看见的结果（项目卡上那张图），而纯函数是唯一能穷举它的地方。
 */
describe('项目封面归属（domain/project/cover）', () => {
  it('只有生成产物时取生成那张', () => {
    expect(resolveProjectCover({ generated: { hash: 'g1', at: 100 }, marked: null })).toBe('g1')
  })

  it('只有上传时取上传那张', () => {
    expect(resolveProjectCover({ generated: null, marked: { hash: 'u1', at: 100 } })).toBe('u1')
  })

  it('★ 上传晚于生成 ⇒ 上传那张（用户原话：最后一次出现在画布中的图片）', () => {
    expect(resolveProjectCover({ generated: { hash: 'g1', at: 100 }, marked: { hash: 'u1', at: 200 } })).toBe(
      'u1',
    )
  })

  it('★ 生成晚于上传 ⇒ 生成那张（不是"上传优先"，是"时间优先"）', () => {
    expect(resolveProjectCover({ generated: { hash: 'g2', at: 300 }, marked: { hash: 'u1', at: 200 } })).toBe(
      'g2',
    )
  })

  it('同一毫秒打平 ⇒ 取生成的（那一张才是用户刚看到落下来的）', () => {
    expect(resolveProjectCover({ generated: { hash: 'g1', at: 100 }, marked: { hash: 'u1', at: 100 } })).toBe(
      'g1',
    )
  })

  it('两边都没有 ⇒ null（卡片回落网格占位，不显示破图）', () => {
    expect(resolveProjectCover({})).toBeNull()
    expect(resolveProjectCover({ generated: null, marked: null })).toBeNull()
  })

  it('readCoverMark：读得回、缺字段容错、脏数据不抛', () => {
    expect(readCoverMark({ cover: { hash: 'u1', at: 5 } })).toEqual({ hash: 'u1', at: 5 })
    // 老项目没有这一笔
    expect(readCoverMark({})).toBeNull()
    expect(readCoverMark(undefined)).toBeNull()
    expect(readCoverMark(null)).toBeNull()
    // 脏数据：hash 缺失 / 不是字符串 / at 不是数字
    expect(readCoverMark({ cover: { at: 5 } })).toBeNull()
    expect(readCoverMark({ cover: { hash: '' } })).toBeNull()
    expect(readCoverMark({ cover: 'u1' })).toBeNull()
    // at 坏掉时当作 0（不丢封面，只是它排在任何有时间戳的候选之后）
    expect(readCoverMark({ cover: { hash: 'u1', at: 'x' } })).toEqual({ hash: 'u1', at: 0 })
  })

  it('withCoverMark：写进 extra 且不改原对象', () => {
    const before = { foo: 1 }
    const next = withCoverMark(before, 'u1', 9)
    expect(next).toEqual({ foo: 1, cover: { hash: 'u1', at: 9 } })
    expect(before).toEqual({ foo: 1 })
    // 非对象 / 空值入参也能写（项目行的 extra 可能压根没有）
    expect(withCoverMark(undefined, 'u1', 9)).toEqual({ cover: { hash: 'u1', at: 9 } })
    expect(withCoverMark('bad', 'u1', 9)).toEqual({ cover: { hash: 'u1', at: 9 } })
  })
})
