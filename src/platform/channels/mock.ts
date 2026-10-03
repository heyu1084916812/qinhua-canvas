import type { AppError } from '../../shared/result'
import type { ModelCapability } from '../../domain/shared/capability'
import { fingerprintBytesSync, fingerprintHex } from '../../domain/shared/hash'
import { clampCount } from '../../domain/shared/capability'
import { imageInputsOf } from '../../domain/shared/execution/inputs'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
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
 * mock 出图的「请求印记」：写进 PNG 的 `tEXt` 块，**只改字节、不改像素**。
 *
 * 为什么要这一段：产物 hash 是**产物字节的内容指纹**（§8「id 即内容哈希」）。
 * 而 mock 是确定性的 —— 同色同尺寸的图字节完全相同，于是「改提示词重生成」
 * 与「批量 N 张」都会撞成同一个 hash，「底图确实换了」这类断言就无从断言。
 * 真实渠道不会这样（每张图片素本就不同），mock 必须主动把「请求不同」落进字节。
 * 放 tEXt 而不改像素，是为了保住「灰度 = 无图输入 / 品红 = 有图输入」这条可观测标记。
 */
/**
 * 调序号纳入印记的原因很直接：**真实渠道每次调用都会出一张不同的图**，
 * 哪怕 model + prompt + 参考图完全一样。若 mock 只按「请求内容」造图，
 * 同参数的两批生成就会吐出**完全相同的字节** —— 内容寻址下 hash 也相同，
 * 于是「先生成 4 张、再生成 2 张」里后两张会跟前两张一模一样（用户 2026-09-17 报的
 * 现象之一）。`callSeq` 是渠道**累计调用次数**，故每次调用都不同；
 * 而新建的 channel 从 1 起，于是「同一个请求、全新的 channel」仍然可复现。
 */
function stampOf(
  model: string,
  prompt: string,
  imageHashes: readonly string[],
  callSeq: number,
  index: number,
): string {
  return [model, prompt, imageHashes.join(','), `call#${callSeq}`, `item#${index}`].join('|')
}

/**
 * 测试用：不调渠道，直接算出 mock 对给定请求会吐出的产物 hash。
 *
 * 存在的理由：hash 规则变成内容寻址后，测试里再拼 `fingerprintHex(model|prompt|0)`
 * 就与实现脱节了 —— 那样的断言会**恒假**，不是「锁住规则」而是「锁住一个已不存在的规则」。
 * 由实现方暴露口径，测试才能真的锁住「同请求 → 同 hash」。
 */
