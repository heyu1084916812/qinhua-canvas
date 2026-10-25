import { describe, it, expect } from 'vitest'
import { createOpenAiChatAdapter } from './openaiChat'
import { createMemoryNetwork, createMemoryPlatform } from '../../platform/memory'
import type { ResolvedChannelConfig } from './registry'
import { ChannelError, type TextRunRequest } from './types'

function resp(status: number, obj: unknown) {
  return {
    status,
    headers: {},
    async text() {
      return JSON.stringify(obj)
    },
    async json<T>(): Promise<T> {
      return obj as T
    },
    async arrayBuffer() {
      return new ArrayBuffer(0)
    },
  }
}

const cfg: ResolvedChannelConfig = {
  id: 'c',
  protocol: 'openai-chat',
  baseUrl: 'https://x',
  credentialRef: null,
  modelCache: [],
  apiKey: 'k',
}

const signal = new AbortController().signal

function request(
  inputs: TextRunRequest['inputs'],
  prompt = '描述这张图',
): TextRunRequest {
  return { kind: 'text', channelId: 'c', model: 'gpt-4o', prompt, inputs, params: {} }
}

/** 1×1 PNG 的最小字节（8 字节签名），只用于验证「素材真的被编码进请求」 */
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function platformWith(assets: { id: string; bytes: Uint8Array; mime: string }[]) {
  return createMemoryPlatform({ rows: { assets } })
}

describe('openaiChat adapter / 基础契约', () => {
  it('verify 成功返回模型，且模型按 id 归类（gpt-4o → chat）', async () => {
    const net = createMemoryNetwork({
      handler: async () => resp(200, { data: [{ id: 'gpt-4o' }, { id: 'gpt-image-2' }] }),
    })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.models.map((m) => m.category)).toEqual(['chat', 'image'])
    }
  })

  it('verify：响应不是模型列表 → 判为不像 OpenAI 兼容接口（防假 200）', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(200, { html: 'login' }) })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    const r = await a.verify(cfg, signal)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/不是模型列表/)
  })

  it('生图 / 生视频明确不支持（这是聊天协议，不是图像协议）', async () => {
    const a = createOpenAiChatAdapter(cfg, {
      network: createMemoryNetwork({ handler: async () => resp(200, {}) }),
      assets: platformWith([]).assets,
    })
    await expect(
      a.generateImage({ ...request([]), kind: 'image' } as never, signal),
    ).rejects.toBeInstanceOf(ChannelError)
    await expect(
      a.generateVideo({ ...request([]), kind: 'video' } as never, signal),
    ).rejects.toBeInstanceOf(ChannelError)
  })
})

