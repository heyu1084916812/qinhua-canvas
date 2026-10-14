import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INSPIRATION_SOURCES,
  customInspirationSource,
  parseGithubRepoInput,
} from './sources'

describe('灵感来源 · GitHub 仓库直解析', () => {
  it('接受 owner/repo 与完整 GitHub URL，拒绝其它地址', () => {
    expect(parseGithubRepoInput('YouMind-OpenLab/awesome-seedance-2-prompts')?.fullName).toBe(
      'YouMind-OpenLab/awesome-seedance-2-prompts',
    )
    expect(
      parseGithubRepoInput(
        'https://github.com/PicoTrex/Awesome-Nano-Banana-images/tree/main',
      )?.fullName,
    ).toBe('PicoTrex/Awesome-Nano-Banana-images')
    expect(parseGithubRepoInput('https://example.com/owner/repo')).toBeNull()
  })

  it('自定义来源只填仓库 / 模型 / 类型，README 主分支与备用分支都生成', () => {
    const source = customInspirationSource({
      name: '我的提示词库',
      repo: 'owner/repo',
      modelCategory: 'GPT Image',
      kind: 'video',
    })
    expect(source).toMatchObject({
      id: 'custom:owner/repo',
      name: '我的提示词库',
      modelCategory: 'GPT Image',
      kind: 'video',
      format: 'readme',
      readmeStyle: 'youmindAll',
      builtin: false,
    })
    expect(source?.dataUrl).toContain('/owner/repo@main/README.md')
    expect(source?.fallbackDataUrl).toContain('/owner/repo@master/README.md')
  })

  it('内置来源都有模型分类和媒体类型，Seedance 明确是视频', () => {
    expect(DEFAULT_INSPIRATION_SOURCES.every((source) => source.modelCategory)).toBe(true)
    expect(DEFAULT_INSPIRATION_SOURCES.find((source) => source.id === 'youmind-seedance-2')?.kind).toBe(
      'video',
    )
  })
})
