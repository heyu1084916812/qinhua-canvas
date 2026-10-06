import type { CredentialPort, HostingPort, NetworkPort, StoragePort } from '../ports'
import {
  HOSTING_ROW_ID,
  cloudinaryUploadUrl,
  hostingConfigOf,
  hostingNeedsSecret,
  hostingObjectKey,
  hostingProbe,
  hostingPublicUrl,
  hostingReadiness,
  hostingSecretRef,
  sha256Hex,
  signAwsV4,
  signCloudinary,
  signOss,
  tmpfilesDirectUrl,
  type HostingConfig,
} from '../../domain/shared/hosting'

const TMPFILES_UPLOAD = 'https://tmpfiles.org/api/v1/upload'
/** 上传超时：大素材 + 慢网要留足，但别无限等（用户会以为卡死） */
const UPLOAD_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 15_000

/**
 * **素材传输（web）**：按设置页选的服务把素材传上去，换回公网直链（对账 #260）。
 *
 * 覆盖五家：`tmpfiles`（免注册匿名）/ 阿里云 OSS / 七牛云 / Cloudinary / S3 兼容（自填端点）。
 * 签名算法**全在 domain**（`domain/shared/hosting.ts`），这里只负责"取配置 → 取密钥 →
 * 发请求 → 拼地址"这些带 IO 的动作 —— 这样三套签名能被单测钉住（它们错了最难查：
 * 服务端只会回一句 `SignatureDoesNotMatch`）。
 *
 * ## 密钥从哪来
 *
 * 配置行（`presets`）里**只有** endpoint / bucket / accessKeyId 这类非敏感字段，
 * 密钥走凭据层（桌面端是 OS 加密库）。上传与测连通都现取现用，不缓存进内存。
 */