describe('openaiChat adapter / Comfly 全量模型目录', () => {
  const comflyCfg: ResolvedChannelConfig = {
    ...cfg,
    protocol: 'comfly',
    baseUrl: 'https://ai.comfly.org',
  }

  it('★★ 合并鉴权目录与公开模型目录，缺失模型补齐且按元数据分类', async () => {
    const urls: string[] = []
    const net = createMemoryNetwork({
      handler: async (request) => {
        urls.push(request.url)
        return resp(200, {
          data: [{ id: 'gpt-image-2' }, { id: 'existing-chat' }],
        })
      },
    })
    const remoteUrls: string[] = []
    const a = createOpenAiChatAdapter(comflyCfg, {
      network: net,
      assets: platformWith([]).assets,
      remoteBytes: {
        request: async (remoteRequest) => {
          remoteUrls.push(remoteRequest.url)
          return {
            status: 200,
            headers: {},
            text: JSON.stringify({
              data: {
                models: [
                  { key: 'gpt-image-2', tags: '对话' },
                  { key: 'gemini-3.1-flash-image', tags: '对话' },
                  { key: 'grok-imagine-video', tags: '视频,异步任务' },
                  { key: 'gemini-3.8-flash-thinking-low', tags: '对话,推理' },
                  { key: 'new-tts', tags: '文本转语音' },
                ],
              },
            }),
          }
        },
      },
    })
    const models = await a.listModels(comflyCfg, signal)

    expect(urls).toEqual(['https://ai.comfly.org/v1/models'])
    expect(remoteUrls).toEqual(['https://ai.comfly.org/api/models/price?version='])
    expect(models.map((model) => model.id)).toEqual([
      'gpt-image-2',
      'existing-chat',
      'gemini-3.1-flash-image',
      'grok-imagine-video',
      'gemini-3.8-flash-thinking-low',
      'new-tts',
    ])
    expect(models.map((model) => [model.id, model.category])).toEqual([
      ['gpt-image-2', 'image'],
      ['existing-chat', 'chat'],
      ['gemini-3.1-flash-image', 'image'],
      ['grok-imagine-video', 'video'],
      ['gemini-3.8-flash-thinking-low', 'chat'],
      ['new-tts', 'audio'],
    ])
  })

  it('公开目录失败时仍返回鉴权目录，不让模型拉取整批失败', async () => {
    const net = createMemoryNetwork({
      handler: async (_req) => {
        return resp(200, { data: [{ id: 'gpt-image-2' }] })
      },
    })
    const a = createOpenAiChatAdapter(comflyCfg, {
      network: net,
      assets: platformWith([]).assets,
      remoteBytes: {
        request: async () => ({ status: 503, headers: {}, text: '' }),
      },
    })
    const models = await a.listModels(comflyCfg, signal)
    expect(models.map((model) => model.id)).toEqual(['gpt-image-2'])
  })
})

describe('openaiChat adapter / SoonStudio 站点分类', () => {
  const soonCfg: ResolvedChannelConfig = {
    ...cfg,
    protocol: 'soonstudio',
    baseUrl: 'https://soonstudio.ai',
  }

  it('合并公开 customModels，并以 primaryType 覆盖按模型名猜出的分类', async () => {
    const net = createMemoryNetwork({
      handler: async () => resp(200, {
        data: [
          { id: 'soon-image' },
          { id: 'soon-video' },
          { id: 'soon-audio' },
          { id: 'soon-text' },
        ],
      }),
    })
    const remoteUrls: string[] = []
    const a = createOpenAiChatAdapter(soonCfg, {
      network: net,
      assets: platformWith([]).assets,
      remoteBytes: {
        request: async (request) => {
          remoteUrls.push(request.url)
          return {
            status: 200,
            headers: {},
            text: JSON.stringify({
              customModels: [
                { id: 'soon-image', name: '图像模型', primaryType: 'image' },
                { id: 'soon-video', name: '视频模型', primaryType: 'video' },
                { id: 'soon-audio', name: '音频模型', primaryType: 'audio' },
                { id: 'soon-text', name: '对话模型', primaryType: 'text' },
                { id: 'catalog-only', name: '目录独有', primaryType: 'image' },
              ],
            }),
          }
        },
      },
    })

    const models = await a.listModels(soonCfg, signal)
    expect(remoteUrls).toEqual(['https://soonstudio.ai/api/web/catalog-overrides'])
    expect(models.map((model) => [model.id, model.category])).toEqual([
      ['soon-image', 'image'],
      ['soon-video', 'video'],
      ['soon-audio', 'audio'],
      ['soon-text', 'chat'],
      ['catalog-only', 'image'],
    ])
  })
})

