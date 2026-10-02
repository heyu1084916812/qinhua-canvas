import { describe, it, expect } from 'vitest'
import {
  SKILL_LIMITS,
  parseSkillMarkdown,
  skillGuard,
  validateSkill,
  type Skill,
} from './skill'

/**
 * 技能：md 解析与校验（用户 2026-09-24）。
 *
 * 解析是「导入 md」的入口，也是**唯一**由外部内容驱动的地方 ——
 * 用户随手写的、从别处拷来的文件都会进这里，所以边界最多、最该逐条钉住。
 */

describe('parseSkillMarkdown · 带 frontmatter', () => {
  const md = [
    '---',
    'name: 详情页策划',
    'description: 按母婴产品特性生成详情页结构',
    'inputMode: text',
    'tags: [电商, 策划]',
    '---',
    '你是资深电商详情页策划，请按五段输出。',
  ].join('\n')

  it('★ 读出名称 / 说明 / 输入类型 / 标签，正文不含 frontmatter', () => {
    const r = parseSkillMarkdown(md, 'fallback')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.skill.name).toBe('详情页策划')
    expect(r.skill.description).toBe('按母婴产品特性生成详情页结构')
    expect(r.skill.inputMode).toBe('text')
    expect(r.skill.tags).toEqual(['电商', '策划'])
    expect(r.skill.content).toBe('你是资深电商详情页策划，请按五段输出。')
    // 正文里不该残留 frontmatter 的任何一行
    expect(r.skill.content).not.toContain('name:')
    expect(r.skill.content).not.toContain('---')
  })

  it('inputMode 认 image / any；写别的值退回 text（不报错）', () => {
    for (const [given, want] of [
      ['image', 'image'],
      ['any', 'any'],
      ['图片', 'text'],
    ] as const) {
      const r = parseSkillMarkdown(`---\ninputMode: ${given}\n---\n正文`, 'x')
      expect(r.ok && r.skill.inputMode).toBe(want)
    }
  })

  /**
   * ★ 技能卡的**图片 / 效果位**（用户 2026-10-02：「每个 skill 有图片、效果的展示
   * （可以留空，后期我自己添加）」）。写 `image:` 就带上，不写就不带这个字段
   * （不是空串 —— 「没填」与「填了个空的」在卡片上是同一种呈现，数据上也该是同一种）。
   */
  it('★ image / preview 认作展示图；不写就没这个字段', () => {
    const withImage = parseSkillMarkdown(
      '---\nname: 带图\nimage: https://example.com/a.png\n---\n正文',
      'x',
    )
    expect(withImage.ok && withImage.skill.image).toBe('https://example.com/a.png')
    /** `preview` 是别名：别处拿来的 skill 两种写法都见过 */
    const withPreview = parseSkillMarkdown('---\npreview: https://example.com/b.png\n---\n正文', 'x')
    expect(withPreview.ok && withPreview.skill.image).toBe('https://example.com/b.png')
    const without = parseSkillMarkdown('---\nname: 无图\n---\n正文', 'x')
    expect(without.ok && 'image' in without.skill).toBe(false)
  })

  it('★ Windows 的 CRLF 与 BOM 都能处理（记事本写出来的文件）', () => {
    const crlf = '\uFEFF---\r\nname: 测试\r\n---\r\n正文内容'
    const r = parseSkillMarkdown(crlf, 'x')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.skill.name).toBe('测试')
  })

  it('★ frontmatter 的 description 支持 YAML 折叠块（`>` / `|` 多行）', () => {
    // 外部导入的 SKILL.md 常用折叠块写法，折叠块行首有缩进、不能混进正文
    const folded = [
      '---',
      'name: 创作分镜',
      'description: >',
      '  第一行说明这一份技能是做什么的，',
      '  第二行继续补充触发词与适用范围。',
      'inputMode: any',
      '---',
      '正文第一句。',
    ].join('\n')
    const r = parseSkillMarkdown(folded, 'fallback')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.skill.name).toBe('创作分镜')
    expect(r.skill.description).toContain('第一行说明')
    expect(r.skill.description).toContain('第二行继续补充')
    expect(r.skill.inputMode).toBe('any')
    // 折叠块之后的键值不能被吞掉，正文也不该带上 frontmatter
    expect(r.skill.content).toBe('正文第一句。')
    expect(r.skill.content).not.toContain('description')
    expect(r.skill.content).not.toContain('inputMode')
  })

  it('description 超长时截断到上限（tooltip 不该变成一段文章）', () => {
    const long = 'x'.repeat(SKILL_LIMITS.descriptionMax + 40)
    const r = parseSkillMarkdown(`---\ndescription: ${long}\n---\n正文`, 'x')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.skill.description.length).toBe(SKILL_LIMITS.descriptionMax)
    }
  })
})

