import type { PlatformKit } from '../../platform/ports'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { FusionRect, GenerationData } from '../../domain/canvas/model/node'
import type { NodeInput } from '../../domain/shared/execution/types'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import {
  FACE_BOX_INSTRUCTION,
  FACE_BOX_SYSTEM,
  faceBoxFailureReason,
  faceBoxToRect,
  parseFaceBox,
  type FaceBox,
} from '../../domain/canvas/vision/faceBox'
import { emotionPromptOf } from '../../domain/canvas/layout/presets'
import { asAppError, describeError } from '../../shared/result'
import { NODE_MINIMUMS } from '../../domain/canvas/layout/constants'
import { fusionSpec, FUSION_PATCH_PORT } from '../../domain/canvas/nodeSpecs/fusion'
import { createId } from '../../shared/id'
import { noOverlapDelta } from './duplicatePlacement'
import { extractSelection } from './extractSelection'

/**
 * 情绪调节的**局部改脸**流水线（用户 2026-10-05 第五批第 1 条：
 * 「情绪调节需要重新设计，需要先自动识别面部，然后只改变面部的情绪，
 * 其他的内容完全不变才对」）。
 *
 * ## 为什么是这四步
 *
 * 原来的做法是「把情绪那句话拼进提示词、整张图重画一遍」——模型当然会把整幅画都改掉。
 * 要「其余完全不变」，只能走**局部**：只把脸那一块交给模型，改完再**贴回原图**。
 * 项目里这两件事本来就都有：
 *
 *  - 「提取选区」（`extractSelection`）= 按矩形裁一块 → 存成新素材 → 在原图右侧建局部节点，
 *    并把「它属于哪张原图、哪个矩形」记进 `cropContext`（多轮改图都跟着走）；
 *  - 「融合节点」（`FUSION_PATCH_PORT`）= 原图（`input`）+ 若干局部修改图（`patch`）→ 本地像素合成。
 *
 * 所以这里不加新机制，只把三步串起来：**识别人脸 → 裁那一块 → 建融合节点接回原图**。
 * 真正花钱的只有中间那次「改局部图」的生成，由调用方去跑。
 *
 * ## 识别人脸为什么是「问模型」
 *
 * 实测本机 Chrome `window.FaceDetector === undefined`（Shape Detection 在 Windows 未开放），
 * 浏览器不会帮我们认。项目里已有看图链路（「反推」= `completeText` 带 `inputs`），
 * 于是让对话模型回一个归一化人脸框，再由 `domain/canvas/vision/faceBox` 换算成像素矩形。
 */

export type EmotionLook = (req: {
  channelId: string
  model: string
  system: string
  text: string
  inputs: NodeInput[]
  signal?: AbortSignal
}) => Promise<string>

export interface EmotionEditDeps {
  platform: PlatformKit
  store: CanvasStore
  /** 看图（与「反推提示词」同一条链路）：把源图发给对话模型，回一句话 */
  look: EmotionLook
  /**
   * 依次尝试的对话模型（第一个通常是渠道解析链选出的默认对话模型）。
   *
   * 为什么要一串：**不是每个对话模型都能看图**。真机上报过一次「识别人脸失败」，
   * 只试一个模型时要么它看不了图、要么那条渠道当天不通 —— 于是这里按顺序试到有人给出
   * 可解析的框为止（最多 4 个，够用且不会无限重试）。
   */
  candidates: readonly { channelId: string; model: string }[]
}

export interface EmotionEditInput {
  /** 源节点：要有素材（人物的那张图） */
  nodeId: string
  /** 情绪名（`EMOTIONS` 里的中文名），写进局部节点的正文 */
  emotion: string
  signal?: AbortSignal
}

export type EmotionEditOutcome =
  | {
      ok: true
      cropNodeId: string
      fusionNodeId: string
      box: FaceBox | null
      /** true = 走的「用户已经框好局部图」那条快捷路径（没调模型） */
      reusedSelection: boolean
    }
  | { ok: false; reason: string }

/** 局部图与融合节点之间的间距（世界 px，与画布其它落位同档） */
const GAP_X = 48

/**
 * 建流水线（不跑生成）。
 *
 * 产出：① 源图右侧多一个**局部节点**（正文 = 情绪那句）；② 更右边多一个**融合节点**，
 * 已经把「原图 → input」「局部图 → patch」接好。调用方接着 `runNode(局部)`，
 * 等它出图后再 `runNode(融合)` 就得到结果。
 */