describe('openaiChat adapter / 多模态（上游图片送进 LLM）', () => {
  it('纯文本：content 直接是字符串（对中转站兼容性更好）', async () => {
    let body: unknown = null
    const net = createMemoryNetwork({
      handler: async (req) => {
        body = req.body
        return resp(200, { choices: [{ message: { content: 'a cat' }, finish_reason: 'stop' }] })
      },
    })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    const r = await a.completeText(request([]), signal)
    expect(r.text).toBe('a cat')
    expect(r.finishReason).toBe('stop')
    expect(body).toMatchObject({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: '描述这张图' }],
    })
  })

  it('带素材：content 变成 text + image_url 数组，图以 data URL 编码', async () => {
    let body: unknown = null
    const net = createMemoryNetwork({
      handler: async (req) => {
        body = req.body
        return resp(200, { choices: [{ message: { content: 'a cat' }, finish_reason: 'stop' }] })
      },
    })
    const a = createOpenAiChatAdapter(cfg, {
      network: net,
      assets: platformWith([{ id: 'h1', bytes: PNG_BYTES, mime: 'image/png' }]).assets,
    })
    await a.completeText(
      request([{ kind: 'asset', nodeId: 'n1', assetHash: 'h1', mime: 'image/png' }]),
      signal,
    )
    const content = (body as { messages: { content: unknown[] }[] }).messages[0]!.content
    expect(Array.isArray(content)).toBe(true)
    expect(content[0]).toEqual({ type: 'text', text: '描述这张图' })
    expect(String((content[1] as { image_url: { url: string } }).image_url.url)).toMatch(
      /^data:image\/png;base64,iVBORw0KGgo=$/,
    )
  })

  it('素材读不到 → 静默跳过，不因此让整次提问失败（图是增强项）', async () => {
    const net = createMemoryNetwork({
      handler: async () => resp(200, { choices: [{ message: { content: 'ok' } }] }),
    })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    const r = await a.completeText(
      request([{ kind: 'asset', nodeId: 'n1', assetHash: 'missing', mime: 'image/png' }]),
      signal,
    )
    expect(r.text).toBe('ok')
  })

  it('★★ Gemini 被网关要求改走原生协议时，自动重试 /v1beta 并把商品图转成 inlineData', async () => {
    const calls: { url: string; body: unknown }[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        calls.push({ url: req.url, body: req.body })
        if (req.url.endsWith('/v1/chat/completions')) {
          return resp(400, {
            error: {
              code: 'gemini_native_request_required',
              message: 'Use POST /v1beta/models/gemini-4-argon:generateContent',
            },
          })
        }
        return resp(200, {
          candidates: [
            {
              content: { parts: [{ text: '{"ok":true}' }] },
              finishReason: 'STOP',
            },
          ],
        })
      },
    })
    const adapter = createOpenAiChatAdapter(cfg, {
      network: net,
      assets: platformWith([{ id: 'h1', bytes: PNG_BYTES, mime: 'image/png' }]).assets,
    })
    const result = await adapter.completeText(
      {
        ...request(
          [{ kind: 'asset', nodeId: 'n1', assetHash: 'h1', mime: 'image/png' }],
          '',
        ),
        model: 'gemini-4-argon',
        messages: [
          { role: 'system', content: '只输出 JSON' },
          { role: 'user', content: '分析商品图' },
        ],
      },
      signal,
    )
    expect(result.text).toBe('{"ok":true}')
    expect(result.finishReason).toBe('stop')
    expect(calls.map((call) => call.url)).toEqual([
      'https://x/v1/chat/completions',
      'https://x/v1beta/models/gemini-4-argon:generateContent',
    ])
    const native = calls[1]!.body as {
      systemInstruction: { parts: { text: string }[] }
      contents: { role: string; parts: unknown[] }[]
    }
    expect(native.systemInstruction.parts[0]!.text).toBe('只输出 JSON')
    expect(native.contents[0]!.role).toBe('user')
    expect(native.contents[0]!.parts).toMatchObject([
      { text: '分析商品图' },
      { inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgo=' } },
    ])
  })

  it('响应里没有 message.content → 报解析错误，不返回空串', async () => {
    // 空串会被上层当成「模型回答了，只是回答是空的」写回节点，把用户原文冲掉。
    const net = createMemoryNetwork({
      handler: async () => resp(200, { choices: [{ finish_reason: 'stop' }] }),
    })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    await expect(a.completeText(request([]), signal)).rejects.toBeInstanceOf(ChannelError)
  })

  it('HTTP 401 → 归一为 missingKey（设置页能说清是密钥问题）', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(401, {}) })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    await expect(a.completeText(request([]), signal)).rejects.toMatchObject({
      appError: { kind: 'channel', detail: 'missingKey' },
    })
  })
})

