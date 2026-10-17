/**
 * 普通画布生成节点的默认标题。
 *
 * Agent 建的节点由模型直接给 title；普通画布没有这一步。这里采用**元数据优先**
 * 的确定性规则：用户已经给过的信息（标题、文件名、预设、用途）先复用，提示词
 * 只负责兜底。全程不调用 LLM，因此没有额外费用、延迟或失败分支。
 */
import type { GenerationData, NodeSnapshot } from '../model/node'
import { presetById } from '../layout/presets'

const GENERIC_TITLES = new Set([
  '生成',
  '图片生成',
  '视频生成',
  '批量生成',
  '批量出图',
  '生成（套图）',
  '图生图',
  '底图',
  '图片',
  '视频',
  '提示词',
  '结果',
  '未命名',
  'image',
  'img',
  'photo',
  'untitled',
  'screenshot',
  '屏幕截图',
])

/** 承载节点自动追加的一段：「的输出1」「output 2」「-03」。 */
const AUTO_OUTPUT_SUFFIX = /(?:\s*(?:的?输出|output)\s*\d+|\s*-?\s*\d+)\s*$/iu

/** 上传素材常见的泛化名；这些名字对识别内容没有帮助，应继续看提示词。 */
const GENERIC_MATERIAL =
  /^(?:(?:img|image|dsc|dscn|pic|photo|screenshot|screen shot|untitled|微信图片|wechat image|截图|屏幕截图|素材|参考图|图片|视频|未命名|新建文件|无标题)(?:[\s_-]*\d+)*)$/i

const KNOWN_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'webp',
  'gif',
  'bmp',
  'tif',
  'tiff',
  'heic',
  'heif',
  'avif',
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'm4v',
])

const LEADING_COMMAND =
  /^(?:(?:请|麻烦)\s*)?(?:(?:帮我|帮忙)\s*)?(?:生成|绘制|画|制作|创建|设计)(?:一张|一幅|一个|一段|一组|张|幅|个|段|组)?\s*[：:，,\s]*/iu

const LEADING_ENGLISH_COMMAND =
  /^(?:please\s+)?\b(?:create|generate|make|design|draw|paint|produce|render|show)\b\s*(?:me\s+)?(?:an?|the|one|two|three|four)?\s*/i

const LEADING_ARTICLE = /^(?:一张|一幅|一个|一段|一组|张|幅|个|段|组|an?\s+|the\s+)/iu

const LEADING_LABEL =
  /^(?:主体|商品|产品|角色|场景|用途|平台|风格|镜头|画面|要求)\s*[：:]\s*/u

const WEAK_FIRST_CLAUSE =
  /^(?:高清|超清|4k|8k|高画质|高质量|写实|写实风格|电影感|纯色背景|白色背景|白底背景|透明背景|high quality|hd|4k|8k|realistic)$/i

/** 「第1张」「图2」只是在报序号，不是画面主体。 */
const SEQUENCE_ONLY_CLAUSE =
  /^(?:第\s*(?:\d+|\[[^\]]+\])\s*[张幅个]|图\s*\d+|image\s*\d+)$/iu

