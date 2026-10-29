import { describe, expect, it, vi } from 'vitest'
import type { AgentToolEffect } from '../../../domain/agent/job'
import type { ChatMessage } from '../../../domain/shared/execution/types'
import { AgentToolEffectBlockedError } from '../../../features/shared/agent/AgentToolEffectLedger'
import { AGENT_DEFAULT_MAX_STEPS, errText, resumeAgentTurn, runAgentTurn } from './agentLoop'

/**
 * Agent 循环（设计文档 §4）。
 *
 * 这里盯的三件事都是**手点验不出来**的：写/花钱的工具必须跳出循环等确认、
 * 打转要刹车、参数解析失败要把错误回填而不是炸掉。
 */

const tools = [{ name: 'readGraph', parameters: { type: 'object' } }]
const signal = new AbortController().signal

/**
 * 用户 2026-10-05 第 3 批：「他显示报错的时候能否把中文发我，而不是代码」。
 *
 * 渠道层抛的是 **AppError 字面量**（不是 Error），所以这条必须走
 * `asAppError → describeError` 那条路 —— 否则会落到 `JSON.stringify`
 * 把 `{"kind":"http","status":402,…}` 原样贴在对话里。
 */
describe('errText · 报错给人话', () => {
  it('★★ AppError 字面量 → 中文一句话（不出现 kind / status 这些字段名）', () => {
    const t = errText({ kind: 'http', status: 402, body: '{"error":{"message":"预扣费不足"}}' })
    expect(t).toContain('预扣费不足')
    expect(t).not.toContain('kind')
    expect(t).not.toContain('[object Object]')
  })

  it('★ 没有可读字段的未知对象 → 也带中文前缀（不是裸 JSON）', () => {
    const t = errText({ foo: 1 })
    expect(t).toContain('没预料到')
  })
})

interface Reply {
  text?: string
  toolCalls?: { id: string; name: string; args: string }[]
}

function depsWith(
  replies: Reply[],
  executeRead = vi.fn(async () => ({ nodes: [] })),
  executeWrite = vi.fn(async () => ({ ok: true, createdNodeIds: ['n1'] })),
) {
  let i = 0
  const adapter = {
    completeText: vi.fn(async () => {
      const r = replies[Math.min(i++, replies.length - 1)]!
      return { text: r.text ?? '', ...(r.toolCalls ? { toolCalls: r.toolCalls } : {}) }
    }),
  }
  return {
    deps: { adapter, channelId: 'c', model: 'm', tools, executeRead, executeWrite, signal },
    adapter,
    executeRead,
    executeWrite,
  }
}

const user = (content: string): ChatMessage[] => [{ role: 'user', content }]

/**
 * 确认**之前**的预检（用户 2026-10-02：「重复让我确认新建工作流，重复了三次，
 * 但是我的画布中没有」）。
 *
 * 那条链路的毛病是：计划不合法时仍然先弹确认卡，用户点完才被告知不行，
 * 模型再发一版差不多的 —— 确认卡一张接一张，画布一直空着。
 * 预检就是把它挪到**问用户之前**。
 */
