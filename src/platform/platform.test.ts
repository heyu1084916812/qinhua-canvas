import { describe, it, expect } from 'vitest'
import { parseSSELine, createLineSplitter } from './sse'
import { createMemoryPlatform } from './memory/index'
import { createPlatform } from './index'
import { createWebPlatform } from './web/index'
import type { NotifyPort, RemoteBytesPort, Row, StorageAdminPort } from './ports'

/**
 * **可选端口的"转出去"**（2026-10-08 真机探针抓到的真缺陷）。
 *
 * `createWebPlatform` 的入参里写着 `storageAdmin`，但返回的对象**漏了这一行** ——
 * 于是桌面壳里 `platform.storageAdmin` 永远是 undefined：「存储 → 数据目录 / 网页缓存」
 * 两块在应用里也显示"仅在桌面应用可用"，用户根本看不到「打开数据目录」「清理网页缓存」。
 * 浏览器冒烟测不出它（浏览器里"没有这一项"本来就是对的），只有桌面壳探针会红。
 *
 * ⇒ 这一组钉住"**传进去的必须在返回的 kit 上找得到**"：少一行、或以后新增端口又忘了转，
 * 这里立刻红，不必等真机。
 */
describe('平台装配：可选端口必须真的转到 PlatformKit 上', () => {
  const admin: StorageAdminPort = {
    dataDir: async () => 'C:/data',
    openDir: async () => {},
    cacheUsage: async () => 0,
    clearCache: async () => 0,
  }

  /**
   * 单测跑在 node 环境里，没有 `localStorage`，而装配层要用它（凭据端口的默认落点）。
   * 这不是被测行为，所以给一个最小替身，用完还原。
   */
  const withLocalStorage = <T>(fn: () => T): T => {
    const bag = new Map<string, string>()
    const stub = {
      getItem: (k: string) => bag.get(k) ?? null,
      setItem: (k: string, v: string) => void bag.set(k, v),
      removeItem: (k: string) => void bag.delete(k),
    }
    const host = globalThis as unknown as { localStorage?: unknown }
    const prev = host.localStorage
    host.localStorage = stub
    try {
      return fn()
    } finally {
      host.localStorage = prev
    }
  }

  it('壳传了 storageAdmin ⇒ kit.storageAdmin 就是它（漏转 = 桌面版永远显示"仅在桌面应用可用"）', () => {
    const kit = withLocalStorage(() => createWebPlatform({ storageAdmin: admin }))
    expect(kit.storageAdmin).toBe(admin)
  })

  it('没传就是"没有这一项"（浏览器那一档照旧）', () => {
    const kit = withLocalStorage(() => createWebPlatform())
    expect(kit.storageAdmin).toBeUndefined()
    expect(kit.cli).toBeUndefined()
    expect(kit.updater).toBeUndefined()
    expect(kit.remoteBytes).toBeUndefined()
  })

  /**
   * 对账 #396：抓站点图标靠这一项。漏转的话**桌面版也会显示"从网站抓取"是灰的**，
   * 而浏览器里本来就该灰着 —— 这条差异只有壳能发现，所以钉在这儿。
   */
  it('壳传了 remoteBytes ⇒ kit.remoteBytes 就是它', () => {
    const port: RemoteBytesPort = {
      get: async () => ({ status: 200, contentType: 'image/png', bytes: new Uint8Array() }),
    }
    const kit = withLocalStorage(() => createWebPlatform({ remoteBytes: port }))
    expect(kit.remoteBytes).toBe(port)
  })

  /**
   * 对账 #392：系统通知也走同一条"可选端口"的路子 —— 壳里传官方通知插件，
   * 浏览器里没有（调用方退回页面自带的 `Notification`）。漏转的后果同样是
   * **壳里永远显示"没有系统通知能力"**，而浏览器冒烟测不出来（那里本来就该没有）。
   */
  it('壳传了 notify ⇒ kit.notify 就是它；没传就是"没有这一项"', () => {
    const port: NotifyPort = {
      state: async () => 'granted',
      request: async () => 'granted',
      send: async () => true,
    }
    const kit = withLocalStorage(() => createWebPlatform({ notify: port }))
    expect(kit.notify).toBe(port)
    const bare = withLocalStorage(() => createWebPlatform())
    expect(bare.notify).toBeUndefined()
  })
})

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
    const out = await platform.storage.transaction(['nodes'], async (tx) => {
      await tx.put('nodes', { id: 'n-tx', projectId: 'p2' })
      return 42
    })
    expect(out).toBe(42)
    expect(await platform.storage.query('nodes', { id: 'n-tx' })).toHaveLength(1)
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
