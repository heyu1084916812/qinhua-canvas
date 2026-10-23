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
import { prepareModelImageInput } from './chatImageInput'

export interface OpenAiChatConfig extends SafeChannelConfig {
  apiKey: string | null
}

interface ComflyCatalogModel {
  key?: unknown
  name?: unknown
  categories?: unknown
  tags?: unknown
  input_modalities?: unknown
  output_modalities?: unknown
}

interface SoonStudioCatalogModel {
  id?: unknown
  name?: unknown
  maker?: unknown
  primaryType?: unknown
}

function stringValues(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : []
}

/**
 * Comfly 的公开模型目录比鉴权后的 `/v1/models` 更完整：
 * 实测同一时刻前者 881 条、后者 751 条。公开目录还带 `tags / categories /
 * input_modalities / output_modalities`，比按模型名猜类别可靠。
 */
function comflyCategoryOf(model: ComflyCatalogModel): ModelCapability['category'] | undefined {
  const output = stringValues(model.output_modalities).map((value) => value.toLowerCase())
  if (output.includes('video')) return 'video'
  if (output.includes('image')) return 'image'
  if (output.includes('audio')) return 'audio'

  const categories = stringValues(model.categories).map((value) => value.toLowerCase())
  if (categories.includes('video')) return 'video'
  if (categories.includes('image')) return 'image'
  if (categories.includes('audio')) return 'audio'
  if (categories.includes('text')) return 'chat'

  const tags = stringValues(model.tags).join(',')
  if (tags.includes('视频')) return 'video'
  if (tags.includes('绘图') || tags.includes('图像编辑')) return 'image'
  if (tags.includes('文本转语音') || tags.includes('音频') || tags.includes('音乐')) return 'audio'
  if (tags.includes('对话') || tags.includes('识图') || tags.includes('推理')) return 'chat'
  return undefined
}

function mergeComflyCatalog(
  official: readonly ModelCapability[],
  catalog: readonly ComflyCatalogModel[],
): ModelCapability[] {
  const merged = new Map(official.map((model) => [model.id, model]))
  for (const item of catalog) {
    const id =
      typeof item.key === 'string' && item.key.trim()
        ? item.key.trim()
        : typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : ''
    if (!id) continue
    /**
     * 模型 ID 里的显式媒体词优先于站点 tags。实测 Comfly 把
     * `gemini-3.1-flash-image` 的 tags 错标成“对话”，但 ID 明确含 image；
     * 让错误元数据覆盖 ID 会把它重新塞回对话模型下拉。
     */
    const idCategory = toModelCapability(id).category
    const hint = idCategory === 'chat' ? comflyCategoryOf(item) : idCategory
    if (!merged.has(id) || hint) merged.set(id, toModelCapability(id, hint))
  }
  return [...merged.values()]
}

function soonStudioCategoryOf(
  model: SoonStudioCatalogModel,
): ModelCapability['category'] | undefined {
  const type =
    typeof model.primaryType === 'string' ? model.primaryType.trim().toLowerCase() : ''
  if (type === 'video') return 'video'
  if (type === 'image') return 'image'
  if (type === 'audio') return 'audio'
  if (type === 'text') return 'chat'
  return undefined
}

function mergeSoonStudioCatalog(
  official: readonly ModelCapability[],
  catalog: readonly SoonStudioCatalogModel[],
): ModelCapability[] {
  const merged = new Map(official.map((model) => [model.id, model]))
  for (const item of catalog) {
    const id =
      typeof item.id === 'string' && item.id.trim()
        ? item.id.trim()
        : typeof item.name === 'string' && item.name.trim()
          ? item.name.trim()
          : ''
    if (!id) continue
    /**
     * SoonStudio 公开目录的 `primaryType` 就是站点自己的分栏，优先于按名称猜。
     * 站点没给时才保留 ID 中明确的媒体词。
     */
    const siteCategory = soonStudioCategoryOf(item)
    const idCategory = toModelCapability(id).category
    const hint = siteCategory ?? (idCategory === 'chat' ? undefined : idCategory)
    if (!merged.has(id) || hint) merged.set(id, toModelCapability(id, hint))
  }
  return [...merged.values()]
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

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }

