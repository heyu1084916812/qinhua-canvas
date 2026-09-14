import type { NetworkPort, NetworkRequest, NetworkResponse, StreamChunk } from '../ports'
import type { AppError } from '../../shared/result'
import { parseSSELine, createLineSplitter } from '../sse'

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

function requestInit(req: NetworkRequest): { headers: Record<string, string>; body?: BodyInit } {
  const raw = isRawBody(req.body)
  const base: Record<string, string> = raw || req.body === undefined ? {} : { 'content-type': 'application/json' }
  const merged: Record<string, string> = { ...base, ...req.headers }
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

function toResponse(res: Response, text: string): NetworkResponse {
  const headers: Record<string, string> = {}
  res.headers.forEach((value, key) => {
    headers[key] = value
  })
  return {
    status: res.status,
    headers,
    async text() {
      return text
    },
    async json<T = unknown>() {
      try {
        return JSON.parse(text) as T
      } catch {
        throw { kind: 'parse', raw: text.slice(0, 200) } satisfies AppError
      }
    },
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer as ArrayBuffer
    },
  }
}

export function createFetchNetwork(): NetworkPort {
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
        const text = await res.text()
        if (!res.ok) {
          throw { kind: 'http', status: res.status, body: text.slice(0, 500) } satisfies AppError
        }
        return toResponse(res, text)
      } catch (e) {
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
