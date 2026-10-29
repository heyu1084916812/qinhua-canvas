import type { ChatMessage, NodeInput, ToolDeclaration } from '../../../domain/shared/execution/types'
import type { AgentToolRequest } from '../../../domain/agent/toolRequest'
import {
  AGENT_CONFIRM_TOOL_NAMES,
  AGENT_READ_TOOL_NAMES,
  AGENT_WRITE_TOOL_NAMES,
  agentToolDefinitionOf,
} from '../../../domain/agent/toolRegistry'
import type { ChannelAdapter } from '../../../platform/channels/types'
import { errorTextOf } from '../../../shared/result'
import { createId } from '../../../shared/id'
import { AgentToolEffectBlockedError } from '../../../features/shared/agent/AgentToolEffectLedger'
import { parseJsonAgentAction } from './jsonToolFallback'

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
const READ_TOOLS = new Set<string>(AGENT_READ_TOOL_NAMES)
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
const WRITE_TOOLS = new Set<string>(AGENT_WRITE_TOOL_NAMES)
/** 花钱 / 改已有节点：跳出循环，等用户确认 */
const CONFIRM_TOOLS = new Set<string>(AGENT_CONFIRM_TOOL_NAMES)

export type { AgentToolRequest } from '../../../domain/agent/toolRequest'

export interface AgentLoopCheckpoint {
  kind: 'max_steps'
  maxSteps: number
  completedSteps: number
}

export interface AgentLoopActivity {
  id: string
  phase: 'thinking' | 'tool'
  status: 'running' | 'done' | 'failed'
  tool?: string
  /** 渠道公开返回的真实过程摘要；只用于当前一行，不参与模型上下文。 */
  detail?: string
}

export type AgentLoopOutcome =
  /** 模型给了文字回答，本轮结束 */
  | { kind: 'message'; text: string; messages: ChatMessage[] }
  /** 模型要做写 / 花钱的动作，等用户确认（界面据此出预览卡） */
  | { kind: 'confirm'; request: AgentToolRequest; messages: ChatMessage[] }
  /** 渠道 / 解析错误，中止本轮 */
  | {
      kind: 'error'
      message: string
      messages: ChatMessage[]
      /** 工具副作用可能已发生；界面必须转 needs_attention，不能当普通失败重试。 */
      needsAttention?: { toolCallId?: string; reason: string }
    }
  /** 触发刹车（轮数上限 / 反复调同一个工具） */
  | {
      kind: 'stopped'
      reason: string
      messages: ChatMessage[]
      /** 仅轮数预算耗尽时给出；用户可以带着现有工具结果继续。 */
      checkpoint?: AgentLoopCheckpoint
    }

