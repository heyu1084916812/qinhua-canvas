import { describe, expect, it, beforeEach } from 'vitest'
import { allSpecs, registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import {
  buildAgentSystemPrompt,
  buildAgentSystemPromptWithContext,
  buildCanvasVocabulary,
  buildCurrentState,
  summarizeForPrompt,
} from './agentSystemPrompt'

/**
 * 系统提示词（设计文档 §4.1）。
 *
 * 核心断言是**词表从 `nodeSpecs` 生成**：类型清单与规格表逐一对得上，
 * 融合节点的 `patch` 口也必须出现 —— 少了它，模型永远接不上局部修改图那条线。
 */

beforeEach(() => registerAllSpecs())

describe('画布词表', () => {
  it('★★ 每种注册的节点都在词表里（词表从代码生成，不手写第二份）', () => {
    const vocab = buildCanvasVocabulary()
    for (const spec of allSpecs()) {
      expect(vocab).toContain(`${spec.type}（${spec.label}）`)
    }
  })

  it('★★ 融合节点的 patch 口要报出来，并说清在哪一侧', () => {
    const vocab = buildCanvasVocabulary()
    expect(vocab).toContain('patch')
    expect(vocab).toContain('右侧')
  })

  it('★ 每种节点都写明「能接的上游」，且与其规格一致', () => {
    const vocab = buildCanvasVocabulary()
    for (const spec of allSpecs()) {
      const line = vocab.split('\n').find((l) => l.includes(`${spec.type}（${spec.label}）`))
      const next = vocab.split('\n')[vocab.split('\n').indexOf(line!) + 1]!
      for (const up of spec.accepts?.upstream ?? []) expect(next).toContain(up)
    }
  })

  /**
   * 用户 2026-10-04 的事故：「结构全对、但是没有提示词」—— 模型把正文写进了
   * `data.prompt`，而提示词节点读的是 `data.text`。原词表只说类型 / 上游 / 端口，
   * **一个字没提 data 里该写什么键**，模型只能猜。
   */
  it('★★ data 字段与「正文写在哪个键」都报出来（别让模型猜字段名）', () => {
    const vocab = buildCanvasVocabulary()
    expect(vocab).toContain('data 字段')
    expect(vocab).toContain('正文写在 data.text')
    expect(vocab).toContain('正文写在 data.prompt')
  })

  /**
   * 用户 2026-10-04 第二次事故：「自检没有通过，比例不是按照我的要求」——
   * 原始计划里模型写的是 `aspectRatio: "1:1"`，而画布读 `data.ratio`，
   * 于是比例落回默认配方（9:16），出图 1152×2048。
   *
   * 根因是**生成参数的键名从来没进过词表**（它们不在 `createDefaultData()` 里），
   * 模型只能按自己的习惯起名。词表得把白名单里的键逐个报出来。
   */
  it('★★ 生成参数的键名也要报出来，并点名「比例是 data.ratio」', () => {
    const vocab = buildCanvasVocabulary()
    expect(vocab).toContain('生成参数')
    expect(vocab).toContain('ratio')
    expect(vocab).toContain('resolution')
    expect(vocab).toContain('aspectRatio')
  })
})

describe('本次现状', () => {
  it('空画布如实说空', () => {
    expect(buildCurrentState({ nodes: [], edges: [] })).toContain('（空画布）')
  })

  it('★ 报出节点数与连线数，并标出哪些已出图', () => {
    const s = summarizeForPrompt([
      {
        id: 'n1',
        projectId: 'p',
        type: 'generation',
        parentId: null,
        x: 0,
        y: 0,
        w: 10,
        h: 10,
        title: '生成',
        disabled: false,
        data: { assetHash: 'h' },
      } as never,
    ])
    const text = buildCurrentState(s)
    expect(text).toContain('1 个节点')
    expect(text).toContain('已出图')
  })

  it('★ 继承来的参数要标明「用户说了就以他说的为准」（优先级，§11）', () => {
    const text = buildCurrentState({ nodes: [], edges: [] }, { ratio: '16:9', count: 4 })
    expect(text).toContain('ratio: 16:9')
    expect(text).toContain('count: 4')
    expect(text).toContain('以他说的为准')
  })

  it('★ 没继承值时那一节不出现（不留空标题）', () => {
    expect(buildCurrentState({ nodes: [], edges: [] })).not.toContain('之前用过的参数')
  })
})

describe('组装', () => {
  it('三段都在，且硬规则里写明了「花钱要等确认」', () => {
    const p = buildAgentSystemPrompt({ nodes: [], edges: [] })
    expect(p).toContain('轻画')
    expect(p).toContain('## 画布上有哪些节点')
    expect(p).toContain('## 现在这张画布上有什么')
    expect(p).toContain('让用户确认')
  })
})

/**
 * 素材段与技能段（设计文档 §8 / §14 M4）。
 *
 * 这两段是**界面上看不见的**：技能选没选中看得见，选了之后正文有没有真的发给模型
 * 看不见。所以它们必须有断言钉住 —— 「入口在」不等于「生效了」。
 */
describe('素材段与技能段', () => {
  const empty = { nodes: [], edges: [] }

  it('★★ 选了技能 → 名字与正文真的进了系统提示词（不是只存在选择框里）', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, {
      skill: { name: '电商详情页策划', content: '第一步：提炼卖点\n第二步：排布信息' },
    })
    expect(p).toContain('## 本会话启用的技能')
    expect(p).toContain('电商详情页策划')
    expect(p).toContain('第一步：提炼卖点')
    expect(p).toContain('第二步：排布信息')
  })

  it('★ 没选技能时那一段不出现（不留空标题）', () => {
    const p = buildAgentSystemPromptWithContext(empty)
    expect(p).not.toContain('本会话启用的技能')
  })

  it('★★ 随对话给的素材：逐个报节点 id，并要求 attach 复用、不要重复建', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, {
      assetIds: ['node_a', 'node_b'],
    })
    expect(p).toContain('## 用户随这次对话给的素材（已经在画布上了）')
    expect(p).toContain('- 素材节点 node_a')
    expect(p).toContain('- 素材节点 node_b')
    expect(p).toContain('不要重复建')
  })

  it('★ 没给素材时那一段不出现', () => {
    expect(buildAgentSystemPromptWithContext(empty)).not.toContain('随这次对话给的素材')
  })

  it('★ 素材 + 技能同时给 → 两段都在，且素材在前（先说你手里有什么）', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, {
      assetIds: ['node_a'],
      skill: { name: 'TVC 商业广告视频创作流程', content: '阶段一：脚本' },
    })
    expect(p.indexOf('随这次对话给的素材')).toBeGreaterThan(-1)
    expect(p.indexOf('本会话启用的技能')).toBeGreaterThan(p.indexOf('随这次对话给的素材'))
    expect(p).toContain('阶段一：脚本')
  })
})

