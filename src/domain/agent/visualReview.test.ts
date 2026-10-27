import { describe, expect, it } from 'vitest'
import {
  VISUAL_REVIEW_SYSTEM_PROMPT,
  buildVisualReviewPrompt,
  parseVisualReviewText,
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
    expect(prompt).toContain('n1｜主图，2048×2048，image/png')
    expect(prompt).toContain('检查 Logo 和标题错字')
    expect(prompt).toContain('#14532d')
    expect(prompt).toContain('套件参考素材 2 张')
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
})
