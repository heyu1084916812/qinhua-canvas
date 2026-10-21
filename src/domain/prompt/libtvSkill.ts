/**
 * LibTV 外部技能目录。
 *
 * 目录是只读索引：卡片、详情、示例媒体和可选的 SKILL.md 正文分开存储。
 * 没有正文的条目仍然可浏览和收藏，但不能伪装成可执行技能。
 */

export const LIBTV_CATEGORIES = [
  '推荐',
  '专业影视',
  '商业广告',
  '短剧漫剧',
  '动漫游戏',
  '音乐MV',
  '自媒体创作',
  '通用技能',
  '发现',
] as const

export type LibtvCategory = (typeof LIBTV_CATEGORIES)[number]

export type LibtvSourceGroup = 'libtv' | 'jimeng' | 'mine'

export interface LibtvCase {
  productionCaseUrl?: string | null
  canvasCaseUrl?: string | null
}

export interface LibtvSkill {
  id: string
  sourceId: string
  name: string
  description: string
  useScenario: string
  inputType: string
  outputContent: string
  resultType: 1 | 2 | 3 | 4
  coverUrl?: string | null
  tags: string[]
  recommended: boolean
  cases: LibtvCase[]
  bodyFile?: string | null
}

export type MediaKind = 'text' | 'image' | 'video' | 'audio'

export interface LibtvPreview {
  url: string
  kind: 'image' | 'video'
}

export interface LibtvSkillFile {
  path: string
  content: string
}

const MEDIA_LABEL: Record<LibtvSkill['resultType'], string> = {
  1: '文本',
  2: '图片',
  3: '视频',
  4: '音频',
}

const VALID_CATEGORY = new Set<string>(
  LIBTV_CATEGORIES.filter((category) => category !== '推荐' && category !== '发现'),
)

export function libtvMediaKind(resultType: LibtvSkill['resultType']): MediaKind {
  if (resultType === 2) return 'image'
  if (resultType === 3) return 'video'
  if (resultType === 4) return 'audio'
  return 'text'
}

export function libtvMediaLabel(resultType: LibtvSkill['resultType']): string {
  return MEDIA_LABEL[resultType] ?? '文本'
}

/**
 * 「推荐」优先级最高；其次取目录自带分类；其余全部落「发现」。
 * 这条规则只决定列表归属，不覆写原始 tags。
 */
export function libtvCategoryOf(skill: LibtvSkill): LibtvCategory {
  if (skill.recommended) return '推荐'
  const category = skill.tags.find((tag) => VALID_CATEGORY.has(tag))
  return (category as LibtvCategory | undefined) ?? '发现'
}

function kindFromUrl(url: string): LibtvPreview['kind'] | null {
  const path = url.split(/[?#]/, 1)[0]?.toLowerCase() ?? ''
  if (/\.(mp4|mov|webm|m4v)$/.test(path)) return 'video'
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(path)) return 'image'
  return null
}

/** 详情预览优先使用真实示例；没有示例时回落到封面。 */
export function libtvPreviewOf(skill: LibtvSkill): LibtvPreview | null {
  for (const item of skill.cases) {
    const url = item.productionCaseUrl?.trim()
    if (!url) continue
    const kind = kindFromUrl(url)
    if (kind) return { url, kind }
  }
  const cover = skill.coverUrl?.trim()
  return cover ? { url: cover, kind: 'image' } : null
}

export function libtvCanvasCaseOf(skill: LibtvSkill): string | null {
  for (const item of skill.cases) {
    const url = item.canvasCaseUrl?.trim()
    if (url) return url
  }
  return null
}

export function libtvCardImageOf(skill: LibtvSkill): string | null {
  const cover = skill.coverUrl?.trim()
  if (cover) return cover
  for (const item of skill.cases) {
    const url = item.productionCaseUrl?.trim()
    if (url && kindFromUrl(url) === 'image') return url
  }
  return null
}

const THUMBNAIL_PROCESS = 'image/resize,w_640/format,webp/quality,q_72'
const THUMBNAIL_HOSTS = new Set(['libtv-res.liblib.art', 'liblibai-online.liblib.cloud'])

/** 卡片只取 640px WebP；详情仍使用原图。CDN 不支持时自动保留原 URL。 */
export function libtvThumbnailUrl(url: string | null): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    if (!THUMBNAIL_HOSTS.has(parsed.hostname)) return url
    parsed.searchParams.set('x-oss-process', THUMBNAIL_PROCESS)
    return parsed.toString()
  } catch {
    return url
  }
}

export function libtvHasBody(skill: LibtvSkill): boolean {
  return typeof skill.bodyFile === 'string' && skill.bodyFile.length > 0
}

/** 单技能 Agent 契约仍是一段正文：把主文件和附件按文件边界拼进去。 */
export function libtvAgentContentOf(files: readonly LibtvSkillFile[]): string {
  return files
    .filter((file) => file.content.trim())
    .map((file) => `# ${file.path}\n\n${file.content.trim()}`)
    .join('\n\n---\n\n')
}
