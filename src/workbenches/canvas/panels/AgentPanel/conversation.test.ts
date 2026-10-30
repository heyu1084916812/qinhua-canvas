import { describe, expect, it } from 'vitest'
import type { ChatMessage } from '../../../../domain/shared/execution/types'
import {
  describeToolResult,
  processEntriesOf,
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

  it('★ 节点没有名字时显示「目标节点」，不把内部 id 暴露给用户', () => {
    const d = describeToolResult(
      'runNode',
      JSON.stringify({ ok: true, outcomes: [{ nodeId: 'n7', ok: true }] }),
    )
    expect(d.lines.join()).toContain('目标节点')
    expect(d.lines.join()).not.toContain('n7')
  })

  it('★ 结果不是合法 JSON：原样给出来，不假装什么都没发生', () => {
    const d = describeToolResult('runNode', 'boom\n第二行')
    expect(d.lines).toEqual(['boom'])
    expect(d.failed).toBe(false)
  })

  it('★★ 失败明细里的内部节点 id 会替换成节点标题', () => {
    const d = describeToolResult(
      'applyPlan',
      JSON.stringify({
        ok: false,
        problems: [
          '新节点 node_girl_turn_white 压在已有节点 node_brand_reference 上',
        ],
      }),
      new Map([
        ['node_girl_turn_white', '白底转身图'],
        ['node_brand_reference', '品牌参考'],
      ]),
    )
    expect(d.lines.join('\n')).toContain('白底转身图')
    expect(d.lines.join('\n')).toContain('品牌参考')
    expect(d.lines.join('\n')).not.toContain('node_')
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
        targetNodeIds: ['n1', 'n2', 'n3', 'n4'],
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
    expect(d.activityKind).toBe('image')
    expect(d.activityLabel).toBe('已查看 4 张图像')
    expect(d.nodeIds).toEqual(['n1'])
    expect(d.summaryLines).toEqual([
      '需要修改：Logo 和标题需要调整',
      '1 个严重问题 · 1 条建议',
      '优先处理：标题有错字',
    ])
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

  it('★★ 用户随消息带入的图片节点保留在回合数据里，供图像查看活动计数', () => {
    const items = toConversation([
      {
        role: 'user',
        content: '参考这四张图',
        display: '参考 @[图1](node:n1) @[图2](node:n2)',
        imageNodeIds: ['n1', 'n1', 'n2', '', 'n3'],
      },
    ])
    expect(items[0]).toMatchObject({
      kind: 'user',
      imageNodeIds: ['n1', 'n2', 'n3'],
    })
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
        assets: [
          { nodeId: 'node_8936ccef', title: '古装美女三视图设定', mime: 'image/png' },
          { nodeId: 'node_audio', title: '旁白', mime: 'audio/mpeg' },
        ],
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
    expect(asset.activityKind).toBe('image')
    expect(asset.activityLabel).toBe('已查看 1 张图像')
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

  it('★★ 带工具调用的过程正文进入折叠历史，不在正文里铺成多段', () => {
    const messages: ChatMessage[] = [
      {
        role: 'user',
        content: '换个背心和短裤',
        createdAt: 100,
      },
      {
        role: 'assistant',
        content: '先确认人物基准，再换服装。',
        createdAt: 200,
        toolCalls: [{ id: 'c1', name: 'requestTaskConfirmation', args: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        content: '{"ok":true,"approved":true}',
      },
    ]
    const items = toConversation(messages)

    expect(items).toEqual([
      { kind: 'user', text: '换个背心和短裤', createdAt: 100 },
      {
        kind: 'process',
        entries: [
          {
            id: 'process-1',
            text: '先确认人物基准，再换服装。',
            createdAt: 200,
            source: 'intent',
          },
        ],
        startedAt: 100,
      },
    ])
    expect(processEntriesOf(messages)).toEqual([
      {
        id: 'process-1',
        text: '先确认人物基准，再换服装。',
        createdAt: 200,
        source: 'intent',
      },
    ])
  })

  it('★★ 真实思考摘要不铺进正文，单独收成可展开的过程历史', () => {
    const messages: ChatMessage[] = [
      {
        role: 'assistant',
        reasoning: '先核对现有节点，确认人物参考图后再生成。',
        content: '我会先读取画布，再创建生成节点。',
        createdAt: 300,
        toolCalls: [{ id: 'c1', name: 'readGraph', args: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'c1',
        content: '{"nodes":[]}',
      },
    ]
    const items = toConversation(messages)

    expect(items.map((item) => item.kind)).toEqual(['process', 'step'])
    expect(processEntriesOf(messages)).toEqual([
      {
        id: 'process-0',
        text: '我会先读取画布，再创建生成节点。',
        createdAt: 300,
        source: 'intent',
      },
      {
        id: 'process-0-reasoning',
        text: '先核对现有节点，确认人物参考图后再生成。',
        createdAt: 300,
        source: 'reasoning',
      },
    ])
    expect(items.some((item) => item.kind === 'text')).toBe(false)
  })

  it('★ 对不上 toolCallId 的结果被丢掉，不凭空冒出一张卡', () => {
    const items = toConversation([
      { role: 'tool', toolCallId: 'ghost', content: '{"ok":true}' },
      { role: 'assistant', content: '接着说' },
    ])
    expect(items).toEqual([{ kind: 'text', text: '接着说' }])
  })

  it('★★ 一次任务的理解、思考和最终结果共用一个带起止时间的过程块', () => {
    const items = toConversation([
      { role: 'user', content: '生成一张白底产品图', createdAt: 100 },
      {
        role: 'assistant',
        reasoning: '先确认产品结构，再运行生成。',
        content: '我会先检查画布，再生成白底图。',
        createdAt: 110,
        toolCalls: [{ id: 'run', name: 'runNode', args: '{}' }],
      },
      {
        role: 'tool',
        toolCallId: 'run',
        content: JSON.stringify({
          ok: true,
          outcomes: [{ nodeId: 'node_product', title: '白底产品图', ok: true }],
        }),
      },
      {
        role: 'assistant',
        content: '白底产品图已经生成完成。',
        createdAt: 190,
      },
    ])

    const process = items.find((item) => item.kind === 'process')
    expect(process).toMatchObject({
      kind: 'process',
      startedAt: 100,
      finishedAt: 190,
      entries: [
        {
          source: 'intent',
          text: '我会先检查画布，再生成白底图。',
        },
        {
          source: 'reasoning',
          text: '先确认产品结构，再运行生成。',
        },
      ],
    })
    expect(items.at(-1)).toMatchObject({
      kind: 'text',
      text: '白底产品图已经生成完成。',
    })
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
