import type { ChatMessage, ToolDeclaration } from '../../../domain/shared/execution/types'
import type { ChannelAdapter } from '../../../platform/channels/types'

/**
 * Agent 循环（设计文档 §4）。
 *
 * 一轮对话就是「问模型 → 看它要不要调工具 → 调完回填 → 再问」的往复。
 * 这个文件只管循环本身，工具的具体实现调用方注入 —— 所以它能用假 adapter 完整单测，
 * 而循环的刹车（打转、轮数上限）恰恰是最不能靠手点验证的部分。
 *
 * ## 为什么「写」与「花钱」的工具要跳出循环
 *
 * 用户 2026-10-01 定的规矩：花钱的动作默认停下等确认（设计文档 §9）。
 * 实现上就是**不在循环里执行**这类工具，而是把请求交回界面 ——
 * 界面确认后再用 `resumeAgentTurn` 把执行结果喂回去继续。
 * 若在循环里直接执行，确认就成了一句空话。
 */

export const AGENT_DEFAULT_MAX_STEPS = 8

/** 读类：循环里直接跑，结果回填给模型 */
const READ_TOOLS = new Set(['readGraph', 'readAsset', 'readResult'])
/** 写 / 花钱：跳出循环，等用户确认 */
const CONFIRM_TOOLS = new Set(['applyPlan', 'updateNode', 'runNode'])

export interface AgentToolRequest {
  callId: string
  name: string
  args: unknown
}

export type AgentLoopOutcome =
  /** 模型给了文字回答，本轮结束 */
  | { kind: 'message'; text: string; messages: ChatMessage[] }
  /** 模型要做写 / 花钱的动作，等用户确认（界面据此出预览卡） */
  | { kind: 'confirm'; request: AgentToolRequest; messages: ChatMessage[] }
  /** 渠道 / 解析错误，中止本轮 */
  | { kind: 'error'; message: string; messages: ChatMessage[] }
  /** 触发刹车（轮数上限 / 反复调同一个工具） */
  | { kind: 'stopped'; reason: string; messages: ChatMessage[] }

export interface AgentLoopDeps {
  adapter: Pick<ChannelAdapter, 'completeText'>
  channelId: string
  model: string
  tools: readonly ToolDeclaration[]
  /** 执行**读类**工具，返回要回填给模型的结果（失败也照常返回一个说明对象） */
  executeRead: (name: string, args: unknown) => Promise<unknown>
  signal: AbortSignal
  maxSteps?: number
}

const PARSE_FAILED = Symbol('parse-failed')

/** 参数解析失败**不抛**：把错误回填给模型让它重发，这是它能自己修的问题（§4） */
function parseArgs(raw: string): unknown | typeof PARSE_FAILED {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return PARSE_FAILED
  }
}

const toolResult = (callId: string, value: unknown): ChatMessage => ({
  role: 'tool',
  toolCallId: callId,
  content: JSON.stringify(value ?? {}),
})

/** 工具调用的指纹，用于发现「反复调同一个」 */
const callFingerprint = (name: string, args: unknown): string =>
  `${name}:${JSON.stringify(args ?? {})}`

async function askModel(history: ChatMessage[], deps: AgentLoopDeps) {
  return deps.adapter.completeText(
    {
      kind: 'text',
      channelId: deps.channelId,
      model: deps.model,
      // 给了 messages 就以它为准；prompt 只是老路径的兜底，这里留空
      prompt: '',
      inputs: [],
      params: {},
      tools: deps.tools,
      messages: history,
    },
    deps.signal,
  )
}

/** 跑一轮（可能是多步工具调用）：要么给出回答、要么要求确认、要么停下 */
export async function runAgentTurn(
  history: readonly ChatMessage[],
  deps: AgentLoopDeps,
): Promise<AgentLoopOutcome> {
  const messages = [...history]
  const maxSteps = deps.maxSteps ?? AGENT_DEFAULT_MAX_STEPS
  const seenCalls = new Map<string, number>()

  for (let step = 0; step < maxSteps; step += 1) {
    let result: Awaited<ReturnType<typeof askModel>>
    try {
      result = await askModel(messages, deps)
    } catch (e) {
      // 渠道错误（401 / 限流）**不回填**：那是配置问题，模型改不了（§4）
      return { kind: 'error', message: e instanceof Error ? e.message : String(e), messages }
    }

    const calls = result.toolCalls ?? []
    if (calls.length === 0) {
      messages.push({ role: 'assistant', content: result.text })
      return { kind: 'message', text: result.text, messages }
    }

    messages.push({
      role: 'assistant',
      content: result.text,
      toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
    })

    for (const call of calls) {
      const args = parseArgs(call.args)
      if (args === PARSE_FAILED) {
        messages.push(
          toolResult(call.id, { ok: false, error: 'arguments 不是合法 JSON，请重新发一次' }),
        )
        continue
      }

      /**
       * 刹车①：同一个工具 + 同样参数反复调。
       * 第 2 次提醒、第 3 次直接停 —— 这是模型打转最常见的形态（§4）。
       */
      const fp = callFingerprint(call.name, args)
      const times = (seenCalls.get(fp) ?? 0) + 1
      seenCalls.set(fp, times)
      if (times >= 3) {
        return {
          kind: 'stopped',
          reason: `反复调用同一个工具（${call.name}）且参数相同，已停下`,
          messages,
        }
      }
      if (times === 2) {
        messages.push(
          toolResult(call.id, {
            ok: false,
            error: `你刚做过同样的 ${call.name}，换个做法或直接给结论`,
          }),
        )
        continue
      }

      if (CONFIRM_TOOLS.has(call.name)) {
        // 写 / 花钱：跳出循环，交界面等确认（§9）
        return { kind: 'confirm', request: { callId: call.id, name: call.name, args }, messages }
      }
      if (!READ_TOOLS.has(call.name)) {
        messages.push(toolResult(call.id, { ok: false, error: `没有这个工具：${call.name}` }))
        continue
      }

      let outcome: unknown
      try {
        outcome = await deps.executeRead(call.name, args)
      } catch (e) {
        outcome = { ok: false, error: e instanceof Error ? e.message : String(e) }
      }
      messages.push(toolResult(call.id, outcome))
    }
  }

  // 刹车②：轮数上限（§4）
  return {
    kind: 'stopped',
    reason: `连续 ${maxSteps} 轮还在调工具，已停下（可能是任务太大或它在打转）`,
    messages,
  }
}

/**
 * 用户确认（或取消）之后把结果喂回去继续这一轮（§4）。
 *
 * 取消也要回填 —— 不回填的话模型不知道自己那条请求被拒了，会一直等，
 * 或者下一步基于「我已经建好了」这个错误前提继续说话。
 */
export async function resumeAgentTurn(
  history: readonly ChatMessage[],
  callId: string,
  payload: unknown,
  deps: AgentLoopDeps,
): Promise<AgentLoopOutcome> {
  return runAgentTurn([...history, toolResult(callId, payload)], deps)
}
