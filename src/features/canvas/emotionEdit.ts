import type { PlatformKit } from '../../platform/ports'
import type { CanvasStore } from '../../state/workbenches/canvas/store'
import type { GenerationData } from '../../domain/canvas/model/node'
import type { NodeInput } from '../../domain/shared/execution/types'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import {
  FACE_BOX_INSTRUCTION,
  FACE_BOX_SYSTEM,
  faceBoxFailureReason,
  normalizeDetectorBox,
  parseFaceBox,
  pickPrimaryFace,
  type FaceBox,
} from '../../domain/canvas/vision/faceBox'
import { asAppError, describeError } from '../../shared/result'

/**
 * 「情绪调节」的第一步：**找出脸在哪**。
 *
 * 找到就写进节点数据（`GenerationData.faceBox`），由提示词带着它去生成；
 * 找不到就如实说明为什么，由面板开灯箱让人自己框。
 *
 * ## 为什么只有「找脸」这一步，没有第二条流水线
 *
 * 早先这里是「识别脸 → 裁局部 → 改局部 → 融合回原图」的四步流水线，会在画布上
 * 多出**两个节点**（局部图 + 融合）。那是错的（用户 2026-10-06 明确）：
 * 画布上的融合节点是**另一套工作流**（原图 + 若干带上下文的局部修改图 → 本地像素合成），
 * 情绪调节借它去「贴回去」，等于把两件事焊死，用户莫名其妙多出两个节点。
 *
 * 现在照参考实现（VOZEB-PRO）的做法：**识别脸 → 把位置写进提示词 → 点生成直接出图**。
 * 整条链路只剩一次生成，产物是**源图右侧的一个新节点**（原图留着不动），
 * 没有中间节点，也不碰融合。
 *
 * ## 两条路的先后
 *
 * 1. **本机检测**（`platform.vision` → MediaPipe BlazeFace）：不联网、不花渠道、
 *    不依赖任何模型能力，所以排第一。它成了的话，这一步没有失败面。
 * 2. **问看图模型**（`completeText` + `inputs`，与「反推提示词」同一条链路）：
 *    本机没认出来时兜底。
 *
 * 两条都没结果时返回 `ok: false` —— 面板据此开灯箱让人手动框，而不是给一个
 * 「识别失败」的死胡同（用户 2026-10-06：识别不了就要能手动框）。
 */

export type FaceLook = (req: {
  channelId: string
  model: string
  system: string
  text: string
  inputs: NodeInput[]
  signal?: AbortSignal
}) => Promise<string>

export interface FaceResolveDeps {
  platform: PlatformKit
  store: CanvasStore
  /** 看图（与「反推提示词」同一条链路）：把源图发给对话模型，回一句话 */
  look: FaceLook
  /**
   * 依次尝试的对话模型（第一个通常是渠道解析链选出的默认对话模型）。
   *
   * 为什么要一串：**不是每个对话模型都能看图**。真机上报过一次「识别人脸失败」，
   * 只试一个模型时要么它看不了图、要么那条渠道当天不通 —— 于是这里按顺序试到有人
   * 给出可解析的框为止（最多 4 个，够用且不会无限重试）。
   *
   * **可以是空数组**：本机检测不需要任何渠道。
   */
  candidates: readonly { channelId: string; model: string }[]
}

export type FaceResolveOutcome =
  | {
      ok: true
      box: FaceBox
      /** 框是哪条路找到的（决定给用户看哪句话） */
      detectedBy: 'local' | 'model'
    }
  | { ok: false; reason: string }

/**
 * 找出这张图里的主脸。
 *
 * 一张图里有多张脸时取**面积最大**的那张：情绪调节是一键跑的，没有让人挑的那一步，
 * 而一张图里最大的脸通常就是主体（合影里也是主角）。
 */
export async function resolveFaceBox(
  deps: FaceResolveDeps,
  input: { nodeId: string; signal?: AbortSignal },
): Promise<FaceResolveOutcome> {
  const graph = deps.store.getSnapshot()
  const node = graph.nodes.find((n) => n.id === input.nodeId)
  if (!node) return { ok: false, reason: '节点不存在' }
  const data = node.data as GenerationData
  const assetHash = data.assetHash
  if (!assetHash) {
    return { ok: false, reason: '这个节点还没有图片：先让它出一张图，再来调表情' }
  }

  const payload = await deps.platform.assets.read(assetHash)
  if (!payload) return { ok: false, reason: '读不到这张图的素材' }
  const size =
    data.naturalSize ?? (await imageSizeOf(payload.bytes, payload.mime).catch(() => null))
  if (!size) return { ok: false, reason: '读不到这张图的尺寸' }
  const mime = payload.mime || 'image/png'

  /**
   * ① **先让本机认**（MediaPipe BlazeFace worker，随包走的 wasm + 模型）。
   *
   * 这一步不联网、不花渠道、不看模型脸色。`platform.vision` 缺席（测试用的内存平台 /
   * 老浏览器）或认不出来，都只是「这一步没结果」，继续往下走。
   */
  const localRan = Boolean(deps.platform.vision)
  if (deps.platform.vision) {
    const hit = await deps.platform.vision.detectFaces(payload.bytes, mime, input.signal)
    if (hit) {
      const boxes = hit.faces
        .map((face) => normalizeDetectorBox(face, hit.imageWidth, hit.imageHeight))
        .filter((face): face is FaceBox => face !== null)
      const primary = pickPrimaryFace(boxes)
      if (primary) return { ok: true, box: primary, detectedBy: 'local' }
    }
  }

  /**
   * ② 本机没结果 → 退回**问看图模型**：按候选顺序试，谁给出可解析的框就用谁。
   * 候选为空是允许的（本机那条路不需要渠道），这时直接落到下面的失败分支。
   */
  const tried: string[] = []
  let lastAnswer = ''
  let lastError = ''
  const imageInput = {
    kind: 'asset',
    nodeId: node.id,
    assetHash,
    mime,
  } satisfies NodeInput
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
      const box = parseFaceBox(answer, size)
      if (box) return { ok: true, box, detectedBy: 'model' }
    } catch (e) {
      const app = asAppError(e)
      lastError = app ? describeError(app) : e instanceof Error ? e.message : String(e)
    }
  }

  /** 失败时把**证据一起给出来**（谁试过、报了什么、模型回了什么），见 `faceBoxFailureReason` */
  return { ok: false, reason: faceBoxFailureReason({ tried, lastError, lastAnswer, localRan }) }
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

/**
 * 灯箱里手动框出来的矩形（**原图像素**）→ 归一化人脸框。
 *
 * 为什么要有这一步：灯箱的选区存的是原图像素（缩放 / 平移时框跟着图走，不必重算），
 * 而节点上存的是归一化值（换尺寸、复制粘贴都不会指错）。两边各说各的坐标，
 * 换算是必须显式做一次的 —— 塞在组件里做，这条规则就没人测得到。
 */
export function faceBoxFromRect(
  rect: { x: number; y: number; w: number; h: number },
  natural: { w: number; h: number },
): FaceBox | null {
  const safeW = Math.max(1, natural.w)
  const safeH = Math.max(1, natural.h)
  const w = Math.max(0, Math.min(1, rect.w / safeW))
  const h = Math.max(0, Math.min(1, rect.h / safeH))
  if (w <= 0 || h <= 0) return null
  const x = Math.max(0, Math.min(1 - w, rect.x / safeW))
  const y = Math.max(0, Math.min(1 - h, rect.y / safeH))
  return { x, y, w, h }
}
