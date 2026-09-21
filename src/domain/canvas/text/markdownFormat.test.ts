/**
 * 提示词正文 Markdown 格式化的单测（产品文档 §6.7，用户 2026-09-21）。
 *
 * 这些变换直接决定「点按钮之后文本变成什么」，而它的正确性没法靠肉眼看
 * ——点一次 H2 再点一次 H3，到底是替换还是叠加，截图上看不出来。
 * 故规则收在纯函数里，由这里钉住；视图层只负责读写光标。
 */
import { describe, it, expect } from 'vitest'
import { applyInlineFormat, applyLineFormat, insertDivider, linePrefixOf } from './markdownFormat'

describe('applyLineFormat · 标题与正文', () => {
  it('正文 → H1：行首加 `# `', () => {
    const r = applyLineFormat('一只猫', 0, 0, 'h1')
    expect(r.text).toBe('# 一只猫')
  })

  it('H1 → H2 是**替换**不是叠加（否则会出现 `# ## 猫`）', () => {
    const r = applyLineFormat('# 一只猫', 0, 0, 'h2')
    expect(r.text).toBe('## 一只猫')
  })

  it('H3 → 正文：前缀被摘干净', () => {
    const r = applyLineFormat('### 一只猫', 3, 3, 'paragraph')
    expect(r.text).toBe('一只猫')
  })

  it('★ 幂等：对已是该格式的行再点一次，结果不变', () => {
    const once = applyLineFormat('一只猫', 0, 0, 'h2')
    const twice = applyLineFormat(once.text, once.start, once.end, 'h2')
    expect(twice.text).toBe('## 一只猫')
  })

  it('列表前缀也能被标题替换（`- ` → `## `）', () => {
    expect(applyLineFormat('- 猫', 0, 0, 'h2').text).toBe('## 猫')
  })

  it('有序列表前缀能被正文摘掉', () => {
    expect(applyLineFormat('1. 猫', 0, 0, 'paragraph').text).toBe('猫')
  })

  it('★ 跨行选区：三行一起变标题', () => {
    const text = '一\n二\n三\n四'
    const r = applyLineFormat(text, 0, 5, 'h1') // 覆盖前三行
    expect(r.text).toBe('# 一\n# 二\n# 三\n四')
  })

  it('只作用光标所在行，不动其它行', () => {
    const text = '一\n二\n三'
    const r = applyLineFormat(text, 2, 2, 'h1') // 光标在「二」
    expect(r.text).toBe('一\n# 二\n三')
  })

  it('空行也能加标题前缀（用户先点 H1 再打字）', () => {
    expect(applyLineFormat('', 0, 0, 'h1').text).toBe('# ')
  })
})

describe('applyLineFormat · 列表', () => {
  it('正文 → 无序列表', () => {
    expect(applyLineFormat('猫', 0, 0, 'bullet').text).toBe('- 猫')
  })

  it('正文 → 有序列表', () => {
    expect(applyLineFormat('猫', 0, 0, 'ordered').text).toBe('1. 猫')
  })

  it('★ 无序 → 有序是替换（不叠加）', () => {
    expect(applyLineFormat('- 猫', 0, 0, 'ordered').text).toBe('1. 猫')
  })

  it('★ 再点一次无序 = 取消（回到正文）', () => {
    // 与常见编辑器一致：同一格式再点一次撤销该格式
    expect(applyLineFormat('- 猫', 0, 0, 'paragraph').text).toBe('猫')
  })
})

describe('applyInlineFormat', () => {
  it('选中文字 → 加粗', () => {
    const r = applyInlineFormat('一只猫', 1, 2, 'bold')
    expect(r.text).toBe('一**只**猫')
  })

  it('选中文字 → 斜体（单星号）', () => {
    const r = applyInlineFormat('一只猫', 1, 2, 'italic')
    expect(r.text).toBe('一*只*猫')
  })

  it('★ 已加粗再点一次 = 取消（两侧标记摘掉）', () => {
    const r = applyInlineFormat('一**只**猫', 3, 4, 'bold')
    expect(r.text).toBe('一只猫')
  })

  it('★ 用户连标记一起选中时，也判定为取消', () => {
    // `一**只**猫` 里 `**只**` 占下标 1..6（不是 1..5）
    const r = applyInlineFormat('一**只**猫', 1, 6, 'bold')
    expect(r.text).toBe('一只猫')
  })

  it('★ 无选区：插入成对标记且光标落在中间（接着打字就是加粗的）', () => {
    const r = applyInlineFormat('一只猫', 1, 1, 'bold')
    expect(r.text).toBe('一****只猫')
    // 光标必须在两个 ** 之间
    expect(r.text.slice(0, r.start)).toBe('一**')
    expect(r.text.slice(r.end)).toBe('**只猫')
    expect(r.start).toBe(r.end)
  })

  it('选区被正确回写（加粗后仍选中「只」）', () => {
    const r = applyInlineFormat('一只猫', 1, 2, 'bold')
    expect(r.text.slice(r.start, r.end)).toBe('只')
  })
})

describe('insertDivider', () => {
  it('光标在行首：直接插入分隔线并换行', () => {
    expect(insertDivider('猫', 0, 0).text).toBe('---\n猫')
  })

  it('光标在行中：先断开再插（不产生 `猫---` 这种中间态）', () => {
    expect(insertDivider('猫', 1, 1).text).toBe('猫\n---\n')
  })

  it('光标停在新行行首（接着能打字）', () => {
    const r = insertDivider('猫', 1, 1)
    expect(r.start).toBe(r.text.length)
  })
})

describe('linePrefixOf', () => {
  it('识别正文 / 标题 / 两种列表', () => {
    expect(linePrefixOf('猫', 1)).toBe('paragraph')
    expect(linePrefixOf('# 猫', 3)).toBe('h1')
    expect(linePrefixOf('## 猫', 4)).toBe('h2')
    expect(linePrefixOf('### 猫', 5)).toBe('h3')
    expect(linePrefixOf('- 猫', 3)).toBe('bullet')
    expect(linePrefixOf('12. 猫', 5)).toBe('ordered')
  })

  it('多行文本里只看光标所在那一行', () => {
    const text = '# 标题\n正文\n## 小标题'
    expect(linePrefixOf(text, 2)).toBe('h1')
    expect(linePrefixOf(text, 6)).toBe('paragraph')
    expect(linePrefixOf(text, 12)).toBe('h2')
  })

  it('光标的行首判定与 applyLineFormat 一致（点 H2 后读出来就是 h2）', () => {
    const r = applyLineFormat('猫', 0, 0, 'h2')
    expect(linePrefixOf(r.text, r.start)).toBe('h2')
  })
})