export function createWebHosting(deps: {
  storage: StoragePort
  credentials: CredentialPort
  network: NetworkPort
}): HostingPort {
  const { storage, credentials, network } = deps

  const readConfig = async (): Promise<HostingConfig> =>
    hostingConfigOf((await storage.query('presets', { id: HOSTING_ROW_ID }))[0])

  const secretOf = async (config: HostingConfig): Promise<string> =>
    (await credentials.load(hostingSecretRef(config.provider))) ?? ''

  /** 上传前的共同闸门：配置齐不齐、密钥有没有 —— **如实说缺什么**，别让用户对着 401 猜 */
  const guard = async (config: HostingConfig): Promise<string> => {
    const { ready, missing } = hostingReadiness(config)
    if (!ready) throw new Error(`素材传输还缺配置：${missing.join('、')}`)
    const secret = await secretOf(config)
    if (hostingNeedsSecret(config.provider) && !secret) {
      throw new Error('还没有填密钥（AccessKey Secret / API Secret）')
    }
    return secret
  }

  /** OSS / 七牛 / S3 兼容：签名后 PUT 一个对象，再拼出公网直链 */
  const uploadToBucket = async (
    config: HostingConfig,
    blob: Blob,
    key: string,
    secret: string,
  ): Promise<{ url: string }> => {
    const publicUrl = hostingPublicUrl(config, key)
    if (!publicUrl) throw new Error('拼不出公网直链：检查 Endpoint / Bucket（七牛还要填公网域名）')

    const endpoint = (config.endpoint ?? '').trim().replace(/\/+$/, '')
    const bucket = (config.bucket ?? '').trim()
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const contentType = blob.type || 'application/octet-stream'

    let url: string
    let headers: Record<string, string>
    if (config.provider === 'aliyun-oss') {
      const host = new URL(endpoint).host
      url = `${new URL(endpoint).protocol}//${bucket}.${host}/${key}`
      const signed = await signOss({
        verb: 'PUT',
        bucket,
        key,
        accessKeyId: (config.accessKeyId ?? '').trim(),
        secretAccessKey: secret,
        contentType,
        now: new Date(),
      })
      headers = {
        'content-type': contentType,
        'x-oss-date': signed.date,
        authorization: signed.authorization,
      }
    } else {
      url = `${endpoint}/${bucket}/${key}`
      const signed = await signAwsV4({
        method: 'PUT',
        url,
        region: (config.region ?? 'us-east-1').trim(),
        accessKeyId: (config.accessKeyId ?? '').trim(),
        secretAccessKey: secret,
        payloadHash: await sha256Hex(bytes),
        headers: { 'content-type': contentType },
        now: new Date(),
      })
      headers = signed.headers
    }

    await network.request(
      { url, method: 'PUT', headers, body: blob, timeoutMs: UPLOAD_TIMEOUT_MS },
      new AbortController().signal,
    )
    return { url: publicUrl }
  }

  /** Cloudinary：multipart 表单 + 参数签名，地址由它的 `secure_url` 返回 */
  const uploadToCloudinary = async (
    config: HostingConfig,
    blob: Blob,
    key: string,
    secret: string,
  ): Promise<{ url: string }> => {
    const timestamp = Math.floor(Date.now() / 1000).toString()
    const params: Record<string, string> = { timestamp }
    const folder = (config.pathPrefix ?? '').trim().replace(/^\/+|\/+$/g, '')
    if (folder) params.folder = folder
    const { signature } = await signCloudinary(params, secret)

    const form = new FormData()
    form.append('file', blob, key.split('/').pop() ?? 'asset')
    form.append('api_key', (config.apiKey ?? '').trim())
    form.append('timestamp', timestamp)
    if (folder) form.append('folder', folder)
    form.append('signature', signature)

    const res = await network.request(
      { url: cloudinaryUploadUrl(config.cloudName ?? ''), method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS },
      new AbortController().signal,
    )
    const body = (await res.json().catch(() => null)) as { secure_url?: unknown } | null
    const url = typeof body?.secure_url === 'string' ? body.secure_url : null
    if (!url) throw new Error('Cloudinary 没有返回 secure_url')
    return { url }
  }

  return {
    async upload({ blob, name }) {
      const config = await readConfig()
      /** 没配图床：如实返回 null（调用方回落内联 Base64），不当成失败 */
      if (config.provider === 'off') return null

      if (config.provider === 'tmpfiles') {
        const form = new FormData()
        form.append('file', blob, name)
        form.append('expire', String(config.expireSeconds))
        const res = await network.request(
          { url: TMPFILES_UPLOAD, method: 'POST', body: form, timeoutMs: UPLOAD_TIMEOUT_MS },
          new AbortController().signal,
        )
        const url = tmpfilesDirectUrl(await res.json().catch(() => null))
        if (!url) throw new Error('图床没有返回可用直链')
        return { url }
      }

      const secret = await guard(config)
      const key = hostingObjectKey(config, name, Date.now())
      return config.provider === 'cloudinary'
        ? uploadToCloudinary(config, blob, key, secret)
        : uploadToBucket(config, blob, key, secret)
    },

    /**
     * **测连通性**（用户第 4 条点名要的按钮）。
     *
     * 只发**一发只读请求**（`hostingProbe` 决定打哪儿），不做真实上传 ——
     * 上传会在用户桶里留垃圾对象，还要额外权限去删。所以这里能验的是
     * "端点/桶/云名通不通、凭据格式对不对"，**不假装验了写权限**：
     * 返回的话术里把那件事说清楚（见 `403` 那一档）。
     */
    async test() {
      const config = await readConfig()
      if (config.provider === 'off') return { ok: false, message: '当前是「关闭」：不会上传，也无需测连通' }

      const { ready, missing } = hostingReadiness(config)
      if (!ready) return { ok: false, message: `还缺：${missing.join('、')}` }

      const probe = hostingProbe(config)
      if (!probe) return { ok: false, message: '这家服务没有可探测的地址：先把 Endpoint / Bucket 补齐' }

      const headers: Record<string, string> = {}
      const secret = await secretOf(config)
      if (probe.basicUser) {
        if (!secret) return { ok: false, message: '还没有填密钥（API Secret）' }
        headers.authorization = `Basic ${btoa(`${probe.basicUser}:${secret}`)}`
      }

      try {
        const res = await network.request(
          { url: probe.url, method: probe.method, headers, timeoutMs: PROBE_TIMEOUT_MS },
          new AbortController().signal,
        )
        return { ok: true, message: `连通（HTTP ${res.status}）：${probe.note}` }
      } catch (err) {
        const status = (err as { status?: number }).status
        if (status === 403 && !probe.basicUser) {
          return {
            ok: true,
            message: '地址可达、桶存在（403：桶不是公开可读 —— 这正常，上传用的是凭据；写权限要发一次真实上传才知道）',
          }
        }
        if (status === 404) return { ok: false, message: '端点或桶名不对（404）' }
        if (status === 401) return { ok: false, message: '密钥不对（401）：检查 API Key / Secret' }
        if (typeof status === 'number') return { ok: false, message: `请求被拒（HTTP ${status}）` }
        return {
          ok: false,
          message: `连不上：${String((err as Error)?.message ?? err).slice(0, 120)}（检查网络、端点、CORS）`,
        }
      }
    },
  }
}
