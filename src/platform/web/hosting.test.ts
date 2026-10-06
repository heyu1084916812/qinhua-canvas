import { describe, expect, it } from 'vitest'
import { createMemoryCredentials, createMemoryStorage } from '../memory'
import type { NetworkPort, NetworkRequest, NetworkResponse } from '../ports'
import { HOSTING_ROW_ID, hostingSecretRef, sha256Hex, type HostingConfig } from '../../domain/shared/hosting'
import { createWebHosting } from './hosting'

/**
 * 素材传输（对账 #260）：上传与「测连通性」的平台实现。
 *
 * 网络用一个**记录请求 + 按剧本回话**的假实现：这样能验到"到底发了什么"
 * （方法 / 地址 / 签名头 / 表单字段），而不是只验"函数没抛"——
 * 签名类错误在真实环境里只会回一句 `SignatureDoesNotMatch`，靠单测才追得清。
 */
function fakeNetwork(script: (req: NetworkRequest) => { status?: number; json?: unknown } = () => ({})): {
  port: NetworkPort
  calls: NetworkRequest[]
} {
  const calls: NetworkRequest[] = []
  const port: NetworkPort = {
    async request(req) {
      calls.push(req)
      const out = script(req)
      const status = out.status ?? 200
      if (status >= 400) throw { kind: 'http', status, body: '' }
      const body = out.json
      return {
        status,
        headers: {},
        text: async () => JSON.stringify(body ?? ''),
        /** 端口签名是 `json<T>()`；假实现照样把剧本里的值交出去 */
        json: async <T,>() => body as T,
        arrayBuffer: async () => new ArrayBuffer(0),
      } satisfies NetworkResponse
    },
    // eslint-disable-next-line require-yield
    async *stream() {
      throw new Error('素材传输不走流式')
    },
  }
  return { port, calls }
}

async function harness(config: HostingConfig, secret?: string) {
  const storage = createMemoryStorage({ rows: { presets: [{ id: HOSTING_ROW_ID, ...config }] } })
  const credentials = createMemoryCredentials()
  if (secret) await credentials.save(hostingSecretRef(config.provider), secret)
  const net = fakeNetwork()
  const hosting = createWebHosting({ storage, credentials, network: net.port })
  return { hosting, calls: net.calls }
}

const probe = () => new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'image/png' })

