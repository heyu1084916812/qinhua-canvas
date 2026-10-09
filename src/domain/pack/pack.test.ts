import { describe, expect, it } from 'vitest'
import { PACK_FORMAT, compareVersions, packSummary, parsePack } from './pack'

/**
 * 扩展包解析（对账 #386 阶段一）。
 *
 * 这是**别人发来的文件**进门的第一道关，所以判据写得比较狠：
 * 每条错误都要指到具体位置（第几个技能 / 哪个字段），安全线（不执行代码、不带权限）
 * 一律**拒收**而不是忽略。
 */
const good = {
  format: PACK_FORMAT,
  version: 1,
  id: 'pack.ecommerce-cn',
  displayName: '中文电商套图包',
  publisher: '轻画',
  minAppVersion: '0.1.0',
  contents: {
    skills: [
      {
        id: 'ecommerce-set',
        name: '电商套图',
        description: '一套多张',
        content: '## 怎么出图\n按主图/场景/细节排。',
        inputMode: 'any',
        tags: ['电商'],
      },
    ],
    ecommercePlatforms: [
      {
        id: 'pdd',
        name: '拼多多',
        group: 'china',
        ratios: ['1:1'],
        languages: ['zh-CN'],
        countHint: '主图 1 张',
        rules: '主图白底、产品居中。',
        updatedAt: '2026-10-09',
        sourceNote: '通用建议：未核实官方规则，按常见做法整理',
      },
    ],
  },
  permissions: [],
}

describe('扩展包解析与校验', () => {
  it('★ 合法包：解析通过，内容一份不少', () => {
    const r = parsePack(good, { appVersion: '0.1.0' })
    expect(r.ok).toBe(true)
    expect(r.pack?.id).toBe('pack.ecommerce-cn')
    expect(r.pack?.contents.skills).toHaveLength(1)
    expect(r.pack?.contents.ecommercePlatforms[0]?.name).toBe('拼多多')
    expect(r.pack?.permissions).toEqual([])
  })

  it('★★ 摘要说清"装进来是什么"（安装前先看这一句）', () => {
    const r = parsePack(good)
    expect(packSummary(r.pack!)).toBe(
      '中文电商套图包：1 个技能 + 1 条电商平台规则，来自 轻画。纯数据包，不执行任何代码。',
    )
  })

  it('★★ 安全线：带权限声明 / 带代码字段的包一律拒收（不是忽略）', () => {
    const withPerm = parsePack({ ...good, permissions: ['fs'] })
    expect(withPerm.ok).toBe(false)
    expect(withPerm.errors.join()).toContain('不允许声明权限')

    for (const key of ['code', 'main', 'entry', 'script', 'runtime']) {
      const r = parsePack({ ...good, [key]: 'alert(1)' })
      expect(r.ok, key).toBe(false)
      expect(r.errors.join()).toContain(key)
    }
  })

  it('★ 格式 / 版本 / id / 名字不对时逐条报错', () => {
    expect(parsePack({ ...good, format: 'other.pack' }).errors.join()).toContain('format')
    expect(parsePack({ ...good, version: 2 }).errors.join()).toContain('先升级应用')
    expect(parsePack({ ...good, id: 'PACK_Ecommerce' }).errors.join()).toContain('id 不合法')
    expect(parsePack({ ...good, displayName: '  ' }).errors.join()).toContain('displayName')
    expect(parsePack('不是对象').ok).toBe(false)
  })

  it('★ minAppVersion 高于当前版本 ⇒ 说明要先升级；相等 / 更低 ⇒ 通过', () => {
    const high = parsePack({ ...good, minAppVersion: '9.9.9' }, { appVersion: '0.1.0' })
    expect(high.ok).toBe(false)
    expect(high.errors.join()).toContain('需要轻画 9.9.9')
    expect(parsePack({ ...good, minAppVersion: '0.1.0' }, { appVersion: '0.1.0' }).ok).toBe(true)
    expect(parsePack({ ...good, minAppVersion: '0.0.9' }, { appVersion: '0.1.0' }).ok).toBe(true)
    // 不给 appVersion 就不校验这一条（领域层不认识"当前版本"）
    expect(parsePack({ ...good, minAppVersion: '9.9.9' }).ok).toBe(true)
  })

  it('★ 技能缺字段 / 超限时指到第几个', () => {
    const bad = parsePack({
      ...good,
      contents: { ...good.contents, skills: [{ id: 'ok-id', name: '名字' }, { id: 'x' }] },
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join()).toContain('contents.skills[0].content')
    expect(bad.errors.join()).toContain('contents.skills[1].id')
  })

  it('★ 平台规则缺"更新时间 / 来源"时拒收（规则会过期，必须能看见它什么时候写的）', () => {
    const noDate = parsePack({
      ...good,
      contents: { ...good.contents, ecommercePlatforms: [{ ...good.contents.ecommercePlatforms[0], updatedAt: '去年' }] },
    })
    expect(noDate.ok).toBe(false)
    expect(noDate.errors.join()).toContain('YYYY-MM-DD')

    const noSource = parsePack({
      ...good,
      contents: { ...good.contents, ecommercePlatforms: [{ ...good.contents.ecommercePlatforms[0], sourceNote: '' }] },
    })
    expect(noSource.ok).toBe(false)
    expect(noSource.errors.join()).toContain('sourceNote')
  })

  it('★ 空包拒收（不让人装一个"什么都没有"的包）', () => {
    const empty = parsePack({ ...good, contents: { skills: [], ecommercePlatforms: [] } })
    expect(empty.ok).toBe(false)
    expect(empty.errors.join()).toContain('空的')
  })

  it('版本比较：按段比大小，不认识的两串退化成字典序', () => {
    expect(compareVersions('0.2.0', '0.1.9')).toBeGreaterThan(0)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('0.0.9', '0.1.0')).toBeLessThan(0)
    expect(compareVersions('a', 'b')).toBeLessThan(0)
  })
})
