import { describe, expect, it } from 'vitest'
import {
  FONT_COUNT_MAX,
  FONT_SIZE_MAX,
  canAddFont,
  defaultFontName,
  describeFontError,
  extOf,
  fontFaceRule,
  fontFamilyOf,
  fontStackFor,
  validateFontFile,
  type UserFont,
} from './fonts'

/**
 * 自定义字体（用户 2026-10-09）。
 *
 * 这一层是纯函数，所以断言都钉在**具体规则**上，而不是"能跑"：
 * 格式认出几种、超限怎么报、字族名怎么消毒、缺字怎么回落。
 */
describe('自定义字体 · 纯逻辑', () => {
  it('★ 扩展名按最后一段取，大小写都认', () => {
    expect(extOf('Inter-Regular.ttf')).toBe('ttf')
    expect(extOf('SourceHanSans.OTF')).toBe('otf')
    expect(extOf('pingfang.woff2')).toBe('woff2')
    expect(extOf('no-extension')).toBe('')
  })

  it('★ 四种格式放行，其他一律拦下并说清支持哪些', () => {
    for (const ext of ['ttf', 'otf', 'woff', 'woff2']) {
      expect(validateFontFile({ name: `f.${ext}`, size: 1024 })).toEqual({ ok: true, format: ext })
    }
    const bad = validateFontFile({ name: 'font.ttc', size: 1024 })
    expect(bad.ok).toBe(false)
    if (!bad.ok) {
      expect(bad.error.kind).toBe('unsupported')
      expect(describeFontError(bad.error)).toContain('.ttc')
      expect(describeFontError(bad.error)).toContain('woff2')
    }
  })

  it('★★ 空文件与超大文件各给可行动的报错（不说"不支持的文件"）', () => {
    const empty = validateFontFile({ name: 'a.ttf', size: 0 })
    expect(empty.ok).toBe(false)
    if (!empty.ok) {
      expect(empty.error.kind).toBe('empty')
      expect(describeFontError(empty.error)).toContain('空的')
    }

    const big = validateFontFile({ name: 'a.ttf', size: FONT_SIZE_MAX + 1 })
    expect(big.ok).toBe(false)
    if (!big.ok) {
      expect(big.error.kind).toBe('too-large')
      // 报错要说清"多大 / 上限多少"，否则用户不知道该删什么
      expect(describeFontError(big.error)).toMatch(/\d+\.\d+MB/)
      expect(describeFontError(big.error)).toContain('上限')
    }
  })

  it('★ 边界值：正好等于上限要放行（不能把刚好合规的字体拦掉）', () => {
    expect(validateFontFile({ name: 'a.ttf', size: FONT_SIZE_MAX }).ok).toBe(true)
  })

  it('★★ 内部字族名绝不采用用户输入（防样式表注入）', () => {
    expect(fontFamilyOf('abc123')).toBe('qh-font-abc123')
    // 只保留字母数字与短横线：引号、分号、大括号、空格全部剔除
    expect(fontFamilyOf("a'; } body{display:none}")).toBe('qh-font-abodydisplaynone')
    expect(fontFamilyOf('中文名字')).toBe('qh-font-unknown')
  })

  it('★ @font-face 规则带 font-display:swap 与全字重范围', () => {
    const font: UserFont = {
      id: 'f1',
      name: '思源黑体',
      family: 'qh-font-f1',
      format: 'woff2',
      size: 1000,
      createdAt: 1,
    }
    const css = fontFaceRule(font, 'blob:http://localhost/abc')
    expect(css).toContain("@font-face{font-family:'qh-font-f1'")
    expect(css).toContain("format('woff2')")
    expect(css).toContain('font-display:swap')
    expect(css).toContain('font-weight:100 900')
  })

  it('★★ 自定义字族永远排在系统栈前面（缺字自动回落，不会整屏方块）', () => {
    const fonts: UserFont[] = [
      { id: 'f1', name: 'X', family: 'qh-font-f1', format: 'ttf', size: 1, createdAt: 1 },
    ]
    const stack = fontStackFor({ kind: 'custom', fontId: 'f1' }, fonts)
    expect(stack.startsWith("'qh-font-f1'")).toBe(true)
    expect(stack).toContain('sans-serif') // 系统栈兜底还在
  })

  it('★ 字体被删掉后选择回落系统字体（不留一个指不到的引用）', () => {
    expect(fontStackFor({ kind: 'custom', fontId: 'gone' }, [])).not.toContain('qh-font-')
    expect(fontStackFor({ kind: 'system' }, [])).toContain('Segoe UI Variable')
  })

  it('★ 上限保护与默认显示名', () => {
    expect(canAddFont(FONT_COUNT_MAX - 1)).toBe(true)
    expect(canAddFont(FONT_COUNT_MAX)).toBe(false)
    expect(defaultFontName('Source Han Sans.otf')).toBe('Source Han Sans')
    expect(defaultFontName('.ttf')).toBe('自定义字体')
  })
})
