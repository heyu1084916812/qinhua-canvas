import { describe, expect, it } from 'vitest'
import { runPlanWaves, type RunTask } from './plan'

function task(id: string, dependsOn: string[] = []): RunTask {
  return {
    id,
    nodeId: id,
    request: {
      kind: 'image',
      channelId: 'channel-1',
      model: 'model-1',
      prompt: id,
      inputs: [],
      params: {},
    },
    dependsOn,
    fingerprint: `fp-${id}`,
    params: {},
  }
}

describe('runPlanWaves', () => {
  it('独立任务同波，依赖任务进入下一波', () => {
    expect(
      runPlanWaves([
        task('c', ['a', 'b']),
        task('a'),
        task('b'),
        task('d', ['c']),
      ]).map((wave) => wave.map((item) => item.id)),
    ).toEqual([['a', 'b'], ['c'], ['d']])
  })

  it('未知依赖、自依赖和重复 id 在调用渠道前失败', () => {
    expect(() => runPlanWaves([task('a', ['missing'])])).toThrow(
      '依赖不存在',
    )
    expect(() => runPlanWaves([task('a', ['a'])])).toThrow('不能依赖自己')
    expect(() => runPlanWaves([task('a'), task('a')])).toThrow('任务 id 重复')
  })

  it('依赖成环明确失败', () => {
    expect(() =>
      runPlanWaves([task('a', ['b']), task('b', ['a'])]),
    ).toThrow('依赖成环')
  })
})
