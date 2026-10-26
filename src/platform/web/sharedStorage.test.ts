import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSharedStorage } from './sharedStorage'

function response(value: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => value,
  } as Response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shared storage', () => {
  it('open 接受当前共享存储协议', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          ok: true,
          service: 'qinghua-shared-store',
          version: 5,
        }),
      ),
    )

    await expect(createSharedStorage().open()).resolves.toBeUndefined()
  })

  it('open 明确拒绝旧共享存储，而不是静默使用慢后端', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          ok: true,
          service: 'qinghua-shared-store',
          version: 2,
        }),
      ),
    )

    await expect(createSharedStorage().open()).rejects.toThrow('共享存储服务版本过旧')
  })

  it('put 把 Uint8Array 编成可跨端传输的标记，query 再还原', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
        if (url.endsWith('/query')) {
          return response({
            rows: [
              {
                id: 'a1',
                bytes: { __qhType: 'u8', base64: btoa(String.fromCharCode(1, 2, 3)) },
              },
            ],
          })
        }
        return response({ ok: true })
      }),
    )

    const storage = createSharedStorage()
    await storage.put('assets', { id: 'a1', bytes: new Uint8Array([1, 2, 3]) })
    const rows = await storage.query('assets', { id: 'a1' })

    expect(calls[0]!.body).toMatchObject({
      table: 'assets',
      row: { id: 'a1', bytes: { __qhType: 'u8' } },
    })
    expect(Array.from(rows[0]!.bytes as Uint8Array)).toEqual([1, 2, 3])
  })

  it('transaction 在回调成功后才一次提交，失败则一次都不提交', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        return response({ ok: true })
      }),
    )
    const storage = createSharedStorage()

    await storage.transaction(['nodes'], async (tx) => {
      await tx.put('nodes', { id: 'n1' })
      await tx.put('nodes', { id: 'n2' })
    })
    expect(urls.filter((url) => url.endsWith('/tx'))).toHaveLength(1)
    expect(urls.filter((url) => url.endsWith('/put'))).toHaveLength(0)

    urls.length = 0
    await expect(
      storage.transaction(['nodes'], async (tx) => {
        await tx.put('nodes', { id: 'n3' })
        throw new Error('stop')
      }),
    ).rejects.toThrow('stop')
    expect(urls.filter((url) => url.endsWith('/tx'))).toHaveLength(0)
  })

  it('事务之外的并发写不会混进当前事务，也不会被事务提交吞掉', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null })
        return response({ ok: true })
      }),
    )
    const storage = createSharedStorage()
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered!: () => void
    const ready = new Promise<void>((resolve) => {
      entered = resolve
    })
    const txRun = storage.transaction(['nodes'], async (tx) => {
      await tx.put('nodes', { id: 'tx-row', projectId: 'p1' })
      entered()
      await gate
    })
    await ready
    await storage.put('nodes', { id: 'outside-row', projectId: 'p1' })
    release()
    await txRun

    const direct = calls.find((call) => call.url.endsWith('/put'))
    const atomic = calls.find((call) => call.url.endsWith('/tx'))
    expect(direct?.body).toMatchObject({ table: 'nodes', row: { id: 'outside-row' } })
    expect(atomic?.body).toMatchObject({ ops: [{ kind: 'put', table: 'nodes' }] })
    expect(JSON.stringify(atomic?.body)).not.toContain('outside-row')
  })
})
