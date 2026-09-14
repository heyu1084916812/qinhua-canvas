import type { AppError } from '../../shared/result'
import type { ModelCapability } from '../../domain/shared/capability'
import { fingerprintHex } from '../../domain/shared/hash'
import { clampCount } from '../../domain/shared/capability'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import { solidPng } from './mockPng'
import type { SafeChannelConfig } from '../ports'
import {
  ChannelError,
  type ChannelAdapter,
  type GeneratedAsset,
  type ImageRunRequest,
  type TextRunRequest,
  type TextResult,
  type VerifyResult,
  type VideoRunRequest,
} from './types'

export interface MockChannelOptions {
  protocol?: string
  models?: ModelCapability[]
  /** 模拟网络耗时；默认 0，测试里保持同步快速返回 */
  latencyMs?: number
  /** 前 N 次调用失败（用于验证退避重试）；0 表示不失败 */
  failTimes?: number
  failWith?: AppError
}

export interface MockChannel extends ChannelAdapter {
  /** 累计调用次数，测试用来断言重试次数 */
  readonly callCount: number
  reset(): void
}

const DEFAULT_MODELS: ModelCapability[] = [
  {
    id: 'mock-image-1',
    category: 'image',
    inputTypes: ['text'],
    aspectRatios: ['1:1', '16:9'],
    resolutions: ['1k', '2k'],
    maxCount: 4,
  },
  {
    // 离线文本 LLM：供提示词节点的「优化 / 翻译」使用（§6.7），category 为 chat
    id: 'mock-chat-1',
    category: 'chat',
    inputTypes: ['text'],
  },
  {
    /**
     * 视频类模型（§6.8 视频模式）。
     *
     * 补它的原因是一个**整维不可达**的洞：`ModelCapability.category` 有 `'video'`、
     * `GenerationData.mode` 有 `'video'`、`ChannelAdapter.generateVideo` 也齐了，
     * 但没有任何适配器会**产出**视频类模型——于是视频这一整条维度在真机上永远
     * 走不到，也就永远验不了。mock 是测试专用渠道，把这块 fixture 补齐是它的本职：
     * 「假数据的保真度决定断言的上限」。
     */
    id: 'mock-video-1',
    category: 'video',
    inputTypes: ['text', 'image'],
    aspectRatios: ['16:9', '9:16'],
    durations: [3, 15],
    maxReferenceImages: 2,
  },
]

/**
 * mock 出图的两种颜色：灰度 = 纯文生图，品红 = 带图像输入（M6-12 的可观测答案）。
 *
 * 为什么颜色要能区分：mock 是离线 / 测试专用渠道，它的产物必须能回答一个问题
 * 「这次调用到底有没有把 inputs 递给渠道？」灰度图 vs 品红图就是那个可观测的答案——
 * 断言「下游出的是品红」，等价于断言「图生图链路真的通了」。
 * 若 mock 无视 inputs 一律出同样的图，这条链路在冒烟里就**永远证明不了**，
 * 只能退化成「跑通了但不知道有没有生效」——假数据的保真度决定了断言的上限。
 *
 * 产物**必须真可解码**：早先这里吐的是 `mock-asset:<hash>` 文本、却把 `mime` 标成
 * `image/png`，于是 `<img>` 拿到了 `blob:` 地址却解不出像素（`naturalWidth` 为 0），
 * 「图到底渲染出来没有」在冒烟里同样证明不了。
 */
const GRAY: readonly [number, number, number] = [0x8a, 0x8a, 0x8a]
const MAGENTA: readonly [number, number, number] = [0xff, 0x00, 0xff]

/** 出图的长边（mock 不必给真实分辨率，够解码、够算出比例即可） */
const MOCK_LONGEST_SIDE = 64

/**
 * 请求比例 → 产物像素尺寸（`w:h` → 长边 64）。
 *
 * 解析失败（未指定 / 不是 `w:h` / 非数字）一律退回 1:1：**不猜**，宁可让比例断言
 * 退化成「至少是方的」，也不要拿一个与请求无关的数字冒充真实产物。
 */
