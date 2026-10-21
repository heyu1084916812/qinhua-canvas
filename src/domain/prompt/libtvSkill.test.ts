import { describe, expect, it } from 'vitest'
import {
  libtvCanvasCaseOf,
  libtvCardImageOf,
  libtvCategoryOf,
  libtvHasBody,
  libtvMediaLabel,
  libtvPreviewOf,
  type LibtvSkill,
} from './libtvSkill'

function skill(overrides: Partial<LibtvSkill> = {}): LibtvSkill {
  return {
    id: 'libtv:test',
    sourceId: 'test',
    name: '测试技能',
    description: '',
    useScenario: '',
    inputType: '',
    outputContent: '',
    resultType: 3,
    coverUrl: null,
    tags: [],
    recommended: false,
    cases: [],
    bodyFile: null,
    ...overrides,
  }
}

describe('LibTV Skill 领域规则', () => {
  it('推荐优先，其次分类，未归类落发现', () => {
    expect(libtvCategoryOf(skill({ recommended: true, tags: ['专业影视'] }))).toBe('推荐')
    expect(libtvCategoryOf(skill({ tags: ['专业影视'] }))).toBe('专业影视')
    expect(libtvCategoryOf(skill({ tags: ['不存在的分类'] }))).toBe('发现')
  })

  it('媒体类型由 resultType 稳定映射', () => {
    expect(libtvMediaLabel(1)).toBe('文本')
    expect(libtvMediaLabel(2)).toBe('图片')
    expect(libtvMediaLabel(3)).toBe('视频')
    expect(libtvMediaLabel(4)).toBe('音频')
  })

  it('详情优先示例媒体；创作详情取第一条 canvasCaseUrl', () => {
    const item = skill({
      cases: [
        { productionCaseUrl: 'https://x.test/case.mp4' },
        {
          productionCaseUrl: 'https://x.test/case2.mp4',
          canvasCaseUrl: 'https://x.test/canvas/chat-share?shareId=abc',
        },
      ],
      coverUrl: 'https://x.test/cover.png',
    })
    expect(libtvPreviewOf(item)).toEqual({ url: 'https://x.test/case.mp4', kind: 'video' })
    expect(libtvCanvasCaseOf(item)).toBe('https://x.test/canvas/chat-share?shareId=abc')
    expect(libtvCardImageOf(item)).toBe('https://x.test/cover.png')
  })

  it('没有 cover 时，卡片回落到图片示例而不是视频 URL', () => {
    const item = skill({
      cases: [
        { productionCaseUrl: 'https://x.test/case.mp4' },
        { productionCaseUrl: 'https://x.test/case.png' },
      ],
    })
    expect(libtvCardImageOf(item)).toBe('https://x.test/case.png')
  })

  it('正文可用性只认 bodyFile', () => {
    expect(libtvHasBody(skill())).toBe(false)
    expect(libtvHasBody(skill({ bodyFile: 'bodies/test.md' }))).toBe(true)
  })
})
