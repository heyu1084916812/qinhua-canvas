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
  '先核对品牌、产品、角色、自定义套件中的标志、结构、身份、颜色、字体和参考素材，',
  '再检查文字可读性、错字、裁切、构图、清晰度、明显瑕疵与同一套图的视觉一致性。',
  '不要用“感觉不好看”作为结论；每个问题都要指出画面证据和可执行修改建议。',
  '无法确认的内容必须写进 limitations，不能猜。',
  '只输出一个 JSON 对象，不要 Markdown、代码围栏或额外说明。',
  'JSON 形状：',
  '{"verdict":"pass|needs_changes|unreviewable","summary":"一句话结论",',
  '"issues":[{"severity":"blocking|warning|suggestion",',
  '"category":"brand|product|role|text|layout|quality|consistency|other",',
  '"nodeId":"可选的目标节点 id","problem":"看到的具体问题",',
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
  checklist?: string
  context?: string
  referenceAssetCount?: number
}): string {
  const lines = [
    '## 本次验收目标',
    `目标图片 ${input.targets.length} 张，套件参考素材 ${Math.max(0, input.referenceAssetCount ?? 0)} 张。`,
    ...input.targets.map((target) => {
      const name = target.title?.trim() || target.nodeId
      const size =
        target.width && target.height ? `，${target.width}×${target.height}` : ''
      const mime = target.mime ? `，${target.mime}` : ''
      return `- ${target.nodeId}｜${name}${size}${mime}`
    }),
    '',
    '请把随消息附上的目标图片作为被验收作品；套件参考素材用于核对品牌、产品结构、角色身份和视觉规范。',
  ]
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

export function parseVisualReviewText(
  rawText: string,
  targetNodeIds: readonly string[] = [],
): VisualReviewResult {
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
      const nodeId = textOf(row.nodeId, 200)
      return [
        {
          severity: severityOf(row.severity),
          category: categoryOf(row.category),
          ...(nodeId && (allowedTargets.size === 0 || allowedTargets.has(nodeId))
            ? { nodeId }
            : {}),
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