function pixelSizeOf(ratio: unknown): [number, number] {
  if (typeof ratio !== 'string') return [MOCK_LONGEST_SIDE, MOCK_LONGEST_SIDE]
  const [a, b] = ratio.split(':').map((s) => Number.parseFloat(s))
  if (!a || !b || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    return [MOCK_LONGEST_SIDE, MOCK_LONGEST_SIDE]
  }
  const scale = MOCK_LONGEST_SIDE / Math.max(a, b)
  const w = Math.max(1, Math.round(a * scale))
  const h = Math.max(1, Math.round(b * scale))
  return [w, h]
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

/**
 * mock 渠道（M0-11 契约验证用）。
 * 出图是确定性的：同样的 model + prompt + 序号必然产出同样的 hash，
 * 因此测试可以对 hash 做精确断言，而不必处理随机性。
 */
export function createMockChannel(opts: MockChannelOptions = {}): MockChannel {
  const models = opts.models ?? DEFAULT_MODELS
  const failTimes = opts.failTimes ?? 0
  const failWith: AppError = opts.failWith ?? { kind: 'http', status: 500 }
  let calls = 0

  const before = async (): Promise<void> => {
    calls += 1
    await sleep(opts.latencyMs ?? 0)
    if (calls <= failTimes) throw new ChannelError(failWith)
  }

  const asset = (request: ImageRunRequest | VideoRunRequest, index: number): GeneratedAsset => {
    const hash = fingerprintHex(`${request.model}|${request.prompt}|${index}`)
    if (request.kind === 'video') {
      return { hash, mime: 'video/mp4', bytes: new TextEncoder().encode(`mock-asset:${hash}`) }
    }
    // M6-12：请求带了图像输入（上游图 / 角色参考图）→ 出品红图，
    // 使「inputs 是否真的被消费」在离线环境下可被断言。hash 规则不变，
    // 因此既有按 hash 断言的测试不受影响。
    const withImage = imageInputsOf(request.inputs).length > 0
    const [width, height] = pixelSizeOf(request.params.ratio)
    return {
      hash,
      mime: 'image/png',
      bytes: solidPng(width, height, withImage ? MAGENTA : GRAY),
      width,
      height,
    }
  }

  return {
    protocol: opts.protocol ?? 'mock',
    get callCount() {
      return calls
    },
    reset() {
      calls = 0
    },
    async verify(_config: SafeChannelConfig, _signal: AbortSignal): Promise<VerifyResult> {
      return { ok: true, models }
    },
    async listModels(_config: SafeChannelConfig, _signal: AbortSignal): Promise<ModelCapability[]> {
      return models
    },
    async generateImage(request: ImageRunRequest, _signal: AbortSignal): Promise<GeneratedAsset[]> {
      await before()
      const cap = models[0] ?? DEFAULT_MODELS[0]!
      const count = clampCount(cap, typeof request.params.count === 'number' ? request.params.count : 1)
      return Array.from({ length: count }, (_, i) => asset(request, i))
    },
    async generateVideo(request: VideoRunRequest, _signal: AbortSignal): Promise<GeneratedAsset[]> {
      await before()
      return [asset(request, 0)]
    },
    /**
     * 文本输出里带上**实际收到的素材**，使「上游图片是否真的送进了 LLM」可断言。
     *
     * 与出图侧的「品红图 vs 灰度图」是同一个道理：若 mock 无视 `inputs` 一律回
     * `mock:<prompt>`，那么「把图喂给文本模型」这条链路在离线环境里**永远证明不了**，
     * 只能靠接真实渠道才发现没生效。带上 hash 前缀后，单测可以直接断言素材到了渠道层。
     */
    async completeText(request: TextRunRequest, _signal: AbortSignal): Promise<TextResult> {
      await before()
      const images = imageInputsOf(request.inputs)
      const prefix = images.map((i) => `img:${i.assetHash.slice(0, 8)}`).join(',')
      return {
        text: prefix ? `mock:${prefix}|${request.prompt}` : `mock:${request.prompt}`,
        finishReason: 'stop',
      }
    },
  }
}