describe('runAgentTurn · 确认之前的预检', () => {
  const runNodeCall = { toolCalls: [{ id: 'c1', name: 'runNode', args: '{"nodeIds":["n1"]}' }] }

  it('★★ 预检不过 → 不弹确认卡，把问题回填给模型让它自己改', async () => {
    const { deps } = depsWith([runNodeCall, { text: '好，我改一版' }])
    let seen = 0
    const r = await runAgentTurn(user('建个流程'), {
      ...deps,
      precheck: () => {
        seen += 1
        return { ok: false, result: { ok: false, problems: ['节点不存在：n1'] } }
      },
    })
    expect(seen).toBe(1)
    // 关键：**没有**停在 confirm —— 用户一次都不用点
    expect(r.kind).toBe('message')
    const toolMsg = r.messages.find((m) => m.role === 'tool')
    expect(String(toolMsg?.content)).toContain('节点不存在：n1')
  })

  it('★★ 预检通过才弹确认卡（能落地的照常问，不许拿预检当挡箭牌）', async () => {
    const { deps } = depsWith([runNodeCall])
    const r = await runAgentTurn(user('建个流程'), { ...deps, precheck: () => ({ ok: true }) })
    expect(r.kind).toBe('confirm')
    if (r.kind === 'confirm') expect(r.request.name).toBe('runNode')
  })

  it('★ 没接预检时行为不变（不能变成静默丢弃）', async () => {
    const { deps } = depsWith([runNodeCall])
    const r = await runAgentTurn(user('建个流程'), deps)
    expect(r.kind).toBe('confirm')
  })

  it('★★ rememberMemory 也必须先让用户确认，不能由模型直接落库', async () => {
    const call = {
      toolCalls: [
        {
          id: 'memory-call',
          name: 'rememberMemory',
          args: '{"text":"以后主色都用深绿","kind":"fact","scope":"project"}',
        },
      ],
    }
    const { deps, executeWrite } = depsWith([call])
    const r = await runAgentTurn(user('记住以后主色都用深绿'), deps)
    expect(r.kind).toBe('confirm')
    if (r.kind === 'confirm') expect(r.request.name).toBe('rememberMemory')
    expect(executeWrite).not.toHaveBeenCalled()
  })
})

