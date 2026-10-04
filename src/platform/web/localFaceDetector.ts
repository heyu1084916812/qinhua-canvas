import type { FaceDetectionPort, FaceDetectionResult } from '../ports'
import { parseDetectorResponse, type DetectorFaceRect } from '../../shared/faceDetect'

/**
 * 本机人脸检测（MediaPipe BlazeFace，跑在 Worker 里）。
 *
 * ## 为什么要有这一条路
 *
 * 「情绪调节」原来靠**问对话模型**「脸在哪」。那条路能不能出框，取决于模型会不会
 * 看图、渠道通不通、回的话格不格式 —— 真机上报过「识别人脸失败」正是栽在这里。
 * 参照 VOZEB-PRO，把检测搬到本机：不联网、不花渠道、不依赖任何模型能力。
 *
 * ## 这一层只做四件事
 *
 * 懒建 worker、把字节解码成 `ImageBitmap` 转过去、等回包、把「跑不起来」翻译成 `null`。
 * **判断与换算都不在这里**：归一化是 `shared/faceDetect` 的纯函数（有单测），
 * 「用哪张脸」也是上层的决定。
 *
 * ## 为什么失败一律是 `null` 而不是抛异常
 *
 * 端口契约（`ports.ts` 的 `FaceDetectionPort`）：认不出来不是失败，是「没有」。
 * 上层据此走回退（问模型 / 手动框选）。只有**用户主动取消**才抛 `AbortError`——
 * 那种情况下上层不该再去做任何别的事。
 */

/**
 * 第一次要现编译十几 MB 的 wasm，给足时间；之后每次都是几十毫秒。
 * 超时不重试（免得卡住用户），但会**把 worker 丢掉重来** —— 卡死的 worker
 * 留着的话，后面每一次都会跟着卡。
 */
const FIRST_RUN_TIMEOUT_MS = 20000

interface PendingDetection {
  resolve: (faces: DetectorFaceRect[] | null) => void
  cleanup: () => void
}

let worker: Worker | null = null
let sequence = 0
const pending = new Map<number, PendingDetection>()

/**
 * 拿 worker（没有就建一个）。**任何一步不行都返回 null**：
 * 环境没有 `Worker`（老浏览器 / 测试环境）、脚本 404、被 CSP 拦住，全都归到这一类。
 */
function getWorker(): Worker | null {
  if (worker) return worker
  if (typeof Worker === 'undefined' || typeof document === 'undefined') return null
  try {
    /**
     * 路径以 **`BASE_URL` 为根**，不以当前文档为根。
     *
     * 这两者的差别踩过一次：画布页的地址是 `/canvas/<id>`（没有结尾斜杠），
     * 拿它当基准的话 `mediapipe/...` 会解析成 `/canvas/mediapipe/...`，
     * 被 dev server 的 SPA 回退成 `index.html` 200 ⇒ worker 拿到一坨 HTML
     * ⇒ 建得起来、跑不起来，**而回退路径会把整条流程照常跑绿**。
     * 第一版就是这么错的，靠冒烟里「本机检测的三样文件都被真正加载」那条抓出来。
     *
     * worker 脚本放在 `public/mediapipe/` 下按静态文件原样加载，不经打包器改写。
     */
    const url = new URL(`${import.meta.env.BASE_URL}mediapipe/face-detector-worker.js`, document.baseURI).href
    const created = new Worker(url)
    created.onmessage = (event: MessageEvent<unknown>) => {
      const response = parseDetectorResponse(event.data)
      if (!response) {
        /** 回包形状不认：丢掉整个 worker，别让后续请求继续拿不清不楚的结果 */
        failAll()
        return
      }
      const request = pending.get(response.id)
      if (!request) return
      pending.delete(response.id)
      request.cleanup()
      if (response.error) {
        /** worker 里报的错（模型缺失 / wasm 跑不起来）：如实记一笔，上层按「没认出来」走 */
        console.warn('[face-detect] 本机人脸识别失败：', response.error)
        request.resolve(null)
        return
      }
      request.resolve(response.faces ?? [])
    }
    created.onerror = () => failAll()
    created.onmessageerror = () => failAll()
    worker = created
    return created
  } catch {
    return null
  }
}

/** worker 整个坏掉：所有等待中的请求按「没认出来」收尾，并把它丢掉重建 */
function failAll(): void {
  for (const request of pending.values()) {
    request.cleanup()
    request.resolve(null)
  }
  pending.clear()
  worker?.terminate()
  worker = null
}

function abortError(): DOMException {
  return new DOMException('人脸识别已取消', 'AbortError')
}

async function detectFaces(
  bytes: Uint8Array,
  mime: string,
  signal?: AbortSignal,
): Promise<FaceDetectionResult | null> {
  if (typeof createImageBitmap !== 'function') return null
  if (signal?.aborted) throw abortError()
  const target = getWorker()
  if (!target) return null

  /** 解码失败（不是图片 / 格式不支持）：按「没认出来」处理，别把半个坏图送进去 */
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(new Blob([bytes as unknown as BlobPart], { type: mime }))
  } catch {
    return null
  }
  if (signal?.aborted) {
    bitmap.close()
    throw abortError()
  }
  const { width, height } = bitmap
  const id = ++sequence

  const faces = await new Promise<DetectorFaceRect[] | null>((resolve) => {
    const timer = setTimeout(() => {
      const request = pending.get(id)
      if (!request) return
      pending.delete(id)
      request.cleanup()
      /** 超时八成是 worker 卡住了 —— 丢掉重建，下一次才有机会正常 */
      worker?.terminate()
      worker = null
      resolve(null)
    }, FIRST_RUN_TIMEOUT_MS)
    const onAbort = () => {
      const request = pending.get(id)
      if (!request) return
      pending.delete(id)
      request.cleanup()
      resolve(null)
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    pending.set(id, { resolve, cleanup })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      target.postMessage({ id, image: bitmap }, [bitmap])
    } catch {
      pending.delete(id)
      cleanup()
      bitmap.close()
      resolve(null)
    }
  })
  /** 取消走的是 `onAbort`（resolve null）+ 这里补抛，两条都要留：Promise 只能收一次尾 */
  if (signal?.aborted) throw abortError()
  if (!faces) return null
  return { imageWidth: width, imageHeight: height, faces }
}

export function createLocalFaceDetector(): FaceDetectionPort {
  return { detectFaces }
}
