export type VisualReviewVerdict = 'pass' | 'needs_changes' | 'unreviewable'
export type VisualReviewSeverity = 'blocking' | 'warning' | 'suggestion'
export type VisualReviewCategory =
  | 'brand'
  | 'product'
  | 'role'
  | 'text'
  | 'layout'
  | 'quality'
  | 'consistency'
  | 'other'

export interface VisualReviewTarget {
  nodeId: string
  title?: string
  width?: number
  height?: number
  mime?: string
}

export interface VisualReviewIssue {
  severity: VisualReviewSeverity
  category: VisualReviewCategory
  nodeId?: string
  nodeTitle?: string
  problem: string
  suggestion: string
  evidence?: string
}

export interface VisualReviewResult {
  ok: boolean
  verdict: VisualReviewVerdict
  summary: string
  issues: VisualReviewIssue[]
  targetNodeIds: string[]
  referenceAssetCount?: number
  suiteContextAvailable?: boolean
  limitations: string[]
  rawText?: string
}

const SEVERITIES = new Set<VisualReviewSeverity>([
  'blocking',
  'warning',
  'suggestion',
])
const CATEGORIES = new Set<VisualReviewCategory>([
  'brand',
  'product',
  'role',
  'text',
  'layout',
  'quality',
  'consistency',
  'other',
])

export const VISUAL_REVIEW_SYSTEM_PROMPT = [
  '你是轻画的只读视觉验收子代理。',
  '你只能检查随消息附上的图片并输出问题清单，不能修改画布、不能创建或删除节点、',
  '不能调用生成、不能假设已经重新出图。',
  '只有在本次明确附上品牌、产品、角色或自定义套件参考素材时，才按这些参考核对。',
  '没有提供套件上下文或参考素材时，不要检查、推断或提及套件与品牌库，也不要输出“套件未提供”类限制。',
  '每张图对应的生成提示词是本次验收的硬性基准。提示词明确写出的产品结构、材质、',
  '配件和禁止项，不得用你自己的品类假设推翻；角度、反光或分辨率造成的视觉差异，',
  '只有在能排除这些因素时才可判成结构与材质不一致。',
  '有参考素材时核对标志、结构、身份、颜色、字体和参考素材；同时检查文字可读性、',
  '错字、裁切、构图、清晰度、明显瑕疵与同一套图的视觉一致性。',
  '不要用“感觉不好看”作为结论；每个问题都要指出画面证据和可执行修改建议。',
  '无法确认的内容必须写进 limitations，不能猜。',
  '只输出一个 JSON 对象，不要 Markdown、代码围栏或额外说明。',
  'JSON 形状：',
  '{"verdict":"pass|needs_changes|unreviewable","summary":"一句话结论",',
  '"issues":[{"severity":"blocking|warning|suggestion",',
  '"category":"brand|product|role|text|layout|quality|consistency|other",',
  '"target":"目标图片名称（从上表抄）","problem":"看到的具体问题",',
  '"suggestion":"可执行修改建议","evidence":"可选画面证据"}],',
  '"limitations":["无法确认或本次未检查的项目"]}',
].join('\n')

const CATEGORY_ALIASES: Record<string, VisualReviewCategory> = {
  品牌: 'brand',
  产品: 'product',
  角色: 'role',
  文字: 'text',
  文案: 'text',
  排版: 'layout',
  画质: 'quality',
  质量: 'quality',
  一致性: 'consistency',
  统一: 'consistency',
  其他: 'other',
}

const SEVERITY_ALIASES: Record<string, VisualReviewSeverity> = {
  阻塞: 'blocking',
  严重: 'blocking',
  错误: 'blocking',
  警告: 'warning',
  提醒: 'warning',
  建议: 'suggestion',
  优化: 'suggestion',
}

function recordOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function textOf(value: unknown, max = 1_000): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function jsonObjectFrom(text: string): Record<string, unknown> | null {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return recordOf(JSON.parse(trimmed.slice(start, end + 1)))
  } catch {
    return null
  }
}

