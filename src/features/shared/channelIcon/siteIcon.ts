import { readChannelIconBlob } from './readIconFile'

/**
 * **从网站抓站点图标**（对账 #396：用户问「上传图标能否给网站，然后自己去拉取抓图标下来？」）。
 *
 * 抓的是站点**根目录下的标准位置**，按顺序试两条：
 * ① `/favicon.ico`（最老也最通用的一条）；② `/apple-touch-icon.png`（没有 ① 的站点里常见）。
 *
 * 为什么只试这两条、不去解析页面里的 `<link rel="icon">`：那要把首页 HTML 拉回来解析，
 * 等于为了一张小图去抓整页 —— 体量、超时、编码、大小站各不相同，收益远不及"没抓到就让用户
 * 手动上传"。也**不接第三方图标服务**：那等于把用户填的站点地址交给第三方，且多一个会挂的依赖。
 *
 * 与网络层（`RemoteBytesPort`）的分工：端口只负责"把字节取回来"，这里负责判断
 * "这算不算一张能用的图标" —— 判据只有一条：**响应说它是图片**（`image/*`，且不是 SVG，
 * 因为 canvas 解不了 SVG 那种矢量图）。
 */

/** 抓取要用的两件事，注入进来便于单测（node 环境没有 canvas） */
export interface SiteIconDeps {
  get(req: {
    url: string
    timeoutMs?: number
  }): Promise<{ status: number; contentType: string; bytes: Uint8Array }>
  /** 字节 → ≤128px 的 PNG data URL（默认实现走 canvas，见 `readIconFile.ts`） */
  toIcon(bytes: Uint8Array, contentType: string): Promise<string>
}

export type SiteIconOutcome =
  | {
      ok: true
      /** 存进 `channel.icon` 的值（`data:image/png;base64,…`） */
      dataUrl: string
      /** 实际抓到的那条地址（用于如实告诉用户是从哪儿抓的） */
      sourceUrl: string
    }
  | { ok: false; message: string }

/** 默认的"字节 → 图标"：装成 Blob 交给和"上传图片"同一条压缩路径 */
export const defaultToIcon: SiteIconDeps['toIcon'] = (bytes, contentType) =>
  readChannelIconBlob(
    new Blob([bytes as unknown as BlobPart], { type: contentType || 'image/png' }),
  )

/**
 * 站点地址 → 要试的两条图标地址（**纯函数**，可单测）。
 *
 * 只取 **origin**（协议 + 主机 + 端口），把用户填的路径丢掉：
 * 渠道地址常写成 `https://api.xxx.com/v1` 这种 API 前缀，图标在根上，不在 `/v1` 下面。
 * 没写协议时按 `https://` 补（用户多半只会敲域名）。不是 http/https 就返回空数组 ——
 * 调用方据此如实说"这不像网站地址"，而不是去发一个奇怪请求。
 */
export function siteIconCandidates(siteUrl: string): string[] {
  const raw = siteUrl.trim()
  if (!raw) return []
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`
  let origin: string
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return []
    origin = url.origin
  } catch {
    return []
  }
  return [`${origin}/favicon.ico`, `${origin}/apple-touch-icon.png`]
}

/** 这一条 `Content-Type` 算不算"能解码的栅格图" */
export function isRasterImageType(contentType: string): boolean {
  const type = normalizeType(contentType)
  if (!type.startsWith('image/')) return false
  /** SVG 是矢量：`createImageBitmap` 在 Chromium 上解不了它，收下只会变成"之后那一步失败" */
  return type !== 'image/svg+xml'
}

function normalizeType(contentType: string): string {
  return contentType.split(';')[0].trim().toLowerCase()
}

/** 结果行里给用户看的一句人话：拿到的到底是什么 */
function describeMiss(contentType: string, status: number): string {
  const type = normalizeType(contentType)
  if (status < 200 || status >= 300) return `HTTP ${status}`
  if (type === 'image/svg+xml') return '站点给的是 SVG'
  if (type.startsWith('text/html')) return '站点返回的是网页'
  if (type) return `拿到的不是图片（${type}）`
  return '取不回来'
}

/**
 * 真的去抓：两条候选依次试，第一条能用的就用。
 *
 * 失败时**不抛**，而是回一句能行动的话 —— 调用方直接把它显示在图标那一行，
 * 用户看到的下一步永远是"手动上传一张"，不会是一个空白或一句英文异常。
 */
export async function fetchSiteIcon(
  siteUrl: string,
  deps: SiteIconDeps,
  timeoutMs = 8000,
): Promise<SiteIconOutcome> {
  const candidates = siteIconCandidates(siteUrl)
  if (candidates.length === 0) {
    return { ok: false, message: '先在「地址」里填一个网站（http / https），再去抓图标' }
  }
  let lastMiss = ''
  for (const url of candidates) {
    let res: { status: number; contentType: string; bytes: Uint8Array }
    try {
      res = await deps.get({ url, timeoutMs })
    } catch {
      /** 网络层抛（超时 / DNS / 拒绝）：对用户就是"这个站点取不回来" */
      lastMiss = '取不回来'
      continue
    }
    if (res.status < 200 || res.status >= 300 || !isRasterImageType(res.contentType)) {
      lastMiss = describeMiss(res.contentType, res.status)
      continue
    }
    try {
      const dataUrl = await deps.toIcon(res.bytes, normalizeType(res.contentType))
      return { ok: true, dataUrl, sourceUrl: url }
    } catch {
      /** 拿到了字节但解不成图（截断 / 伪装成 png 的别的格式）：同上，让用户手动上传 */
      lastMiss = '拿到的字节解不成图片'
    }
  }
  return { ok: false, message: `这个站点没抓到图标（${lastMiss || '取不回来'}），手动上传一张吧` }
}
