import { describe, expect, it } from 'vitest'
import {
  DEFAULT_INSPIRATION_SOURCES,
  type InspirationSource,
} from '../../domain/inspiration/sources'
import type { StoragePort } from '../../platform/ports'
import {
  INSPIRATION_SOURCES_KEY,
  loadInspirationSources,
  mergeMissingBuiltinSources,
  type StoredInspirationSource,
} from './inspirationSourceStore'

function stored(source: InspirationSource, enabled = true): StoredInspirationSource {
  return { ...source, enabled }
}

describe('灵感来源迁移', () => {
  it('补齐缺失的图片 / 视频内置来源，同时保留用户已有顺序和开关', () => {
    const existing = stored(DEFAULT_INSPIRATION_SOURCES[0]!, false)
    const merged = mergeMissingBuiltinSources([existing])
    expect(merged[0]).toEqual(existing)
    expect(merged.some((source) => source.id === 'shuixian-prompts')).toBe(true)
    expect(merged.some((source) => source.id === 'minimax-h3-official')).toBe(true)
    expect(new Set(merged.map((source) => source.id)).size).toBe(merged.length)
  })

  it('内置来源配置升级时保留用户开关，但更新数据地址与解析规则', () => {
    const current = DEFAULT_INSPIRATION_SOURCES.find(
      (source) => source.id === 'learnprompt-seedance',
    )!
    const stale = {
      ...stored(current, false),
      dataUrl: 'https://old.example.com/cases.json',
    }
    const merged = mergeMissingBuiltinSources([stale])
    const upgraded = merged.find((source) => source.id === current.id)!
    expect(upgraded.dataUrl).toBe(current.dataUrl)
    expect(upgraded.enabled).toBe(false)
  })

  it('旧版本存储只升级一次；版本写入后不会反复补回用户删掉的来源', async () => {
    let row: Record<string, unknown> = {
      id: INSPIRATION_SOURCES_KEY,
      sources: [stored(DEFAULT_INSPIRATION_SOURCES[0]!)],
      version: 1,
    }
    const storage = {
      async query() {
        return [row]
      },
      async put(_table: string, value: Record<string, unknown>) {
        row = value
      },
    } as unknown as StoragePort

    const first = await loadInspirationSources(storage)
    expect(first.some((source) => source.id === 'shuixian-prompts')).toBe(true)
    expect(row.version).toBe(4)

    row = {
      ...row,
      sources: first.filter((source) => source.id !== 'shuixian-prompts'),
    }
    const second = await loadInspirationSources(storage)
    expect(second.some((source) => source.id === 'shuixian-prompts')).toBe(false)
  })
})
