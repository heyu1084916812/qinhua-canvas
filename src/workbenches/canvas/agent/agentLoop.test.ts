import { describe, expect, it, vi } from 'vitest'
import type { ChatMessage } from '../../../domain/shared/execution/types'
import { AGENT_DEFAULT_MAX_STEPS, resumeAgentTurn, runAgentTurn } from './agentLoop'

/**
 * Agent 循环（设计文档 §4）。
 *
 * 这里盯的三件事都是**手点验不出来**的：写/花钱的工具必须跳出循环等确认、
 * 打转要刹车、参数解析失败要把错误回填而不是炸掉。
 */

const tools = [{ name: 'readGraph', parameters: { type: 'object' } }]
const signal = new AbortController().signal

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

    expect(executeRead).toHaveBeenCalledWith('readGraph', { scope: 'all' })
    expect(adapter.completeText).toHaveBeenCalledTimes(2)
    expect(r.kind).toBe('message')
    if (r.kind === 'message') {
      const toolMsg = r.messages.find((m) => m.role === 'tool')
      expect(toolMsg?.toolCallId).toBe('c1')
    }
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

    expect(executeWrite).toHaveBeenCalledWith('applyPlan', { summary: 'x', nodes: [], edges: [] })
    expect(executeRead).not.toHaveBeenCalled()
    expect(r.kind).toBe('message')
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
    expect(adapter.completeText).toHaveBeenCalledTimes(3)
    expect(AGENT_DEFAULT_MAX_STEPS).toBeGreaterThan(1)
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
