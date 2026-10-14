import { describe, expect, it, vi } from 'vitest'
import {
  cachedToolSupport,
  clearToolSupportCache,
  decideToolMode,
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

  it('★★ 探测请求必须带非空 messages（只给 prompt 会让上游收到空数组）', async () => {
    clearToolSupportCache()
    let seen: Record<string, unknown> = {}
    const adapter = adapterWith(async (req) => {
      seen = req as Record<string, unknown>
      return { text: '', toolCalls: [{ id: 'c1', name: 'agent_probe', args: '{}' }] }
    })
    await probeToolCalling(adapter, KEY, signal)
    /**
     * 2026-10-14 实测：应用里的探测走 `completeWithTools`，它硬编码 `prompt: ''`、
     * 只认 messages。只给 prompt 时上游收到 `messages: []`，comfly 回 500
     * 「field messages is required」⇒ 每个真实渠道的 Agent 一发消息就报错。
     */
    expect(typeof seen.prompt).toBe('string')
    const messages = seen.messages as { content?: unknown }[] | undefined
    expect(messages?.length ?? 0).toBeGreaterThan(0)
    expect(String(messages?.[0]?.content ?? '')).toContain('agent_probe')
  })

  it('★★ 收下工具却只回文字 → 不支持，且给出可读原因（而不是笼统失败）', async () => {
    clearToolSupportCache()
    const adapter = adapterWith(async () => ({ text: '好的，我看看' }))
    const r = await probeToolCalling(adapter, KEY, signal)
    expect(r.supported).toBe(false)
    expect(r.reason).toContain('tool_calls')
    // 这不是探测失败：模型拿到了工具声明但选择不调，可以降级到 JSON 工具调用
    expect(r.probeFailed).toBeFalsy()
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
    // 探测请求本身失败必须单独标出来：这种降级到 JSON 也没用，要让用户去查渠道
    expect(r.probeFailed).toBe(true)
  })

  it('★★ 探测请求失败不写缓存（一次网络抖动不能永久记住）', async () => {
    clearToolSupportCache()
    const adapter = adapterWith(async () => {
      throw new Error('连不上：等太久，超时了')
    })
    await probeToolCalling(adapter, KEY, signal)
    // 缓存住失败会让之后每次发消息都直接报同一句，直到刷新页面 —— 实测踩过
    expect(cachedToolSupport(KEY)).toBeUndefined()
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

describe('decideToolMode：探测结果 → 走原生 / 降级 / 报错', () => {
  it('★ 支持原生 tools → native', () => {
    expect(decideToolMode({ supported: true })).toEqual({ kind: 'use', mode: 'native' })
  })

  it('★★ 模型收下工具只回文字（非探测失败）→ 自动降级 JSON，不报错', () => {
    expect(
      decideToolMode({ supported: false, reason: '该模型收下了工具声明，但没有返回 tool_calls' }),
    ).toEqual({ kind: 'use', mode: 'json' })
  })

  it('★★ 探测请求本身失败 → 报错让用户查渠道（降级也救不了）', () => {
    const d = decideToolMode({
      supported: false,
      reason: 'API Key 无效或无权限（401/403）',
      probeFailed: true,
    })
    expect(d.kind).toBe('error')
    if (d.kind === 'error') expect(d.message).toContain('401')
  })
})
