import { describe, it, expect } from 'vitest'
import { fingerprintBytes } from '../../domain/shared/hash'
import { createMemoryPlatform } from '../../platform/memory'
import type { NetworkRequest, NetworkResponse } from '../../platform/ports'
import { createRunningHubAdapter, RUNNINGHUB_ENDPOINTS } from './runninghub'
import { ChannelError, type ImageRunRequest } from './types'
import type { ResolvedChannelConfig } from './registry'

/** 真实 PNG 头（`imageSizeFromHeader` 要能读出来，产物才有像素） */
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00,
])

function json(status: number, obj: unknown): NetworkResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    async text() {
      return JSON.stringify(obj)
    },
    async json<T>() {
      return obj as T
    },
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
}

/** 产物下载那一跳：只有它回二进制 */
function bytes(status: number, data: Uint8Array): NetworkResponse {
  return {
    status,
    headers: { 'content-type': 'image/png' },
    async text() {
      return ''
    },
    async json<T>() {
      return {} as T
    },
    async arrayBuffer() {
      return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
    },
  }
}

const config: ResolvedChannelConfig = {
  id: 'c1',
  protocol: 'runninghub-api',
  baseUrl: 'https://www.runninghub.cn',
  credentialRef: null,
  modelCache: [],
  apiKey: 'rh-key',
}

const signal = new AbortController().signal

const imageRequest = (model: string, inputs: ImageRunRequest['inputs'] = []): ImageRunRequest => ({
  kind: 'image',
  channelId: 'c1',
  model,
  prompt: '一只橘猫',
  inputs,
  params: { ratio: '1:1', resolution: '2k' },
})

/** 一轮就出结果（不真等 5 秒：轮询节奏与等待都注入掉） */
const FAST = { sleep: async () => {}, pollIntervalMs: 0 }

