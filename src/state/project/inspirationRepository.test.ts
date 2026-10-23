import { describe, expect, it } from 'vitest'
import type { InspirationSource } from '../../domain/inspiration/sources'
import type { NetworkPort, NetworkResponse, StoragePort } from '../../platform/ports'
import { createInspirationRepository } from './inspirationRepository'

function response(body: unknown): NetworkResponse {
  return {
    status: 200,
    headers: {},
    text: async () => String(body),
    json: async <T>() => body as T,
    arrayBuffer: async () => new ArrayBuffer(0),
  }
}

function fakeStorage(): StoragePort {
  const rows = new Map<string, Record<string, unknown>>()
  return {
    async query(_table: string, filter: Record<string, unknown>) {
      return [...rows.values()].filter((row) =>
        Object.entries(filter).every(([key, value]) => row[key] === value),
      )
    },
    async put(_table: string, row: Record<string, unknown>) {
      rows.set(String(row.id), row)
    },
    async delete(_table: string, id: string) {
      rows.delete(id)
    },
  } as unknown as StoragePort
}

describe('灵感来源聚合刷新', () => {
  it('★ dataUrls 多文件聚合成一个来源，统一去重后只写一份缓存', async () => {
    const source: InspirationSource = {
      id: 'multi',
      name: '多文件来源',
      repo: 'https://github.com/example/multi',
      dataUrl: 'https://cdn.example.com/one.json',
      dataUrls: [
        'https://cdn.example.com/one.json',
        'https://cdn.example.com/two.json',
      ],
      imageBase: '',
      note: '测试',
      format: 'json',
      modelCategory: 'AI 图片',
      kind: 'image',
    }
    const network = {
      async request(req: { url: string }) {
        return response(
          req.url.endsWith('one.json')
            ? [{ id: 1, title: '一', prompt: 'prompt one' }]
            : [{ id: 2, title: '二', prompt: 'prompt two' }],
        )
      },
      async *stream() {},
    } as unknown as NetworkPort
    const repo = createInspirationRepository(fakeStorage(), network)
    const out = await repo.refresh(source, new AbortController().signal)
    expect(out.error).toBeUndefined()
    expect(out.cases.map((item) => item.id)).toEqual(['multi:1', 'multi:2'])
  })

  it('★ text 型官方指南每个文件生成一条可复制案例', async () => {
    const source: InspirationSource = {
      id: 'h3',
      name: 'MiniMax H3 官方提示词',
      repo: 'https://github.com/MiniMax-AI/MiniMax-H3',
      dataUrl: 'https://cdn.example.com/base-en.txt',
      dataUrls: [
        'https://cdn.example.com/base-en.txt',
        'https://cdn.example.com/ref-en.txt',
      ],
      imageBase: '',
      note: '测试',
      format: 'text',
      modelCategory: 'MiniMax H3',
      kind: 'video',
    }
    const network = {
      async request(req: { url: string }) {
        return response(req.url.includes('ref-en') ? 'subject_definitions' : 'overall_soundscape')
      },
      async *stream() {},
    } as unknown as NetworkPort
    const out = await createInspirationRepository(fakeStorage(), network).refresh(
      source,
      new AbortController().signal,
    )
    expect(out.cases).toHaveLength(2)
    expect(out.cases.map((item) => item.title)).toEqual([
      expect.stringContaining('基础与关键帧模式'),
      expect.stringContaining('全参考模式'),
    ])
  })

  it('★ 多分片只有部分成功时保留已取到的案例，同时如实报部分失败', async () => {
    const source: InspirationSource = {
      id: 'partial',
      name: '分片来源',
      repo: 'https://github.com/example/partial',
      dataUrl: 'https://cdn.example.com/good.json',
      dataUrls: [
        'https://cdn.example.com/good.json',
        'https://cdn.example.com/bad.json',
      ],
      imageBase: '',
      note: '测试',
      format: 'json',
      modelCategory: 'AI 图片',
      kind: 'image',
    }
    let nextId = 1
    const network = {
      async request(req: { url: string }) {
        if (req.url.includes('bad')) return { ...response(''), status: 503 }
        return response([{ id: nextId, title: `可读分片 ${nextId}`, prompt: 'prompt' }])
      },
      async *stream() {},
    } as unknown as NetworkPort
    const storage = fakeStorage()
    const repo = createInspirationRepository(storage, network)
    const out = await repo.refresh(
      source,
      new AbortController().signal,
    )
    expect(out.cases.map((item) => item.title)).toEqual(['可读分片 1'])
    expect(out.error).toContain('部分分片加载失败')
    nextId = 2
    const second = await repo.refresh(source, new AbortController().signal)
    expect(second.cases.map((item) => item.title)).toEqual(['可读分片 1', '可读分片 2'])
  })
})
