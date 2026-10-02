import type { AppError } from '../../shared/result'
import type { ModelCapability } from '../../domain/shared/capability'
import type { StreamChunk } from '../ports'
import type { PlatformKit, SafeChannelConfig } from '../ports'
import type { RunRequest } from '../../domain/shared/execution/types'

/**
 * 渠道适配层契约（架构 §4.2）。
 *
 * 请求类型直接复用共享 domain 的 `RunRequest`（domain/shared/execution/types），
 * 不另造一份——否则「主体产出的请求」与「渠道接收的请求」会各自定义、各自漂移。
 * 这里只按 kind 收窄，保证 generateImage 只会收到 image 请求。
 */
export type ImageRunRequest = RunRequest & { kind: 'image' }
export type VideoRunRequest = RunRequest & { kind: 'video' }
export type TextRunRequest = RunRequest & { kind: 'text' }

/** 生成产物：节点只持有 hash，媒体本体由调用方写入 assets 表 */
export interface GeneratedAsset {
  hash: string
  mime: string
  bytes: Uint8Array
  /** 产物真实像素（能读出来才填；读不出保持 undefined，绝不猜） */
  width?: number
  height?: number
  /**
   * **远程产物地址**（只有视频会用到）。
   *
   * 用户 2026-10-03 实测：Agnes 的成片放在 `cos-platform-outputs.agnes-ai.cn` 上，
   * 浏览器去 fetch 字节会被 **CORS 拦掉（`net::ERR_FAILED`）** —— 任务明明成功、
   * url 也有值，就是下不下来。而 `<video src>` **播放不受 CORS 限制**，
   * 所以这一档允许「只给地址、不给字节」：界面上照常播，只有要读像素时才受限。
   */
  url?: string
  /**
   * 本次**向渠道请求**的像素（§6.18 日志面板「请求像素」）。
   * 渠道把比例翻译成合法像素 `size` 后才填——它是「我们问渠道要了多大」，
   * 与 `width/height`（渠道实际给了多大）是两件事，故必须分成两组字段：
   * 合成一组时「请求 = 实际」恒成立，日志里两个数永远相等，缺口只是看起来被填上了。
   */
  requestedWidth?: number
  requestedHeight?: number
}

export interface TextResult {
  text: string
  finishReason?: 'stop' | 'length' | 'tool_calls'
  /**
   * 模型请求调用的工具（架构 §5.9 ④）。
   *
   * `args` 保持**原始 JSON 字符串**、不在这里 parse：解析失败要报给谁、
   * 失败了怎么回给模型（把错误塞回去让它改），是 caller（agent）的决定，
   * 适配器不该替它吞掉这个失败。
   */
  toolCalls?: { id: string; name: string; args: string }[]
}

export type VerifyResult =
  | { ok: true; models: ModelCapability[] }
  | { ok: false; error: AppError; message?: string }

/**
 * 渠道适配器的外部依赖（M6-12 扩展）。
 *
 * 以前只有 `network`——于是渠道层**看不见素材**，请求里也就永远只有提示词。
 * 图生图 / 角色参考图需要把 `inputs` 里 asset 项的字节读出来随请求上传，
 * 故这里补上 `assets`。刻意用 `Pick<PlatformKit, …>` 而非新造结构：
 * 装配处（两个 ExecutionProvider / channelStore）可以直接把整个 `platform` 传进来，
 * 无需逐个字段搬运，也不会漏。
 */
export type ChannelDeps = Pick<PlatformKit, 'network' | 'assets'>

export interface ChannelAdapter {
  protocol: string
  verify(config: SafeChannelConfig, signal: AbortSignal): Promise<VerifyResult>
  listModels(config: SafeChannelConfig, signal: AbortSignal): Promise<ModelCapability[]>
  generateImage(request: ImageRunRequest, signal: AbortSignal): Promise<GeneratedAsset[]>
  generateVideo(request: VideoRunRequest, signal: AbortSignal): Promise<GeneratedAsset[]>
  completeText(request: TextRunRequest, signal: AbortSignal): Promise<TextResult>
  /** Agent 流式通道（架构 §5.9 ④）：可选，未实现该能力的渠道不提供 */
  streamChat?(request: TextRunRequest, signal: AbortSignal): AsyncIterable<StreamChunk>
}

/** 渠道调用失败时抛出，runEngine 捕获后归一为 AppError */
export class ChannelError extends Error {
  readonly appError: AppError
  constructor(appError: AppError) {
    super(`[channel] ${appError.kind}`)
    this.name = 'ChannelError'
    this.appError = appError
  }
}
