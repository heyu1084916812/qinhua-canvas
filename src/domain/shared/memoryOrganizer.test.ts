import { describe, expect, it } from 'vitest'
import {
  inferMemoryKey,
  inferMemoryKind,
  memoryCandidateFromText,
  memoryCandidateProblems,
  normalizeMemoryCandidate,
} from './memoryOrganizer'

describe('memory organizer', () => {
  it('把明确的长期要求整理成带作用域和主题键的候选', () => {
    const candidate = memoryCandidateFromText('以后这个项目的品牌主色统一用深绿', {
      workbench: 'ecommerce',
      projectId: 'p1',
      sessionId: 's1',
    })
    expect(candidate).toMatchObject({
      kind: 'fact',
      scope: 'project',
      projectId: 'p1',
      key: 'brand.primaryColor',
    })
    expect(candidate?.text).toContain('品牌主色')
  })

  it('一次性要求不会被永久化', () => {
    expect(memoryCandidateFromText('这次先不要加文字')).toBeNull()
    expect(
      memoryCandidateProblems({
        kind: 'constraint',
        text: '这一张暂时不要 logo',
        scope: 'global',
        confidence: 0.8,
        reason: 'test',
      }),
    ).toContain('一次性要求不能升级成长期记忆')
  })

  it('密钥和超长内容会被拒绝', () => {
    expect(memoryCandidateFromText('记住 api_key=sk-1234567890abcdef')).toBeNull()
    expect(
      memoryCandidateProblems({
        kind: 'fact',
        text: '很长'.repeat(401),
        scope: 'global',
        confidence: 0.8,
        reason: 'test',
      }),
    ).toContain('单条记忆不能超过 800 字')
  })

  it('Agent 工具参数会被规则归一化，并补齐当前项目与会话', () => {
    const candidate = normalizeMemoryCandidate(
      {
        kind: 'decision',
        text: '以后海报都用蓝色',
        scope: 'session',
        confidence: 2,
      },
      { workbench: 'canvas', projectId: 'p1', sessionId: 's1' },
    )
    expect(candidate).toMatchObject({
      kind: 'decision',
      scope: 'session',
      projectId: 'p1',
      sessionId: 's1',
      confidence: 1,
    })
  })

  it('常用事实能稳定推断主题键', () => {
    expect(inferMemoryKey('品牌主色是深绿')).toBe('brand.primaryColor')
    expect(inferMemoryKey('项目成品比例用 4:3')).toBe('project.size')
    expect(inferMemoryKind('以后不要使用霓虹色')).toBe('constraint')
  })
})
