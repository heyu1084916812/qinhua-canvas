import type { ModelCapability } from '../../domain/shared/capability'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import type { SafeChannelConfig } from '../ports'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type TextResult,
  type TextRunRequest,
  type VerifyResult,
} from './types'
import {
  authHeader,
  classifyError,
  isModelListBody,
  openAiBaseUrl,
  toModelCapability,
  CHAT_TIMEOUT_MS,
  VERIFY_TIMEOUT_MS,
} from './openaiCommon'

export interface OpenAiChatConfig extends SafeChannelConfig {
  apiKey: string | null
}

/** 聊天补全的一条内容片段；纯文本时直接发字符串（兼容性更好），带图才走数组形态 */
type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }

/** Uint8Array → base64。分块拼接：一次性 `String.fromCharCode(...bytes)` 在大图上会爆栈 */
function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/**
 * OpenAI 兼容协议的**聊天**能力（产品文档 §11 / §6.7）。
 *
 * 为什么必须单独开一个协议：`openai-images` 只有 `/v1/images/generations` 与
 * `/v1/images/edits`，**根本没有聊天端点**。而提示词节点的「优化 / 翻译 / 反推」
 * 全都要文本模型——此前它们只能跑在 mock 上，接了真实中转站反而退化成
 * 「暂无可用文本模型」。这个适配器就是补上那半边。
 *
 * 多模态：`inputs` 里的图像素材编码成 `image_url` 的 data URL 随消息发出，
 * 于是「上游图片 → 反推提示词」这类「像对话里发图」的用法在真实渠道上也成立。
 * 素材读不到时**静默跳过**——图是增强项，少一张不该让整次提问失败；
 * 但一张都读不到而调用方明确要带图时，仍会照发纯文本（不编造、不假装有图）。
 */
export function createOpenAiChatAdapter(config: OpenAiChatConfig, deps: ChannelDeps): ChannelAdapter {
  // 版本段由协议声明（`/v1` 或 Ark 的 `/api/v3`），基址已含版本段，端点直接续写
  const base = openAiBaseUrl(config)
  const modelsUrl = `${base}/models`
  const chatUrl = `${base}/chat/completions`

  const verify: ChannelAdapter['verify'] = async (_cfg, signal): Promise<VerifyResult> => {
    try {
      const res = await deps.network.request(
        { url: modelsUrl, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
        signal,
      )
      if (res.status < 200 || res.status >= 300) {
        // 同 openaiImages：失败时先读响应体，服务端原话是排障的唯一线索
        const detail = await res.text().catch(() => '')
        const { error, message } = classifyError(null, res.status, detail)
        return { ok: false, error, message }
      }
      const body = await res.json<{ data?: { id: string }[] }>().catch(() => null)
      if (!isModelListBody(body)) {
        return {
          ok: false,
          error: { kind: 'channel', detail: 'unsupported' },
          message: '响应不是模型列表，该地址不像 OpenAI 兼容接口',
        }
      }
      return { ok: true, models: body.data.map((m) => toModelCapability(m.id)) }
    } catch (e) {
      const { error, message } = classifyError(e)
      return { ok: false, error, message }
    }
  }

  const listModels: ChannelAdapter['listModels'] = async (_cfg, signal): Promise<ModelCapability[]> => {
    const res = await deps.network.request(
      { url: modelsUrl, method: 'GET', headers: authHeader(config.apiKey), timeoutMs: VERIFY_TIMEOUT_MS },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res.json<{ data?: { id: string }[] }>().catch(() => ({ data: [] as { id: string }[] }))
    return (body.data ?? []).map((m) => toModelCapability(m.id))
  }

  /** 读出素材并编码成 data URL；读不到的跳过（不因此让提问失败） */
  const imageParts = async (request: TextRunRequest): Promise<ContentPart[]> => {
    const parts: ContentPart[] = []
    for (const item of imageInputsOf(request.inputs)) {
      const payload = await deps.assets.read(item.assetHash)
      if (!payload) continue
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${payload.mime};base64,${toBase64(payload.bytes)}`, detail: 'auto' },
      })
    }
    return parts
  }

  const completeText: ChannelAdapter['completeText'] = async (
    request: TextRunRequest,
    signal,
  ): Promise<TextResult> => {
    const parts = await imageParts(request)
    // 无图时发字符串而非「只有一个 text 片段的数组」：部分中转对数组形态兼容不全
    const content: string | ContentPart[] =
      parts.length > 0 ? [{ type: 'text', text: request.prompt }, ...parts] : request.prompt

    const res = await deps.network.request(
      {
        url: chatUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
        body: {
          model: request.model,
          messages: [{ role: 'user', content }],
          // 温度刻意不设：让服务端用默认值。写死 0.7 会让「优化提示词」这类
          // 需要确定性的任务变得不稳定，而用户并没有要求可调温度。
        },
        timeoutMs: CHAT_TIMEOUT_MS,
      },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res
      .json<{ choices?: { message?: { content?: unknown }; finish_reason?: string }[] }>()
      .catch(() => null)
    const text = body?.choices?.[0]?.message?.content
    /**
     * 没有 content 就如实报解析失败，不返回空串。
     * 空串会被上层当成「模型回答了，只是回答是空的」写回节点——把原文冲掉，
     * 用户看到提示词凭空消失却查不到原因（正是「看起来通了」那一类）。
     */
    if (typeof text !== 'string') {
      throw new ChannelError({ kind: 'parse', raw: '聊天响应里没有 message.content' })
    }
    const reason = body?.choices?.[0]?.finish_reason
    return {
      text,
      finishReason:
        reason === 'stop' || reason === 'length' || reason === 'tool_calls' ? reason : undefined,
    }
  }

  return {
    protocol: config.protocol,
    verify,
    listModels,
    async generateImage() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
    async generateVideo() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
    completeText,
  }
}