describe('runAgentTurn · 基本往复', () => {
  it('★ 模型直接回答 → message，历史里多一条 assistant', async () => {
    const { deps } = depsWith([{ text: '好，我来建' }])
    const r = await runAgentTurn(user('建个流程'), deps)
    expect(r.kind).toBe('message')
    if (r.kind === 'message') {
      expect(r.text).toBe('好，我来建')
      expect(r.messages.at(-1)).toEqual({ role: 'assistant', content: '好，我来建' })
    }
  })

  it('★★ 读类工具在循环里直接执行，结果回填后继续问模型', async () => {
    const { deps, executeRead, adapter } = depsWith([
      { toolCalls: [{ id: 'c1', name: 'readGraph', args: '{"scope":"all"}' }] },
      { text: '画布是空的' },
    ])
    const r = await runAgentTurn(user('画布上有什么'), deps)

    expect(executeRead).toHaveBeenCalledWith('readGraph', { scope: 'all' }, 'c1')
    expect(adapter.completeText).toHaveBeenCalledTimes(2)
    expect(r.kind).toBe('message')
    if (r.kind === 'message') {
      const toolMsg = r.messages.find((m) => m.role === 'tool')
      expect(toolMsg?.toolCallId).toBe('c1')
      expect(toolMsg?.toolName).toBe('readGraph')
    }
  })

  it('★★ 图片输入会随每轮请求进入渠道，不再只给尺寸让模型猜选区', async () => {
    const { deps, adapter } = depsWith([{ text: '看图后再裁剪' }])
    const asset = { kind: 'asset' as const, nodeId: 'n1', assetHash: 'h1', mime: 'image/png' }
    const r = await runAgentTurn(user('看这张图'), { ...deps, inputs: [asset] })

    expect(r.kind).toBe('message')
    expect(adapter.completeText).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: [asset] }),
      expect.anything(),
    )
  })

  it('★★ 运行中引导在下一次模型调用前插入，不另起用户回合', async () => {
    const { deps, adapter } = depsWith([
      { text: '先按原计划处理' },
      { text: '已改成横版' },
    ])
    let pulls = 0
    const r = await runAgentTurn(user('做一张竖版'), {
      ...deps,
      takeSteering: async () => {
        pulls += 1
        return pulls === 2
          ? [{ role: 'user' as const, content: '改成横版' }]
          : []
      },
    })

    expect(r.kind).toBe('message')
    expect(adapter.completeText).toHaveBeenCalledTimes(2)
    const calls = adapter.completeText.mock.calls as unknown as [
      { messages: ChatMessage[] },
      AbortSignal,
    ][]
    const firstRequest = calls[0]?.[0]
    const secondRequest = calls[1]?.[0]
    expect(firstRequest.messages).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ content: '改成横版' })]),
    )
    expect(secondRequest.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: '改成横版' })]),
    )
  })

  /**
   * ★★ 建图**直接落地**（用户 2026-10-02：「他直接给我新建进去，但是生成与否
   * 需要让我确认，取消后也不会撤回已经新建到画布中的工作流」）。
   *
   * 与「花钱才拦」配套看：建节点不花钱、且整份计划是一次原子 dispatch（一次撤销
   * 全回退），拦它没有收益，只会把「批准建图」和「批准花钱」混成一件事。
   */
  it('★★ 建图类（applyPlan）直接执行，不停下来问', async () => {
    const { deps, executeWrite, executeRead } = depsWith([
      { toolCalls: [{ id: 'c1', name: 'applyPlan', args: '{"summary":"x","nodes":[],"edges":[]}' }] },
      { text: '建好了' },
    ])
    const r = await runAgentTurn(user('建个流程'), deps)

    expect(executeWrite).toHaveBeenCalledWith(
      'applyPlan',
      { summary: 'x', nodes: [], edges: [] },
      'c1',
    )
    expect(executeRead).not.toHaveBeenCalled()
    expect(r.kind).toBe('message')
  })

  it('★★ 建图工具已开始但结果未知时，本轮直接转 needs_attention，不再问模型下一步', async () => {
    const effect: AgentToolEffect = {
      effectKey: 'agent:job:step:call',
      stepId: 'step',
      toolCallId: 'c1',
      toolName: 'applyPlan',
      argsDigest: 'digest',
      state: 'started',
      startedAt: 1,
    }
    const blocked = new AgentToolEffectBlockedError(
      '工具已经开始但结果未知，不会自动重发',
      'needs_attention',
      { kind: 'pending', reason: '工具已经开始但结果未知，不会自动重发', effect },
    )
    const { deps, adapter } = depsWith(
      [
        {
          toolCalls: [
            {
              id: 'c1',
              name: 'applyPlan',
              args: '{"summary":"x","nodes":[],"edges":[]}',
            },
          ],
        },
        { text: '不该继续' },
      ],
      undefined,
      vi.fn(async () => {
        throw blocked
      }),
    )

    const r = await runAgentTurn(user('建个流程'), deps)
    expect(r).toMatchObject({
      kind: 'error',
      message: '工具已经开始但结果未知，不会自动重发',
      needsAttention: {
        toolCallId: 'c1',
        reason: '工具已经开始但结果未知，不会自动重发',
      },
    })
    expect(adapter.completeText).toHaveBeenCalledTimes(1)
  })

  it('★★ 读工具或视觉验收遇到未决副作用时也停止，不把阻塞当成普通工具错误', async () => {
    const effect: AgentToolEffect = {
      effectKey: 'agent:job:step:review',
      stepId: 'step',
      toolCallId: 'review',
      toolName: 'visualReview',
      argsDigest: 'digest',
      state: 'started',
      startedAt: 1,
    }
    const blocked = new AgentToolEffectBlockedError(
      '还有未决工具调用',
      'needs_attention',
      { kind: 'pending', reason: '还有未决工具调用', effect },
    )
    const { deps, adapter } = depsWith(
      [
        {
          toolCalls: [
            {
              id: 'review',
              name: 'visualReview',
              args: '{"nodeIds":["n1"]}',
            },
          ],
        },
        { text: '不该继续' },
      ],
      vi.fn(async () => {
        throw blocked
      }),
    )

    const r = await runAgentTurn(user('验收'), deps)
    expect(r).toMatchObject({
      kind: 'error',
      needsAttention: { toolCallId: 'review' },
    })
    expect(adapter.completeText).toHaveBeenCalledTimes(1)
  })

  it('★★ 节点移动与排列直接复用画布命令，不误弹确认卡', async () => {
    const { deps, executeWrite, executeRead } = depsWith([
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'moveNodes',
            args: '{"nodeIds":["n1"],"dx":40,"dy":20}',
          },
        ],
      },
      { text: '移动好了' },
    ])
    const r = await runAgentTurn(user('把节点往右下移动'), deps)

    expect(executeWrite).toHaveBeenCalledWith(
      'moveNodes',
      {
        nodeIds: ['n1'],
        dx: 40,
        dy: 20,
      },
      'c1',
    )
    expect(executeRead).not.toHaveBeenCalled()
    expect(r.kind).toBe('message')
  })

  it('★ 实时活动只上报公开阶段与真实工具开始/结束', async () => {
    const { deps } = depsWith([
      {
        toolCalls: [
          {
            id: 'read',
            name: 'readGraph',
            args: '{"scope":"all"}',
          },
        ],
      },
      { text: '画布看完了' },
    ])
    const events: string[] = []
    const r = await runAgentTurn(user('看看画布'), {
      ...deps,
      onActivity: (activity) =>
        events.push(
          `${activity.phase}:${activity.tool ?? ''}:${activity.status}`,
        ),
    })

    expect(r.kind).toBe('message')
    expect(events).toContain('thinking::running')
    expect(events).toContain('tool:readGraph:running')
    expect(events).toContain('tool:readGraph:done')
    expect(events.filter((event) => event === 'tool:readGraph:running')).toHaveLength(1)
  })

  it('★★ 取消连线会停下来让用户确认', async () => {
    const { deps, executeWrite } = depsWith([
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'deleteEdges',
            args: '{"edgeIds":["edge-1"]}',
          },
        ],
      },
    ])
    const r = await runAgentTurn(user('取消这条连线'), deps)

    expect(executeWrite).not.toHaveBeenCalled()
    expect(r).toMatchObject({
      kind: 'confirm',
      request: { name: 'deleteEdges', args: { edgeIds: ['edge-1'] } },
    })
  })

  it('★★ 删除节点会停下来让用户确认', async () => {
    const { deps, executeWrite } = depsWith([
      {
        toolCalls: [
          {
            id: 'c1',
            name: 'deleteNodes',
            args: '{"nodeIds":["n1"]}',
          },
        ],
      },
    ])
    const r = await runAgentTurn(user('删除这个节点'), deps)

    expect(executeWrite).not.toHaveBeenCalled()
    expect(r).toMatchObject({
      kind: 'confirm',
      request: { name: 'deleteNodes', args: { nodeIds: ['n1'] } },
    })
  })

  it('★★ 花钱的工具不执行，跳出循环等确认（否则「确认」是空话）', async () => {
    const { deps, executeRead, executeWrite } = depsWith([
      { toolCalls: [{ id: 'c1', name: 'runNode', args: '{"nodeIds":["n1"]}' }] },
    ])
    const r = await runAgentTurn(user('跑一下'), deps)

    expect(r.kind).toBe('confirm')
    if (r.kind === 'confirm') {
      expect(r.request.name).toBe('runNode')
      expect(r.request.callId).toBe('c1')
      expect(r.request.args).toEqual({ nodeIds: ['n1'] })
    }
    expect(executeRead).not.toHaveBeenCalled()
    expect(executeWrite).not.toHaveBeenCalled()
  })

  it('★★ 视觉验收后禁止同一轮自动写画布或重跑付费请求', async () => {
    const { deps, executeRead, executeWrite } = depsWith([
      {
        toolCalls: [
          {
            id: 'review',
            name: 'visualReview',
            args: '{"nodeIds":["n1"],"checklist":"检查文字"}',
          },
          {
            id: 'run',
            name: 'runNode',
            args: '{"nodeIds":["n1"]}',
          },
        ],
      },
    ])
    const r = await runAgentTurn(user('验收后直接重跑'), deps)

    expect(r.kind).toBe('message')
    if (r.kind === 'message') {
      expect(r.text).toContain('不会自动修改画布或重新生成')
    }
    expect(executeRead).toHaveBeenCalledWith(
      'visualReview',
      {
        nodeIds: ['n1'],
        checklist: '检查文字',
      },
      'review',
    )
    expect(executeWrite).not.toHaveBeenCalled()
  })

  it('★★ 视觉验收返回时刚收到引导：丢弃旧动作并带新要求重新问模型', async () => {
    const { deps, executeRead, executeWrite, adapter } = depsWith([
      {
        toolCalls: [
          {
            id: 'review',
            name: 'visualReview',
            args: '{"nodeIds":["n1"]}',
          },
        ],
      },
      {
        toolCalls: [
          {
            id: 'old-action',
            name: 'runNode',
            args: '{"nodeIds":["n1"]}',
          },
        ],
      },
      { text: '先完成验收，再按最新要求继续。' },
    ])
    const steer = { role: 'user' as const, content: '不要跑旧节点，改成生成 Lookbook' }
    let pulls = 0
    const r = await runAgentTurn(user('验收后继续旧任务'), {
      ...deps,
      takeSteering: async () => {
        pulls += 1
        return pulls === 3 ? [steer] : []
      },
    })

    expect(r.kind).toBe('message')
    if (r.kind === 'message') {
      expect(r.text).toBe('先完成验收，再按最新要求继续。')
      expect(r.messages).toContainEqual(steer)
    }
    expect(executeRead).toHaveBeenCalledWith(
      'visualReview',
      { nodeIds: ['n1'] },
      'review',
    )
    expect(executeWrite).not.toHaveBeenCalled()
    expect(adapter.completeText).toHaveBeenCalledTimes(3)
  })

  it('★★ 视觉验收后不能替用户把计划步骤直接收口', async () => {
    const { deps, executeWrite } = depsWith([
      {
        toolCalls: [
          {
            id: 'review',
            name: 'visualReview',
            args: '{"nodeIds":["n1"]}',
          },
          {
            id: 'step',
            name: 'updateTaskStep',
            args: '{"stepId":"review","status":"done"}',
          },
          {
            id: 'run',
            name: 'runNode',
            args: '{"nodeIds":["n1"]}',
          },
        ],
      },
    ])
    const r = await runAgentTurn(user('验完并记录结果'), deps)

    expect(r.kind).toBe('message')
    expect(executeWrite).not.toHaveBeenCalled()
  })

  it('★★ 视觉验收后允许发起用户结果验收确认卡', async () => {
    const { deps, executeWrite } = depsWith([
      {
        toolCalls: [
          {
            id: 'review',
            name: 'visualReview',
            args: '{"nodeIds":["n1"]}',
          },
          {
            id: 'confirm',
            name: 'requestTaskConfirmation',
            args:
              '{"stepId":"review","purpose":"review","question":"这组图是否满意？"}',
          },
        ],
      },
    ])
    const r = await runAgentTurn(user('请验收这一组图'), deps)

    expect(r.kind).toBe('confirm')
    if (r.kind === 'confirm') {
      expect(r.request).toMatchObject({
        name: 'requestTaskConfirmation',
        args: expect.objectContaining({
          stepId: 'review',
          purpose: 'review',
        }),
      })
    }
    expect(executeWrite).not.toHaveBeenCalled()
  })

  it('★★ 确认后用 resumeAgentTurn 把结果喂回去，模型能看到自己做过什么', async () => {
    const { deps } = depsWith([
      { toolCalls: [{ id: 'c1', name: 'runNode', args: '{"nodeIds":["n1"]}' }] },
      { text: '跑完了' },
    ])
    const first = await runAgentTurn(user('建个流程'), deps)
    expect(first.kind).toBe('confirm')
    if (first.kind !== 'confirm') return

    const second = await resumeAgentTurn(first.messages, first.request.callId, { ok: true }, deps)
    expect(second.kind).toBe('message')
    if (second.kind === 'message') expect(second.text).toBe('跑完了')
  })
})

