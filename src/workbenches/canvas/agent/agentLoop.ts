import type { ChatMessage, ToolDeclaration } from '../../../domain/shared/execution/types'
import type { ChannelAdapter } from '../../../platform/channels/types'
import { asAppError, describeError } from '../../../shared/result'

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
/**
 * 建图类：循环里**直接落地**，不问用户。
 *
 * 用户 2026-10-02 定了这条口径（对着参考产品的截图）：
 * 「他直接给我新建进去，但是生成与否需要让我确认，取消后也不会撤回已经新建到
 * 画布中的工作流（包括图片链接和提示词和新的节点的参数设置）」。
 *
 * 道理也站得住：**建节点不花钱**，而且整份计划是一次原子 dispatch（一次撤销全回退）。
 * 真正该拦的是花钱那一步。此前把建图也拦在确认卡后面，反而把「点确认 = 批准建图」
 * 和「点确认 = 批准花钱」混成了一件事 —— 用户点完发现画布还是空的（那是另一个
 * bug），体验上完全分不清发生了什么。
 */
const WRITE_TOOLS = new Set(['applyPlan'])
/** 花钱 / 改已有节点：跳出循环，等用户确认 */
const CONFIRM_TOOLS = new Set(['updateNode', 'runNode'])

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
  /** 执行**建图类**工具（`applyPlan`）：直接落到画布上，不等确认 */
  executeWrite: (name: string, args: unknown) => Promise<unknown>
  /**
   * 确认**之前**的预检（可选）。
   *
   * 返回 `{ ok: false, result }` 时**不弹确认卡**，直接把 `result` 回填给模型，
   * 让它在同一轮里自己改。存在的理由就是用户 2026-10-02 报的那件事：
   * 「重复让我确认新建工作流，重复了三次，画布上什么都没有」—— 计划不合法时
   * 还让用户先点一次确认，点完才告诉他不行，是最气人的那种交互。
   *
   * 为什么放在循环里而不是每个调用点自己记得：确认卡是**这里**弹的，
   * 预检就该和它挨着；散在调用点迟早有一条路径漏掉。
   */
  precheck?: (name: string, args: unknown) => { ok: true } | { ok: false; result: unknown }
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
      return { kind: 'error', message: e instanceof Error ? e.message : errText(e), messages }
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
          /**
           * 用户 2026-10-06 第七批 #189：「我换了一个 llm 之后规划就非常清晰的，基本上没有出错，
           * 是不是 llm 模型的问题」——**是**。规划能力确实跟对话模型强相关，
           * 而用户此刻最需要知道的不是「停下了」，而是**下一步该怎么办**。
           * 所以这句要把可行动作说出来：换个更擅长规划的对话模型（面板顶部就能换）。
           */
          reason:
            `反复调用同一个工具（${call.name}）且参数相同，已停下 —— ` +
            '这个对话模型这几轮没能给出可用的计划。换一个更擅长规划的对话模型（面板顶部那枚模型）再试一次通常就通了。',
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
        /**
         * 先过预检：不合法的就**别让用户点**（见 `precheck` 的说明）。
         * 预检只挡「根本落不了地」的请求；能落地的一律照常弹确认卡。
         */
        const pre = deps.precheck?.(call.name, args)
        if (pre && pre.ok === false) {
          messages.push(toolResult(call.id, pre.result))
          continue
        }
        // 写 / 花钱：跳出循环，交界面等确认（§9）
        return { kind: 'confirm', request: { callId: call.id, name: call.name, args }, messages }
      }
      /**
       * 建图类：**直接执行**（不问用户），把自检结果回填 ——
       * 模型靠它决定补连线还是改图。
       */
      if (WRITE_TOOLS.has(call.name)) {
        let wrote: unknown
        try {
          wrote = await deps.executeWrite(call.name, args)
        } catch (e) {
          wrote = { ok: false, problems: [e instanceof Error ? e.message : errText(e)] }
        }
        messages.push(toolResult(call.id, wrote))
        continue
      }
      if (!READ_TOOLS.has(call.name)) {
        messages.push(toolResult(call.id, { ok: false, error: `没有这个工具：${call.name}` }))
        continue
      }

      let outcome: unknown
      try {
        outcome = await deps.executeRead(call.name, args)
      } catch (e) {
        outcome = { ok: false, error: e instanceof Error ? e.message : errText(e) }
      }
      messages.push(toolResult(call.id, outcome))
    }
  }

  // 刹车②：轮数上限（§4）
  return {
    kind: 'stopped',
    reason:
      `连续 ${maxSteps} 轮还在调工具，已停下（可能是任务太大或它在打转）。` +
      '如果这个模型经常这样，换一个更擅长规划的对话模型会明显好转。',
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

/**
 * 任意抛出物 → **人能读的一句话**。
 *
 * 用户 2026-10-03 报「agent 出错了但界面上只写 `出错：[object Object]`」——
 * 因为错误对象不是 `Error` 实例（渠道层抛的是 `{kind, detail}` 这种普通对象），
 * `String(e)` 就变成 `[object Object]`，等于**把真实原因吞了**。修图 / 修视频
 * 全靠这句话，所以先把它修对。
 */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object') {
    /**
     * **先按 AppError 翻成人话**（用户 2026-10-05 第 3 批：「报错要中文，不要代码」）。
     *
     * 渠道层抛的正是 AppError 字面量（`{kind:'http', status:402, body:…}`）——
     * 不先过这一层的话，下面那张 `message/detail/…` 的键都对不上，
     * 会一路落到 `JSON.stringify` 把原始结构贴在界面上。
     */
    const app = asAppError(e)
    if (app) return describeError(app)
    const o = e as Record<string, unknown>
    for (const k of ['message', 'detail', 'raw', 'reason', 'error']) {
      const v = o[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    try {
      const s = JSON.stringify(e)
      if (s && s !== '{}') return `遇到了没预料到的错误（详情：${s.slice(0, 300)}）`
    } catch {
      /* 循环引用之类，走最后的兜底 */
    }
    return '[错误对象没有可读信息]'
  }
  return String(e)
}
