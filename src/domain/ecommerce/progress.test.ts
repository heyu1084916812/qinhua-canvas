import { describe, expect, it } from 'vitest'
import type { EcommerceGenerationStage } from './progress'

describe('电商生成阶段词表', () => {
  it('阶段携带稳定的机器状态与可读文案', () => {
    const stage: EcommerceGenerationStage = {
      phase: 'generate',
      label: '正在生成第 2/4 张',
      current: 2,
      total: 4,
    }
    expect(stage.phase).toBe('generate')
    expect(stage.label).toContain('2/4')
  })
})
