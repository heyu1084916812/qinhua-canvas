import type { ChatMessage, NodeInput, ToolDeclaration } from '../../../domain/shared/execution/types'
import type { ChannelAdapter } from '../../../platform/channels/types'
import { errorTextOf } from '../../../shared/result'
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
const READ_TOOLS = new Set(['readGraph', 'readAsset', 'readResult', 'visualReview'])
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
const WRITE_TOOLS = new Set([
  'applyPlan',
  'updateTaskStep',
  'moveNodes',
  'arrangeNodes',
  'compareNodes',
  'resizeNodes',
  'sliceImage',
  'splitGrid',
])
/** 花钱 / 改已有节点：跳出循环，等用户确认 */
const CONFIRM_TOOLS = new Set([
  'proposeTaskPlan',
  'requestTaskConfirmation',
  'updateNode',
  'runNode',
  'runFrom',
  'deleteEdges',
  'deleteNodes',
  'rememberMemory',
])

export interface AgentToolRequest {
  callId: string
  name: string
  args: unknown
}

export interface AgentLoopCheckpoint {
  kind: 'max_steps'
  maxSteps: number
  completedSteps: number
}

export type AgentLoopOutcome =
  /** 模型给了文字回答，本轮结束 */
  | { kind: 'message'; text: string; messages: ChatMessage[] }
  /** 模型要做写 / 花钱的动作，等用户确认（界面据此出预览卡） */
  | { kind: 'confirm'; request: AgentToolRequest; messages: ChatMessage[] }
  /** 渠道 / 解析错误，中止本轮 */
  | { kind: 'error'; message: string; messages: ChatMessage[] }
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
  executeRead: (name: string, args: unknown) => Promise<unknown>
  /** 执行**建图类**工具（`applyPlan`）：直接落到画布上，不等确认 */
  executeWrite: (name: string, args: unknown) => Promise<unknown>
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
      inputs: [...(deps.inputs ?? [])],
      params: {},
      tools: deps.toolMode === 'json' ? [] : deps.tools,
      messages: history.map((message) => ({ ...message })),
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
  const pullSteering = async (): Promise<number> => {
    if (!deps.takeSteering) return 0
    const steering = await deps.takeSteering()
    if (steering.length > 0) messages.push(...steering)
    return steering.length
  }

  for (let step = 0; step < maxSteps; step += 1) {
    await pullSteering()
    let result: Awaited<ReturnType<typeof askModel>>
    try {
      result = await askModel(messages, deps)
    } catch (e) {
      // 渠道错误（401 / 限流）**不回填**：那是配置问题，模型改不了（§4）
      return { kind: 'error', message: e instanceof Error ? e.message : errText(e), messages }
    }

    let calls = result.toolCalls ?? []
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
        messages.push({ role: 'assistant', content: message })
        return { kind: 'message', text: message, messages }
      }
      if (!action) {
        messages.push({ role: 'assistant', content: result.text })
        return {
          kind: 'error',
          message:
            '这个对话模型不支持原生工具调用，也没有按要求输出 JSON 工具调用。请换一个支持 tools 的模型，或让它按 {"tool":"...","args":{...}} 输出。',
          messages,
        }
      }
      calls = [{ id: `json-${step}`, name: action.name, args: JSON.stringify(action.args ?? {}) }]
    }
    if (calls.length === 0) {
      if ((await pullSteering()) > 0) continue
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
          toolResult(call.id, call.name, {
            ok: false,
            error: 'arguments 不是合法 JSON，请重新发一次',
          }),
        )
        continue
      }

      /**
       * 视觉验收是只读终点：它只负责交付问题清单。验收后同一轮里若模型继续建图、
       * 改图或发起生成，就停在这里，把决定权交回用户。子代理本身没有写入口，
       * 这一道则防止主管 Agent 拿到清单后自动改动或重跑付费请求。
       */
      if (
        visualReviewRan &&
        (WRITE_TOOLS.has(call.name) || CONFIRM_TOOLS.has(call.name)) &&
        call.name !== 'updateTaskStep'
      ) {
        return {
          kind: 'stopped',
          reason:
            '视觉验收已完成，问题清单已返回。本轮的视觉验收子代理不会自动修改画布或重新生成；' +
            '请先查看问题，再由你明确决定是否修改和运行。',
          messages,
        }
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
        let wrote: unknown
        try {
          wrote = await deps.executeWrite(call.name, args)
        } catch (e) {
          wrote = { ok: false, problems: [e instanceof Error ? e.message : errText(e)] }
        }
        messages.push(toolResult(call.id, call.name, wrote))
        continue
      }
      if (!READ_TOOLS.has(call.name)) {
        messages.push(
          toolResult(call.id, call.name, { ok: false, error: `没有这个工具：${call.name}` }),
        )
        continue
      }

      let outcome: unknown
      try {
        outcome = await deps.executeRead(call.name, args)
      } catch (e) {
        outcome = { ok: false, error: e instanceof Error ? e.message : errText(e) }
      }
      messages.push(toolResult(call.id, call.name, outcome))
      if (call.name === 'visualReview') visualReviewRan = true
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
