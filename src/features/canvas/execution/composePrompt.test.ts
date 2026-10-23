import { describe, it, expect, vi } from 'vitest'
import { composePromptFromDraft, type ComposePromptRequest } from './composePrompt'
import { PROMPT_COMPOSE_TEXT, DEFAULT_PRESET_TEXT } from '../../../domain/prompt/presetText'
import type { GraphSnapshot } from '../../../domain/canvas/model/graph'
import type { NodeSnapshot, PromptData } from '../../../domain/canvas/model/node'

function node(
  over: Partial<NodeSnapshot<PromptData>> & { id: string; type: NodeSnapshot['type'] },
): NodeSnapshot<PromptData> {
  return {
    projectId: 'p1',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    title: over.id,
    disabled: false,
    data: { text: '', upstreamPromptLinked: false, channelId: 'ch-text', model: 'gpt-4o' },
    ...over,
  } as NodeSnapshot<PromptData>
}

function graph(
  nodes: NodeSnapshot<PromptData>[],
  edges: GraphSnapshot['edges'] = [],
): GraphSnapshot {
  return { projectId: 'p1', nodes: nodes as NodeSnapshot[], edges }
}

describe('composePromptFromDraft · 面板草稿先走 LLM 再写正文', () => {
  it('★ 纯文本需求：草稿作为用户内容发出，结果写回 text', async () => {
    const prompt = node({
      id: 'p',
      type: 'prompt',
      data: {
        text: '',
        draft: '写一个小乌龟的故事',
        upstreamPromptLinked: false,
        channelId: 'ch-text',
        model: 'gpt-4o',
      },
    })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => '  一只小乌龟在沙滩上爬行  ')

    const result = await composePromptFromDraft({
      node: prompt,
      graph: graph([prompt]),
      completeText,
    })

    expect(result).toEqual({ kind: 'applied', text: '一只小乌龟在沙滩上爬行' })
    expect(completeText).toHaveBeenCalledTimes(1)
    const request = completeText.mock.calls[0]![0]
    expect(request.text).toBe('写一个小乌龟的故事')
    expect(request.system).toBe(PROMPT_COMPOSE_TEXT)
    expect(request.inputs).toEqual([])
    expect(request.channelId).toBe('ch-text')
    expect(request.model).toBe('gpt-4o')
  })

  it('★ 有上游图片：把图发给模型，并沿用「反推」指令（含后台覆盖）', async () => {
    const prompt = node({
      id: 'p',
      type: 'prompt',
      data: {
        text: '',
        draft: '反推图片',
        upstreamPromptLinked: false,
        channelId: 'ch-text',
        model: 'gpt-4o',
      },
    })
    const image = node({
      id: 'up',
      type: 'generation',
      data: {
        text: '',
        upstreamPromptLinked: false,
        mode: 'image',
        prompt: '',
        linkedPromptNodeIds: [],
        channelId: 'ch-img',
        model: 'img',
        assetHash: 'hash-up',
      } as never,
    })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => 'a turtle on the beach')

    const result = await composePromptFromDraft({
      node: prompt,
      graph: graph(
        [prompt, image],
        [{ id: 'e1', projectId: 'p1', source: 'up', target: 'p' }],
      ),
      completeText,
      presetOverrides: { describe: '后台改过的反推指令' },
    })

    expect(result).toEqual({ kind: 'applied', text: 'a turtle on the beach' })
    const request = completeText.mock.calls[0]![0]
    expect(request.system).toBe('后台改过的反推指令')
    expect(request.inputs).toEqual([
      { kind: 'asset', nodeId: 'up', assetHash: 'hash-up', mime: 'image/png' },
    ])
  })

  it('★ 有图但用户要写故事 → 不套反推指令，直接完成故事请求', async () => {
    const prompt = node({
      id: 'p',
      type: 'prompt',
      data: {
        text: '',
        draft: '用这张图写一个小乌龟的故事',
        upstreamPromptLinked: false,
        channelId: 'ch-text',
        model: 'gpt-4o',
      },
    })
    const image = node({
      id: 'up',
      type: 'generation',
      data: {
        text: '',
        upstreamPromptLinked: false,
        mode: 'image',
        prompt: '',
        linkedPromptNodeIds: [],
        channelId: 'ch-img',
        model: 'img',
        assetHash: 'hash-up',
      } as never,
    })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => '小乌龟慢慢爬向湖边。')

    const result = await composePromptFromDraft({
      node: prompt,
      graph: graph(
        [prompt, image],
        [{ id: 'e1', projectId: 'p1', source: 'up', target: 'p' }],
      ),
      completeText,
    })

    expect(result).toEqual({ kind: 'applied', text: '小乌龟慢慢爬向湖边。' })
    const request = completeText.mock.calls[0]![0]
    expect(request.system).toBe(PROMPT_COMPOSE_TEXT)
    expect(request.inputs).toHaveLength(1)
  })

  it('★ compose 指令要求按用户请求产出，不许把故事请求改写成提示词', () => {
    expect(PROMPT_COMPOSE_TEXT).toMatch(/要写故事就写故事/)
    expect(PROMPT_COMPOSE_TEXT).toMatch(/不要把请求本身改写成/)
    expect(PROMPT_COMPOSE_TEXT).toMatch(/直接完成这个请求/)
  })

  it('正文已有内容 → 不调用模型，不覆盖手写结果', async () => {
    const prompt = node({
      id: 'p',
      type: 'prompt',
      data: {
        text: '我自己写的正文',
        draft: '面板里的新要求',
        upstreamPromptLinked: false,
        channelId: 'ch-text',
        model: 'gpt-4o',
      },
    })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => '不该出现')

    const result = await composePromptFromDraft({
      node: prompt,
      graph: graph([prompt]),
      completeText,
    })

    expect(result).toEqual({ kind: 'skip', reason: 'has-text' })
    expect(completeText).not.toHaveBeenCalled()
  })

  it('面板没有草稿 → 不调用模型（缺失提示词仍由下游规划报出）', async () => {
    const prompt = node({ id: 'p', type: 'prompt' })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => '不该出现')

    const result = await composePromptFromDraft({
      node: prompt,
      graph: graph([prompt]),
      completeText,
    })

    expect(result).toEqual({ kind: 'skip', reason: 'no-draft' })
    expect(completeText).not.toHaveBeenCalled()
  })

  it('没选文本模型 → 明确报错且不发请求', async () => {
    const prompt = node({
      id: 'p',
      type: 'prompt',
      data: {
        text: '',
        draft: '写一个小乌龟的故事',
        upstreamPromptLinked: false,
        channelId: '',
        model: '',
      },
    })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => '不该出现')

    const result = await composePromptFromDraft({
      node: prompt,
      graph: graph([prompt]),
      completeText,
    })

    expect(result.kind).toBe('failed')
    expect(result.kind === 'failed' && result.message).toContain('需要文本模型')
    expect(completeText).not.toHaveBeenCalled()
  })

  it('模型返回空白 → 判失败，不写空正文', async () => {
    const prompt = node({
      id: 'p',
      type: 'prompt',
      data: {
        text: '',
        draft: '写一个小乌龟的故事',
        upstreamPromptLinked: false,
        channelId: 'ch-text',
        model: 'gpt-4o',
      },
    })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => '   ')

    const result = await composePromptFromDraft({
      node: prompt,
      graph: graph([prompt]),
      completeText,
    })

    expect(result).toEqual({ kind: 'failed', message: '提示词生成失败：模型没有返回内容' })
  })

  it('模型请求失败 → 保留原文案语义并给出失败原因', async () => {
    const prompt = node({
      id: 'p',
      type: 'prompt',
      data: {
        text: '',
        draft: '写一个小乌龟的故事',
        upstreamPromptLinked: false,
        channelId: 'ch-text',
        model: 'gpt-4o',
      },
    })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => {
      throw new Error('网关断了')
    })

    const result = await composePromptFromDraft({
      node: prompt,
      graph: graph([prompt]),
      completeText,
    })

    expect(result.kind).toBe('failed')
    expect(result.kind === 'failed' && result.message).toContain('网关断了')
  })

  it('出厂「反推」指令仍是默认值（有图且没覆盖时）', async () => {
    const prompt = node({
      id: 'p',
      type: 'prompt',
      data: {
        text: '',
        draft: '反推图片',
        upstreamPromptLinked: false,
        channelId: 'ch-text',
        model: 'gpt-4o',
      },
    })
    const image = node({
      id: 'up',
      type: 'generation',
      data: {
        text: '',
        upstreamPromptLinked: false,
        mode: 'image',
        prompt: '',
        linkedPromptNodeIds: [],
        channelId: 'ch-img',
        model: 'img',
        assetHash: 'hash-up',
      } as never,
    })
    const completeText = vi.fn(async (_req: ComposePromptRequest) => 'x')

    await composePromptFromDraft({
      node: prompt,
      graph: graph(
        [prompt, image],
        [{ id: 'e1', projectId: 'p1', source: 'up', target: 'p' }],
      ),
      completeText,
    })

    expect(completeText.mock.calls[0]![0].system).toBe(DEFAULT_PRESET_TEXT.describe)
  })
})
