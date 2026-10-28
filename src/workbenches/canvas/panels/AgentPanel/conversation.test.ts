import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  describeToolResult,
  readableConfirmationLines,
  toConversation,
  toolLabel,
  type ConversationItem,
} from './conversation'

describe('确认卡长文分段', () => {
  it('把挤在一段的编号项拆成可读行，并保留原文内容', () => {
    const text =
      '做 Logo 前确认 3 件事：1) 职业领域与目标受众：你目前是品牌设计；' +
      '2) 沿用已经确认的品牌名 HE YU、黑白主色；' +
      '3) 画布上的旧图保留不动。'
    expect(readableConfirmationLines(text)).toEqual([
      '做 Logo 前确认 3 件事：',
      '1) 职业领域与目标受众：你目前是品牌设计；',
      '2) 沿用已经确认的品牌名 HE YU、黑白主色；',
      '3) 画布上的旧图保留不动。',
    ])
  })
})

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
    /**
     * ⚠️ **刻意不挂缩略图**（用户 2026-10-14：「工作流已建成和已经运行生成都出现了
     * 生成的图片…是不是只需要一个就行了？」）。产物图只留给「已运行生成」那张卡 ——
     * 否则节点跑完后两张卡会长出同一批图。
     */
    expect(d.nodeIds).toEqual([])
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

  it('★★ runNode 那一行报**节点名**，不是裸 id（用户 2026-10-14）', () => {
    const d = describeToolResult(
      'runNode',
      JSON.stringify({
        ok: true,
        outcomes: [
          {
            nodeId: 'node_0544f492-6542-41a1-8c3d-f64227daa489',
            ok: true,
            title: '作品集总封面',
          },
        ],
      }),
    )
    expect(d.lines.join()).toContain('作品集总封面')
    expect(d.lines.join()).not.toContain('node_0544f492')
  })

  it('★ 节点没有名字时退回 id，不编造一个', () => {
    const d = describeToolResult(
      'runNode',
      JSON.stringify({ ok: true, outcomes: [{ nodeId: 'n7', ok: true }] }),
    )
    expect(d.lines.join()).toContain('n7')
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

  it('★★ visualReview：直接列出结论、问题、建议和无法确认项', () => {
    const d = describeToolResult(
      'visualReview',
      JSON.stringify({
        ok: true,
        verdict: 'needs_changes',
        summary: 'Logo 和标题需要调整',
        referenceAssetCount: 0,
        issues: [
          {
            severity: 'blocking',
            category: 'text',
            nodeId: 'n1',
            nodeTitle: '作品集封面',
            problem: '标题有错字',
            suggestion: '把“己”改成“已”',
          },
          {
            severity: 'suggestion',
            category: 'layout',
            nodeId: 'n1',
            nodeTitle: '作品集封面',
            problem: '标题离边缘过近',
            suggestion: '增加安全边距',
          },
        ],
        limitations: ['小字是否符合平台规范无法确认'],
      }),
    )
    expect(toolLabel('visualReview')).toBe('视觉验收完成')
    expect(d.failed).toBe(false)
    expect(d.nodeIds).toEqual(['n1'])
    expect(d.lines.join('\n')).toContain('需要修改：Logo 和标题需要调整')
    expect(d.lines.join('\n')).toContain('【文字】')
    expect(d.lines.join('\n')).toContain('阻塞「作品集封面」：标题有错字')
    expect(d.lines.join('\n')).not.toContain('n1')
    expect(d.lines.join('\n')).toContain('文字、排版、画质与画面内部一致性')
    expect(d.lines.join('\n')).not.toContain('套件')
    expect(d.lines.join('\n')).toContain('未检查：小字是否符合平台规范无法确认')
  })

  it('未绑定套件时过滤模型臆测的“套件参考素材为 0”', () => {
    const d = describeToolResult(
      'visualReview',
      JSON.stringify({
        ok: true,
        verdict: 'pass',
        referenceAssetCount: 0,
        issues: [],
        limitations: ['套件参考素材为 0，无法核对品牌库'],
      }),
    )
    expect(d.lines.join('\n')).not.toContain('套件参考素材为 0')
    expect(d.lines.join('\n')).not.toContain('品牌库')
  })

  it('★ 没登记的工具给兜底标题，不假装认识', () => {
    expect(toolLabel('runNode')).toBe('已运行生成')
    expect(toolLabel('someFutureTool')).toContain('someFutureTool')
  })

  it('★ 计划工具由进度卡承接，不重复刷一屏步骤', () => {
    const items = toConversation([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'plan', name: 'proposeTaskPlan', args: '{}' },
          { id: 'step', name: 'updateTaskStep', args: '{}' },
        ],
      },
      { role: 'tool', toolCallId: 'plan', content: '{"ok":true}' },
      { role: 'tool', toolCallId: 'step', content: '{"ok":true}' },
    ])
    expect(items).toEqual([])
  })

  it('★★ result and asset tool cards prefer node titles over raw ids', () => {
    const result = describeToolResult(
      'readResult',
      JSON.stringify({
        results: [{ nodeId: 'node_8936ccef', title: '古装美女三视图设定', status: 'ok' }],
      }),
    )
    const asset = describeToolResult(
      'readAsset',
      JSON.stringify({
        assets: [{ nodeId: 'node_8936ccef', title: '古装美女三视图设定', mime: 'image/png' }],
      }),
    )
    const run = describeToolResult(
      'runNode',
      JSON.stringify({
        ok: false,
        outcomes: [{ nodeId: 'node_8936ccef', title: '古装美女三视图设定', ok: false, error: '超时' }],
      }),
    )
    for (const d of [result, asset, run]) {
      expect(d.lines.join(' ')).toContain('古装美女三视图设定')
      expect(d.lines.join(' ')).not.toContain('node_8936ccef')
    }
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

describe('工具结果跨轮次对账', () => {
  it('hides an earlier failed runNode when readResult later confirms the same node ok', () => {
    const items = toConversation([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'run', name: 'runNode', args: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'run',
        content: JSON.stringify({
          ok: false,
          outcomes: [{ nodeId: 'n1', ok: false, error: 'not recorded yet' }],
        }),
      },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'read', name: 'readResult', args: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'read',
        content: JSON.stringify({ results: [{ nodeId: 'n1', status: 'ok' }] }),
      },
    ])
    const steps = items.filter(
      (item): item is Extract<ConversationItem, { kind: 'step' }> => item.kind === 'step',
    )
    expect(steps).toHaveLength(1)
    expect(steps[0]!.tool).toBe('readResult')
    expect(steps[0]!.nodeIds).toEqual(['n1'])
  })

  it('keeps a failed runNode when no later result confirms that node', () => {
    const steps = toConversation([
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'run', name: 'runNode', args: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'run',
        content: JSON.stringify({
          ok: false,
          outcomes: [{ nodeId: 'n1', ok: false, error: 'real failure' }],
        }),
      },
    ]).filter(
      (item): item is Extract<ConversationItem, { kind: 'step' }> => item.kind === 'step',
    )
    expect(steps).toHaveLength(1)
    expect(steps[0]!.failed).toBe(true)
    expect(steps[0]!.nodeIds).toEqual(['n1'])
  })
})
