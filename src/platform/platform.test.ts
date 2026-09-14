import { describe, it, expect } from 'vitest'
import { parseSSELine, createLineSplitter } from './sse'
import { createMemoryPlatform } from './memory/index'
import { createPlatform } from './index'
import type { Row } from './ports'

describe('SSE 解析', () => {
  it('解析带类型的 JSON', () => {
    expect(parseSSELine('data: {"type":"delta","text":"你好"}')).toEqual({
      type: 'delta',
      text: '你好',
    })
  })

  it('DONE 结束', () => {
    expect(parseSSELine('data: [DONE]')).toEqual({ type: 'done' })
  })

  it('非 JSON 当作一段 delta', () => {
    expect(parseSSELine('data: 纯文本')).toEqual({ type: 'delta', text: '纯文本' })
  })

  it('忽略空行与非 data 行', () => {
    expect(parseSSELine('')).toBeNull()
    expect(parseSSELine('event: ping')).toBeNull()
  })
})

describe('分行器', () => {
  it('跨 chunk 截断时只吐出完整行', () => {
    const split = createLineSplitter()
    expect(split('data: {"type":"delta","text":"a"}\nda')).toEqual([
      'data: {"type":"delta","text":"a"}',
    ])
    expect(split('ta: {"type":"done"}\n')).toEqual(['data: {"type":"done"}'])
  })
})

describe('内存存储', () => {
  const rows: Row[] = [
    { id: 'n1', projectId: 'p1', type: 'prompt' },
    { id: 'n2', projectId: 'p1', type: 'generation' },
    { id: 'n3', projectId: 'p2', type: 'prompt' },
  ]

  it('写入后可查询，且返回副本', async () => {
    const platform = createMemoryPlatform({ rows: { nodes: rows } })
    const found = await platform.storage.query('nodes', { projectId: 'p1' })
    expect(found.map((r) => r.id)).toEqual(['n1', 'n2'])
    found[0]!.id = 'changed'
    expect((await platform.storage.query('nodes', { id: 'n1' }))[0]!.id).toBe('n1')
  })

  it('bulkPut 与 delete', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.bulkPut('nodes', rows)
    expect(await platform.storage.query('nodes', { projectId: 'p2' })).toHaveLength(1)
    await platform.storage.delete('nodes', 'n3')
    expect(await platform.storage.query('nodes', {})).toHaveLength(2)
  })

  it('transaction 透传返回值', async () => {
    const platform = createMemoryPlatform()
    const out = await platform.storage.transaction(['nodes'], async () => 42)
    expect(out).toBe(42)
  })

  it('容量上报', async () => {
    const platform = createMemoryPlatform({ usage: { used: 10, quota: 100 } })
    expect(await platform.storage.estimateUsage()).toEqual({ used: 10, quota: 100 })
  })
})

describe('内存网络与流式', () => {
  it('request 走注入的 handler', async () => {
    const platform = createMemoryPlatform({
      handler: async () => ({
        status: 200,
        headers: {},
        async text() {
          return '{"ok":true}'
        },
        async json<T>() {
          return { ok: true } as T
        },
        async arrayBuffer() {
          return new ArrayBuffer(0)
        },
      }),
    })
    const res = await platform.network.request({ url: 'http://x' }, new AbortController().signal)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('stream 按行产出，遇 done 停止', async () => {
    const platform = createMemoryPlatform({
      handler: async () => ({
        status: 200,
        headers: {},
        async text() {
          return 'data: {"type":"delta","text":"A"}\ndata: [DONE]\ndata: {"type":"delta","text":"B"}\n'
        },
        async json<T>() {
          return {} as T
        },
        async arrayBuffer() {
          return new ArrayBuffer(0)
        },
      }),
    })
    const chunks = []
    for await (const c of platform.network.stream({ url: 'http://x' }, new AbortController().signal)) {
      chunks.push(c)
    }
    expect(chunks).toEqual([{ type: 'delta', text: 'A' }, { type: 'done' }])
  })

  it('取消后不再产出', async () => {
    const platform = createMemoryPlatform({
      handler: async () => ({
        status: 200,
        headers: {},
        async text() {
          return 'data: {"type":"delta","text":"A"}\ndata: {"type":"delta","text":"B"}\n'
        },
        async json<T>() {
          return {} as T
        },
        async arrayBuffer() {
          return new ArrayBuffer(0)
        },
      }),
    })
    const controller = new AbortController()
    controller.abort()
    const chunks = []
    for await (const c of platform.network.stream({ url: 'http://x' }, controller.signal)) {
      chunks.push(c)
    }
    expect(chunks).toEqual([])
  })
})

describe('凭据端口', () => {
  it('存取往返与掩码', async () => {
    const platform = createMemoryPlatform()
    await platform.credentials.save('ch1', 'sk-1234567890abcdef')
    expect(await platform.credentials.load('ch1')).toBe('sk-1234567890abcdef')
    expect(await platform.credentials.load('missing')).toBeNull()
    expect(platform.credentials.mask('sk-1234567890abcdef')).toBe('sk-1••••cdef')
    await platform.credentials.remove('ch1')
    expect(await platform.credentials.load('ch1')).toBeNull()
  })
})

describe('平台工厂', () => {
  it('memory 运行时给出内存实现', async () => {
    const platform = createPlatform('memory', { rows: { projects: [{ id: 'p1' }] } })
    expect(await platform.storage.query('projects', {})).toHaveLength(1)
  })
})