describe('RunningHub 适配器 / 标准模型（金额路）', () => {
  it('★ 提交 → 轮询 → 下载产物（官方 v2 端点形状）', async () => {
    const calls: { method: string; url: string; body: unknown }[] = []
    let polls = 0
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push({ method: req.method ?? 'GET', url: req.url, body: req.body })
        if (req.url.endsWith('/openapi/v2/query')) {
          polls += 1
          /** 第一轮还在跑：验证它真的会继续轮询，而不是拿 RUNNING 当结果 */
          if (polls === 1) return json(200, { status: 'RUNNING' })
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/a.png', outputType: 'png' }],
          })
        }
        if (req.url.endsWith('/openapi/v2/rhart-image-g-2/text-to-image')) {
          return json(200, { code: 0, taskId: 't1' })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })

    const adapter = createRunningHubAdapter(config, platform, FAST)
    const assets = await adapter.generateImage(
      imageRequest('endpoint:rhart-image-g-2/text-to-image'),
      signal,
    )

    expect(polls).toBe(2)
    expect(assets).toHaveLength(1)
    /** hash 是 `await fingerprintBytes` 算出来的：算错/漏 await 这里立刻红 */
    expect(assets[0]!.hash).toBe(await fingerprintBytes(PNG_BYTES))
    expect(assets[0]!.mime).toBe('image/png')
    const submit = calls.find((c) => c.url.endsWith('/rhart-image-g-2/text-to-image'))!
    expect(submit.method).toBe('POST')
    expect(submit.body).toMatchObject({
      prompt: '一只橘猫',
      aspectRatio: '1:1',
      resolution: '2k',
    })
  })

  it('任务终态 FAILED → 带上服务端原话（含 812 的充值 / 币路指引）', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'FAILED',
            errorCode: '812',
            errorMessage: '企业版余额不足',
          })
        }
        return json(200, { code: 0, taskId: 't1' })
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const err = await adapter
      .generateImage(imageRequest('endpoint:rhart-image-g-2/text-to-image'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err!.appError).toMatchObject({ kind: 'http' })
    const body = 'body' in err!.appError ? String(err!.appError.body) : ''
    expect(body).toContain('企业版余额不足')
    expect(body).toContain('充值')
    expect(body).toContain('app:')
  })

  it('不认识模型 → channel/missingModel；没填 Key → channel/missingKey', async () => {
    const platform = createMemoryPlatform({ handler: async () => json(200, {}) })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    await expect(adapter.generateImage(imageRequest('endpoint:没有这条'), signal)).rejects.toThrow(
      ChannelError,
    )

    const noKey = createRunningHubAdapter({ ...config, apiKey: null }, platform, FAST)
    const err = await noKey
      .generateImage(imageRequest('endpoint:rhart-image-g-2/text-to-image'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err!.appError).toEqual({ kind: 'channel', detail: 'missingKey' })
  })

  it('参考图 < 5MB 内联成 data URI（不走上传）', async () => {
    let submitBody: Record<string, unknown> | null = null
    const platform = createMemoryPlatform({
      rows: { assets: [{ id: 'h1', bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' }] },
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/a.png' }],
          })
        }
        if (req.url.endsWith('/media/upload/binary')) {
          throw new Error('小图不该走上传')
        }
        if (req.url.includes('/rhart-image-g-3/image-to-image')) {
          submitBody = req.body as Record<string, unknown>
          return json(200, { code: 0, taskId: 't1' })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    await adapter.generateImage(
      imageRequest('endpoint:rhart-image-g-3/image-to-image', [
        { kind: 'asset', nodeId: 'n1', assetHash: 'h1', mime: 'image/png' },
      ]),
      signal,
    )
    const images = (submitBody as unknown as { imageUrls: string[] }).imageUrls
    expect(images).toHaveLength(1)
    expect(images[0]!.startsWith('data:image/png;base64,')).toBe(true)
  })
})

describe('RunningHub 适配器 / AI 应用（币路）', () => {
  it('★ 拉节点 → 填 prompt → ai-app/run → 轮询 → 产物', async () => {
    const calls: string[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(req.url)
        if (req.url.includes('/api/webapp/apiCallDemo')) {
          return json(200, {
            code: 0,
            data: {
              nodeInfoList: [
                { nodeId: 18, fieldName: 'prompt', fieldType: 'STRING', fieldValue: '' },
                { nodeId: 19, fieldName: 'aspectRatio', fieldType: 'STRING', fieldValue: '1:1' },
              ],
            },
          })
        }
        if (req.url.endsWith('/task/openapi/ai-app/run')) {
          return json(200, { code: 0, data: { taskId: 'app-task-1' } })
        }
        if (req.url.endsWith('/openapi/v2/query')) {
          return json(200, {
            status: 'SUCCESS',
            results: [{ url: 'https://files.runninghub.cn/b.png' }],
          })
        }
        if (req.url.startsWith('https://files.runninghub.cn/')) return bytes(200, PNG_BYTES)
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const assets = await adapter.generateImage(imageRequest('app:2046794551444119554'), signal)

    expect(assets).toHaveLength(1)
    /** 应用路走的是 `/task/openapi/ai-app/run`，不是标准模型的 v2 端点 */
    expect(calls.some((u) => u.endsWith('/task/openapi/ai-app/run'))).toBe(true)
    expect(calls.some((u) => u.includes('/api/webapp/apiCallDemo'))).toBe(true)
  })

  it('应用没有可改节点 → 报上游的话，而不是假装成功', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.includes('/api/webapp/apiCallDemo')) {
          return json(200, { code: 0, data: { nodeInfoList: [] } })
        }
        return json(200, {})
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const err = await adapter
      .generateImage(imageRequest('app:1'), signal)
      .then(() => null)
      .catch((e: unknown) => e as ChannelError)
    expect(err).toBeInstanceOf(ChannelError)
    expect(err!.appError.kind).toBe('http')
  })
})

describe('RunningHub 适配器 / verify 与模型清单', () => {
  it('verify 打 accountStatus，成功则带出端点模型', async () => {
    const calls: string[] = []
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        calls.push(req.url)
        if (req.url.endsWith('/uc/openapi/accountStatus')) {
          return json(200, { code: 0, data: { remainCoins: '473', apiType: 'SHARED' } })
        }
        return json(200, { code: 0, data: { records: [] } })
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const r = await adapter.verify(config, signal)
    expect(calls[0]!.endsWith('/uc/openapi/accountStatus')).toBe(true)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.models.length).toBeGreaterThanOrEqual(RUNNINGHUB_ENDPOINTS.length)
  })

  it('Key 不认账 → ok:false，且消息带服务端原话', async () => {
    const platform = createMemoryPlatform({
      handler: async () => json(200, { code: 401, msg: 'APIKEY 校验失败' }),
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const r = await adapter.verify(config, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toContain('APIKEY')
  })

  it('应用列表拉不到（非 JSON）→ 仍然给出端点模型，验证不失败', async () => {
    const platform = createMemoryPlatform({
      handler: async (req: NetworkRequest) => {
        if (req.url.endsWith('/uc/openapi/accountStatus')) return json(200, { code: 0 })
        return {
          status: 200,
          headers: {},
          async text() {
            return '<html>502 Bad Gateway</html>'
          },
          async json<T>() {
            return {} as T
          },
          async arrayBuffer() {
            return new ArrayBuffer(0)
          },
        }
      },
    })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    const models = await adapter.listModels(config, signal)
    expect(models.length).toBe(RUNNINGHUB_ENDPOINTS.length)
  })

  it('没有对话能力（RunningHub 就不做 chat）', async () => {
    const platform = createMemoryPlatform({ handler: async () => json(200, {}) })
    const adapter = createRunningHubAdapter(config, platform, FAST)
    await expect(
      adapter.completeText(
        { kind: 'text', channelId: 'c1', model: 'x', prompt: 'hi', inputs: [], params: {} },
        signal,
      ),
    ).rejects.toThrow(ChannelError)
  })
})