/**
 * 工具调用（Agent 用，架构 §5.9 ④）。
 *
 * 这一组补的是**此前完全空白**的一段：适配器只在 `finish_reason` 的枚举里带了
 * `'tool_calls'` 这个字符串，请求体从不发 `tools`、响应也从不解析 `tool_calls`。
 * 结果就是「任意渠道都不能当 agent 的大脑」。
 */
describe('openaiChat adapter / 工具调用', () => {
  const tool = {
    name: 'apply_plan',
    description: '把一份画布计划落地',
    parameters: {
      type: 'object',
      properties: { summary: { type: 'string' } },
      required: ['summary'],
    },
  }

  it('★★ 传了 tools 就按 OpenAI 的 function 形态发出去；不传则请求体里没有这两个字段', async () => {
    const bodies: Record<string, unknown>[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        bodies.push(req.body as Record<string, unknown>)
        return resp(200, { choices: [{ message: { content: '好' }, finish_reason: 'stop' }] })
      },
    })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    await a.completeText(request([]), signal)
    await a.completeText({ ...request([]), tools: [tool] }, signal)

    // 不传 tools 时逐字节保持老样子（老路径不受影响）
    expect(bodies[0]!.tools).toBeUndefined()
    expect(bodies[0]!.tool_choice).toBeUndefined()
    expect(bodies[1]!.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'apply_plan',
          description: '把一份画布计划落地',
          parameters: tool.parameters,
        },
      },
    ])
    expect(bodies[1]!.tool_choice).toBe('auto')
  })

  it('★★ 多轮工具请求把节点素材编码进 OpenAI user 消息，不是空 inputs', async () => {
    const bodies: Record<string, unknown>[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        bodies.push(req.body as Record<string, unknown>)
        return resp(200, { choices: [{ message: { content: '看到标题了' }, finish_reason: 'stop' }] })
      },
    })
    const a = createOpenAiChatAdapter(cfg, {
      network: net,
      assets: platformWith([{ id: 'h1', bytes: PNG_BYTES, mime: 'image/png' }]).assets,
    })
    await a.completeText(
      {
        ...request([{ kind: 'asset', nodeId: 'n1', assetHash: 'h1', mime: 'image/png' }]),
        messages: [{ role: 'user', content: '看文字在哪个位置', imageNodeIds: ['n1'] }],
        tools: [tool],
      },
      signal,
    )

    expect(bodies[0]?.messages).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: '看文字在哪个位置' },
          expect.objectContaining({ type: 'image_url' }),
        ],
      },
    ])
  })

  it('★★ content 为 null 但带 tool_calls → 不算解析失败，原样带出', async () => {
    const net = createMemoryNetwork({
      handler: async () =>
        resp(200, {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'call_1',
                    type: 'function',
                    function: { name: 'apply_plan', arguments: '{"summary":"建两个节点"}' },
                  },
                ],
              },
              finish_reason: 'tool_calls',
            },
          ],
        }),
    })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    const r = await a.completeText({ ...request([]), tools: [tool] }, signal)

    expect(r.text).toBe('')
    expect(r.finishReason).toBe('tool_calls')
    // args 保持原始字符串：解析失败该由 caller 决定怎么处理，适配器不替它吞
    expect(r.toolCalls).toEqual([
      { id: 'call_1', name: 'apply_plan', args: '{"summary":"建两个节点"}' },
    ])
  })

  it('★ 既没有 content 也没有 tool_calls → 仍如实报解析失败（不许拿空串糊过去）', async () => {
    const net = createMemoryNetwork({ handler: async () => resp(200, { choices: [{ message: {} }] }) })
    const a = createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets })
    await expect(a.completeText(request([]), signal)).rejects.toMatchObject({
      appError: { kind: 'parse' },
    })
  })
})

