import { describe, expect, it } from 'vitest'
import { runWaves } from './runWaves'

/**
 * 一次运行的**依赖波次**（用户 2026-10-05 第 2 条：「应该是同时生成的，但是他
 * 先生成一个再生成另外一个」）。
 */
describe('runWaves · 一批节点切波次', () => {
  const e = (source: string, target: string) => ({ id: `${source}->${target}`, source, target })

  it('★★ 两个互不依赖的生成 → 同一波（可以同时发）', () => {
    expect(runWaves(['a', 'b'], [])).toEqual([['a', 'b']])
  })

  it('★★ 有依赖时分成两波，顺序不乱（A 出图 → B 优化）', () => {
    expect(runWaves(['a', 'b'], [e('a', 'b')])).toEqual([['a'], ['b']])
  })

  it('★ 只按**这一批内部**的依赖算：集合外的上游不算数', () => {
    // outside → a 这条边在集合外，a 仍然是最前面那一波
    expect(runWaves(['a', 'b'], [e('outside', 'a')])).toEqual([['a', 'b']])
  })

  it('★ 同波保持传入顺序（结果稳定、可断言）', () => {
    expect(runWaves(['b', 'a', 'c'], [])).toEqual([['b', 'a', 'c']])
  })

  it('★ 链式依赖切三波', () => {
    expect(runWaves(['a', 'b', 'c'], [e('a', 'b'), e('b', 'c')])).toEqual([['a'], ['b'], ['c']])
  })

  it('★ 有环也不空转：剩下的当最后一波返回', () => {
    expect(runWaves(['a', 'b'], [e('a', 'b'), e('b', 'a')])).toEqual([['a', 'b']])
  })

  it('★ 空输入返回空', () => {
    expect(runWaves([], [])).toEqual([])
  })
})
