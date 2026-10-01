import type { ChannelAdapter } from '../../../platform/channels/types'

/**
 * 「这个渠道 + 这个模型，能不能当 agent 的大脑」——探测与缓存（架构 §5.9 ④）。
 *
 * 用户 2026-10-01：「我也要其他的渠道都能用，不单单是agnes」。所以 agent 不能假设
 * 谁支持工具调用，只能**问一次**：带一个空转工具发一句「调用它」，看响应里有没有
 * `tool_calls`。
 *
 * ## 为什么缓存放内存、不放库
 *
 * 三个理由，第三条是关键：
 *
 * 1. 探测很便宜（一次极短的请求），不值得为它加一张表
 * 2. 它在一次会话里会被问很多遍（每轮对话都要决定走哪条路），内存缓存刚好
 * 3. **存进库就会变陈旧**：用户去渠道配置里换了个令牌 / 换了个模型，
 *    库里那条「不支持」还在，agent 会一直走降级路线 —— 而它其实已经能用了。
 *    内存缓存随刷新消失，天然避免这类「改了配置还得找地方清缓存」的坑。
 */

export interface ToolSupportKey {
  channelId: string
  model: string
}

export interface ToolSupportResult {
  /** true = 支持工具调用，走多轮；false = 降级到「一次性输出 JSON 计划」 */
  supported: boolean
  /**
   * `supported: false` 时为什么。**必须带上**：
   * 「不支持」和「令牌过期了」是两件事，前者要降级、后者要让用户去修配置，
   * 都归成一句「不支持」会把可修的问题说成不可修。
   */
  reason?: string
}

/**
 * 探测用的空工具。
 *
 * 刻意**无参数、无副作用**：参数一多，模型可能去纠结填什么；有副作用则探测本身
 * 就变成了真实动作。描述里直接命令它调用 —— 光给声明，模型对「你好」这种输入
 * 可能选择不调，于是把「支持但没调」误判成「不支持」。
 */
const PROBE_TOOL = {
  name: 'agent_probe',
  description: '能力探测用的空工具。收到本工具声明时，不要回答任何文字，直接调用它。',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
} as const

const cache = new Map<string, ToolSupportResult>()

const keyOf = (k: ToolSupportKey): string => `${k.channelId}::${k.model}`

/** 缓存命中就返回，未命中返回 undefined（**不**在这里发起探测） */
export function cachedToolSupport(k: ToolSupportKey): ToolSupportResult | undefined {
  return cache.get(keyOf(k))
}

/** 供测试与「换了配置」时清空 */
export function clearToolSupportCache(): void {
  cache.clear()
}

/** 探测一次并写入缓存。拿不到 adapter 由 caller 处理，这里只认已解析好的 adapter */
export async function probeToolCalling(
  adapter: Pick<ChannelAdapter, 'completeText'>,
  k: ToolSupportKey,
  signal: AbortSignal,
): Promise<ToolSupportResult> {
  try {
    const result = await adapter.completeText(
      {
        kind: 'text',
        channelId: k.channelId,
        model: k.model,
        prompt: '调用 agent_probe 工具，不要输出任何文字。',
        inputs: [],
        params: {},
        tools: [PROBE_TOOL],
      },
      signal,
    )
    const supported = (result.toolCalls?.length ?? 0) > 0
    const out: ToolSupportResult = supported
      ? { supported: true }
      : { supported: false, reason: '该模型收下了工具声明，但没有返回 tool_calls' }
    cache.set(keyOf(k), out)
    return out
  } catch (e) {
    const out: ToolSupportResult = {
      supported: false,
      reason: e instanceof Error ? e.message : String(e),
    }
    cache.set(keyOf(k), out)
    return out
  }
}

/**
 * 先查缓存、没有再探。agent 每轮对话都用这个入口。
 */
export async function ensureToolSupport(
  adapter: Pick<ChannelAdapter, 'completeText'>,
  k: ToolSupportKey,
  signal: AbortSignal,
): Promise<ToolSupportResult> {
  return cachedToolSupport(k) ?? (await probeToolCalling(adapter, k, signal))
}
