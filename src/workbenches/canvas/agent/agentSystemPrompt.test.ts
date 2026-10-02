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
 * 生成参数段（用户 2026-10-02：「要有模型的选择，技能的选择，比例尺寸，画质的选择」）。
 *
 * 与素材 / 技能同一个理由：选择器在界面上**看得见**，选完有没有真的生效**看不见**。
 * 不告诉模型的话，它只会按自己的想法填节点 data，用户选了 16:9 却拿到 1:1 ——
 * 那是最典型的「功能摆着不生效」。
 */
describe('生成参数段', () => {
  const empty = { nodes: [], edges: [] }

  it('★★ 面板上选过的比例 / 画质 / 质量真的进了系统提示词', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, {
      params: { ratio: '16:9', resolution: '2k', quality: 'high' },
    })
    expect(p).toContain('## 用户在这条对话里指定的生成参数')
    expect(p).toContain('- ratio: 16:9')
    expect(p).toContain('- resolution: 2k')
    expect(p).toContain('- quality: high')
  })

  it('★ 没选过参数时那一段不出现（不留空标题）', () => {
    expect(buildAgentSystemPromptWithContext(empty)).not.toContain('指定的生成参数')
  })

  /**
   * 「自动」= 用户没指定。若把 auto 也报给模型，每一轮都会塞三条 `auto`：
   * 白白占掉模型的注意力，还容易被读成「用户要求在节点上写 auto」。
   */
  it('★ 空值与 auto 都不进提示词（只报用户真选过的档位）', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, {
      params: { ratio: '16:9', resolution: '', quality: 'auto' },
    })
    expect(p).toContain('- ratio: 16:9')
    expect(p).not.toContain('- resolution')
    expect(p).not.toContain('- quality')
  })

  it('★ 写清优先级：这句对话里另有要求时以对话为准（§11）', () => {
    const p = buildAgentSystemPromptWithContext(empty, undefined, { params: { ratio: '1:1' } })
    expect(p).toContain('以他说的为准')
  })
})
