/**
 * 普通画布生成节点的默认标题。
 *
 * Agent 建的节点由模型直接给 title；普通画布没有这一步，过去只能一直叫「生成」。
 * 这里用本地纯函数从提示词首句提取一个短标题，不额外调用模型，因此不会增加
 * 请求费用或等待时间。
 */

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
])

/** 承载节点的旧自动名：「生成的输出1」「提示词的输出2」「结果 3」等。 */
const GENERIC_OUTPUT = /^(?:生成|图片生成|视频生成|批量生成|批量出图|生成（套图）|图生图|底图|图片|视频|提示词|结果)(?:的输出)?\s*\d*$/

const LEADING_COMMAND =
  /^(?:(?:请|麻烦)\s*)?(?:(?:帮我|帮忙)\s*)?(?:生成|绘制|画|制作|创建|设计)(?:一张|一幅|一个|一段|一组|张|幅|个|段|组)?\s*[：:，,\s]*/u

const LEADING_ARTICLE = /^(?:一张|一幅|一个|一段|一组|张|幅|个|段|组)\s*/u

export interface GeneratedNodeTitleInput {
  prompt: string
  mode: 'image' | 'video'
  /** new = 另建承载节点；reuse = 写回已有空节点 */
  slotKind: 'new' | 'reuse'
  sourceTitle: string
  /** reuse 时的真实落点标题；new 时是计划生成的承载节点标题 */
  targetTitle: string
  /** 同一来源节点内的第几张，从 0 开始 */
  index: number
  total: number
}

export function isGenericGenerationTitle(title: string): boolean {
  const value = title.trim()
  return GENERIC_TITLES.has(value) || GENERIC_OUTPUT.test(value)
}

/**
 * 从提示词首句提取短标题。
 *
 * 规则刻意保守：只处理用户最常写的前缀，不做“语义总结”。真正的语义摘要需要
 * 额外调用 LLM 或本地模型，对一个只用于显示的名字来说成本和延迟都不值得。
 */
export function titleStemFromPrompt(prompt: string, mode: 'image' | 'video'): string {
  const first = prompt
    .replace(/\r\n?/g, '\n')
    .split(/[\n。！？!?；;]/u)[0]
    ?.trim()
    .replace(LEADING_COMMAND, '')
    .replace(LEADING_ARTICLE, '')
    .replace(/^[“"'「『（(【[]+\s*/u, '')
    .replace(/\s*[”"'」』）)】\]]+$/u, '')
    .replace(/\s+/gu, ' ')
    .trim()

  const fallback = mode === 'video' ? '生成视频' : '生成图片'
  if (!first) return fallback

  const chars = Array.from(first)
  return chars.slice(0, 16).join('') || fallback
}

/**
 * 最终节点标题。
 *
 * 优先级：
 * 1. 用户已有的明确标题（不是「生成」这类默认名）
 * 2. 当前输入提示词的首句
 * 3. 「生成图片 / 生成视频」
 *
 * 同一来源一次出多张时追加 `· 1/N`，让画布、素材详情和下载文件名都能对应。
 */
export function generatedNodeTitle(input: GeneratedNodeTitleInput): string {
  const preferred = input.slotKind === 'reuse' ? input.targetTitle : input.sourceTitle
  const base =
    preferred.trim() && !isGenericGenerationTitle(preferred)
      ? preferred.trim()
      : titleStemFromPrompt(input.prompt, input.mode)
  const suffix = input.total > 1 ? ` · ${input.index + 1}/${input.total}` : ''
  return `${base}${suffix}`
}