/**
 * @ 引用段（用户 2026-10-02：图三 / 图四 —— 能引用画布里的节点或模型）。
 *
 * 与素材 / 技能同一个理由：引用在输入框里**看得见**，有没有真的送到模型那里
 * **看不见**。不报给模型的话，那句「@ 小猫钓鱼 改一下」就只是一段普通文字，
 * 模型不知道「小猫钓鱼」是画布上的哪个节点 —— 只能自己再建一个。
 */
describe('引用段', () => {
  const empty = { nodes: [], edges: [] }

  it('★★ @ 到的节点带 id 进提示词（只说名字等于没说）', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, {
      mentions: [{ kind: 'node', id: 'node_a1', label: '小猫钓鱼' }],
    })
    expect(p).toContain('## 用户在这句话里 @ 引用到的（他指的是这些东西）')
    expect(p).toContain('- node_a1（小猫钓鱼）')
    expect(p).toContain('不要重复建同名的节点')
  })

  it('★ @ 到的模型写成「这次就用它」，与默认值冲突时以它为准', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, {
      mentions: [{ kind: 'model', id: 'Agnes 2.5 Pro', label: 'Agnes 2.5 Pro' }],
    })
    expect(p).toContain('模型：')
    expect(p).toContain('- Agnes 2.5 Pro')
    expect(p).toContain('以他引用的为准')
  })

  it('★ 没引用时那一段不出现（不留空标题）', () => {
    expect(buildAgentSystemPromptWithContext(empty)).not.toContain('@ 引用到的')
  })

  /**
   * ★ 用户点选的图片 / 视频模型要**让模型知道**（用户 2026-10-03：「模型有三个选项」）。
   *
   * 系统已经把它们当默认配方落节点了（`recipeForGenerated`），所以这一段的作用是
   * 「别让它猜、也别让它换掉」—— 不报的话，模型会在计划里自己挑一个模型，
   * 而计划数据是**压过**默认配方的。
   */
  it('★ 图片 / 视频两档模型进了提示词，并写明「不必再写、也别换」', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, {
      mediaModels: { image: 'Agnes Image 2.5 Flash', video: 'Agnes Video 2.0' },
    })
    expect(p).toContain('## 这次建出来的生成节点用哪个模型')
    expect(p).toContain('- 图片：Agnes Image 2.5 Flash')
    expect(p).toContain('- 视频：Agnes Video 2.0')
    expect(p).toContain('不必在计划里再写一遍')
  })

  it('★ 没选图片 / 视频模型时那一段不出现', () => {
    expect(buildAgentSystemPromptWithContext(empty)).not.toContain('生成节点用哪个模型')
  })
})
