import { describe, expect, it } from 'vitest'
import {
  FONT_COUNT_MAX,
  FONT_SIZE_MAX,
  canAddFont,
  detectVariableFont,
  defaultFontName,
  describeFontError,
  extOf,
  fontFaceRule,
  fontFamiliesOf,
  fontFamilyOf,
  fontStackFor,
  sanitizeFamily,
  validateFontFile,
  type UserFont,
} from './fonts'

/** 测试用的字体行：只写关心的字段，其余给一份合法默认 */
function makeFont(over: Partial<UserFont> & { id: string }): UserFont {
  return {
    name: 'X',
    family: fontFamilyOf(over.id),
    format: 'ttf',
    size: 1024,
    createdAt: 1,
    weight: 400,
    variable: false,
    ...over,
  }
}

/** 造一个最小 sfnt（ttf/otf）头：12 字节头 + N 条 16 字节表记录 */
function sfnt(tags: string[], numTables = tags.length): ArrayBuffer {
  const bytes = new Uint8Array(12 + numTables * 16)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x00010000)
  view.setUint16(4, numTables)
  tags.forEach((tag, i) => {
    const off = 12 + i * 16
    for (let k = 0; k < 4; k += 1) view.setUint8(off + k, tag.charCodeAt(k) || 0x20)
  })
  return bytes.buffer
}

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

  it('★★ @font-face 规则：静态字体只声明自己那个字重（谎报全区间 = 标题和正文一样粗）', () => {
    const font = makeFont({ id: 'f1', name: '思源黑体', format: 'woff2' })
    const css = fontFaceRule(font, 'blob:http://localhost/abc')
    expect(css).toContain("@font-face{font-family:'qh-font-f1'")
    expect(css).toContain("format('woff2')")
    expect(css).toContain('font-display:swap')
    expect(css).toContain('font-weight:400')
    expect(css).not.toContain('100 900')
  })

  it('★★ 粗体那一份声明 700；可变字体才声明整段 100–900', () => {
    expect(fontFaceRule(makeFont({ id: 'b1', weight: 700 }), 'blob:x')).toContain('font-weight:700')
    /* 可变字体：一个文件含全部字重，声明区间让浏览器用它的字重轴 */
    expect(fontFaceRule(makeFont({ id: 'v1', variable: true }), 'blob:x')).toContain(
      'font-weight:100 900',
    )
    /* `variable: null`（woff/woff2 认不出）按静态处理，不谎报区间 */
    expect(fontFaceRule(makeFont({ id: 'u1', variable: null }), 'blob:x')).toContain(
      'font-weight:400',
    )
  })

  it('★★ 可变字体判定：只认 ttf/otf 的 fvar 表，压缩格式如实说"认不出"', () => {
    expect(detectVariableFont(sfnt(['cmap', 'fvar', 'glyf']), 'ttf')).toBe(true)
    expect(detectVariableFont(sfnt(['cmap', 'glyf']), 'otf')).toBe(false)
    // woff / woff2 的表是压缩的 ⇒ 不猜，返回 null
    expect(detectVariableFont(sfnt(['fvar']), 'woff2')).toBeNull()
    expect(detectVariableFont(new ArrayBuffer(4), 'ttf')).toBeNull()
    // 表记录数超出文件长度（坏文件）也不许崩
    expect(detectVariableFont(sfnt(['fvar'], 999), 'ttf')).toBeNull()
  })

  it('★★ 字族名读回时要消毒：脏字符剔掉，空值由调用方回落', () => {
    expect(sanitizeFamily('qh-font-abc')).toBe('qh-font-abc')
    expect(sanitizeFamily('abc')).toBe('qh-font-abc')
    expect(sanitizeFamily("f1'; } body{display:none}")).toBe('qh-font-f1bodydisplaynone')
    expect(sanitizeFamily('')).toBeNull()
    expect(sanitizeFamily('中文')).toBeNull()
  })

  it('★★ 按字族分组：常规 + 粗体合成一个"字体"，缺粗体时如实为 null', () => {
    const regular = makeFont({ id: 'r1', family: 'qh-font-team' })
    const bold = makeFont({ id: 'b1', family: 'qh-font-team', weight: 700 })
    const lonely = makeFont({ id: 'l1', family: 'qh-font-lonely' })
    const groups = fontFamiliesOf([bold, regular, lonely])
    expect(groups.map((g) => g.family)).toEqual(['qh-font-team', 'qh-font-lonely'])
    expect(groups[0]?.regular.id).toBe('r1')
    expect(groups[0]?.bold?.id).toBe('b1')
    expect(groups[1]?.bold).toBeNull()
  })

  it('★★ 自定义字族永远排在系统栈前面（缺字自动回落，不会整屏方块）', () => {
    const fonts: UserFont[] = [makeFont({ id: 'f1' })]
    const stack = fontStackFor({ kind: 'custom', fontId: 'f1' }, fonts)
    expect(stack.startsWith("'qh-font-f1'")).toBe(true)
    expect(stack).toContain('sans-serif') // 系统栈兜底还在
  })

  it('★★ 字族名取自记录本身（粗体与常规体共享）—— 选常规体也能拿到粗体', () => {
    const regular = makeFont({ id: 'r9', family: 'qh-font-shared' })
    const bold = makeFont({ id: 'b9', family: 'qh-font-shared', weight: 700 })
    const stack = fontStackFor({ kind: 'custom', fontId: 'r9' }, [regular, bold])
    // 若按 id 现推会得到 'qh-font-r9'，那一份粗体就永远匹配不上
    expect(stack.startsWith("'qh-font-shared'")).toBe(true)
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
