/**
 * 循环展开的单测（产品文档 §6.22）。
 *
 * 重点钉住三条**容易写错**的性质：
 * 1. 素材**切片**（取完就没了）vs 提示词**取模**（可轮换）—— 两者语义不同，不能统一；
 * 2. 变量替换的两种写法（全角书名号 / 半角方括号）；
 * 3. 参数归一化（坏数据不炸、不跑飞）。
 */
import { describe, it, expect } from 'vitest'
import { applyLoopVariables, expandLoopRounds, normalizeLoopParams, LOOP_LIMITS } from './loopPlan'

describe('normalizeLoopParams', () => {
  it('缺省值：1 轮、从第 1 张起、每轮 1 张、无自有提示词', () => {
    expect(normalizeLoopParams(undefined)).toEqual({ count: 1, loopStart: 1, batch: 1, prompts: [] })
  })

  it('★ 越界值被钳制（不是原样透传）', () => {
    const p = normalizeLoopParams({ count: 99999, loopStart: -5, batch: 0 })
    expect(p.count).toBe(LOOP_LIMITS.countMax)
    expect(p.loopStart).toBe(LOOP_LIMITS.startMin)
    expect(p.batch).toBe(LOOP_LIMITS.batchMin)
  })

  it('★ NaN / 非数字回落到下界，不产生 NaN 传染', () => {
    const p = normalizeLoopParams({ count: Number.NaN, loopStart: undefined, batch: Number.NaN })
    expect(p.count).toBe(1)
    expect(p.loopStart).toBe(1)
    expect(p.batch).toBe(1)
  })

  it('小数被取整（轮次 / 张数没有小数含义）', () => {
    expect(normalizeLoopParams({ count: 3.9, batch: 2.7 }).count).toBe(3)
    expect(normalizeLoopParams({ count: 3.9, batch: 2.7 }).batch).toBe(2)
  })
})

describe('applyLoopVariables', () => {
  it('三种变量、两种写法全部替换', () => {
    const t = '第《计数》张（[计数]）共《总数》张（[总数]）进度《进度》([进度])'
    expect(applyLoopVariables(t, { index: 3, total: 10 })).toBe(
      '第3张（3）共10张（10）进度3/10(3/10)',
    )
  })

  it('没有变量时原样返回', () => {
    expect(applyLoopVariables('画一只猫', { index: 1, total: 1 })).toBe('画一只猫')
  })
})

describe('expandLoopRounds · 素材切片', () => {
  it('每轮取 1 张：轮次与素材一一对应', () => {
    const rounds = expandLoopRounds({ params: { count: 3 }, upstreamImages: 10 })
    expect(rounds.map((r) => [r.index, r.imageFrom, r.imageTo])).toEqual([
      [1, 0, 1],
      [2, 1, 2],
      [3, 2, 3],
    ])
  })

  it('每轮取 2 张（batch）：下标按批推进', () => {
    const rounds = expandLoopRounds({ params: { count: 3, batch: 2 }, upstreamImages: 10 })
    expect(rounds.map((r) => [r.imageFrom, r.imageTo])).toEqual([
      [0, 2],
      [2, 4],
      [4, 6],
    ])
  })

  it('loopStart 决定从第几张开始', () => {
    const rounds = expandLoopRounds({ params: { count: 2, loopStart: 4 }, upstreamImages: 10 })
    expect(rounds.map((r) => [r.imageFrom, r.imageTo])).toEqual([
      [3, 4],
      [4, 5],
    ])
  })

  it('★ 素材取完就没有了（第 3 轮之后是空区间，不是回到第 1 张）', () => {
    const rounds = expandLoopRounds({ params: { count: 4 }, upstreamImages: 2 })
    expect(rounds.map((r) => [r.imageFrom, r.imageTo])).toEqual([
      [0, 1],
      [1, 2],
      [2, 2],
      [2, 2],
    ])
  })

  it('关掉 useImageInput 时不带素材', () => {
    const rounds = expandLoopRounds({ params: { count: 2 }, upstreamImages: 10, useImageInput: false })
    expect(rounds.every((r) => r.imageFrom === 0 && r.imageTo === 0)).toBe(true)
  })
})

describe('expandLoopRounds · 提示词取模', () => {
  it('本节点 3 条提示词跑 6 轮 → 1-2-3-1-2-3', () => {
    const rounds = expandLoopRounds({
      params: { count: 6, prompts: ['A', 'B', 'C'] },
      upstreamImages: 0,
    })
    expect(rounds.map((r) => r.prompt)).toEqual(['A', 'B', 'C', 'A', 'B', 'C'])
  })

  it('★ 上游提示词在前、本节点提示词在后（同一池子里轮换）', () => {
    const rounds = expandLoopRounds({
      params: { count: 3, prompts: ['本地'] },
      upstreamImages: 0,
      upstreamPrompts: ['上游'],
    })
    expect(rounds.map((r) => r.prompt)).toEqual(['上游', '本地', '上游'])
  })

  it('★ 与素材的区别：素材取完为空，提示词取完回到开头', () => {
    const rounds = expandLoopRounds({
      params: { count: 3, prompts: ['P'] },
      upstreamImages: 1,
    })
    // 素材：只有第 1 轮有；提示词：三轮都有
    expect(rounds.map((r) => r.imageTo - r.imageFrom)).toEqual([1, 0, 0])
    expect(rounds.map((r) => r.prompt)).toEqual(['P', 'P', 'P'])
  })

  it('没有提示词时轮次里是空串（不是 undefined）', () => {
    const rounds = expandLoopRounds({ params: { count: 2 }, upstreamImages: 0 })
    expect(rounds.every((r) => r.prompt === '')).toBe(true)
  })

  it('关掉 usePrompt 时不带提示词', () => {
    const rounds = expandLoopRounds({
      params: { count: 2, prompts: ['A'] },
      upstreamImages: 0,
      usePrompt: false,
    })
    expect(rounds.every((r) => r.prompt === '')).toBe(true)
  })

  it('空白提示词被剔除（不会占掉一个轮换位）', () => {
    const rounds = expandLoopRounds({
      params: { count: 4, prompts: ['A', '   ', 'B'] },
      upstreamImages: 0,
    })
    expect(rounds.map((r) => r.prompt)).toEqual(['A', 'B', 'A', 'B'])
  })
})

describe('expandLoopRounds · 变量替换', () => {
  it('★ 每轮的提示词带自己的轮次变量', () => {
    const rounds = expandLoopRounds({
      params: { count: 3, loopStart: 5, prompts: ['第《计数》张，共《总数》张（《进度》）'] },
      upstreamImages: 0,
    })
    expect(rounds.map((r) => r.prompt)).toEqual([
      '第5张，共3张（5/3）',
      '第6张，共3张（6/3）',
      '第7张，共3张（7/3）',
    ])
  })
})

describe('expandLoopRounds · 轮次序号', () => {
  it('★ loopStart 影响 index（提示词里的计数从它开始）', () => {
    const rounds = expandLoopRounds({ params: { count: 3, loopStart: 10 }, upstreamImages: 0 })
    expect(rounds.map((r) => r.index)).toEqual([10, 11, 12])
  })

  it('count=1 时只有一轮（不特殊处理也能跑）', () => {
    expect(expandLoopRounds({ params: { count: 1 }, upstreamImages: 5 })).toHaveLength(1)
  })
})