describe('素材传输 · 上传（#260）', () => {
  it('关闭 ⇒ 如实返回 null（调用方回落内联 Base64，这不是失败）', async () => {
    const { hosting, calls } = await harness({ provider: 'off', expireSeconds: 86_400 })
    expect(await hosting.upload({ blob: probe(), name: 'a.png' })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('★★ 配置不全 ⇒ 报错里点名缺什么（不让用户对着 401 猜）', async () => {
    const { hosting } = await harness({ provider: 'aliyun-oss', expireSeconds: 86_400 })
    await expect(hosting.upload({ blob: probe(), name: 'a.png' })).rejects.toThrow(/还缺配置：Endpoint/)
  })

  it('★★ 没填密钥 ⇒ 单独报一句（配置齐 ≠ 能用）', async () => {
    const { hosting } = await harness({
      provider: 's3',
      expireSeconds: 86_400,
      endpoint: 'https://s3.example.com',
      region: 'us-east-1',
      bucket: 'b',
      accessKeyId: 'AK',
    })
    await expect(hosting.upload({ blob: probe(), name: 'a.png' })).rejects.toThrow(/还没有填密钥/)
  })

  it('★★ 阿里云 OSS：PUT 到桶域名 + `x-oss-date` + OSS 授权头（不用禁用的 `Date`）', async () => {
    const { hosting, calls } = await harness(
      {
        provider: 'aliyun-oss',
        expireSeconds: 86_400,
        endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        region: 'cn-hangzhou',
        bucket: 'my-bucket',
        accessKeyId: 'AK',
        pathPrefix: 'q',
      },
      'SECRET',
    )
    const out = await hosting.upload({ blob: probe(), name: 'a.png' })
    const req = calls[0]!
    expect(req.method).toBe('PUT')
    expect(req.url).toMatch(/^https:\/\/my-bucket\.oss-cn-hangzhou\.aliyuncs\.com\/q\/\d+-a\.png$/)
    expect(req.headers?.authorization).toMatch(/^OSS AK:/)
    expect(req.headers?.['x-oss-date']).toBeTruthy()
    expect(req.headers).not.toHaveProperty('date')
    expect(out?.url).toBe(req.url)
  })

  it('★★ S3 兼容：PUT 到 path-style + SigV4 授权头 + payload 的 sha256 进签名头', async () => {
    const { hosting, calls } = await harness(
      {
        provider: 's3',
        expireSeconds: 86_400,
        endpoint: 'https://minio.local:9000',
        region: 'us-east-1',
        bucket: 'b',
        accessKeyId: 'AK',
      },
      'SECRET',
    )
    const blob = probe()
    const out = await hosting.upload({ blob, name: 'a.png' })
    const req = calls[0]!
    expect(req.url).toMatch(/^https:\/\/minio\.local:9000\/b\/\d+-a\.png$/)
    expect(req.headers?.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\//)
    expect(req.headers?.['x-amz-content-sha256']).toBe(
      await sha256Hex(new Uint8Array(await blob.arrayBuffer())),
    )
    expect(out?.url).toBe(req.url)
  })

  it('★★ Cloudinary：POST 表单带签名，地址用它返回的 `secure_url`', async () => {
    const storage = createMemoryStorage({
      rows: {
        presets: [
          {
            id: HOSTING_ROW_ID,
            provider: 'cloudinary',
            expireSeconds: 86_400,
            cloudName: 'my-cloud',
            apiKey: 'KEY',
          },
        ],
      },
    })
    const credentials = createMemoryCredentials()
    await credentials.save(hostingSecretRef('cloudinary'), 'SECRET')
    const net = fakeNetwork(() => ({ json: { secure_url: 'https://res.cloudinary.com/my-cloud/a.png' } }))
    const hosting = createWebHosting({ storage, credentials, network: net.port })

    const out = await hosting.upload({ blob: probe(), name: 'a.png' })
    const form = net.calls[0]!.body as FormData
    expect(net.calls[0]!.url).toBe('https://api.cloudinary.com/v1_1/my-cloud/auto/upload')
    expect(form.get('api_key')).toBe('KEY')
    expect(String(form.get('signature'))).toMatch(/^[0-9a-f]{40}$/)
    expect(out?.url).toBe('https://res.cloudinary.com/my-cloud/a.png')
  })
})

describe('素材传输 · 测连通性（#260）', () => {
  it('关闭 / 配置不全时**如实说**（不是转圈也不是假成功）', async () => {
    const off = await harness({ provider: 'off', expireSeconds: 86_400 })
    expect((await off.hosting.test()).ok).toBe(false)
    const bare = await harness({ provider: 's3', expireSeconds: 86_400 })
    const bareOut = await bare.hosting.test()
    expect(bareOut.ok).toBe(false)
    expect(bareOut.message).toContain('还缺')
  })

  it('★★ 403 要说清「桶在、只是不公开」并明说**写权限没验**（别把没验的说成验过）', async () => {
    const storage = createMemoryStorage({
      rows: {
        presets: [
          {
            id: HOSTING_ROW_ID,
            provider: 's3',
            expireSeconds: 86_400,
            endpoint: 'https://s3.example.com',
            region: 'us-east-1',
            bucket: 'b',
            accessKeyId: 'AK',
          },
        ],
      },
    })
    const net = fakeNetwork(() => ({ status: 403 }))
    const hosting = createWebHosting({ storage, credentials: createMemoryCredentials(), network: net.port })
    const out = await hosting.test()
    expect(out.ok).toBe(true)
    expect(out.message).toContain('403')
    expect(out.message).toContain('写权限')
    expect(net.calls[0]!.method).toBe('HEAD')
  })

  it('★ 404 / 401 / 连不上 各有各的话术（不是一个"失败"了事）', async () => {
    const mk = async (status: number) => {
      const storage = createMemoryStorage({
        rows: {
          presets: [
            {
              id: HOSTING_ROW_ID,
              provider: 'cloudinary',
              expireSeconds: 86_400,
              cloudName: 'c',
              apiKey: 'K',
            },
          ],
        },
      })
      const credentials = createMemoryCredentials()
      await credentials.save(hostingSecretRef('cloudinary'), 'S')
      const net = fakeNetwork(() => ({ status }))
      return createWebHosting({ storage, credentials, network: net.port }).test()
    }
    expect((await mk(401)).message).toContain('密钥不对')
    expect((await mk(404)).message).toContain('端点或桶名')
    expect((await mk(500)).message).toContain('HTTP 500')
  })
})
