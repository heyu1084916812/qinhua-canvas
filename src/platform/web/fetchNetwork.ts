import type {
  NetworkPort,
  NetworkRequest,
  NetworkResponse,
  RemoteBytesPort,
  RemoteMultipartPart,
  RemoteTextRequest,
  StreamChunk,
} from '../ports'
import type { AppError } from '../../shared/result'
import { parseSSELine, createLineSplitter } from '../sse'
import { base64ToBytes, bytesToBase64 } from '../../domain/shared/base64'

/**
 * 请求体是否「原样上传」的形态（M6-12）。
 *
 * 此前 `body` 一律 `JSON.stringify`，因此渠道层**无法**发 multipart——
 * 图生图 / 参考图上传也就无从谈起。这里放行浏览器原生的 BodyInit 形态：
 * FormData（multipart，图生图要用）、Blob / ArrayBuffer（二进制直传）。
 *
 * 关键副作用：FormData 的 `Content-Type` 必须**由浏览器**补上 boundary，
 * 手写 `multipart/form-data` 会让服务端解析不出分界。故下面凡是原样体，
 * 都清掉调用方可能自带的 content-type。
 */
function isRawBody(body: unknown): body is BodyInit {
  return (
    body instanceof FormData ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof URLSearchParams ||
    ArrayBuffer.isView(body)
  )
}

function withoutContentType(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type') continue
    out[k] = v
  }
  return out
}

export function requestInit(req: NetworkRequest): { headers: Record<string, string>; body?: BodyInit } {
  const raw = isRawBody(req.body)
  /**
   * 键名**一律小写再合并**（2026-10-01 修）。
   *
   * 原先是 `{ ...base, ...req.headers }`：默认项写作 `content-type`、渠道层传的是
   * `Content-Type`，两个键大小写不同于是同时留在对象里。交给 `fetch` 后浏览器会把
   * 同名头**按逗号拼起来**，真发出去的是
   * `content-type: application/json, application/json` —— 服务端判定「不是 JSON」
   * 并回 400，而错误文案指不到病根（Agnes 的原话是「该接口仅支持 Content-Type:
   * application/json」）。mock 渠道不经网络层，所以整条冒烟一直没暴露它。
   */
  const merged: Record<string, string> = {}
  if (!raw && req.body !== undefined) merged['content-type'] = 'application/json'
  for (const [k, v] of Object.entries(req.headers ?? {})) merged[k.toLowerCase()] = v
  return {
    headers: raw ? withoutContentType(merged) : merged,
    body: raw ? (req.body as BodyInit) : req.body === undefined ? undefined : JSON.stringify(req.body),
  }
}

function toAppError(e: unknown, signal: AbortSignal): AppError {
  if (signal.aborted) return { kind: 'network', detail: 'aborted' }
  if (e && typeof e === 'object' && 'kind' in e) return e as AppError
  const name = e instanceof Error ? e.name : ''
  if (name === 'AbortError' || name === 'TimeoutError') {
    return { kind: 'network', detail: 'timeout' }
  }
  return { kind: 'network', detail: 'dns' }
}

function toResponse(status: number, headers: Record<string, string>, buffer: ArrayBuffer): NetworkResponse {
  const text = new TextDecoder().decode(buffer)
  return {
    status,
    headers,
    async text() {
      return text
    },
    async json<T = unknown>() {
      try {
        return JSON.parse(text) as T
      } catch {
        throw { kind: 'parse', raw: text.slice(0, 2000) } satisfies AppError
      }
    },
    async arrayBuffer() {
      return buffer.slice(0)
    },
  }
}

/**
 * **跨域回落**（对账 #518）：页面 `fetch` 失败时，改用桌面壳的原生 HTTP 再打一次。
 *
 * 为什么要回落：壳里的 webview 与浏览器是**同一份 fetch 实现、同样受 CORS 限制**。
 * 中转站不给 `Access-Control-Allow-Origin` 时，请求在浏览器这一层就被拦掉了 ——
 * 服务端其实好好的（实测 200），但应用只拿到一个"网络错误"，
 * 于是"验证协议"报「连不上这个地址（域名解析失败或连接被拒绝）」：
 * 真正的原因是跨域，而这句文案把用户往"地址填错了"的方向带。
 *
 * 只在**网络类失败**时回落（dns / tls / cors）：HTTP 状态码是服务端真回答了，
 * 那种失败（401 / 404 / 429）改走另一条路也还是同一个答复，没有任何意义。
 */
function isCorsLikeNetworkError(err: unknown): boolean {
  const e = err as { kind?: string; detail?: string } | null
  if (!e || e.kind !== 'network') return false
  // `dns` 是 fetch 抛错时的兜底归类（见 toAppError），CORS 被拦也落在这里
  return e.detail === 'dns' || e.detail === 'cors' || e.detail === 'tls'
}

/**
 * 只有 **GET** 允许在超时后走壳回落。
 *
 * POST 可能是已经受理并扣费的生成请求；网页层超时后再由壳重发会重复下单。
 * GET 产物下载没有这个副作用，浏览器直连卡住时值得换原生 HTTP 再取一次。
 */
function canFallbackToShell(req: NetworkRequest, err: unknown): boolean {
  if (isCorsLikeNetworkError(err)) return true
  const e = err as { kind?: string; detail?: string } | null
  return (
    (req.method ?? 'GET').toUpperCase() === 'GET' &&
    e?.kind === 'network' &&
    e.detail === 'timeout'
  )
}

