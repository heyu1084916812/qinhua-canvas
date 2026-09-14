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
})
