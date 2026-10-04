/**
 * 人脸框的形状与换算 —— **纯计算，与任何工作台无关**。
 *
 * ## 为什么单独放一份
 *
 * 「脸在哪」这件事有两个来源：
 *
 * 1. **本机检测**（`platform/web/localFaceDetector` → MediaPipe BlazeFace worker），
 *    回的是**像素**框；
 * 2. **问模型**（画布的「情绪调节」，`domain/canvas/vision/faceBox`），
 *    回的是 0–1 / 0–100 / 像素三种都可能。
 *
 * 两条路最后必须落到**同一种东西**上，否则「什么叫一张有效的脸框」会有两套口径，
 * 换一条路行为就变。所以归一化、有效性判据、回包解析都收在这里，两边共用。
 *
 * 放在 `shared` 而不是 `domain/canvas`：平台层（`src/platform`）也要用它，
 * 而平台的端口实现**不该反向依赖某个工作台的领域模块**（架构 §5.10 同一条口径）。
 */

/** 归一化人脸框：`x/y` = 左上角，`w/h` = 宽高，全部 0–1 */
export interface FaceBox {
  x: number
  y: number
  w: number
  h: number
  /** 检测器的可信度（0–1）。「问模型」那条路没有这个值，所以可选 */
  score?: number
}

/** 检测器回的**像素**框（相对图片左上角） */
export interface DetectorFaceRect {
  x: number
  y: number
  width: number
  height: number
  score?: number
}

export interface DetectorResponse {
  id: number
  faces?: DetectorFaceRect[]
  error?: string
}

/** 一张图要有点面积才可能是脸；小于这个比例的直接判「没有」 */
const MIN_FACE_EDGE = 0.02

/**
 * 像素框 → 归一化人脸框。
 *
 * 判据与「问模型」那条路同一套：贴边夹回画面内、太小判 null。
 * 两套检测器出来的框要能互换使用，就不能各自定义一套「什么叫有效框」。
 */
export function normalizeDetectorBox(
  box: DetectorFaceRect,
  imageWidth: number,
  imageHeight: number,
): FaceBox | null {
  const safeW = Math.max(1, imageWidth)
  const safeH = Math.max(1, imageHeight)
  const w = Math.max(0, Math.min(1, box.width / safeW))
  const h = Math.max(0, Math.min(1, box.height / safeH))
  if (w <= MIN_FACE_EDGE || h <= MIN_FACE_EDGE) return null
  const x = Math.max(0, Math.min(1 - w, box.x / safeW))
  const y = Math.max(0, Math.min(1 - h, box.y / safeH))
  return box.score === undefined ? { x, y, w, h } : { x, y, w, h, score: box.score }
}

/**
 * Worker 回包 → 可信结构。**形状不认识就返回 null**（而不是硬解）。
 *
 * 为什么要这么严：`postMessage` 是跨线程的，回什么完全由那边决定；一个 `id`
 * 对不上、或 `faces` 不是数组的回包如果被当成正常结果，就会变成「识别到了 0 张脸」
 * 这种**看起来成功、实际说不清**的状态。
 */
export function parseDetectorResponse(value: unknown): DetectorResponse | null {
  if (!value || typeof value !== 'object') return null
  const data = value as Record<string, unknown>
  if (typeof data.id !== 'number' || !Number.isInteger(data.id)) return null
  if (data.error !== undefined && typeof data.error !== 'string') return null
  const rawFaces = data.faces
  if (rawFaces !== undefined && !Array.isArray(rawFaces)) return null
  const faces: DetectorFaceRect[] = []
  for (const raw of (rawFaces ?? []) as unknown[]) {
    if (!raw || typeof raw !== 'object') return null
    const f = raw as Record<string, unknown>
    const nums = [f.x, f.y, f.width, f.height]
    if (!nums.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
    if (f.score !== undefined && (typeof f.score !== 'number' || !Number.isFinite(f.score))) return null
    faces.push({
      x: f.x as number,
      y: f.y as number,
      width: f.width as number,
      height: f.height as number,
      ...(f.score === undefined ? {} : { score: f.score as number }),
    })
  }
  return {
    id: data.id as number,
    ...(data.error === undefined ? {} : { error: data.error as string }),
    faces,
  }
}

/**
 * 一张图里可能有好几张脸，而「情绪调节」是一键跑的、没有让人挑的那一步。
 *
 * 取**面积最大**的那张：一张图里最大的脸通常就是主体（合影里也是主角）；
 * 取第一张则取决于检测顺序，那是实现细节，不该渗进产品行为。
 */
export function pickPrimaryFace(faces: readonly FaceBox[]): FaceBox | null {
  let best: FaceBox | null = null
  for (const face of faces) {
    if (!best || face.w * face.h > best.w * best.h) best = face
  }
  return best
}
