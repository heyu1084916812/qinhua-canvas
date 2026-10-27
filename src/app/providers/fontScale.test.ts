import { describe, expect, it, vi } from 'vitest'
import { applyUiFontScale } from './fontScale'

describe('applyUiFontScale', () => {
  it('每次先清掉旧内联字号，再从设计令牌基准缩放，不会跨热更新累乘', () => {
    const values: Record<string, string> = {
      '--fs-body': '14px',
      '--fs-nav': '14px',
    }
    const removed: string[] = []
    const root = {
      style: {
        removeProperty: vi.fn((token: string) => {
          removed.push(token)
          delete values[token]
          return ''
        }),
        setProperty: vi.fn((token: string, value: string) => {
          values[token] = value
        }),
      },
    }
    const readComputed = (token: string) =>
      token === '--fs-body' || token === '--fs-nav' ? '14px' : ''

    applyUiFontScale({
      root,
      tokens: ['--fs-body', '--fs-nav'],
      scale: 'comfortable',
      readComputed,
    })
    expect(removed).toEqual(['--fs-body', '--fs-nav'])
    expect(values).toEqual({
      '--fs-body': '15.12px',
      '--fs-nav': '15.12px',
    })

    applyUiFontScale({
      root,
      tokens: ['--fs-body', '--fs-nav'],
      scale: 'standard',
      readComputed,
    })
    expect(values).toEqual({
      '--fs-body': '14px',
      '--fs-nav': '14px',
    })
  })
})