async function shellMultipartOf(form: FormData): Promise<RemoteMultipartPart[]> {
  const parts: RemoteMultipartPart[] = []
  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      parts.push({ name, value })
      continue
    }
    const bytes = new Uint8Array(await value.arrayBuffer())
    parts.push({
      name,
      dataBase64: bytesToBase64(bytes),
      fileName: value instanceof File ? value.name : name,
      contentType: value.type || 'application/octet-stream',
    })
  }
  return parts
}

async function shellBodyOf(
  body: BodyInit,
): Promise<Pick<RemoteTextRequest, 'body' | 'bodyBase64' | 'contentType' | 'multipart'>> {
  if (body instanceof FormData) return { multipart: await shellMultipartOf(body) }
  if (body instanceof URLSearchParams) {
    return { body: body.toString(), contentType: 'application/x-www-form-urlencoded' }
  }
  if (body instanceof Blob) {
    const bytes = new Uint8Array(await body.arrayBuffer())
    return {
      bodyBase64: bytesToBase64(bytes),
      contentType: body.type || 'application/octet-stream',
    }
  }
  if (body instanceof ArrayBuffer) {
    return { bodyBase64: bytesToBase64(new Uint8Array(body)) }
  }
  if (ArrayBuffer.isView(body)) {
    return {
      bodyBase64: bytesToBase64(
        new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
      ),
    }
  }
  return {}
}

export function createFetchNetwork(remote?: {
  request?: NonNullable<RemoteBytesPort['request']>
}): NetworkPort {
  const shellRequest = remote?.request
  /** 走壳的原生 HTTP 打一次（不带 signal：Rust 侧自带超时） */
  const viaShell = async (req: NetworkRequest): Promise<NetworkResponse> => {
    const { headers, body } = requestInit(req)
    const bodyFields = body ? await shellBodyOf(body) : {}
    const res = await shellRequest!({
      url: req.url,
      method: req.method ?? 'GET',
      headers,
      ...(typeof body === 'string' ? { body } : bodyFields),
      timeoutMs: req.timeoutMs,
    })
    if (res.status < 200 || res.status >= 300) {
      throw { kind: 'http', status: res.status, body: res.text.slice(0, 500) } satisfies AppError
    }
    /**
     * 旧壳只回 text；新壳同时回 bodyBase64。后者是二进制唯一可靠来源，
     * 前者留给尚未同步升级的壳做兼容，但绝不能再声称它能还原图片字节。
     */
    const buffer = res.bodyBase64
      ? base64ToBytes(res.bodyBase64).buffer
      : new TextEncoder().encode(res.text).buffer
    return toResponse(res.status, res.headers ?? {}, buffer as ArrayBuffer)
  }

  return {
    async request(req: NetworkRequest, signal: AbortSignal): Promise<NetworkResponse> {
      const controller = new AbortController()
      const onAbort = (): void => controller.abort()
      signal.addEventListener('abort', onAbort, { once: true })
      const timer = req.timeoutMs ? setTimeout(() => controller.abort(), req.timeoutMs) : null

      const { headers, body } = requestInit(req)
      try {
        const res = await fetch(req.url, {
          method: req.method ?? 'GET',
          headers,
          body,
          signal: controller.signal,
        })
        /**
         * 必须一次读成 ArrayBuffer，再按需解码为文本。
         * 先 `text()` 再 `TextEncoder` 会把图片等二进制里所有非法 UTF-8 字节
         * 换成 U+FFFD；PNG 的 0x89 首字节会变成 `ef bf bd`，文件永久损坏。
         */
        const buffer = await res.arrayBuffer()
        const text = new TextDecoder().decode(buffer)
        if (!res.ok) {
          throw { kind: 'http', status: res.status, body: text.slice(0, 500) } satisfies AppError
        }
        const responseHeaders: Record<string, string> = {}
        res.headers.forEach((value, key) => {
          responseHeaders[key] = value
        })
        return toResponse(res.status, responseHeaders, buffer)
      } catch (e) {
        /** 浏览器这一层过不去（多为 CORS）且壳有原生 HTTP ⇒ 换一条路再试一次 */
        if (shellRequest && !signal.aborted && canFallbackToShell(req, toAppError(e, signal))) {
          return await viaShell(req)
        }
        throw toAppError(e, signal)
      } finally {
        if (timer) clearTimeout(timer)
        signal.removeEventListener('abort', onAbort)
      }
    },

    async *stream(req: NetworkRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
      try {
        const res = await fetch(req.url, {
          method: req.method ?? 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'text/event-stream',
            ...req.headers,
          },
          body: req.body === undefined ? undefined : JSON.stringify(req.body),
          signal,
        })
        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '')
          yield {
            type: 'error',
            error: { kind: 'http', status: res.status, body: text.slice(0, 500) },
          }
          return
        }

        reader = res.body.getReader()
        const decoder = new TextDecoder()
        const splitter = createLineSplitter()
        while (!signal.aborted) {
          const { done, value } = await reader.read()
          if (done) break
          for (const line of splitter(decoder.decode(value, { stream: true }))) {
            const chunk = parseSSELine(line)
            if (!chunk) continue
            yield chunk
            if (chunk.type === 'done' || chunk.type === 'error') return
          }
        }
      } catch (e) {
        yield { type: 'error', error: toAppError(e, signal) }
      } finally {
        reader?.cancel().catch(() => undefined)
      }
    },
  }
}