export async function buildEmotionEdit(
  deps: EmotionEditDeps,
  input: EmotionEditInput,
): Promise<EmotionEditOutcome> {
  const graph = deps.store.getSnapshot()
  const node = graph.nodes.find((n) => n.id === input.nodeId)
  if (!node) return { ok: false, reason: '节点不存在' }
  const data = node.data as GenerationData
  const assetHash = data.assetHash
  if (!assetHash) return { ok: false, reason: '这个节点还没有图片：先把有人物的图连到它上面' }

  /**
   * **快捷路径：这个节点本身就是一张局部图**（用户先在素材灯箱里框过脸 —— 「提取选区」）。
   *
   * 那就用不着再识别：要改的就是这张图，原图用 `cropContext.source.assetHash` 反查回来。
   * 这条路的现实意义：**不是每个对话模型都能看图**（真机上报过「识别人脸失败」），
   * 手动框一次照样能把「只改面部」跑通。
   */
  const cropCtx = data.cropContext
  const originalNode =
    cropCtx && 'source' in cropCtx
      ? graph.nodes.find(
          (n) =>
            n.id !== node.id &&
            (n.data as { assetHash?: string }).assetHash === cropCtx.source.assetHash,
        )
      : undefined
  if (originalNode) {
    const fusionId = await wirePatchToOriginal(deps, {
      patchNodeId: node.id,
      sourceNodeId: originalNode.id,
      sourceTitle: originalNode.title,
      emotion: input.emotion,
    })
    return { ok: true, cropNodeId: node.id, fusionNodeId: fusionId, box: null, reusedSelection: true }
  }

  /** 素材的 mime 要跟着请求一起发（模型靠它知道这是张图） */
  const payload = await deps.platform.assets.read(assetHash)
  if (!payload) return { ok: false, reason: '读不到这张图的素材' }
  const size = data.naturalSize ?? (await imageSizeOf(payload.bytes, payload.mime).catch(() => null))
  if (!size) return { ok: false, reason: '读不到这张图的尺寸' }

  /** ① 自动识别人脸：按候选顺序试，谁给出可解析的框就用谁 */
  const imageInput = {
    kind: 'asset',
    nodeId: node.id,
    assetHash,
    mime: payload.mime || 'image/png',
  } satisfies NodeInput
  const tried: string[] = []
  let box: FaceBox | null = null
  let lastAnswer = ''
  let lastError = ''
  for (const cand of deps.candidates.slice(0, 4)) {
    tried.push(cand.model)
    try {
      const answer = await deps.look({
        channelId: cand.channelId,
        model: cand.model,
        system: FACE_BOX_SYSTEM,
        text: FACE_BOX_INSTRUCTION,
        inputs: [imageInput],
        ...(input.signal ? { signal: input.signal } : {}),
      })
      lastAnswer = answer
      box = parseFaceBox(answer, size)
      if (box) break
    } catch (e) {
      const app = asAppError(e)
      lastError = app ? describeError(app) : e instanceof Error ? e.message : String(e)
    }
  }
  if (!box) {
    /** 失败时把**证据一起给出来**（试过谁、报了什么、模型回了什么），见 `faceBoxFailureReason` */
    return { ok: false, reason: faceBoxFailureReason({ tried, lastError, lastAnswer }) }
  }

  /** ② 按框裁一块 → 原图右侧多一个局部节点（复用「提取选区」，上下文一起落好） */
  const rect: FusionRect = faceBoxToRect(box, size.width, size.height)
  const crop = await extractSelection(
    { platform: deps.platform, store: deps.store },
    { nodeId: node.id, rect },
  )
  if (!crop.ok) return { ok: false, reason: crop.reason }

  /**
   * ③④ 局部节点的正文 + 配方继承，再建融合节点接回原图 —— 都在 `wirePatchToOriginal` 里
   * （与「用户自己框好的局部图」那条快捷路径共用同一份）。
   */
  const fusionId = await wirePatchToOriginal(deps, {
    patchNodeId: crop.nodeId,
    sourceNodeId: node.id,
    sourceTitle: node.title,
    emotion: input.emotion,
  })

  return { ok: true, cropNodeId: crop.nodeId, fusionNodeId: fusionId, box, reusedSelection: false }
}

/**
 * 把「局部图」接回「原图」：局部节点的正文 = 情绪那句 + 继承配方，
 * 再建一个融合节点（原图 → `input`、局部 → `patch`）。返回融合节点 id。
 *
 * 两条路（识别出来的新局部图 / 用户自己框好的局部图）共用这一份 ——
 * 各写一份必然会漂移成「一条接得上、另一条接不上」。
 */