function normalizeVerdict(value: unknown, issueCount: number): VisualReviewVerdict {
  const raw = textOf(value).toLowerCase()
  if (raw === 'pass' || raw === 'passed' || raw === '通过') {
    return issueCount > 0 ? 'needs_changes' : 'pass'
  }
  if (
    raw === 'needs_changes' ||
    raw === 'needs-changes' ||
    raw === 'fail' ||
    raw === 'failed' ||
    raw === '需修改' ||
    raw === '不通过'
  ) {
    return 'needs_changes'
  }
  if (raw === 'unreviewable' || raw === '无法验收') return 'unreviewable'
  return issueCount > 0 ? 'needs_changes' : 'pass'
}

function severityOf(value: unknown): VisualReviewSeverity {
  const raw = textOf(value).toLowerCase()
  if (SEVERITIES.has(raw as VisualReviewSeverity)) return raw as VisualReviewSeverity
  return SEVERITY_ALIASES[textOf(value)] ?? 'warning'
}

function categoryOf(value: unknown): VisualReviewCategory {
  const raw = textOf(value).toLowerCase()
  if (CATEGORIES.has(raw as VisualReviewCategory)) return raw as VisualReviewCategory
  return CATEGORY_ALIASES[textOf(value)] ?? 'other'
}

export function buildVisualReviewPrompt(input: {
  targets: readonly VisualReviewTarget[]
  targetBriefs?: string
  checklist?: string
  context?: string
  referenceAssetCount?: number
  suiteContextAvailable?: boolean
}): string {
  const referenceAssetCount = Math.max(0, input.referenceAssetCount ?? 0)
  const suiteContextAvailable =
    input.suiteContextAvailable ?? referenceAssetCount > 0
  const lines = [
    '## 本次验收目标',
    `目标图片 ${input.targets.length} 张。`,
    ...input.targets.map((target, index) => {
      const name = target.title?.trim() || `目标图片 ${index + 1}`
      const size =
        target.width && target.height ? `，${target.width}×${target.height}` : ''
      const mime = target.mime ? `，${target.mime}` : ''
      return `- ${name}${size}${mime}`
    }),
    '',
    suiteContextAvailable
      ? referenceAssetCount > 0
        ? `本次附有项目套件参考素材 ${referenceAssetCount} 张，用于核对品牌、产品结构、角色身份和视觉规范。`
        : '本次附有项目套件的文本规范，用于核对品牌、产品结构、角色身份和视觉规范；没有套件图片时不得推断图片级一致性。'
      : '本次没有附品牌、产品、角色或自定义套件参考素材；不要检查或提及这些套件。',
  ]
  const targetBriefs = input.targetBriefs?.trim()
  if (targetBriefs) {
    lines.push(
      '',
      '## 每张图生成时的明确要求（验收硬基准）',
      targetBriefs.slice(0, 16_000),
    )
  }
  const checklist = input.checklist?.trim()
  if (checklist) {
    lines.push('', '## 用户本次验收清单', checklist.slice(0, 4_000))
  }
  const context = input.context?.trim()
  if (context) {
    lines.push('', '## 项目上下文与套件约束', context.slice(0, 12_000))
  }
  lines.push(
    '',
    '## 输出要求',
    '只检查真实可见内容；看不清、被裁掉或不存在的目标写进 limitations。',
    'issues 按 blocking → warning → suggestion 排序。通过时 issues 可为空。',
  )
  return lines.join('\n')
}

export interface VisualReviewPromptGraph {
  nodes: readonly {
    id: string
    title?: string
    data?: unknown
  }[]
  edges: readonly {
    source: string
    target: string
  }[]
}

/**
 * 把目标节点自身的生成提示词、直接上游提示词和关键生成参数整理成验收基准。
 *
 * 视觉模型只收到图片时，很容易拿“常见产品应该怎样”去猜；而实际要求可能明确写了
 * 底部防滑垫、隐藏拉链、可拆洗等结构。这里不替模型判断，只把生成时真实使用过的
 * 约束原样交给它，供逐项核对。
 */