interface GeminiNativeBody {
  candidates?: {
    content?: { parts?: { text?: unknown }[] }
    finishReason?: string
  }[]
}

function geminiInlinePart(part: ContentPart): GeminiPart | null {
  if (part.type !== 'image_url') return null
  const match = /^data:([^;]+);base64,(.+)$/s.exec(part.image_url.url)
  return match
    ? { inlineData: { mimeType: match[1]!, data: match[2]! } }
    : null
}

/**
 * SoonStudio 等网关会把 Gemini 模型暴露在 `/v1/models`，但 OpenAI
 * `/v1/chat/completions` 会被明确拒绝，要求改用 Google 原生
 * `/v1beta/models/{id}:generateContent`。只在这类**明确的协议迁移错误**上重试，
 * 不把所有模型都盲目打成两次请求。
 */
function geminiNativeRequired(status: number, detail: string): boolean {
  if (![400, 404, 405, 415].includes(status)) return false
  return /gemini_native_request_required|Use POST \/v1beta\/models\/|generateContent/i.test(detail)
}

function geminiNativeBody(
  request: TextRunRequest,
  imageParts: readonly ContentPart[],
): Record<string, unknown> {
  const source =
    request.messages && request.messages.length > 0
      ? request.messages.map((message) => ({ role: message.role, content: message.content }))
      : [{ role: 'user' as const, content: request.prompt }]
  const systemInstruction = source
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n')
  const inline = imageParts.map(geminiInlinePart).filter((part): part is GeminiPart => !!part)
  const lastUser = source.reduce((acc, message, index) => (message.role === 'user' ? index : acc), -1)
  const contents = source.flatMap((message, index) =>
    message.role === 'system'
      ? []
      : [{
        role: message.role === 'assistant' ? 'model' : 'user',
        parts: [
          { text: message.content || ' ' },
          ...(index === lastUser ? inline : []),
        ],
      }],
  )
  return {
    ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
    contents,
  }
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
  const comflyCatalogUrl =
    config.protocol === 'comfly'
      ? new URL('/api/models/price?version=', base).toString()
      : null
  const soonStudioCatalogUrl =
    config.protocol === 'soonstudio'
      ? new URL('/api/web/catalog-overrides', base).toString()
      : null

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
    const publicCatalogUrl = comflyCatalogUrl ?? soonStudioCatalogUrl
    const catalogPromise = publicCatalogUrl
      ? (deps.remoteBytes?.request
          ? deps.remoteBytes.request({
              url: publicCatalogUrl,
              method: 'GET',
              headers: { accept: 'application/json' },
              timeoutMs: VERIFY_TIMEOUT_MS,
            })
          : deps.network.request(
              {
                url: publicCatalogUrl,
                method: 'GET',
                headers: { accept: 'application/json' },
                timeoutMs: VERIFY_TIMEOUT_MS,
              },
              signal,
            )
        )
          .then(async (response) => {
            if (response.status < 200 || response.status >= 300) return []
            const text =
              typeof response.text === 'string' ? response.text : await response.text()
            try {
              if (comflyCatalogUrl) {
                const body = JSON.parse(text) as { data?: { models?: ComflyCatalogModel[] } }
                return Array.isArray(body.data?.models)
                  ? body.data.models.map((item) => ({ catalog: 'comfly' as const, item }))
                  : []
              }
              const body = JSON.parse(text) as {
                customModels?: SoonStudioCatalogModel[]
              }
              return Array.isArray(body.customModels)
                ? body.customModels.map((item) => ({ catalog: 'soonstudio' as const, item }))
                : []
            } catch {
              return []
            }
          })
          .catch(() => [])
      : Promise.resolve([] as (
          | { catalog: 'comfly'; item: ComflyCatalogModel }
          | { catalog: 'soonstudio'; item: SoonStudioCatalogModel }
        )[])
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
    const official = (body.data ?? []).map((m) => toModelCapability(m.id))
    const catalog = await catalogPromise
    if (catalog.length === 0) return official
    return catalog[0].catalog === 'soonstudio'
      ? mergeSoonStudioCatalog(
          official,
          catalog.map((entry) => entry.item as SoonStudioCatalogModel),
        )
      : mergeComflyCatalog(
          official,
          catalog.map((entry) => entry.item as ComflyCatalogModel),
        )
  }

  /** 读出素材并编码成 data URL；读不到的跳过（不因此让提问失败） */
  const imageParts = async (request: TextRunRequest): Promise<ContentPart[]> => {
    const parts: ContentPart[] = []
    for (const item of imageInputsOf(request.inputs)) {
      const payload = await deps.assets.read(item.assetHash)
      if (!payload) continue
      const prepared = await prepareModelImageInput({
        bytes: payload.bytes,
        mime: payload.mime,
      })
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${prepared.mime};base64,${toBase64(prepared.bytes)}`,
          detail: 'auto',
        },
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

    /**
     * 消息数组：给了 `messages` 就用它（Agent 多轮），否则退回「单条 user」老路径。
     *
     * 图片只拼进**最后一条 user 消息**：把图片挂到历史消息上会让模型重复看到同一张图，
     * 既费 token 也可能让它以为有多张。
     */
    const toOpenAiMessage = (
      m: {
        role: string
        content: string
        toolCalls?: { id: string; name: string; args: string }[]
        toolCallId?: string
        toolName?: string
      },
      isLastUser: boolean,
    ): Record<string, unknown> => {
      if (m.role === 'tool') {
        /**
         * OpenAI 的 tool 消息只要求 `tool_call_id`，但 Gemini 网关在把历史转成
         * `function_response` 时要求 **name 非空**。真机报错原文：
         * `*.contents[0].parts[0].function_response.name: Name cannot be empty`。
         * `name` 在 OpenAI 规范里是可选字段，带上它不改变普通渠道的行为，却能让
         * 这类网关正确回放工具结果。
         */
        const toolName = m.toolName || toolNameOf(m.toolCallId)
        return {
          role: 'tool',
          tool_call_id: m.toolCallId ?? '',
          ...(toolName ? { name: toolName } : {}),
          content: m.content,
        }
      }
      if (m.role === 'assistant' && m.toolCalls?.length) {
        return {
          role: 'assistant',
          content: m.content || null,
          tool_calls: m.toolCalls.map((c) => ({
            id: c.id,
            type: 'function',
            function: { name: c.name, arguments: c.args },
          })),
        }
      }
      if (m.role === 'user' && isLastUser && parts.length > 0) {
        return { role: 'user', content: [{ type: 'text', text: m.content }, ...parts] }
      }
      return { role: m.role, content: m.content }
    }

    /** 工具调用 id → 函数名：tool 结果只有 id，名字要从同一条 assistant 消息里回查。 */
    const toolNames = new Map<string, string>()
    for (const message of request.messages ?? []) {
      for (const call of message.toolCalls ?? []) {
        if (call.id && call.name) toolNames.set(call.id, call.name)
      }
    }
    const toolNameOf = (id: string | undefined): string | undefined =>
      id ? toolNames.get(id) : undefined

    const lastUserIndex = request.messages
      ? [...request.messages].reduce((acc, m, i) => (m.role === 'user' ? i : acc), -1)
      : -1
    const messages: Record<string, unknown>[] = request.messages
      ? request.messages.map((m, i) => toOpenAiMessage(m, i === lastUserIndex))
      : [{ role: 'user', content }]

    const res = await deps.network.request(
      {
        url: chatUrl,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
        body: {
          model: request.model,
          messages,
          // 温度刻意不设：让服务端用默认值。写死 0.7 会让「优化提示词」这类
          // 需要确定性的任务变得不稳定，而用户并没有要求可调温度。
          /**
           * 工具声明（Agent 用）。不传 tools 时不加任何字段 —— 与加这个能力之前
           * 的请求**逐字节一致**，老路径的行为不受影响。
           *
           * `tool_choice: 'auto'`：让模型自己决定「这句话要不要动手」。
           * 写 `required` 会逼它对「你好」这种纯聊天也去调工具。
           */
          ...(request.tools?.length
            ? {
                tools: request.tools.map((t) => ({
                  type: 'function',
                  function: {
                    name: t.name,
                    ...(t.description ? { description: t.description } : {}),
                    parameters: t.parameters,
                  },
                })),
                tool_choice: 'auto',
              }
            : {}),
        },
        /**
         * 调用方可以自带等待上限（Agent 多轮比普通文本重，见 `RunRequestBase.timeoutMs`）；
         * 不给就还是 60 秒。
         */
        timeoutMs: request.timeoutMs ?? CHAT_TIMEOUT_MS,
      },
      signal,
    )
    if (res.status < 200 || res.status >= 300) {
      const detail = await res.text().catch(() => '')
      /**
       * 部分网关（SoonStudio 已实测）把 Gemini 模型列在同一个模型目录里，
       * 但聊天端点会要求改走 Google 原生形状。只在服务端明确要求时重试，
       * 并按原生长相转回 `TextResult`，上层无需感知协议差异。
       */
      if (
        !request.tools?.length &&
        /gemini/i.test(request.model) &&
        geminiNativeRequired(res.status, detail)
      ) {
        const root = openAiBaseUrl(config).replace(/\/v\d+$/i, '')
        const nativeRes = await deps.network.request(
          {
            url: `${root}/v1beta/models/${encodeURIComponent(request.model)}:generateContent`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...authHeader(config.apiKey) },
            body: geminiNativeBody(request, parts),
            timeoutMs: request.timeoutMs ?? CHAT_TIMEOUT_MS,
          },
          signal,
        )
        const nativeRaw = await nativeRes.text().catch(() => '')
        if (nativeRes.status < 200 || nativeRes.status >= 300) {
          const { error } = classifyError(null, nativeRes.status, nativeRaw)
          throw new ChannelError(error)
        }
        let nativeBody: GeminiNativeBody | null = null
        try {
          nativeBody = JSON.parse(nativeRaw) as GeminiNativeBody
        } catch {
          nativeBody = null
        }
        const nativeText = (nativeBody?.candidates?.[0]?.content?.parts ?? [])
          .map((part) => (typeof part.text === 'string' ? part.text : ''))
          .join('')
        if (!nativeText.trim()) {
          throw new ChannelError({
            kind: 'parse',
            raw: nativeRaw || 'Gemini 原生响应里没有 candidates[0].content.parts[].text',
          })
        }
        const finish = nativeBody?.candidates?.[0]?.finishReason
        return {
          text: nativeText,
          finishReason: finish === 'MAX_TOKENS' ? 'length' : finish === 'STOP' ? 'stop' : undefined,
        }
      }
      const { error } = classifyError(null, res.status, detail)
      throw new ChannelError(error)
    }
    const body = await res
      .json<{
        choices?: {
          message?: {
            content?: unknown
            tool_calls?: { id?: unknown; function?: { name?: unknown; arguments?: unknown } }[]
          }
          finish_reason?: string
        }[]
      }>()
      .catch(() => null)
    const message = body?.choices?.[0]?.message
    const text = message?.content
    /** 工具调用：`arguments` 保持原始字符串，解析交给 caller（见 TextResult 的说明） */
    const toolCalls = (message?.tool_calls ?? [])
      .map((c) => ({
        id: typeof c.id === 'string' ? c.id : '',
        name: typeof c.function?.name === 'string' ? c.function.name : '',
        args: typeof c.function?.arguments === 'string' ? c.function.arguments : '',
      }))
      .filter((c) => c.name)
    /**
     * 没有 content 就如实报解析失败，不返回空串。
     * 空串会被上层当成「模型回答了，只是回答是空的」写回节点——把原文冲掉，
     * 用户看到提示词凭空消失却查不到原因（正是「看起来通了」那一类）。
     *
     * **例外**：带工具调用时 `content` 本来就是 `null`。早先这里只认字符串，
     * 于是「模型正确地要求调工具」会被判成解析失败 —— 正是 M0 要填的坑。
     */
    if (typeof text !== 'string' && toolCalls.length === 0) {
      throw new ChannelError({ kind: 'parse', raw: '聊天响应里没有 message.content' })
    }
    const reason = body?.choices?.[0]?.finish_reason
    return {
      text: typeof text === 'string' ? text : '',
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
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
