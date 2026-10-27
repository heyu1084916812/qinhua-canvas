import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT,
  BACKUP_TABLES,
  BACKUP_VERSION,
  bytesToBase64,
  decodeRow,
  parseBackup,
  serializeBackup,
  type BackupRow,
} from './backup'

/**
 * 全库备份（用户 2026-10-09，对账 #378）。
 *
 * 这层是纯函数，所以断言都钉在**数据完整性**上：
 * 存进去什么、读出来还得是什么；坏文件要被拦住并说清原因。
 */
describe('全库备份 · 编解码', () => {
  const assets: BackupRow[] = [
    {
      id: 'aaa',
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3, 255]),
      thumb: new Uint8Array([9, 9]), // 缩略图是本机缓存，不该进备份
    },
  ]
  const projects: BackupRow[] = [{ id: 'p1', name: '项目一', workbench: 'canvas' }]

  it('★★ 往返一致：素材字节原样回来（不是 {"0":1,"1":2} 那种坏形状）', () => {
    const { text, manifest } = serializeBackup(
      { projects, assets },
      { exportedAt: 111, appVersion: '0.1.0' },
    )
    expect(manifest.tables).toEqual({ projects: 1, assets: 1 })

    const parsed = parseBackup(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.manifest.exportedAt).toBe(111)
    expect(parsed.manifest.appVersion).toBe('0.1.0')
    expect(parsed.manifest.tables).toEqual({ projects: 1, assets: 1 })

    const row = parsed.rowsByTable.assets![0]!
    const decoded = decodeRow('assets', row)
    const bytes = decoded.bytes as Uint8Array
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(bytes)).toEqual([1, 2, 3, 255])
    // 缩略图不进备份：它是可重建的本机缓存
    expect(decoded.thumb).toBeUndefined()
  })

  it('★★ 凭据永不进备份（密文跨设备解不开，带出去只会误导用户）', () => {
    // 就算调用方手滑塞了凭据行，也不该出现在文本里（白名单在 serializeBackup 里兜底）
    const sneaky = {
      projects,
      credentials: [{ id: 'c1', secret: 'top-secret' }],
    } as unknown as Parameters<typeof serializeBackup>[0]
    const { text } = serializeBackup(sneaky)
    expect(text).not.toContain('top-secret')
    expect(text).not.toContain('credentials')
  })

  it('★★ 个人记忆、套件版本和项目绑定进入全库备份', () => {
    for (const table of [
      'contextMemories',
      'contextMemoryRevisions',
      'contextKits',
      'contextKitVersions',
      'projectContextBindings',
    ]) {
      expect(BACKUP_TABLES).toContain(table)
    }
    const { manifest } = serializeBackup({
      contextMemories: [{ id: 'm1', text: '偏好留白' }],
      contextKitVersions: [{ id: 'v1', kitId: 'k1', version: 1 }],
      projectContextBindings: [{ id: 'b1', projectId: 'p1', kitId: 'k1', kitVersion: 1 }],
    })
    expect(manifest.tables).toMatchObject({
      contextMemories: 1,
      contextKitVersions: 1,
      projectContextBindings: 1,
    })
  })

  it('★ 字体可选：默认带上，显式关掉就不带', () => {
    const fonts: BackupRow[] = [{ id: 'font1', name: '思源', size: 8 }]
    const withFonts = serializeBackup({ fonts })
    expect(withFonts.manifest.tables.fonts).toBe(1)

    const without = serializeBackup({ fonts }, { includeFonts: false })
    expect(without.manifest.tables.fonts).toBeUndefined()
    expect(without.text).not.toContain('font1')
  })

  it('★ 空表不占位（备份里不留一堆 "xxx":[]）', () => {
    const { manifest, text } = serializeBackup({ projects: [], nodes: [] })
    expect(manifest.tables).toEqual({})
    expect(text).toContain('"tables":{}')
  })

  it('★★ 坏文件被拦住，且每种错误都说清原因', () => {
    const cases: [string, string, string][] = [
      ['{ 不是 JSON', '不是有效的 JSON', 'parse'],
      ['null', '不是一个对象', 'shape'],
      [JSON.stringify({ format: 'other', version: 1, tables: {} }), '不是轻画的备份文件', 'format'],
      [
        JSON.stringify({ format: BACKUP_FORMAT, version: 99, tables: {} }),
        '可能需要更新应用',
        'version',
      ],
      [
        JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, tables: { 未来表: [] } }),
        '不认识的表',
        'unknown-table',
      ],
      [
        JSON.stringify({ format: BACKUP_FORMAT, version: BACKUP_VERSION, tables: { nodes: 'x' } }),
        '不是数组',
        'not-array',
      ],
    ]
    for (const [text, expected, label] of cases) {
      const r = parseBackup(text)
      expect(r.ok, label).toBe(false)
      if (!r.ok) expect(r.error, label).toContain(expected)
    }
  })

  it('★ 单行字节坏掉不让整份备份失败（那一行降级为"素材缺失"）', () => {
    const bad: BackupRow = { id: 'a1', bytesBase64: '这不是 base64!!!' }
    const decoded = decodeRow('assets', bad)
    expect(decoded.id).toBe('a1')
    expect(decoded.bytes).toBeUndefined()
  })

  it('★ base64 编解码自洽（含非 ASCII 字节）', () => {
    const bytes = new Uint8Array([0, 127, 128, 200, 255])
    const text = bytesToBase64(bytes)
    const back = decodeRow('assets', { id: 'x', bytesBase64: text }).bytes as Uint8Array
    expect(Array.from(back)).toEqual([0, 127, 128, 200, 255])
  })
})
