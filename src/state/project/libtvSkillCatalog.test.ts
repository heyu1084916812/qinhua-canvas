import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  libtvCategoryCounts,
  loadLibtvCatalog,
  loadLibtvSkillBody,
  loadLibtvSkillFiles,
} from './libtvSkillCatalog'

const items = [
  {
    id: 'libtv:recommended',
    sourceId: 'recommended',
    name: '推荐技能',
    description: '',
    useScenario: '',
    inputType: '',
    outputContent: '',
    resultType: 1,
    coverUrl: null,
    tags: ['专业影视'],
    recommended: true,
    cases: [],
    bodyFile: 'bodies/body.md',
  },
  {
    id: 'libtv:tagged',
    sourceId: 'tagged',
    name: '分类技能',
    description: '',
    useScenario: '',
    inputType: '',
    outputContent: '',
    resultType: 2,
    coverUrl: 'https://x.test/cover.png',
    tags: ['商业广告'],
    recommended: false,
    cases: [{ canvasCaseUrl: 'https://x.test/canvas/chat-share?shareId=abc' }],
    bodyFile: null,
  },
  {
    id: 'libtv:unknown',
    sourceId: 'unknown',
    name: '未分类技能',
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
  },
]

const catalogRaw = JSON.stringify({ total: items.length, bodyCount: 1, items })

describe('LibTV 目录异步加载', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('从 public 静态 JSON 加载，按推荐 / 分类 / 发现归桶', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(catalogRaw, { status: 200 })),
    )
    const skills = await loadLibtvCatalog()
    expect(skills).toHaveLength(3)
    const counts = libtvCategoryCounts(skills)
    expect(counts.get('推荐')).toBe(1)
    expect(counts.get('商业广告')).toBe(1)
    expect(counts.get('发现')).toBe(1)
  })

  it('正文按 public URL 懒加载，无 bodyFile 时不发请求', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const value = String(url)
      if (value.includes('/libtv-skills/catalog.json')) {
        return new Response(catalogRaw, { status: 200 })
      }
      expect(value).toContain('/libtv-skills/bodies/b.json')
      return new Response(
        JSON.stringify({
          'bodies/body.md': {
            'SKILL.md': '正文内容',
            'references/camera-language.md': '镜头语言',
          },
        }),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const skills = await loadLibtvCatalog()
    await expect(loadLibtvSkillBody(skills[0]!)).resolves.toBe('正文内容')
    const callsAfterShardLoad = fetchMock.mock.calls.length
    await expect(loadLibtvSkillBody(skills[0]!)).resolves.toBe('正文内容')
    await expect(loadLibtvSkillFiles(skills[0]!)).resolves.toEqual([
      { path: 'SKILL.md', content: '正文内容' },
      { path: 'references/camera-language.md', content: '镜头语言' },
    ])
    await expect(loadLibtvSkillBody(skills[1]!)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(callsAfterShardLoad)
  })
})
