import type { NetworkPort, NetworkRequest, NetworkResponse } from '../../platform/ports'

/**
 * 陈列室用的离线网络层（架构 §5.7）。
 *
 * 陈列室跑在内存平台上，没有真实中转站，因此「批量生成」这类需要走
 * 渠道适配器的交互无法直接演示。这里拦下 OpenAI 兼容协议的两个端点：
 * - GET  {base}/v1/models               → 返回固定模型清单
 * - POST {base}/v1/images/generations   → 按 n 返回若干最小 PNG
 *
 * **仅 DEV 下被 mountPreview 使用**，不会进入生产构建（dev/preview 整目录不进产物）。
 */

/** 1×1 透明 PNG：陈列室只需「有素材可渲染」，不必真的有画面 */
const PNG_1X1_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function json(status: number, body: unknown): NetworkResponse {
  const text = JSON.stringify(body)
  return {
    status,
    headers: { 'content-type': 'application/json' },
    async text() {
      return text
    },
    async json<T = unknown>() {
      return JSON.parse(text) as T
    },
    async arrayBuffer() {
      return new TextEncoder().encode(text).buffer as ArrayBuffer
    },
  }
}

/** 陈列室内置的三个模型：生图 / 视频 / 对话，覆盖参数面板的分档渲染 */
const MODELS = [
  { id: 'mock-image-1', owned_by: 'image' },
  { id: 'mock-video-1', owned_by: 'video' },
  { id: 'mock-chat-1', owned_by: 'chat' },
]

export function createPreviewNetwork(): NetworkPort {
  const handle = async (req: NetworkRequest): Promise<NetworkResponse> => {
    const url = req.url

    if (url.endsWith('/v1/models')) {
      return json(200, { data: MODELS.map((m) => ({ object: 'model', ...m })) })
    }

    if (url.endsWith('/v1/images/generations')) {
      const body = (req.body ?? {}) as { n?: number }
      // 批量场景：一次请求可能带 n 张（面板「数量」档位），逐张给素材
      const n = Math.max(1, Math.min(9, Math.round(body.n ?? 1)))
      return json(200, { data: Array.from({ length: n }, () => ({ b64_json: PNG_1X1_B64 })) })
    }

    return json(404, { error: { message: `preview network 未覆盖的端点：${url}` } })
  }

  return {
    request: (req) => handle(req),
    async *stream() {
      // 陈列室不用流式
    },
  }
}