/**
 * 多轮消息数组（Agent 循环用，设计文档 §4）。
 *
 * `completeText` 原先只发一条 user 消息 —— 那样模型看不到自己上一步调过什么工具，
 * 会反复调同一个（设计文档 §4「循环的刹车」要治的正是这个）。
 */
describe('openaiChat adapter / 多轮消息', () => {
  const capture = () => {
    const bodies: Record<string, unknown>[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        bodies.push(req.body as Record<string, unknown>)
        return resp(200, { choices: [{ message: { content: '好' }, finish_reason: 'stop' }] })
      },
    })
    return { bodies, adapter: createOpenAiChatAdapter(cfg, { network: net, assets: platformWith([]).assets }) }
  }

  it('★★ 给了 messages 就按它发（assistant 的 tool_calls 与 tool 结果都要还原成 OpenAI 形状）', async () => {
    const { bodies, adapter } = capture()
    await adapter.completeText(
      {
        ...request([]),
        messages: [
          { role: 'system', content: '你在操作一张画布' },
          { role: 'user', content: '建个流程' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'call_1', name: 'readGraph', args: '{"scope":"all"}' }],
          },
          { role: 'tool', content: '{"nodes":[]}', toolCallId: 'call_1' },
        ],
      },
      signal,
    )

    expect(bodies[0]!.messages).toEqual([
      { role: 'system', content: '你在操作一张画布' },
      { role: 'user', content: '建个流程' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'readGraph', arguments: '{"scope":"all"}' } },
        ],
      },
      /**
       * `name` 是给 Gemini 网关看的：它把 OpenAI 历史转成 `function_response`
       * 时要求名字非空；普通 OpenAI 渠道多这个可选字段也不受影响。
       */
      { role: 'tool', tool_call_id: 'call_1', name: 'readGraph', content: '{"nodes":[]}' },
    ])
  })

  it('★★ messages + inputs：商品图只挂到最后一条 user，历史消息仍是纯文本', async () => {
    const bodies: Record<string, unknown>[] = []
    const net = createMemoryNetwork({
      handler: async (req) => {
        bodies.push(req.body as Record<string, unknown>)
        return resp(200, { choices: [{ message: { content: '已分析' }, finish_reason: 'stop' }] })
      },
    })
    const adapter = createOpenAiChatAdapter(cfg, {
      network: net,
      assets: platformWith([{ id: 'product', bytes: PNG_BYTES, mime: 'image/png' }]).assets,
    })
    await adapter.completeText(
      {
        ...request([
          { kind: 'asset', nodeId: 'p1', assetHash: 'product', mime: 'image/png' },
        ]),
        messages: [
          { role: 'system', content: '先分析商品图' },
          { role: 'user', content: '上一轮要求' },
          { role: 'assistant', content: '收到' },
          { role: 'user', content: '这一轮写最终提示词' },
        ],
      },
      signal,
    )
    const messages = (bodies[0] as { messages: { role: string; content: unknown }[] }).messages
    expect(messages[1]).toEqual({ role: 'user', content: '上一轮要求' })
    expect(messages[2]).toEqual({ role: 'assistant', content: '收到' })
    expect(Array.isArray(messages[3]!.content)).toBe(true)
    expect(messages[3]!.content).toMatchObject([
      { type: 'text', text: '这一轮写最终提示词' },
      { type: 'image_url' },
    ])
  })

  it('★ 不给 messages 时仍是单条 user 消息（老路径一个字没变）', async () => {
    const { bodies, adapter } = capture()
    await adapter.completeText(request([], '你好'), signal)
    expect(bodies[0]!.messages).toEqual([{ role: 'user', content: '你好' }])
  })
})
