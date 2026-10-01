import { describe, expect, it, beforeEach } from 'vitest'
import { allSpecs, registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import {
  buildAgentSystemPrompt,
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