const LEADING_DECORATION = /^[“"'「『（(【[]+\s*/u
const TRAILING_DECORATION = /\s*[”"'」』）)】\].]+$/u
const TRAILING_COPY_SUFFIX =
  /(?:\s*(?:[-_ ]?(?:副本|copy|final|最终版|修改版|导出版|已编辑)))*(?:\s*[（(]\d+[）)])?\s*$/iu
const HASH_ONLY = /^(?:轻画[-_ ]?)?[a-f0-9]{8,}$/i

const PRESET_LABELS: Record<string, string> = {
  调度故事板: '调度分镜',
  故事板: '故事板',
  '25宫格连贯分镜': '25宫格分镜',
  剧情推演四宫格: '四宫格',
  '画面推演 — 3 秒后': '3秒后',
  '画面推演 — 5 秒前': '5秒前',
  '720 全景': '720全景',
  多机位九宫格: '九宫格',
  角色脸部三视图: '脸部三视图',
  角色三视图: '角色三视图',
  角色设定图: '角色设定',
  场景设定图: '场景设定',
  产品设定图: '产品设定',
  人像质感调节: '人像质感',
  电影级光影校正: '电影光影',
}

export interface GeneratedNodeTitleInput {
  prompt: string
  mode: 'image' | 'video'
  /** new = 另建承载节点；reuse = 写回已有空节点 */
  slotKind: 'new' | 'reuse'
  sourceTitle: string
  /** reuse 时的真实落点标题；new 时是计划生成的承载节点标题 */
  targetTitle: string
  /** 第一张输入素材所属节点的标题（通常是上传文件名）。 */
  materialTitle?: string
  /** 当前视觉预设的显示名，例如「角色三视图」「产品设定图」。 */
  presetName?: string
  /** 业务用途，例如「亚马逊主图」「详情页」「白底图」。优先于预设名。 */
  usageLabel?: string
  /** 画布上已存在的标题，用来避免重复。 */
  existingTitles?: readonly string[]
  /** 同一来源节点内的第几张，从 0 开始 */
  index: number
  total: number
}

function normalizeSpaces(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

function stripDecorations(value: string): string {
  return normalizeSpaces(
    value
      .replace(LEADING_DECORATION, '')
      .replace(TRAILING_DECORATION, '')
      .replace(/[。；;]+$/u, ''),
  )
}

function normalizedKey(value: string): string {
  return normalizeSpaces(value).normalize('NFKC').toLocaleLowerCase()
}

/** 中文按 2 个视觉单位、英文按 1 个计算，避免 16 个汉字和 16 个字母一样长。 */
function visualWidthOf(text: string): number {
  let width = 0
  for (const char of text) {
    width += char.codePointAt(0)! >= 0x2e80 ? 2 : 1
  }
  return width
}

function truncateVisual(text: string, maxUnits: number): string {
  let width = 0
  let out = ''
  for (const char of text) {
    const next = char.codePointAt(0)! >= 0x2e80 ? 2 : 1
    if (width + next > maxUnits) break
    width += next
    out += char
  }
  return out.trim()
}

/** 英文被截断时不要把 on / with / at 这类连接词留在末尾。 */
function trimTruncatedConnector(original: string, truncated: string): string {
  if (truncated === original) return truncated
  return truncated.replace(/\b(?:on|with|for|in|at|by|from|of|and|or|to)\s*$/iu, '').trim()
}

/** 有空格时优先在完整单词边界截断；单词本身超长才退回字符截断。 */
function truncateTitleText(text: string, maxUnits: number): string {
  if (!/\s/u.test(text)) return truncateVisual(text, maxUnits)
  const words = text.split(/\s+/u)
  let out = ''
  for (const word of words) {
    const next = out ? `${out} ${word}` : word
    if (out && visualWidthOf(next) > maxUnits) break
    if (!out && visualWidthOf(word) > maxUnits) return truncateVisual(word, maxUnits)
    out = next
  }
  return out || truncateVisual(text, maxUnits)
}

export function isGenericGenerationTitle(title: string): boolean {
  let value = stripDecorations(title)
  if (GENERIC_TITLES.has(value)) return true
  let stripped = false
  // 链可以重复多层：image的输出1的输出2-01。
  for (let i = 0; i < 20; i += 1) {
    const next = value.replace(AUTO_OUTPUT_SUFFIX, '').trim()
    if (next === value) break
    value = next
    stripped = true
  }
  return stripped && GENERIC_TITLES.has(value)
}

/**
 * 从上传文件名提取主体。
 *
 * 只保留真正能认出内容的文件名；`IMG_9134`、`截图`、纯 hash 等泛化名返回空串，
 * 让调用方继续看提示词，而不是把一个无意义的文件名放到画布上。
 */
export function titleStemFromMaterial(name: string | undefined): string {
  const raw = (name ?? '').trim()
  if (!raw) return ''
  const basename = raw.split(/[\\/]/u).pop() ?? raw
  const dot = basename.lastIndexOf('.')
  const ext = dot >= 0 ? basename.slice(dot + 1).toLocaleLowerCase() : ''
  let stem = KNOWN_EXTENSIONS.has(ext) ? basename.slice(0, dot) : basename
  if (!stem || HASH_ONLY.test(stem) || isGenericGenerationTitle(stem)) return ''
  stem = stem
    .replace(/[_-]+/gu, ' ')
    .replace(TRAILING_COPY_SUFFIX, '')
    .replace(/^\s+|\s+$/gu, '')
    .replace(/\s+/gu, ' ')
  if (!stem || GENERIC_MATERIAL.test(stem)) return ''
  return truncateVisual(stripDecorations(stem), 18)
}

function refocusEnglishRequest(value: string): string {
  const match = value.match(
    /\b(?:image|photo|picture|illustration|render|description)\s+(?:of|for)\s+(?:an?\s+|the\s+)?(.+)$/i,
  )
  return match?.[1]?.trim() || value
}

/**
 * 从提示词首句提取短标题。
 *
 * 会跳过「高清 / 纯色背景 / 4K」这类不构成主体描述的首句，并优先取第一段
 * 有内容的从句。规则仍是确定性的，不做语义总结。
 */
export function titleStemFromPrompt(prompt: string, mode: 'image' | 'video'): string {
  const normalized = prompt
    .replace(/\r\n?/g, '\n')
    .replace(/@\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  if (!normalized) return mode === 'video' ? '视频' : '图片'

  const firstSentence =
    normalized.split(/[\n。！？!?；;]/u).find((part) => part.trim())?.trim() ?? normalized
  const clauses = firstSentence
    .split(/[，,]/u)
    .map((part) => part.trim())
    .filter(Boolean)
  const picked =
    clauses.find((part) => !WEAK_FIRST_CLAUSE.test(part) && !SEQUENCE_ONLY_CLAUSE.test(part)) ??
    clauses[0] ??
    firstSentence

  const cleaned = stripDecorations(
    refocusEnglishRequest(
      picked
      .replace(LEADING_COMMAND, '')
      .replace(LEADING_ENGLISH_COMMAND, '')
      .replace(LEADING_ARTICLE, '')
      .replace(LEADING_LABEL, '')
      .replace(/^(?:拍摄|展示|呈现|描绘|表达)\s*/u, '')
      .replace(/^[：:]\s*/u, '')
      .replace(/\s*(?:--ar|--style|--v)\s+\S+.*$/iu, ''),
    ),
  )
  if (!cleaned) return mode === 'video' ? '视频' : '图片'
  const truncated = truncateTitleText(cleaned, 18)
  return trimTruncatedConnector(cleaned, truncated) || (mode === 'video' ? '视频' : '图片')
}

function compactPresetName(name: string | undefined): string {
  const value = normalizeSpaces(name ?? '').replace(/[—–]/gu, ' ')
  if (!value) return ''
  return PRESET_LABELS[value] ?? truncateVisual(value, 12)
}

function appendPart(base: string, part: string): string {
  if (!part) return base
  if (normalizedKey(base).includes(normalizedKey(part))) return base
  return `${base}-${part}`
}

function formatSequence(index: number): string {
  return String(index + 1).padStart(2, '0')
}

function nextAvailableTitle(base: string, startOrdinal: number, existing: Set<string>): string {
  let ordinal = startOrdinal
  while (existing.has(normalizedKey(`${base}-${formatSequence(ordinal - 1)}`))) {
    ordinal += 1
  }
  return `${base}-${formatSequence(ordinal - 1)}`
}

/**
 * 最终节点标题。
 *
 * 标题优先级：
 * 1. 用户已有的明确标题
 * 2. 素材文件名
 * 3. 业务用途 / 预设
 * 4. 提示词首段
 * 5. 图片 / 视频
 *
 * 多张结果使用 `-01`、`-02`；重名时顺延到下一个未占用序号。
 */
export function generatedNodeTitle(input: GeneratedNodeTitleInput): string {
  const manual =
    input.slotKind === 'reuse'
      ? input.targetTitle.trim()
      : input.sourceTitle.trim()
  const hasManual = !!manual && !isGenericGenerationTitle(manual)

  let base = stripDecorations(manual)
  if (!hasManual) {
    const material = titleStemFromMaterial(input.materialTitle)
    const prompt = titleStemFromPrompt(input.prompt, input.mode)
    base = material || prompt || (input.mode === 'video' ? '视频' : '图片')

    const purpose = compactPresetName(input.usageLabel || input.presetName)
    if (purpose) base = appendPart(base, purpose)
    if (input.mode === 'video' && !/(?:视频|video)/iu.test(base)) {
      base = appendPart(base, '视频')
    }
  }

  base = truncateVisual(normalizeSpaces(base), 24) || (input.mode === 'video' ? '视频' : '图片')
  const existing = new Set((input.existingTitles ?? []).map(normalizedKey))

  if (input.total > 1) {
    return nextAvailableTitle(base, input.index + 1, existing)
  }
  if (!existing.has(normalizedKey(base))) return base
  return nextAvailableTitle(base, 2, existing)
}

export interface LegacyTitleMigration {
  nodes: NodeSnapshot[]
  updates: { id: string; title: string }[]
}

/**
 * 修复旧版本已经落库的链式默认名。
 *
 * 只处理「有产物 + 标题被现规则认定为系统默认名 + 能从 prompt / preset 得出内容名」
 * 的生成节点。用户手动名、空生成节点、没有可用语义的节点一律不动。同 prompt 的
 * 一批结果会按 `-01/-02` 成组重命名。
 */
export function migrateLegacyGeneratedTitles(
  nodes: readonly NodeSnapshot[],
): LegacyTitleMigration {
  const dataOf = (node: NodeSnapshot): GenerationData | null =>
    node.type === 'generation'
      ? (node.data as GenerationData)
      : null
  const hasMeaning = (node: NodeSnapshot): boolean => {
    const data = dataOf(node)
    if (!data || !isGenericGenerationTitle(node.title)) return false
    return !!data.prompt?.trim() || !!presetById(data.preset)?.name
  }
  const withAsset = (node: NodeSnapshot): boolean =>
    hasMeaning(node) && !!dataOf(node)?.assetHash

  const groupCounts = new Map<string, number>()
  for (const node of nodes) {
    if (!withAsset(node)) continue
    const data = dataOf(node)!
    const prompt = typeof data.prompt === 'string' ? data.prompt : ''
    const key = `${data.mode}|${prompt.trim()}|${data.preset ?? ''}`
    groupCounts.set(key, (groupCounts.get(key) ?? 0) + 1)
  }

  const existingTitles = new Set(
    nodes.filter((node) => !hasMeaning(node)).map((node) => node.title),
  )
  const groupSeen = new Map<string, number>()
  const updates: { id: string; title: string }[] = []
  const nextNodes = nodes.map((node) => {
    if (!hasMeaning(node)) return node
    const data = dataOf(node)!
    const prompt = typeof data.prompt === 'string' ? data.prompt : ''
    const key = `${data.mode}|${prompt.trim()}|${data.preset ?? ''}`
    const index = withAsset(node) ? (groupSeen.get(key) ?? 0) : 0
    if (withAsset(node)) groupSeen.set(key, index + 1)
    const title = generatedNodeTitle({
      prompt,
      mode: data.mode,
      slotKind: 'reuse',
      sourceTitle: node.title,
      targetTitle: node.title,
      presetName: presetById(data.preset)?.name ?? '',
      existingTitles: [...existingTitles],
      index,
      total: withAsset(node) ? (groupCounts.get(key) ?? 1) : 1,
    })
    existingTitles.add(title)
    if (title === node.title) return node
    updates.push({ id: node.id, title })
    return { ...node, title }
  })

  return { nodes: nextNodes, updates }
}
