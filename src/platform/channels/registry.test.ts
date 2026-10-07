import { describe, it, expect } from 'vitest'
import { createChannelAdapter } from './registry'
import { ChannelError } from './types'
import { createMemoryPlatform } from '../../platform/memory'
import type { ResolvedChannelConfig } from './registry'

function resp(status: number, obj: unknown) {
  return {
    status,
    headers: {},
    async text() {
      return JSON.stringify(obj)
    },
    async json<T>(): Promise<T> {
      return obj as T
    },
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
}

const base: ResolvedChannelConfig = {
  id: 'c',
  protocol: 'mock',
  baseUrl: '',
  credentialRef: null,
  modelCache: [],
  apiKey: null,
}

describe('channel registry', () => {
  it('mock 协议返回 mock 适配器', () => {
    const a = createChannelAdapter({ ...base, protocol: 'mock' }, createMemoryPlatform())
    expect(a.protocol).toBe('mock')
  })

  it('未注册协议抛 ChannelError', () => {
    expect(() =>
      createChannelAdapter({ ...base, protocol: 'nope' }, createMemoryPlatform()),
    ).toThrow(ChannelError)
  })

  it('openai-images 适配器 verify 成功返回模型', async () => {
    const platform = createMemoryPlatform({
      handler: async () => resp(200, { data: [{ id: 'gpt-image-2' }] }),
    })
    const a = createChannelAdapter({ ...base, protocol: 'openai-images', baseUrl: 'https://x', apiKey: 'k' }, platform)
    const r = await a.verify(
      { id: 'c', protocol: 'openai-images', baseUrl: 'https://x', credentialRef: null, modelCache: [] },
      new AbortController().signal,
    )
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.models[0]?.id).toBe('gpt-image-2')
  })

  it('async-task 族分派到异步任务适配器（不再是 unsupported）', () => {
    const a = createChannelAdapter(
      {
        ...base,
        protocol: 'apimart',
        baseUrl: 'https://api.apimart.ai',
        apiKey: 'k',
        protocolDefinition: {
          id: 'apimart',
          name: 'APIMART',
          short: 'APIM',
          family: 'async-task',
          kind: 'station',
          status: 'ready',
          capabilities: ['image', 'video'],
          versionPath: '/v1',
        },
      },
      createMemoryPlatform(),
    )
    expect(a.protocol).toBe('apimart')
  })

  it('async-task 族里 RunningHub 走自己的适配器（端点清单带 endpoint: 前缀）', async () => {
    const platform = createMemoryPlatform({
      handler: async () => resp(200, { code: 0, data: { records: [] } }),
    })
    const a = createChannelAdapter(
      {
        ...base,
        protocol: 'runninghub-api',
        baseUrl: 'https://www.runninghub.cn',
        apiKey: 'k',
        protocolDefinition: {
          id: 'runninghub-api',
          name: 'RunningHub（API）',
          short: 'RH+',
          family: 'async-task',
          kind: 'station',
          status: 'ready',
          capabilities: ['image'],
        },
      },
      platform,
    )
    const models = await a.listModels(
      { id: 'c', protocol: 'runninghub-api', baseUrl: 'https://www.runninghub.cn', credentialRef: null, modelCache: [] },
      new AbortController().signal,
    )
    /**
     * 同族分流的判据：`asyncTask` 的清单来自 `/v1/models`，不可能出现 `endpoint:`
     * 前缀（它根本不认识这个形状）。出现即证明路由到了 RunningHub 适配器。
     */
    expect(models.some((m) => m.id === '全能图片PRO')).toBe(true)
  })

  it('cli-gateway 族分派到网关适配器（不再是 unsupported）', () => {
    const a = createChannelAdapter(
      {
        ...base,
        protocol: 'gemini-cli',
        baseUrl: 'http://127.0.0.1:8787',
        apiKey: null,
        protocolDefinition: {
          id: 'gemini-cli',
          name: 'Gemini CLI 网关',
          short: 'GEM',
          family: 'cli-gateway',
          kind: 'station',
          status: 'ready',
          capabilities: ['chat'],
          versionPath: '/v1',
        },
      },
      createMemoryPlatform(),
    )
    expect(a.protocol).toBe('gemini-cli')
  })

  it('异步任务：提交 → 轮询 → 产物，走完整链路', async () => {
    let polls = 0
    const platform = createMemoryPlatform({
      handler: async (req) => {
        if (req.method === 'POST') return resp(200, { data: { task_id: 't1' } })
        if (req.url?.includes('/tasks/')) {
          polls += 1
          if (polls === 1) return resp(200, { status: 'processing' })
          return resp(200, { status: 'completed', result: { images: [{ url: ['https://x/a.png'] }] } })
        }
        return resp(200, {})
      },
    })
    const a = createChannelAdapter(
      {
        ...base,
        protocol: 'apimart',
        baseUrl: 'https://api.apimart.ai',
        apiKey: 'k',
        protocolDefinition: {
          id: 'apimart',
          name: 'APIMART',
          short: 'APIM',
          family: 'async-task',
          kind: 'station',
          status: 'ready',
          capabilities: ['image'],
          versionPath: '/v1',
        },
      },
      platform,
    )
    const assets = await (
      a as unknown as {
        __withPoll?: unknown
      } & typeof a
    ).generateImage(
      {
        kind: 'image',
        channelId: 'c',
        model: 'gpt-image-2',
        prompt: 'cat',
        inputs: [],
        params: { count: 1 },
      } as never,
      new AbortController().signal,
    )
    // 产物下载在内存平台里取不到字节 → 断言「走到了终态且没有抛错」
    expect(Array.isArray(assets)).toBe(true)
    expect(polls).toBe(2)
  })
})
