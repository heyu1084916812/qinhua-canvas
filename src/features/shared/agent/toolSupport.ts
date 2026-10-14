import type { ChannelAdapter } from '../../../platform/channels/types'
import { errorTextOf } from '../../../shared/result'

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
  /**
   * 探测请求**本身**失败（网络 / 鉴权 / 限流），不是「模型收到了工具声明却不调用」。
   *
   * 这两种都走 `supported: false`，但处理方式相反：模型不调工具可以降级成 JSON
   * 工具调用继续干活；探测请求本身就失败的话，降级过去也是同一堵墙，必须让用户查渠道。
   */
  probeFailed?: boolean
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

/** 探测请求的正文。**必须同时进 `prompt` 和 `messages`**，理由见 `probeToolCalling`。 */
const PROBE_PROMPT = '调用 agent_probe 工具，不要输出任何文字。'

/**
 * 探测的等待上限。它只是「一个空工具 + 一句话」，不该跟正式对话一样等 3 分钟 ——
 * 上游真挂住时，用户越早知道越好。
 */
const PROBE_TIMEOUT_MS = 30_000

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
        prompt: PROBE_PROMPT,
        inputs: [],
        params: {},
        tools: [PROBE_TOOL],
        timeoutMs: PROBE_TIMEOUT_MS,
        /**
         * ⚠️ **必须给 `messages`，不能只给 `prompt`。**
         *
         * 探测在应用里走的不是裸适配器，而是 `channelStore.completeWithTools` ——
         * 它**硬编码 `prompt: ''`、只认 messages**。只给 prompt 的话，上游收到的是
         * `messages: []`，直接回 500「field messages is required」（2026-10-14 实测
         * comfly + gemini-3.8-flash，见 `.playwright-verify/probe-gemini-comfly.mjs`）。
         * 表现是**每个真实渠道的 Agent 一发消息就报错**，而 mock 渠道不看 messages，
         * 所以冒烟测不出来。
         */
        messages: [{ role: 'user', content: PROBE_PROMPT }],
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
    /**
     * 探测请求本身失败**不写缓存**。
     *
     * 2026-10-14 实测踩到：comfly 的 `gemini-3.8-flash` 平时 3 秒就回、带 tools 也
     * 正常返回 `tool_calls`；但只要有一次网络抖动 / 上游 5xx 让探测抛错，这条
     * 「失败」就被缓存住，之后**每次发消息都直接报同一句超时**，直到刷新页面。
     * 用户看到的是「这个模型一直超时」，实际是第一次的抖动被永久记住了。
     *
     * 结论分两类：「模型不支持工具调用」是稳定判断，可以缓存；
     * 「这次请求没跑通」是暂时状态，下次必须重探。
     */
    return {
      supported: false,
      reason: errorTextOf(e),
      probeFailed: true,
    }
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

export type AgentToolMode = 'native' | 'json'

export type ToolModeDecision =
  | { kind: 'use'; mode: AgentToolMode }
  | { kind: 'error'; message: string }

/**
 * 探测结果 → 这次对话走哪条路。
 *
 * 三种结果必须分开处理，合并任何一种都会退化成用户报过的那类问题：
 * - 支持原生 tools → `native`；
 * - 模型只是不返回 `tool_calls` → `json` 降级，**不打扰用户**（对话模型默认就该能干活）；
 * - 探测请求本身就失败 → 报错让用户去查渠道，因为降级过去也是同一堵墙。
 */
export function decideToolMode(support: ToolSupportResult): ToolModeDecision {
  if (support.supported) return { kind: 'use', mode: 'native' }
  if (support.probeFailed) {
    return {
      kind: 'error',
      message: `调用这个对话模型失败：${support.reason ?? '未知错误'}。请先在渠道设置里确认这个模型可用，再重试。`,
    }
  }
  return { kind: 'use', mode: 'json' }
}
