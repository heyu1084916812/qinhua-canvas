import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  describeToolResult,
  toConversation,
  toolLabel,
  type ConversationItem,
} from './conversation'

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

  /**
   * ★★ 失败时标题要跟着改（用户 2026-10-02 那个「重复让我确认、画布上什么都没有」
   * 的现场里最误导的一处）。
   *
   * 标题是**先**见 assistant 的 `toolCalls` 时按工具名定下的，结果要等下一条
   * tool 消息才到 —— 不改的话，一次彻底失败的计划照样顶着「工作流已创建」，
   * 用户看着一张自相矛盾的卡片，只能得出「它骗我」。
   */
  it('★★ 失败的计划不叫「工作流已创建」（标题跟着结果改）', () => {
    const items = toConversation([
      { role: 'user', content: '建个流程' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'c1', name: 'applyPlan', args: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        content: JSON.stringify({ ok: false, problems: ['第 1 个节点的类型不认识：x'] }),
      },
    ])
    const step = items.find((i) => i.kind === 'step')
    expect(step?.kind).toBe('step')
    if (step?.kind !== 'step') return
    expect(step.failed).toBe(true)
    expect(step.label).toBe('工作流没建成')
    expect(step.lines.join()).toContain('类型不认识')
  })
})

/**
 * ★★ 中间失败的重试不该留在对话里（用户 2026-10-06 第七批 #182）。
 *
 * 用户原话：「agent 给了我大量的报错（工作流没建成）这种报错不需要显示，
 * 因为他后面给我实现了」。真机连续五行「工作流没建成」之后才是「工作流已创建」，
 * 用户看到的是一屏红字加一个成功。
 *
 * 边界同样要钉住：**后面没有再成功过的失败必须留着** —— 那是真失败，
 * 藏起来会变成「看起来什么都没发生」，比多显示几行更糟。
 */
describe('重试过程不进对话（#182）', () => {
  const call = (id: string): ChatMessage => ({
    role: 'assistant',
    content: '',
    toolCalls: [{ id, name: 'applyPlan', args: '{}' }],
  })
  const result = (id: string, ok: boolean): ChatMessage => ({
    role: 'tool',
    toolCallId: id,
    content: JSON.stringify(
      ok ? { ok: true, problems: [], createdNodeIds: ['n1'] } : { ok: false, problems: ['没有新建节点'] },
    ),
  })
  const stepsOf = (items: ConversationItem[]) =>
    items.filter((i): i is Extract<ConversationItem, { kind: 'step' }> => i.kind === 'step')

  it('★★ 失败在前、成功在后 → 那几次失败不再显示（只留成功那条）', () => {
    const steps = stepsOf(
      toConversation([
        call('c1'),
        result('c1', false),
        call('c2'),
        result('c2', false),
        call('c3'),
        result('c3', true),
      ]),
    )
    expect(steps).toHaveLength(1)
    expect(steps[0]!.label).toBe('工作流已创建')
    expect(steps[0]!.failed).toBe(false)
  })

  it('★★ 后面没有再成功过 → 失败照旧留着（这是真失败，不能藏）', () => {
    const steps = stepsOf(toConversation([call('c1'), result('c1', false)]))
    expect(steps).toHaveLength(1)
    expect(steps[0]!.failed).toBe(true)
    expect(steps[0]!.label).toBe('工作流没建成')
  })

  it('★ 成功之后又失败 → 后一条要留（那是新问题，不是重试）', () => {
    const steps = stepsOf(
      toConversation([
        call('c1'),
        result('c1', false),
        call('c2'),
        result('c2', true),
        call('c3'),
        result('c3', false),
      ]),
    )
    expect(steps.map((s) => s.label)).toEqual(['工作流已创建', '工作流没建成'])
  })
})
