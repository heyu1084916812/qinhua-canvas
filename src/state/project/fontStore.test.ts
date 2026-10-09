import { describe, expect, it } from 'vitest'
import { createMemoryStorage } from '../../platform/memory'
import { FONT_COUNT_MAX, FONT_SIZE_MAX } from '../../domain/ui/fonts'
import { createFontStore } from './fontStore'

/**
 * 自定义字体落库（用户 2026-10-09）。
 *
 * 这里钉的是**存储层的边界**：能不能存、能不能原样读回、坏行会不会带崩列表。
 * 界面与 CSS 注入不在这里测（那是 provider / 冒烟的事）。
 */
function bytes(n = 8): ArrayBuffer {
  return new Uint8Array(n).fill(7).buffer
}

describe('自定义字体 · 落库', () => {
  it('★ 存一个字体：元数据与字节都能读回', async () => {
    const store = createFontStore(createMemoryStorage())
    const added = await store.add({ name: 'Source Han Sans.woff2', size: 8, bytes: bytes() })
    expect(added.ok).toBe(true)
    if (!added.ok) return

    expect(added.font.name).toBe('Source Han Sans')
    expect(added.font.format).toBe('woff2')
    expect(added.font.id.startsWith('font')).toBe(true)

    const list = await store.list()
    expect(list).toHaveLength(1)

    const read = await store.readBytes(added.font.id)
    expect(read).not.toBeNull()
    expect(new Uint8Array(read!)[0]).toBe(7)
  })

  it('★★ 校验失败不入库，并给出可读原因（而不是静默失败）', async () => {
    const store = createFontStore(createMemoryStorage())

    const bad = await store.add({ name: 'font.ttc', size: 8, bytes: bytes() })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toContain('.ttc')

    const big = await store.add({ name: 'huge.ttf', size: FONT_SIZE_MAX + 1, bytes: bytes() })
    expect(big.ok).toBe(false)

    // 两次都失败 ⇒ 表里必须是空的（"校验失败却不入库"这条不能只写在注释里）
    expect(await store.list()).toHaveLength(0)
  })

  it('★★ 达到上限后拒绝新增，并说明上限是多少', async () => {
    const store = createFontStore(createMemoryStorage())
    for (let i = 0; i < FONT_COUNT_MAX; i += 1) {
      const r = await store.add({ name: `f${i}.ttf`, size: 8, bytes: bytes() })
      expect(r.ok).toBe(true)
    }
    const over = await store.add({ name: 'extra.ttf', size: 8, bytes: bytes() })
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.reason).toContain(String(FONT_COUNT_MAX))
  })

  it('★ 重命名只改显示名，不动内部字族名（已注册的字体不失效）', async () => {
    const store = createFontStore(createMemoryStorage())
    const added = await store.add({ name: 'Inter.ttf', size: 8, bytes: bytes() })
    if (!added.ok) throw new Error('准备数据失败')
    const familyBefore = added.font.family

    await store.rename(added.font.id, '  我的正文字体  ')
    const list = await store.list()
    expect(list[0]!.name).toBe('我的正文字体')
    expect(list[0]!.family).toBe(familyBefore)
  })

  it('★ 删除后读不到字节（不留半截引用）', async () => {
    const store = createFontStore(createMemoryStorage())
    const added = await store.add({ name: 'A.ttf', size: 8, bytes: bytes() })
    if (!added.ok) throw new Error('准备数据失败')

    await store.remove(added.font.id)
    expect(await store.list()).toHaveLength(0)
    expect(await store.readBytes(added.font.id)).toBeNull()
  })

  it('★★ 坏行被丢弃、不影响其他字体（一条脏数据不能带崩整个列表）', async () => {
    const storage = createMemoryStorage({
      rows: {
        fonts: [
          { id: 'broken', name: '', format: 'ttf', size: 8, createdAt: 1 },
          { id: 'ok', name: '好字体', format: 'ttf', size: 8, createdAt: 2, bytes: bytes() },
        ],
      },
    })
    const store = createFontStore(storage)
    const list = await store.list()
    expect(list).toHaveLength(1)
    expect(list[0]!.id).toBe('ok')
  })

  it('★★ 老行（没有 weight / family / variable）按「常规体 + 按 id 推字族」读回', async () => {
    const storage = createMemoryStorage({
      rows: {
        fonts: [
          /* 这就是升级前存下的行：三个新字段一个都没有 */
          { id: 'legacy', name: '老字体', format: 'ttf', size: 8, createdAt: 1, bytes: bytes() },
        ],
      },
    })
    const list = await createFontStore(storage).list()
    expect(list[0]!.weight).toBe(400)
    expect(list[0]!.family).toBe('qh-font-legacy')
    expect(list[0]!.variable).toBeNull()
  })

  it('★★ 补粗体：同一字族里多一份 700，字族名与常规体完全一致', async () => {
    const store = createFontStore(createMemoryStorage())
    const regular = await store.add({ name: 'Inter-Regular.ttf', size: 8, bytes: bytes() })
    if (!regular.ok) throw new Error('准备数据失败')

    const bold = await store.add({
      name: 'Inter-Bold.ttf',
      size: 8,
      bytes: bytes(),
      weight: 700,
      family: regular.font.family,
    })
    expect(bold.ok).toBe(true)
    if (!bold.ok) return
    expect(bold.font.weight).toBe(700)
    expect(bold.font.family).toBe(regular.font.family)

    const list = await store.list()
    expect(list).toHaveLength(2)
    expect(new Set(list.map((f) => f.family)).size).toBe(1)
  })

  it('★★ 导入时就判定可变字体（含 fvar 的 ttf = 一份文件全字重；woff2 认不出）', async () => {
    const sfnt = (tags: string[]) => {
      const buf = new Uint8Array(12 + tags.length * 16)
      const view = new DataView(buf.buffer)
      view.setUint32(0, 0x00010000)
      view.setUint16(4, tags.length)
      tags.forEach((tag, i) => {
        const off = 12 + i * 16
        for (let k = 0; k < 4; k += 1) view.setUint8(off + k, tag.charCodeAt(k) || 0x20)
      })
      return buf.buffer
    }
    const store = createFontStore(createMemoryStorage())
    const variable = await store.add({ name: 'V.ttf', size: 28, bytes: sfnt(['cmap', 'fvar']) })
    const staticFont = await store.add({ name: 'S.ttf', size: 28, bytes: sfnt(['cmap', 'glyf']) })
    const compressed = await store.add({ name: 'W.woff2', size: 8, bytes: bytes() })
    expect(variable.ok && variable.font.variable).toBe(true)
    expect(staticFont.ok && staticFont.font.variable).toBe(false)
    expect(compressed.ok && compressed.font.variable).toBeNull()
  })

  it('★★ family 里的脏字符不许进 CSS（读回时消毒，空值回落按 id 推）', async () => {
    const storage = createMemoryStorage({
      rows: {
        fonts: [
          {
            id: 'dirty',
            name: '脏字族',
            family: "qh-font-x'; } body{display:none}",
            format: 'ttf',
            size: 8,
            createdAt: 1,
            bytes: bytes(),
          },
        ],
      },
    })
    const list = await createFontStore(storage).list()
    expect(list[0]!.family).not.toContain("'")
    expect(list[0]!.family).not.toContain('{')
    expect(list[0]!.family.startsWith('qh-font-')).toBe(true)
  })
})
