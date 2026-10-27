import { describe, expect, it } from 'vitest'
import {
  libtvCanvasCaseOf,
  libtvCardImageOf,
  libtvCategoryOf,
  libtvHasBody,
  libtvAgentContentOf,
  libtvMediaLabel,
  libtvPreviewOf,
  libtvThumbnailUrl,
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
  it('只认 v2 内容分类，忽略旧标签与推荐位；旧目录缺字段落其他', () => {
    expect(
      libtvCategoryOf(
        skill({ category: '影视剧情', recommended: true, tags: ['专业影视'] }),
      ),
    ).toBe('影视剧情')
    expect(
      libtvCategoryOf(skill({ category: '电商品牌', tags: ['商业广告'] })),
    ).toBe('电商品牌')
    expect(libtvCategoryOf(skill({ tags: ['专业影视'] }))).toBe('其他')
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

  it('LibTV 卡片图转 640px WebP，未知域名保持原样', () => {
    expect(
      libtvThumbnailUrl(
        'https://libtv-res.liblib.art/upload-images/a/cover.png?token=1',
      ),
    ).toBe(
      'https://libtv-res.liblib.art/upload-images/a/cover.png?token=1&x-oss-process=image%2Fresize%2Cw_640%2Fformat%2Cwebp%2Fquality%2Cq_72',
    )
    expect(libtvThumbnailUrl('https://example.com/cover.png')).toBe(
      'https://example.com/cover.png',
    )
    expect(libtvThumbnailUrl(null)).toBeNull()
  })

  it('Agent 单技能正文保留主文件与附件的文件边界', () => {
    expect(
      libtvAgentContentOf([
        { path: 'SKILL.md', content: '主流程' },
        { path: 'references/camera.md', content: '镜头参考' },
      ]),
    ).toBe('# SKILL.md\n\n主流程\n\n---\n\n# references/camera.md\n\n镜头参考')
  })
})