async function wirePatchToOriginal(
  deps: EmotionEditDeps,
  args: { patchNodeId: string; sourceNodeId: string; sourceTitle?: string; emotion: string },
): Promise<string> {
  const graph = deps.store.getSnapshot()
  const sourceNode = graph.nodes.find((n) => n.id === args.sourceNodeId)
  const patchNode = graph.nodes.find((n) => n.id === args.patchNodeId)
  const sourceData = (sourceNode?.data ?? {}) as GenerationData

  /** 局部节点的正文 = 情绪那句，并把源节点的配方继承过来（不继承就会「点了生成说没选渠道」） */
  deps.store.dispatch({
    kind: 'node.updateData',
    id: args.patchNodeId,
    patch: {
      prompt: emotionPromptOf(args.emotion),
      ...(sourceData.channelId ? { channelId: sourceData.channelId } : {}),
      ...(sourceData.model ? { model: sourceData.model } : {}),
      mode: sourceData.mode ?? 'image',
      count: 1,
      ...(sourceData.ratio ? { ratio: sourceData.ratio } : {}),
      preset: undefined,
      presetOptions: undefined,
      emotion: undefined,
    } as Partial<GenerationData>,
  })

  const fusionId = createId('node')
  const origin = patchNode
    ? { x: patchNode.x + patchNode.w + GAP_X, y: patchNode.y }
    : { x: (sourceNode?.x ?? 0) + (sourceNode?.w ?? 240) + GAP_X * 2, y: sourceNode?.y ?? 0 }
  const others = deps.store
    .getSnapshot()
    .nodes.filter((n) => n.id !== fusionId)
    .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }))
  const delta = noOverlapDelta(
    [{ x: origin.x, y: origin.y, w: NODE_MINIMUMS.fusion.w, h: NODE_MINIMUMS.fusion.h }],
    others,
  )
  deps.store.beginPlan(`emotion:${fusionId}`, '情绪局部改脸')
  deps.store.dispatch({
    kind: 'node.create',
    projectId: graph.projectId,
    type: 'fusion',
    id: fusionId,
    at: { x: origin.x + delta.dx, y: origin.y + delta.dy },
    size: { w: NODE_MINIMUMS.fusion.w, h: NODE_MINIMUMS.fusion.h },
    title: `${args.sourceTitle ?? '图片'} · 局部改脸`,
    data: fusionSpec.createDefaultData(),
  })
  deps.store.dispatch({
    kind: 'edge.connect',
    source: args.sourceNodeId,
    target: fusionId,
    sourcePort: 'output',
    targetPort: 'input',
  })
  deps.store.dispatch({
    kind: 'edge.connect',
    source: args.patchNodeId,
    target: fusionId,
    sourcePort: 'output',
    targetPort: FUSION_PATCH_PORT,
  })
  deps.store.endPlan()
  await deps.store.flush()
  return fusionId
}

/** 从字节读像素尺寸（只读文件头那一套，不整张解码） */
async function imageSizeOf(
  bytes: Uint8Array,
  mime: string,
): Promise<{ width: number; height: number } | null> {
  const fromHeader = imageSizeFromHeader(bytes)
  if (fromHeader) return fromHeader
  const bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }))
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

/** 某个节点现在有没有图 */
export function nodeHasAsset(store: CanvasStore, nodeId: string): boolean {
  return Boolean(
    (store.getSnapshot().nodes.find((n) => n.id === nodeId)?.data as
      | { assetHash?: string }
      | undefined)?.assetHash,
  )
}

/**
 * 等某个节点出图（局部图跑完才轮到融合）。
 *
 * 为什么是**轮询**而不是订阅 store：判断「该放弃了吗」还要看执行态
 * （`exec.nodeStateOf` 在另一个 store 里），两条来源不同的状态用订阅拼会漏事件；
 * 400ms 一轮、上限 3 分钟，简单且不会挂死。
 */
export async function waitForNodeAsset(
  store: CanvasStore,
  nodeId: string,
  opts: { timeoutMs?: number; isFailed?: () => boolean } = {},
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 1000
  const startedAt = Date.now()
  for (;;) {
    if (nodeHasAsset(store, nodeId)) return true
    if (opts.isFailed?.()) return false
    if (Date.now() - startedAt > timeoutMs) return false
    await new Promise((r) => setTimeout(r, 400))
  }
}
