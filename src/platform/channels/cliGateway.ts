/**
 * CLI 网关族适配器（cli-gateway）。
 *
 * ## 为什么必须有一层网关
 *
 * 纯 Web 应用跑不了本机命令：浏览器里没有 `gemini` / `codex` 这类可执行文件，
 * 也没有权限去起子进程。所以「即梦 CLI / GPT CLI / Gemini CLI」这类协议
 * **只能**由用户自己在本机或服务器上跑一个网关，把 CLI 包成 HTTP；
 * 本应用只负责按 OpenAI 兼容形态去访问那个网关地址。
 *
 * 这里刻意**不**假装能直接调 CLI：那会是一个「配好了却永远跑不通」的假功能。
 *
 * ## 形态
 *
 * 网关对外仍是 OpenAI 兼容三件套（`GET /models`、`POST /chat/completions`、
 * `POST /images/generations`），因此对话与生图直接复用既有适配器——
 * 两条链路的错误文案、超时、多模态编码因此永远与 OpenAI 兼容站一致，
 * 不会再长出第二套说法。
 *
 * 与 `openai-compatible` 的唯一差别是**语义与文档**：它提示用户「这里要填网关地址」，
 * 并把 CLI 系协议标成 ready（因为它们现在真的能用了）。
 */

import type { SafeChannelConfig } from '../ports'
import type { ChannelAdapter, ChannelDeps } from './types'
import { createOpenAiChatAdapter, type OpenAiChatConfig } from './openaiChat'
import { createOpenAiImagesAdapter, type OpenAiAdapterConfig } from './openaiImages'
import { ChannelError } from './types'

export interface CliGatewayConfig extends SafeChannelConfig {
  apiKey: string | null
}

/** 网关默认端口无依据，故不写死；地址必须由用户填（`requiresBaseUrl` 已经拦住空地址） */
export const CLI_GATEWAY_NOTE =
  'CLI 类协议需要你先跑一个网关（把本机 CLI 包成 OpenAI 兼容 HTTP），这里填它的地址。'

export function createCliGatewayAdapter(
  config: CliGatewayConfig,
  deps: ChannelDeps,
): ChannelAdapter {
  const capabilities = config.protocolDefinition?.capabilities ?? ['chat', 'image']
  const chatConfig: OpenAiChatConfig = config
  const imagesConfig: OpenAiAdapterConfig = config
  const chat = capabilities.includes('chat') ? createOpenAiChatAdapter(chatConfig, deps) : null
  const images = capabilities.includes('image') ? createOpenAiImagesAdapter(imagesConfig, deps) : null
  const verifier = chat ?? images
  if (!verifier) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })

  return {
    protocol: config.protocol,
    verify: (cfg, signal) => verifier.verify(cfg, signal),
    listModels: (cfg, signal) => verifier.listModels(cfg, signal),
    generateImage(request, signal) {
      if (!images) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
      return images.generateImage(request, signal)
    },
    async generateVideo() {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    },
    completeText(request, signal) {
      if (!chat) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
      return chat.completeText(request, signal)
    },
  }
}