export interface AgentLoopDeps {
  adapter: Pick<ChannelAdapter, 'completeText'>
  channelId: string
  model: string
  tools: readonly ToolDeclaration[]
  /**
   * `native`：渠道支持 OpenAI `tools` / `tool_calls`（默认）。
   * `json`：渠道不返回 tool_calls，走设计文档 §7 路线 B ——
   * 提示词要求模型每次只输出一个 `{"tool":"...","args":{...}}`，系统解析后执行。
   */
  toolMode?: 'native' | 'json'
  /** 执行**读类**工具，返回要回填给模型的结果（失败也照常返回一个说明对象） */
  executeRead: (name: string, args: unknown, callId: string) => Promise<unknown>
  /** 执行**建图类**工具（`applyPlan`）：直接落到画布上，不等确认 */
  executeWrite: (name: string, args: unknown, callId: string) => Promise<unknown>
  /** 用户这次明确提供的节点素材；各轮模型请求复用同一批节点引用。 */
  inputs?: readonly NodeInput[]
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
  /**
   * 取出在下一次模型调用前应插入的运行中引导。实现方必须按 id 去重；
   * 循环会在每个工具批次结束后再次调用，不会中断已经发出的模型请求。
   */
  takeSteering?: () =>
    | readonly ChatMessage[]
    | Promise<readonly ChatMessage[]>
  /** 公开工作进度：只上报真实的阶段与工具状态，不包含模型私有思维链。 */
  onActivity?: (activity: AgentLoopActivity) => void
  /** 推送当前消息快照，让过程正文在任务结束前就能进入时间线。 */
  onProgress?: (messages: readonly ChatMessage[]) => void
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

const toolResult = (callId: string, toolName: string, value: unknown): ChatMessage => ({
  role: 'tool',
  toolCallId: callId,
  toolName,
  content: JSON.stringify(value ?? {}),
  createdAt: Date.now(),
})

const failedToolValue = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false
  const row = value as { ok?: unknown; problems?: unknown }
  return row.ok === false || (Array.isArray(row.problems) && row.problems.length > 0)
}

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
      inputs: [...(deps.inputs ?? [])],
      params: {},
      tools: deps.toolMode === 'json' ? [] : deps.tools,
      messages: history.map((message) => {
        const protocolMessage = { ...message }
        delete protocolMessage.createdAt
        delete protocolMessage.reasoning
        return protocolMessage
      }),
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
  let visualReviewRan = false
  const emitProgress = () => deps.onProgress?.([...messages])
  const pullSteering = async (): Promise<number> => {
    if (!deps.takeSteering) return 0
    const steering = await deps.takeSteering()
    if (steering.length > 0) {
      messages.push(...steering)
      emitProgress()
      /**
       * 引导是新的用户指令。它到达后，视觉验收“只读终点”只约束验收刚结束的旧回合，
       * 不能再把用户明确发出的下一步挡回去。
       */
      visualReviewRan = false
    }
    return steering.length
  }
  const emitActivity = (activity: AgentLoopActivity) => {
    deps.onActivity?.(activity)
  }

  for (let step = 0; step < maxSteps; step += 1) {
    await pullSteering()
    emitActivity({ id: `thinking-${step}`, phase: 'thinking', status: 'running' })
    let result: Awaited<ReturnType<typeof askModel>>
    try {
      result = await askModel(messages, deps)
    } catch (e) {
      // 渠道错误（401 / 限流）**不回填**：那是配置问题，模型改不了（§4）
      return { kind: 'error', message: e instanceof Error ? e.message : errText(e), messages }
    }
    if (result.reasoning?.trim()) {
      emitActivity({
        id: `reasoning-${step}`,
        phase: 'thinking',
        status: 'done',
        detail: result.reasoning.trim(),
      })
    }

    let calls = result.toolCalls ?? []
    let showAssistantText = true
    /**
     * 路线 B：渠道不支持原生 tools 时，模型每次只输出一个 JSON 工具调用。
     * 解析不出来就如实拒绝，不让它把“我无法调用工具”当成最终回答。
     */
    if (calls.length === 0 && deps.toolMode === 'json') {
      const action = parseJsonAgentAction(result.text)
      if (action?.name === 'final') {
        if ((await pullSteering()) > 0) continue
        const message =
          action.args &&
          typeof action.args === 'object' &&
          typeof (action.args as { message?: unknown }).message === 'string'
            ? String((action.args as { message: string }).message)
            : result.text
        messages.push({
          role: 'assistant',
          content: message,
          ...(result.reasoning ? { reasoning: result.reasoning } : {}),
          createdAt: Date.now(),
        })
        return { kind: 'message', text: message, messages }
      }
      if (!action) {
        messages.push({
          role: 'assistant',
          content: result.text,
          ...(result.reasoning ? { reasoning: result.reasoning } : {}),
          createdAt: Date.now(),
        })
        return {
          kind: 'error',
          message:
            '这个对话模型不支持原生工具调用，也没有按要求输出 JSON 工具调用。请换一个支持 tools 的模型，或让它按 {"tool":"...","args":{...}} 输出。',
          messages,
        }
      }
      calls = [
        {
          id: createId('jsoncall'),
          name: action.name,
          args: JSON.stringify(action.args ?? {}),
        },
      ]
      showAssistantText = false
    }
    if (calls.length === 0) {
      if ((await pullSteering()) > 0) continue
      messages.push({
        role: 'assistant',
        content: result.text,
        ...(result.reasoning ? { reasoning: result.reasoning } : {}),
        createdAt: Date.now(),
      })
      return { kind: 'message', text: result.text, messages }
    }

    const isPostReviewBlocked = (name: string) =>
      name !== 'requestTaskConfirmation' &&
      (WRITE_TOOLS.has(name) || CONFIRM_TOOLS.has(name))
    const terminalIndex = calls.findIndex(
      (call) => agentToolDefinitionOf(call.name)?.terminalAfter,
    )
    const reviewGuardActive =
      terminalIndex >= 0
        ? calls.some(
            (call, index) => index > terminalIndex && isPostReviewBlocked(call.name),
          )
        : visualReviewRan && calls.some((call) => isPostReviewBlocked(call.name))
    let reviewBlocksTurn = false
    if (reviewGuardActive) {
      /**
       * 引导可能恰好在这次模型请求期间到达。此时先取一次：
       * 有引导就丢掉这份旧动作、带着用户最新要求重新问模型；
       * 没有引导才过滤掉验收后的写操作，并把本轮正常收口成说明。
       */
      const steering = deps.takeSteering ? await deps.takeSteering() : []
      if (steering.length > 0) {
        messages.push(...steering)
        visualReviewRan = false
        continue
      }
      calls = calls.filter((call, index) => {
        if (terminalIndex >= 0) {
          return index <= terminalIndex || !isPostReviewBlocked(call.name)
        }
        return !isPostReviewBlocked(call.name)
      })
      reviewBlocksTurn = true
    }

    messages.push({
      role: 'assistant',
      content: showAssistantText ? result.text : '',
      ...(result.reasoning ? { reasoning: result.reasoning } : {}),
      createdAt: Date.now(),
      toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: c.args })),
    })
    emitProgress()

    for (const call of calls) {
      const args = parseArgs(call.args)
      if (args === PARSE_FAILED) {
        messages.push(
          toolResult(call.id, call.name, {
            ok: false,
            error: 'arguments 不是合法 JSON，请重新发一次',
          }),
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
          toolResult(call.id, call.name, {
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
          messages.push(toolResult(call.id, call.name, pre.result))
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
        emitActivity({
          id: call.id,
          phase: 'tool',
          status: 'running',
          tool: call.name,
        })
        let wrote: unknown
        try {
          wrote = await deps.executeWrite(call.name, args, call.id)
        } catch (e) {
          if (e instanceof AgentToolEffectBlockedError) {
            emitActivity({
              id: call.id,
              phase: 'tool',
              status: 'failed',
              tool: call.name,
            })
            return {
              kind: 'error',
              message: e.message,
              messages,
              ...(e.status === 'needs_attention'
                ? {
                    needsAttention: {
                      toolCallId: e.outcome.effect.toolCallId,
                      reason: e.message,
                    },
                  }
                : {}),
            }
          }
          wrote = { ok: false, problems: [e instanceof Error ? e.message : errText(e)] }
        }
        emitActivity({
          id: call.id,
          phase: 'tool',
          status: failedToolValue(wrote) ? 'failed' : 'done',
          tool: call.name,
        })
        messages.push(toolResult(call.id, call.name, wrote))
        continue
      }
      if (!READ_TOOLS.has(call.name)) {
        emitActivity({
          id: call.id,
          phase: 'tool',
          status: 'failed',
          tool: call.name,
        })
        messages.push(
          toolResult(call.id, call.name, { ok: false, error: `没有这个工具：${call.name}` }),
        )
        continue
      }

      let outcome: unknown
      emitActivity({
        id: call.id,
        phase: 'tool',
        status: 'running',
        tool: call.name,
      })
      try {
        outcome = await deps.executeRead(call.name, args, call.id)
      } catch (e) {
        if (e instanceof AgentToolEffectBlockedError) {
          emitActivity({
            id: call.id,
            phase: 'tool',
            status: 'failed',
            tool: call.name,
          })
          return {
            kind: 'error',
            message: e.message,
            messages,
            ...(e.status === 'needs_attention'
              ? {
                  needsAttention: {
                    toolCallId: e.outcome.effect.toolCallId,
                    reason: e.message,
                  },
                }
              : {}),
          }
        }
        outcome = { ok: false, error: e instanceof Error ? e.message : errText(e) }
      }
      emitActivity({
        id: call.id,
        phase: 'tool',
        status: failedToolValue(outcome) ? 'failed' : 'done',
        tool: call.name,
      })
      messages.push(toolResult(call.id, call.name, outcome))
      if (agentToolDefinitionOf(call.name)?.terminalAfter) visualReviewRan = true
    }
    emitProgress()
    if (reviewBlocksTurn) {
      const message =
        '视觉验收已完成，问题清单已返回。子代理不会自动修改画布或重新生成；' +
        '请先查看验收摘要，再决定下一步。'
      messages.push({
        role: 'assistant',
        content: message,
        ...(result.reasoning ? { reasoning: result.reasoning } : {}),
        createdAt: Date.now(),
      })
      emitProgress()
      return { kind: 'message', text: message, messages }
    }
  }

  // 刹车②：轮数上限（§4）
  return {
    kind: 'stopped',
    reason:
      `本轮连续 ${maxSteps} 步仍在推进，已保存检查点。` +
      '可以点击“继续任务”接着跑，不需要重新描述要求。',
    messages,
    checkpoint: {
      kind: 'max_steps',
      maxSteps,
      completedSteps: maxSteps,
    },
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
  toolName?: string,
): Promise<AgentLoopOutcome> {
  return runAgentTurn([...history, toolResult(callId, toolName ?? '', payload)], deps)
}

/**
 * 任意抛出物 → **人能读的一句话**。
 *
 * 实现在 `shared/result.errorTextOf`：2026-10-14 新增的工具能力探测又踩了同一个
 * `[object Object]` 坑（渠道抛的不是 `Error` 实例），说明「谁记得谁写」防不住，
 * 得共用一份。这里保留 `errText` 这个名字，因为画布与漫剧两侧都在用。
 */
export function errText(e: unknown): string {
  return errorTextOf(e)
}