export function visualReviewGenerationBriefs(
  graph: VisualReviewPromptGraph,
  targetNodeIds: readonly string[],
): string {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]))
  const blocks: string[] = []
  for (const [index, nodeId] of [...new Set(targetNodeIds)].entries()) {
    const node = byId.get(nodeId)
    if (!node) continue
    const data = recordOf(node.data)
    const own = [
      textOf(data.prompt, 4_000),
      textOf(data.text, 4_000),
    ].filter(Boolean)
    const upstreamIds = new Set<string>(
      Array.isArray(data.linkedPromptNodeIds)
        ? data.linkedPromptNodeIds.map(String)
        : [],
    )
    for (const edge of graph.edges) {
      if (edge.target === nodeId) upstreamIds.add(edge.source)
    }
    const upstream = [...upstreamIds]
      .map((id) => byId.get(id))
      .flatMap((source) => {
        if (!source) return []
        const sourceData = recordOf(source.data)
        return [textOf(sourceData.text, 4_000), textOf(sourceData.prompt, 4_000)]
          .filter(Boolean)
      })
    const requirements = [...new Set([...own, ...upstream])]
    if (requirements.length === 0) continue
    const params = [
      typeof data.model === 'string' && data.model.trim()
        ? `模型：${data.model.trim()}`
        : '',
      typeof data.ratio === 'string' && data.ratio.trim()
        ? `比例：${data.ratio.trim()}`
        : '',
      typeof data.resolution === 'string' && data.resolution.trim()
        ? `分辨率：${data.resolution.trim()}`
        : '',
    ].filter(Boolean)
    blocks.push(
      [
        `### ${node.title?.trim() || `目标图片 ${index + 1}`}`,
        ...(params.length > 0 ? [params.join('；')] : []),
        '生成要求：',
        ...requirements.map((text) => `- ${text}`),
      ].join('\n'),
    )
  }
  return blocks.join('\n\n').slice(0, 16_000)
}

export function parseVisualReviewText(
  rawText: string,
  targetsOrIds: readonly (string | VisualReviewTarget)[] = [],
): VisualReviewResult {
  const targets: VisualReviewTarget[] = targetsOrIds.map((target, index) =>
    typeof target === 'string'
      ? { nodeId: target, title: `目标图片 ${index + 1}` }
      : {
          ...target,
          ...(target.title?.trim()
            ? { title: target.title.trim() }
            : { title: `目标图片 ${index + 1}` }),
        },
  )
  const targetNodeIds = targets.map((target) => target.nodeId)
  const titleToNodeId = new Map<string, string>()
  const titleById = new Map<string, string>()
  for (const target of targets) {
    const title = target.title?.trim()
    if (!title) continue
    titleById.set(target.nodeId, title)
    if (!titleToNodeId.has(title)) titleToNodeId.set(title, target.nodeId)
  }
  const parsed = jsonObjectFrom(rawText)
  if (!parsed) {
    return {
      ok: false,
      verdict: 'unreviewable',
      summary: '视觉模型没有返回可解析的结构化验收结果',
      issues: [],
      targetNodeIds: [...targetNodeIds],
      limitations: ['模型输出不是约定的 JSON'],
      rawText: rawText.trim().slice(0, 2_000),
    }
  }
  const allowedTargets = new Set(targetNodeIds)
  const issues = (Array.isArray(parsed.issues) ? parsed.issues : [])
    .slice(0, 50)
    .flatMap((value): VisualReviewIssue[] => {
      const row = recordOf(value)
      const problem = textOf(row.problem)
      const suggestion = textOf(row.suggestion)
      if (!problem) return []
      const explicitNodeId = textOf(row.nodeId, 200)
      const targetName =
        textOf(row.target, 200) ||
        textOf(row.targetTitle, 200) ||
        textOf(row.title, 200)
      const nodeId =
        explicitNodeId ||
        (targetName ? titleToNodeId.get(targetName) ?? '' : '')
      const nodeTitle =
        (nodeId ? titleById.get(nodeId) : undefined) || targetName
      return [
        {
          severity: severityOf(row.severity),
          category: categoryOf(row.category),
          ...(nodeId && (allowedTargets.size === 0 || allowedTargets.has(nodeId))
            ? { nodeId }
            : {}),
          ...(nodeTitle ? { nodeTitle: nodeTitle.slice(0, 200) } : {}),
          problem,
          suggestion: suggestion || '请根据问题定位并修正这一处，其他内容保持不动。',
          ...(textOf(row.evidence) ? { evidence: textOf(row.evidence) } : {}),
        },
      ]
    })
    .sort(
      (left, right) =>
        ['blocking', 'warning', 'suggestion'].indexOf(left.severity) -
        ['blocking', 'warning', 'suggestion'].indexOf(right.severity),
    )
  const verdict = normalizeVerdict(parsed.verdict, issues.length)
  const limitations = (Array.isArray(parsed.limitations) ? parsed.limitations : [])
    .map((item) => textOf(item, 500))
    .filter(Boolean)
    .slice(0, 20)
  return {
    ok: verdict !== 'unreviewable',
    verdict,
    summary:
      textOf(parsed.summary, 1_000) ||
      (verdict === 'pass' ? '未发现需要修改的问题' : '发现需要修改的问题'),
    issues,
    targetNodeIds: [...targetNodeIds],
    limitations,
  }
}

