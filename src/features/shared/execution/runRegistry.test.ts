import { describe, expect, it } from 'vitest'
import { createRunRegistry } from './runRegistry'

describe('并发运行登记表', () => {
  it('两条链路各自登记、互不覆盖', () => {
    const reg = createRunRegistry<{ controller: string }>()
    reg.add('plan-1', { controller: 'c1' })
    reg.add('plan-2', { controller: 'c2' })

    expect(reg.ids().sort()).toEqual(['plan-1', 'plan-2'])
    expect(reg.get('plan-1')?.controller).toBe('c1')
    expect(reg.get('plan-2')?.controller).toBe('c2')
  })

  it('结束其中一条不影响另一条', () => {
    const reg = createRunRegistry<number>()
    reg.add('a', 1)
    reg.add('b', 2)
    reg.remove('a')

    expect(reg.has('a')).toBe(false)
    expect(reg.get('b')).toBe(2)
  })
})