describe('parseSkillMarkdown · 不带 frontmatter', () => {
  it('★ 整份文件当正文，文件名当名称（随手写的 md 也能导入）', () => {
    const r = parseSkillMarkdown('# 随便写点什么\n\n正文如下。', '我的技巧')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.skill.name).toBe('我的技巧')
    expect(r.skill.content).toContain('正文如下')
    expect(r.skill.inputMode).toBe('text')
  })

  it('★ frontmatter 之后没内容 → 明确报错（而不是存一个空技能）', () => {
    const r = parseSkillMarkdown('---\nname: 空的\n---\n', 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('正文是空的')
  })

  it('整份文件也是空的 → 报错', () => {
    const r = parseSkillMarkdown('   \n  ', 'x')
    expect(r.ok).toBe(false)
  })

  it('没有 name 时回落到文件名', () => {
    const r = parseSkillMarkdown('---\ndescription: 只有说明\n---\n正文', '来自文件名')
    expect(r.ok && r.skill.name).toBe('来自文件名')
  })

  it('名称超长时截断，而不是整份拒绝（名字长不该让内容作废）', () => {
    const long = 'x'.repeat(50)
    const r = parseSkillMarkdown(`---\nname: ${long}\n---\n正文`, 'y')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.skill.name.length).toBe(SKILL_LIMITS.nameMax)
  })

  it('正文超长 → 报错并说明长度', () => {
    const huge = 'a'.repeat(SKILL_LIMITS.contentMax + 1)
    const r = parseSkillMarkdown(huge, 'x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('超长')
  })
})

describe('validateSkill · 保存前的校验', () => {
  it('名称 / 正文为空都要拦', () => {
    expect(validateSkill({ name: '', content: 'x' })).toContain('名称')
    expect(validateSkill({ name: 'a', content: '   ' })).toContain('正文')
  })

  it('★ 与导入共用同一组上限常量（两处各写一套数字迟早分叉）', () => {
    const longName = 'x'.repeat(SKILL_LIMITS.nameMax + 1)
    expect(validateSkill({ name: longName, content: 'x' })).toContain('名称太长')
    const longDesc = 'x'.repeat(SKILL_LIMITS.descriptionMax + 1)
    expect(validateSkill({ name: 'a', content: 'x', description: longDesc })).toContain('说明太长')
  })

  it('合规时返回 null', () => {
    expect(validateSkill({ name: 'ok', content: '正文' })).toBeNull()
  })
})

describe('skillGuard · 输入不满足时说清缺什么', () => {
  const base: Skill = {
    id: 's1',
    name: '反推',
    description: '',
    content: 'x',
    inputMode: 'image',
    tags: [],
    updatedAt: 0,
  }

  it('★ 需要图片但没图 → 提示去连一个已出图的生成节点（不是笼统的「无法使用」）', () => {
    const msg = skillGuard(base, { text: '有字', imageCount: 0 })
    expect(msg).toContain('需要图片')
    expect(msg).toContain('反推')
  })

  it('需要图片且有图 → 可执行（哪怕一个字都没有）', () => {
    expect(skillGuard(base, { text: '', imageCount: 1 })).toBeNull()
  })

  it('需要文本但没字 → 拦下', () => {
    const t: Skill = { ...base, inputMode: 'text' }
    expect(skillGuard(t, { text: '  ', imageCount: 2 })).toBe('没有可处理的文本')
  })

  it('any：文本或图片有一个就够', () => {
    const a: Skill = { ...base, inputMode: 'any' }
    expect(skillGuard(a, { text: 'x', imageCount: 0 })).toBeNull()
    expect(skillGuard(a, { text: '', imageCount: 1 })).toBeNull()
    expect(skillGuard(a, { text: '', imageCount: 0 })).toContain('需要文本或图片')
  })
})