function withoutInternalNodeIds(value: string, fallback = '目标图片'): string {
  return value.replace(/node_[a-z0-9_-]+/gi, fallback)
}

/**
 * 把模型原始结果收敛成用户能读、且符合本项目绑定状态的验收结果。
 *
 * 未提供套件上下文时，品牌类问题、套件限制和“套件为 0”的总结都不属于本次
 * 验收范围；如果去掉这些后已经没有问题，verdict 必须同步回到 pass，不能留下
 * “需要修改 + 空问题列表”的矛盾卡。
 */
export function finalizeVisualReviewResult(
  result: VisualReviewResult,
  options: { suiteContextAvailable: boolean },
): VisualReviewResult {
  const suiteContextAvailable = options.suiteContextAvailable
  const issues = (suiteContextAvailable
    ? result.issues
    : result.issues.filter((issue) => issue.category !== 'brand')
  ).map((issue) => {
    const fallback = issue.nodeTitle ? `「${issue.nodeTitle}」` : '目标图片'
    return {
      ...issue,
      problem: withoutInternalNodeIds(issue.problem, fallback),
      suggestion: withoutInternalNodeIds(issue.suggestion, fallback),
      ...(issue.evidence
        ? { evidence: withoutInternalNodeIds(issue.evidence, fallback) }
        : {}),
    }
  })
  const limitations = (suiteContextAvailable
    ? result.limitations
    : result.limitations.filter(
        (item) => !/套件|品牌库|参考素材/.test(item),
      )
  ).map((item) => withoutInternalNodeIds(item))
  const verdict =
    issues.length > 0
      ? 'needs_changes'
      : result.verdict === 'unreviewable'
        ? 'unreviewable'
        : 'pass'
  const rawSummary = withoutInternalNodeIds(result.summary)
  const summary =
    !suiteContextAvailable &&
    /套件|品牌库|参考素材/.test(rawSummary)
      ? verdict === 'pass'
        ? '未发现需要修改的问题'
        : verdict === 'needs_changes'
          ? '发现需要修改的问题'
          : '本次目标图片无法完成验收'
      : rawSummary
  return {
    ...result,
    ok: verdict !== 'unreviewable',
    verdict,
    summary,
    issues,
    limitations,
    suiteContextAvailable,
  }
}