describe('runAgentTurn · JSON 工具调用降级（路线 B）', () => {
  it('模型不返回 tool_calls 时，按 JSON 输出 applyPlan，系统照样执行', async () => {
    const { deps, executeWrite } = depsWith([
      { text: '```json\n{"tool":"applyPlan","args":{"summary":"x","nodes":[],"edges":[]}}\n```' },
      { text: '{"tool":"final","args":{"message":"建好了"}}' },
    ])
    const r = await runAgentTurn(user('建个流程'), { ...deps, toolMode: 'json' })
    expect(executeWrite).toHaveBeenCalledWith(
      'applyPlan',
      expect.anything(),
      expect.stringMatching(/^jsoncall/),
    )
    expect(r.kind).toBe('message')
    if (r.kind === 'message') expect(r.text).toBe('建好了')
  })

  it('模型连 JSON 都不给：如实报错，不把“无法调用工具”当最终回答', async () => {
    const { deps } = depsWith([{ text: '我无法调用工具' }])
    const r = await runAgentTurn(user('建个流程'), { ...deps, toolMode: 'json' })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('JSON')
  })
})

describe('runAgentTurn · 刹车与失败回填', () => {
  it('★★ 参数不是合法 JSON → 回填错误让模型重发，不炸掉', async () => {
    const { deps, executeRead } = depsWith([
      { toolCalls: [{ id: 'c1', name: 'readGraph', args: '{坏掉的' }] },
      { text: '我重试了' },
    ])
    const r = await runAgentTurn(user('x'), deps)
    expect(r.kind).toBe('message')
    expect(executeRead).not.toHaveBeenCalled()
  })

  it('★★ 反复调同一个工具（同样参数）→ 第 3 次直接停下', async () => {
    const same = { id: 'c1', name: 'readGraph', args: '{"scope":"all"}' }
    const { deps } = depsWith([
      { toolCalls: [same] },
      { toolCalls: [{ ...same, id: 'c2' }] },
      { toolCalls: [{ ...same, id: 'c3' }] },
    ])
    const r = await runAgentTurn(user('x'), deps)
    expect(r.kind).toBe('stopped')
    if (r.kind === 'stopped') expect(r.reason).toContain('反复调用')
  })

  it('★ 轮数上限兜底：模型一直要求调工具也会停', async () => {
    let n = 0
    const adapter = {
      completeText: vi.fn(async () => ({
        text: '',
        // 每次换参数，避开「同参数打转」那条刹车，专门验轮数上限
        toolCalls: [{ id: `c${n}`, name: 'readGraph', args: `{"scope":"all","n":${n++}}` }],
      })),
    }
    const r = await runAgentTurn(user('x'), {
      adapter,
      channelId: 'c',
      model: 'm',
      tools,
      executeRead: async () => ({}),
      executeWrite: async () => ({ ok: true }),
      signal,
      maxSteps: 3,
    })
    expect(r.kind).toBe('stopped')
    if (r.kind === 'stopped') {
      expect(r.checkpoint).toMatchObject({
        kind: 'max_steps',
        maxSteps: 3,
      })
      expect(r.reason).toContain('检查点')
    }
    expect(adapter.completeText).toHaveBeenCalledTimes(3)
    expect(AGENT_DEFAULT_MAX_STEPS).toBeGreaterThan(1)
  })

  it('★ 从轮数检查点继续时复用已有工具结果，不重放上一步', async () => {
    let n = 0
    const first = {
      completeText: vi.fn(async () => ({
        text: '',
        toolCalls: [
          {
            id: `checkpoint-${n}`,
            name: 'readGraph',
            args: `{"scope":"all","n":${n++}}`,
          },
        ],
      })),
    }
    const firstOutcome = await runAgentTurn(user('长任务'), {
      adapter: first,
      channelId: 'c',
      model: 'm',
      tools,
      executeRead: async () => ({ ok: true }),
      executeWrite: async () => ({ ok: true }),
      signal,
      maxSteps: 2,
    })
    expect(firstOutcome.kind).toBe('stopped')
    if (firstOutcome.kind !== 'stopped') return
    expect(firstOutcome.checkpoint).toMatchObject({ kind: 'max_steps' })

    const second = {
      completeText: vi.fn(async () => ({ text: '已从检查点完成' })),
    }
    const continued = await runAgentTurn(firstOutcome.messages, {
      adapter: second,
      channelId: 'c',
      model: 'm',
      tools,
      executeRead: async () => ({ ok: true }),
      executeWrite: async () => ({ ok: true }),
      signal,
      maxSteps: 2,
    })
    expect(continued).toMatchObject({
      kind: 'message',
      text: '已从检查点完成',
    })
    expect(first.completeText).toHaveBeenCalledTimes(2)
    expect(second.completeText).toHaveBeenCalledTimes(1)
  })

  it('★★ 渠道报错 → 直接中止本轮，不回填（配置问题模型改不了）', async () => {
    const adapter = {
      completeText: vi.fn(async () => {
        throw new Error('API Key 无效或无权限（401/403）')
      }),
    }
    const r = await runAgentTurn(user('x'), {
      adapter,
      channelId: 'c',
      model: 'm',
      tools,
      executeRead: async () => ({}),
      executeWrite: async () => ({ ok: true }),
      signal,
    })
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('401')
  })
})
