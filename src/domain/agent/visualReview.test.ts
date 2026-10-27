import { describe, expect, it } from 'vitest'
import {
  VISUAL_REVIEW_SYSTEM_PROMPT,
  buildVisualReviewPrompt,
  finalizeVisualReviewResult,
  parseVisualReviewText,
  type VisualReviewResult,
} from './visualReview'

describe('视觉验收子代理', () => {
  it('★★ 提示词明确只读，并携带目标、套件约束和用户清单', () => {
    expect(VISUAL_REVIEW_SYSTEM_PROMPT).toContain('不能修改画布')
    expect(VISUAL_REVIEW_SYSTEM_PROMPT).toContain('不能调用生成')
    const prompt = buildVisualReviewPrompt({
      targets: [
        {
          nodeId: 'n1',
          title: '主图',
          width: 2048,
          height: 2048,
          mime: 'image/png',
        },
      ],
      checklist: '检查 Logo 和标题错字',
      context: '【品牌 A v1】主色 #14532d',
      referenceAssetCount: 2,
    })
    expect(prompt).toContain('- 主图，2048×2048，image/png')
    expect(prompt).not.toContain('- n1｜')
    expect(prompt).toContain('检查 Logo 和标题错字')
    expect(prompt).toContain('#14532d')
    expect(prompt).toContain('套件参考素材 2 张')
  })

  it('★★ 未绑定套件时不检查也不提示“套件为 0”', () => {
    const prompt = buildVisualReviewPrompt({
      targets: [{ nodeId: 'n1', title: '海报封面' }],
      referenceAssetCount: 0,
    })
    expect(prompt).toContain('本次没有附品牌、产品、角色或自定义套件参考素材')
    expect(prompt).toContain('不要检查或提及这些套件')
    expect(prompt).not.toContain('套件参考素材 0 张')
    expect(VISUAL_REVIEW_SYSTEM_PROMPT).toContain('不要输出“套件未提供”类限制')
  })

  it('★ 只绑定文本套件时仍按文本规范验收，但不冒充有套件图片', () => {
    const prompt = buildVisualReviewPrompt({
      targets: [{ nodeId: 'n1', title: '海报封面' }],
      referenceAssetCount: 0,
      suiteContextAvailable: true,
    })
    expect(prompt).toContain('项目套件的文本规范')
    expect(prompt).toContain('没有套件图片时不得推断图片级一致性')
    expect(prompt).not.toContain('套件参考素材 0 张')
  })

  it('★★ 解析并规范问题清单，忽略不存在的目标节点和非法枚举', () => {
    const result = parseVisualReviewText(
      '```json\n' +
        JSON.stringify({
          verdict: 'needs_changes',
          summary: '标题需要修改',
          issues: [
            {
              severity: '严重',
              category: '文字',
              nodeId: 'n1',
              problem: '标题有一个错字',
              suggestion: '把“己”改成“已”',
              evidence: '顶部标题第二个字',
            },
            {
              severity: 'unknown',
              category: 'unknown',
              nodeId: 'other-node',
              problem: '边缘被裁切',
              suggestion: '补足安全边距',
            },
          ],
          limitations: ['无法确认小字是否符合平台规范'],
        }) +
        '\n```',
      ['n1'],
    )
    expect(result.ok).toBe(true)
    expect(result.verdict).toBe('needs_changes')
    expect(result.issues[0]).toMatchObject({
      severity: 'blocking',
      category: 'text',
      nodeId: 'n1',
    })
    expect(result.issues[1]).toMatchObject({
      severity: 'warning',
      category: 'other',
    })
    expect(result.issues[1]).not.toHaveProperty('nodeId')
    expect(result.limitations).toEqual(['无法确认小字是否符合平台规范'])
  })

  it('★★ 模型返回目标名称时映射回节点标题，不把内部 id 带回界面', () => {
    const result = parseVisualReviewText(
      JSON.stringify({
        verdict: 'needs_changes',
        summary: '需要调整',
        issues: [
          {
            severity: 'warning',
            category: 'layout',
            target: '作品集封面',
            problem: '标题离边缘过近',
            suggestion: '增加安全边距',
          },
        ],
        limitations: [],
      }),
      [{ nodeId: 'node_hidden_123', title: '作品集封面' }],
    )
    expect(result.issues[0]).toMatchObject({
      nodeId: 'node_hidden_123',
      nodeTitle: '作品集封面',
    })
  })

  it('★ 非 JSON 输出如实判为无法验收，不伪造问题', () => {
    const result = parseVisualReviewText('看起来不错', ['n1'])
    expect(result.ok).toBe(false)
    expect(result.verdict).toBe('unreviewable')
    expect(result.issues).toEqual([])
    expect(result.rawText).toBe('看起来不错')
  })

  it('★ 通过结果可以没有 issues；有问题但没写 verdict 时判为需修改', () => {
    expect(
      parseVisualReviewText('{"verdict":"pass","summary":"通过","issues":[]}').verdict,
    ).toBe('pass')
    expect(
      parseVisualReviewText(
        '{"summary":"有问题","issues":[{"problem":"文字模糊","suggestion":"重新排版"}]}',
      ).verdict,
    ).toBe('needs_changes')
    expect(
      parseVisualReviewText(
        '{"verdict":"pass","summary":"自相矛盾","issues":[{"problem":"Logo 缺失","suggestion":"补 Logo"}]}',
      ).verdict,
    ).toBe('needs_changes')
  })

  it('★★ 未绑定套件时过滤品牌问题后重算 verdict、摘要和内部 id', () => {
    const result: VisualReviewResult = {
      ok: true,
      verdict: 'needs_changes',
      summary: 'node_abc123 缺少品牌库对照',
      issues: [
        {
          severity: 'blocking',
          category: 'brand',
          nodeId: 'node_abc123',
          nodeTitle: '作品集封面',
          problem: 'node_abc123 与品牌库不一致',
          suggestion: '对照品牌库修改',
        },
      ],
      targetNodeIds: ['node_abc123'],
      limitations: ['套件参考素材为 0，无法核对品牌库'],
    }
    const out = finalizeVisualReviewResult(result, {
      suiteContextAvailable: false,
    })
    expect(out.verdict).toBe('pass')
    expect(out.issues).toEqual([])
    expect(out.limitations).toEqual([])
    expect(out.summary).toBe('未发现需要修改的问题')
    expect(
      JSON.stringify({
        summary: out.summary,
        issues: out.issues,
        limitations: out.limitations,
      }),
    ).not.toContain('node_abc123')
  })

  it('★ 有套件时保留品牌问题，但仍清洗用户可见内部 id', () => {
    const result: VisualReviewResult = {
      ok: true,
      verdict: 'needs_changes',
      summary: 'node_abc123 品牌不一致',
      issues: [
        {
          severity: 'warning',
          category: 'brand',
          nodeTitle: '作品集封面',
          problem: 'node_abc123 的红色偏差',
          suggestion: '按品牌色修正',
        },
      ],
      targetNodeIds: ['node_abc123'],
      limitations: [],
    }
    const out = finalizeVisualReviewResult(result, {
      suiteContextAvailable: true,
    })
    expect(out.issues).toHaveLength(1)
    expect(out.summary).toBe('目标图片 品牌不一致')
    expect(out.issues[0]?.problem).toBe('「作品集封面」 的红色偏差')
  })
})
