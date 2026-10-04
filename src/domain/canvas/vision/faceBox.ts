import type { FaceBox } from '../../../shared/faceDetect'

/**
 * 人脸框（用户 2026-10-05 第五批第 1 条：「情绪调节需要重新设计，需要先自动识别面部，
 * 然后只改变面部的情绪，其他的内容完全不变才对」）。
 *
 * ## 为什么是「问模型」而不是「浏览器自己认」
 *
 * 实测：本机 Chrome **没有** `window.FaceDetector`（Shape Detection API 在 Windows 未开放）。
 * 而项目里已经有一条**看图链路** ——「反推提示词」就是把上游图片随 `completeText` 一起发给
 * 对话模型（`NodeInput` 里的 `kind: 'asset'`）。所以「自动识别面部」复用那条路：
 * 让模型回一个人脸外接框，我们把它换算成原图像素矩形，再交给「提取选区 → 改图 → 融合」。
 *
 * ## 这一层只做**纯计算**
 *
 * 解析（模型的话 → 归一化框）与换算（归一化框 → 像素矩形）都是纯函数，可以单测；
 * 发请求、裁图、建节点在 `features/canvas/emotionEdit.ts`。
 */

/**
 * 归一化人脸框的**形状**定义在 `shared/faceDetect`（平台层的本机检测也用同一个）。
 * 这里只做转出，调用方继续从本模块拿 `FaceBox`。
 */
export type { FaceBox }

/**
 * 让模型「只回一个 JSON 框」。
 *
 * 写清三件事，少一件就会拿到不能用的话：① 只给 JSON（否则会夹一段中文描述）；
 * ② 四个数都是 0–1 的归一化值（否则我们不知道它是像素还是百分比）；
 * ③ 没有脸时给一个**明确的否定答案**（否则它会硬编一个框，我们就裁到背景上去了）。
 */
export const FACE_BOX_SYSTEM = [
  '你是图像标注助手。用户会给你一张图片。',
  '只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块、不要多余文字。',
  '格式：{"x":0.1,"y":0.2,"w":0.3,"h":0.4}',
  '四个数都是 0~1 的**归一化**值：x/y 是「人脸外接框」左上角在图中的相对位置，w/h 是相对宽高。',
  '框要把额头与下巴都包进去（不要只框眼睛）。',
  '图里没有人的脸时，只输出 {"none":true}。',
].join('\n')

/** 这一问的正文。与 `FACE_BOX_SYSTEM` 一起发出去 */
export const FACE_BOX_INSTRUCTION = '找出图中最主要那个人物的脸，输出它的外接框。'

/**
 * 模型的话 → 归一化人脸框。**拿不准就返回 null**。
 *
 * 这里的取舍是刻意的：裁错位置比不裁更糟 —— 用户会看到一张「改到背景上」的图，
 * 却以为是自己点错了。所以任何不合理（缺字段、数值离谱、框小到没有意义、
 * 超出画面太远）都判 null，由调用方如实告诉用户「没识别到，请手动框选」。
 */
export function parseFaceBox(
  raw: string,
  imageSize?: { width: number; height: number },
): FaceBox | null {
  if (!raw) return null
  /** 从可能夹着解释的回话里抠出第一个 JSON 对象（模型偶尔还是会带一句话） */
  const match = raw.match(/\{[\s\S]*?\}/)
  if (!match) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(match[0])
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const o = parsed as Record<string, unknown>
  /** 明确的「没有脸」 */
  if (o.none === true || o.found === false) return null

  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v)
      return Number.isFinite(n) ? n : null
    }
    return null
  }
  let x = num(o.x)
  let y = num(o.y)
  let w = num(o.w ?? o.width)
  let h = num(o.h ?? o.height)
  if (x === null || y === null || w === null || h === null) return null

  /**
   * 三个尺度都可能遇到，按「像哪一种」判：
   * ① 0–1 归一化（我们要的）；② **0–100 百分数**；③ **像素坐标**。
   *
   * ③ 是最常见的一种（模型按原图像素给框），所以要把图片尺寸传进来才敢认 ——
   * 实测失败过一次（真机报「识别人脸失败」）：模型回的是像素，解析器只认前两种，
   * 直接判 null。现在只要四个数都在图片范围内，就按像素换算成归一化值。
   */
  const max = Math.max(x, y, w, h)
  if (max > 1.0001) {
    const looksLikePixels =
      imageSize &&
      imageSize.width > 0 &&
      imageSize.height > 0 &&
      x + w <= imageSize.width * 1.05 &&
      y + h <= imageSize.height * 1.05
    if (looksLikePixels) {
      x /= imageSize!.width
      y /= imageSize!.height
      w /= imageSize!.width
      h /= imageSize!.height
    } else if (max <= 100) {
      x /= 100
      y /= 100
      w /= 100
      h /= 100
    } else {
      return null
    }
  }

  /** 合理性：框要有点面积、中心要落在画面附近（允许略微出界） */
  if (w <= 0.02 || h <= 0.02 || w > 1.2 || h > 1.2) return null
  const cx = x + w / 2
  const cy = y + h / 2
  if (cx < -0.1 || cx > 1.1 || cy < -0.1 || cy > 1.1) return null
  return { x, y, w, h }
}

/**
 * 识别失败时要给用户看的那句话。
 *
 * 真机上只看到一句「识别人脸失败」时，谁都判断不出是**模型看不了图**、**渠道不通**、
 * 还是**它回的格式我们不认** —— 所以这句必须把三样证据摆出来：试过谁、报了什么、
 * 模型回了什么，最后给一条能走的路（换个能看图的模型 / 手动框选）。
 */
export function faceBoxFailureReason(input: {
  tried: readonly string[]
  lastError?: string
  lastAnswer?: string
  /** 本机检测有没有跑过。跑过却没认到，是「图里可能真没脸」的重要线索，要写进话里 */
  localRan?: boolean
}): string {
  const who = input.tried.join(' / ')
  const head = input.localRan
    ? who
      ? `本机与 ${who} 都没认到人脸`
      : '本机没认到人脸，也没有可用的对话模型可以再试'
    : `没识别到人脸（试过 ${who || '没有可用的对话模型'}）`
  const parts = [head]
  if (input.lastError?.trim()) parts.push(`请求报错：${input.lastError.trim()}`)
  if (input.lastAnswer?.trim()) parts.push(`模型回的是：${input.lastAnswer.trim().slice(0, 60)}`)
  parts.push('换一个能看图的对话模型再试，或者先在素材灯箱里框选脸部（提取选区）')
  return parts.join('；')
}

/** 本机检测那条路的解析 / 归一化 / 选主脸在 `shared/faceDetect`，两条路共用一套判据 */
export { normalizeDetectorBox, parseDetectorResponse, pickPrimaryFace } from '../../../shared/faceDetect'
