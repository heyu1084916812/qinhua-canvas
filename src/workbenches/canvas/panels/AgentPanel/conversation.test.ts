import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import { describeToolResult, toConversation, toolLabel } from './conversation'

/**
 * 对话流映射（设计文档 §8）。
 *
 * 这层要解决的是用户直接看到的问题：面板原来把工具结果**原样打印**，
 * 一屏 JSON。断言钉在「翻成人话之后的措辞与节点 id」上 ——
 * 排版可以再调，但「哪一步该说什么、该带出哪个节点」不能悄悄变。
 */

describe('工具结果 → 人话', () => {
  it('★ applyPlan：报新建几个节点，自检通过时明说通过', () => {
    const d = describeToolResult(
      'applyPlan',
      JSON.stringify({ ok: true, problems: [], createdNodeIds: ['n1', 'n2'] }),
    )
    expect(d.lines.join()).toContain('新建 2 个节点')
    expect(d.lines.join()).toContain('自检通过')
    expect(d.nodeIds).toEqual(['n1', 'n2'])
    expect(d.failed).toBe(false)
  })

  it('★★ applyPlan 自检不过：逐条问题带出来，并标成失败', () => {
    const d = describeToolResult(
      'applyPlan',
      JSON.stringify({ ok: false, problems: ['第 1 条连线缺失', 'g2 的端口接反了'] }),
    )
    expect(d.failed).toBe(true)
    expect(d.lines.join()).toContain('第 1 条连线缺失')
    expect(d.lines.join()).toContain('端口接反')
  })

  it('★★ runNode 失败：带出上游原话（不许吞成「已完成」）', () => {
    const d = describeToolResult(
      'runNode',
      JSON.stringify({
        ok: false,
        outcomes: [{ nodeId: 'n9', ok: false, error: '还没有选择渠道' }],
      }),
    )
    expect(d.failed).toBe(true)
    expect(d.lines.join()).toContain('还没有选择渠道')
    expect(d.nodeIds).toEqual(['n9'])
  })

  it('★★ runNode 成功：把节点 id 收下来（面板拿它去嵌结果图）', () => {
    const d = describeToolResult(
      'runNode',
      JSON.stringify({ ok: true, outcomes: [{ nodeId: 'n7', ok: true }] }),
    )
    expect(d.failed).toBe(false)
    expect(d.nodeIds).toEqual(['n7'])
  })

  it('★ 结果不是合法 JSON：原样给出来，不假装什么都没发生', () => {
    const d = describeToolResult('runNode', 'boom\n第二行')
    expect(d.lines).toEqual(['boom'])
    expect(d.failed).toBe(false)
  })

  it('★ readGraph：报节点数与连线数', () => {
    const d = describeToolResult(
      'readGraph',
      JSON.stringify({ nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ source: 'a', target: 'b' }] }),
    )
    expect(d.lines.join()).toContain('2 个节点')
    expect(d.lines.join()).toContain('1 条连线')
  })

  it('★ 没登记的工具给兜底标题，不假装认识', () => {
    expect(toolLabel('runNode')).toBe('已运行生成')
    expect(toolLabel('someFutureTool')).toContain('someFutureTool')
  })
})

describe('消息 → 对话条目', () => {
  it('★★ 助手调工具 → 一张步骤卡；结果消息填回同一张（不再打印 JSON）', () => {
    const messages: ChatMessage[] = [
      { role: 'user', content: '帮我建一个提示词到生成的流程' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'applyPlan', args: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        content: JSON.stringify({ ok: true, problems: [], createdNodeIds: ['n1', 'n2'] }),
      },
    ]
    const items = toConversation(messages)
    expect(items.map((i) => i.kind)).toEqual(['user', 'step'])
    const step = items[1]
    if (step?.kind !== 'step') throw new Error('第二项应当是步骤卡')
    expect(step.label).toBe('工作流已创建')
    expect(step.lines.join()).toContain('新建 2 个节点')
    // 空的 assistant 文本不该冒出一个空气泡
    expect(items.some((i) => i.kind === 'text')).toBe(false)
  })

  it('★ 用户文字进气泡、助手正文进正文（两种形态分开）', () => {
    const items = toConversation([
      { role: 'user', content: '画一只猫' },
      { role: 'assistant', content: '好了，画布上应该能看到两个节点。' },
    ])
    expect(items).toEqual([
      { kind: 'user', text: '画一只猫' },
      { kind: 'text', text: '好了，画布上应该能看到两个节点。' },
    ])
  })

  it('★ 对不上 toolCallId 的结果被丢掉，不凭空冒出一张卡', () => {
    const items = toConversation([
      { role: 'tool', toolCallId: 'ghost', content: '{"ok":true}' },
      { role: 'assistant', content: '接着说' },
    ])
    expect(items).toEqual([{ kind: 'text', text: '接着说' }])
  })

  it('★ 系统提示词不进对话流（那是给模型看的，不是给用户看的）', () => {
    const items = toConversation([
      { role: 'system', content: '你是「轻画」这张无限画布上的助手…' },
      { role: 'user', content: '你好' },
    ])
    expect(items).toEqual([{ kind: 'user', text: '你好' }])
  })
})