export function mockImageHash(args: {
  model: string
  prompt: string
  imageHashes?: readonly string[]
  callSeq?: number
  index?: number
  ratio?: string
}): string {
  const withImage = (args.imageHashes ?? []).length > 0
  const [w, h] = pixelSizeOf(args.ratio ?? null)
  const bytes = solidPng(
    w,
    h,
    withImage ? MAGENTA : GRAY,
    stampOf(args.model, args.prompt, args.imageHashes ?? [], args.callSeq ?? 1, args.index ?? 0),
  )
  return fingerprintBytesSync(bytes)
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
    if (request.kind === 'video') {
      // 视频走文本文节 ⇒ 用请求维度 seed（保持既有 hash 规则，避免影响既有断言）
      const hash = fingerprintHex(`${request.model}|${request.prompt}|${index}`)
      return { hash, mime: 'video/mp4', bytes: new TextEncoder().encode(`mock-asset:${hash}`) }
    }
    // M6-12：请求带了图像输入（上游图 / 角色参考图）→ 出品红图，
    // 使「inputs 是否真的被消费」在离线环境下可被断言。hash 规则不变，
    // 因此既有按 hash 断言的测试不受影响。
    const withImage = imageInputsOf(request.inputs).length > 0
    const [requestedWidth, requestedHeight] = pixelSizeOf(request.params.ratio)
    const stamp = stampOf(
      request.model,
      request.prompt,
      imageInputsOf(request.inputs).map((i) => i.assetHash),
      calls,
      index,
    )
    const bytes = solidPng(requestedWidth, requestedHeight, withImage ? MAGENTA : GRAY, stamp)
    // 实际像素**从产物字节里读出来**，不照抄请求尺寸（§6.18「请求 / 实际」）。
    // mock 造的正是这个尺寸的 PNG，两者一致是**结果**、不是预设——
    // 断言「实际像素」时才不会退化成「请求 = 实际」的恒等式。
    const actual = imageSizeFromHeader(bytes)
    /**
     * 图片 hash 取**产物字节**指纹（内容寻址），与 openaiImages 同口径。
     * 旧的 `model|prompt|index` 在两次生成同 model + prompt 时 index 会碰撞，
     * 导致不同的图共用一个 hash（用户 2026-09-17 报「灯箱出现另一张图」）。
     */
    // mock 的 PNG 只有几十字节 ⇒ 用同步内容指纹（与异步版哈希值一致）
    const hash = fingerprintBytesSync(bytes)
    return {
      hash,
      mime: 'image/png',
      bytes,
      ...(actual ? { width: actual.width, height: actual.height } : {}),
      requestedWidth,
      requestedHeight,
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
      /**
       * **Agent 形态**：带 `tools` 时按「先看画布 → 再给计划 → 然后收尾」演一遍。
       *
       * 为什么 mock 要会这一手：真渠道会返回 tool_calls，而 mock 只会回文本的话，
       * 「一句话变成画布上的图」这条主链在离线环境**根本验不了** ——
       * 于是 agent 最有价值的那一段永远只能靠手点。这里让它确定性地产出
       * `readGraph` → `applyPlan` 两次调用，冒烟就能把整条链跑穿（含确认与自检）。
       *
       * 计划内容由用户最后那句话当提示词，建最经典的「提示词 → 生成」两节点。
       */
      if (request.tools?.length && request.messages?.length) {
        const toolMsgs = request.messages.filter((m) => m.role === 'tool').length
        if (toolMsgs === 0) {
          return {
            text: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'mock-read', name: 'readGraph', args: '{"scope":"all"}' }],
          }
        }
        if (toolMsgs === 1) {
          const lastUser =
            request.messages.filter((m) => m.role === 'user').at(-1)?.content ?? '提示词'
          /**
           * 测试钩子：用户话里带「坏计划」时**故意**给一份落不了地的计划。
           *
           * 用来验用户 2026-10-02 报的那条：「重复让我确认新建工作流，重复了三次，
           * 但是我的画布中没有」—— 计划不合法时**不该弹确认卡**（用户一次都不该点），
           * 原因要直接露在步骤卡上。这个场景用真渠道没法稳定复现，只能由 mock 造。
           */
          if (lastUser.includes('坏计划')) {
            return {
              text: '',
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'mock-bad-plan',
                  name: 'applyPlan',
                  args: JSON.stringify({
                    summary: '一份落不了地的计划',
                    nodes: [{ localId: 'x1', type: 'not-a-node', data: {}, order: 0 }],
                    edges: [],
                  }),
                },
              ],
            }
          }
          /**
           * 测试钩子：用户话里带「比例别名」时，把比例写在 **`aspectRatio`** 上
           * （画布读的是 `data.ratio`）。
           *
           * 复刻用户 2026-10-04 的第二次事故（真机原始计划里就是这个形状）：
           * 参数键名写错 ⇒ `ratio` 落回**默认配方**（上一次生成留下的值）⇒
           * 用户说了 1:1，出图却是竖版。
           */
          if (lastUser.includes('比例别名')) {
            return {
              text: '',
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'mock-ratio-alias-plan',
                  name: 'applyPlan',
                  args: JSON.stringify({
                    summary: '比例写在别名键上的计划',
                    nodes: [
                      {
                        localId: 'g1',
                        type: 'generation',
                        data: { mode: 'image', prompt: '比例别名测试图', aspectRatio: '3:4' },
                        order: 0,
                      },
                    ],
                    edges: [],
                  }),
                },
              ],
            }
          }
          /**
           * 测试钩子：用户话里带「字段写错」时，给一份**结构对、正文落错字段**的计划。
           *
           * 复刻用户 2026-10-04 的真实事故（真机 IndexedDB 里解出来的记录）：
           * 提示词节点读 `data.text`，而模型把正文写进了 `data.prompt` ——
           * 画布上那个框是空的，两个下游生成节点一个词都拿不到。
           * 归一化应当把正文**搬回** `data.text`。
           */
          if (lastUser.includes('字段写错')) {
            return {
              text: '',
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'mock-wrong-field-plan',
                  name: 'applyPlan',
                  args: JSON.stringify({
                    summary: '一份正文写错字段的计划',
                    nodes: [
                      {
                        localId: 'p1',
                        type: 'prompt',
                        // ⚠️ 故意写进 prompt（提示词节点读的是 text）
                        data: { prompt: '小狗钓鱼插画，1:1，2k' },
                        order: 0,
                      },
                      { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 1 },
                      { localId: 'g2', type: 'generation', data: { mode: 'image' }, order: 1 },
                    ],
                    edges: [
                      { source: 'p1', target: 'g1' },
                      { source: 'p1', target: 'g2' },
                    ],
                  }),
                },
              ],
            }
          }
          /**
           * 测试钩子：用户话里带「无提示词」时，给一份**永远跑不起来**的计划
           * （生成节点自己没有正文、上游也没有能给文字的节点）。落地前应当被拦下，
           * 把原因回给模型 —— 而不是建一张点多少次都不发请求的图。
           */
          if (lastUser.includes('无提示词')) {
            return {
              text: '',
              finishReason: 'tool_calls',
              toolCalls: [
                {
                  id: 'mock-promptless-plan',
                  name: 'applyPlan',
                  args: JSON.stringify({
                    summary: '一份没有提示词的计划',
                    nodes: [
                      { localId: 'g1', type: 'generation', data: { mode: 'image' }, order: 0 },
                    ],
                    edges: [],
                  }),
                },
              ],
            }
          }
          const plan = {
            summary: `据「${lastUser.slice(0, 20)}」建一个提示词到生成的流程`,
            nodes: [
              { localId: 'p1', type: 'prompt', data: { text: lastUser }, order: 0 },
              { localId: 'g1', type: 'generation', data: { mode: 'image', prompt: lastUser }, order: 1 },
            ],
            edges: [{ source: 'p1', target: 'g1' }],
          }
          return {
            text: '',
            finishReason: 'tool_calls',
            toolCalls: [{ id: 'mock-plan', name: 'applyPlan', args: JSON.stringify(plan) }],
          }
        }
        /**
         * 落地之后 → **真的去跑生成节点**。
         *
         * 为什么非要有这一步：出图那段（`runNode` + 确认 + 真渠道请求 + 产物写回）
         * 是 agent 整件事的落点。mock 只演到「计划落地」的话，冒烟最多证明
         * 「画布上多了两个节点」，证明不了「点确认后真出图」—— 而那恰恰是最容易
         * 悄悄坏掉的一段（节点没渠道 / 没模型时它不报错，只是什么都不做）。
         *
         * 目标节点取 `createdNodeIds` 的最后一个：计划里 generation 写在 prompt 后面，
         * 落地按计划顺序发 id。这是 mock 自己写的计划，顺序是它自己定的。
         */
        if (toolMsgs === 2) {
          const landed = request.messages
            .filter((m) => m.role === 'tool')
            .map((m) => {
              try {
                return JSON.parse(m.content ?? '') as { createdNodeIds?: unknown }
              } catch {
                return null
              }
            })
            .find((v) => v !== null && Array.isArray(v.createdNodeIds))
          const ids = (landed?.createdNodeIds as string[] | undefined) ?? []
          const target = ids.at(-1)
          if (target) {
            return {
              text: '',
              finishReason: 'tool_calls',
              toolCalls: [
                { id: 'mock-run', name: 'runNode', args: JSON.stringify({ nodeIds: [target] }) },
              ],
            }
          }
        }
        /**
         * 收尾回答故意带 Markdown（粗体 + 无序列表）：用户 2026-10-02 报
         * 「他给我的解释功能给我的是 json 格式的吗？我不想要那些符号」——
         * 界面原先把模型回的 `- **看看画布现状**` 连星号带杠原样打了出来。
         * 假数据不写成这样，「助手气泡会渲染 Markdown」这条就永远验不了。
         */
        return {
          text: '已经建好了，画布上应该能看到两个节点。\n\n- **提示词节点**：写下你要的画面\n- **生成节点**：点生成出图',
          finishReason: 'stop',
        }
      }
      /**
       * Agent 那条路径发的是**消息数组**、`prompt` 为空（设计文档 §4）。
       * 真渠道当然会读消息数组，mock 也得分得清这两种形态，否则
       * 「agent 一问一答」在离线环境里根本验不了（回显一个空串）。
       */
      const lastUser =
        request.messages?.filter((m) => m.role === 'user').at(-1)?.content ?? request.prompt
      const text = request.prompt || lastUser
      return {
        text: prefix ? `mock:${prefix}|${text}` : `mock:${text}`,
        finishReason: 'stop',
      }
    },
  }
}
