import { describe, expect, it } from 'vitest'
import { parseEcommerceIntent } from './chatParse'

describe('电商需求解析 · 爆款复刻', () => {
  it('认「爆款复刻」并写进待确认草稿', () => {
    const out = parseEcommerceIntent(
      JSON.stringify({ usage: '爆款复刻', count: 4, ratio: '3:4' }),
    )
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.draft.usage).toBe('recreate')
    expect(out.rows).toContainEqual({ label: '用途', value: '爆款复刻' })
  })
})
