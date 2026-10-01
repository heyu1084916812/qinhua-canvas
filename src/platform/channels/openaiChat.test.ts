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
