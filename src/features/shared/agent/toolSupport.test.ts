import { describe, expect, it, vi } from 'vitest'
import {
  cachedToolSupport,
  clearToolSupportCache,
  ensureToolSupport,
  probeToolCalling,
} from './toolSupport'

/**
 * 渠道能力探测（用户 2026-10-01：「我也要其他的渠道都能用，不单单是agnes」）。
 *
 * 这三条是这一小段功能的全部要点：探测真的看 tool_calls、失败要说清原因、
 * 同一个渠道+模型只探一次。
 */

const signal = new AbortController().signal
const KEY = { channelId: 'ch1', model: 'm1' }

function adapterWith(completeText: (req: unknown) => Promise<unknown>) {
  return { completeText: completeText as never }
}

describe('工具调用能力探测', () => {
  it('★ 返回 tool_calls 就算支持', async () => {
    clearToolSupportCache()
    const adapter = adapterWith(async () => ({
      text: '',
      toolCalls: [{ id: 'c1', name: 'agent_probe', args: '{}' }],
    }))
    const r = await probeToolCalling(adapter, KEY, signal)
    expect(r.supported).toBe(true)
    expect(r.reason).toBeUndefined()
  })

  it('★★ 收下工具却只回文字 → 不支持，且给出可读原因（而不是笼统失败）', async () => {
    clearToolSupportCache()
    const adapter = adapterWith(async () => ({ text: '好的，我看看' }))
    const r = await probeToolCalling(adapter, KEY, signal)
    expect(r.supported).toBe(false)
    expect(r.reason).toContain('tool_calls')
  })

  it('★★ 请求本身失败（如令牌过期）也记成不支持，但原因是原始错误', async () => {
    clearToolSupportCache()
    const adapter = adapterWith(async () => {
      throw new Error('API Key 无效或无权限（401/403）')
    })
    const r = await probeToolCalling(adapter, KEY, signal)
    expect(r.supported).toBe(false)
    // 「不支持」与「配置坏了」是两件事，原因必须传得下去
    expect(r.reason).toContain('401')
  })

  it('★★ 同一个「渠道+模型」只探一次（缓存命中就不再发请求）', async () => {
    clearToolSupportCache()
    const spy = vi.fn(async () => ({
      text: '',
      toolCalls: [{ id: 'c1', name: 'agent_probe', args: '{}' }],
    }))
    const adapter = adapterWith(spy)

    await ensureToolSupport(adapter, KEY, signal)
    await ensureToolSupport(adapter, KEY, signal)
    await ensureToolSupport(adapter, KEY, signal)

    expect(spy).toHaveBeenCalledTimes(1)
    expect(cachedToolSupport(KEY)?.supported).toBe(true)
  })

  it('★ 换了模型要重新探（缓存键含 model，不能串）', async () => {
    clearToolSupportCache()
    const spy = vi.fn(async () => ({ text: '只回文字' }))
    const adapter = adapterWith(spy)

    await ensureToolSupport(adapter, { channelId: 'ch1', model: 'a' }, signal)
    await ensureToolSupport(adapter, { channelId: 'ch1', model: 'b' }, signal)

    expect(spy).toHaveBeenCalledTimes(2)
  })
})
