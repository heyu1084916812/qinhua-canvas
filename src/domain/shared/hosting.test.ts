import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HOSTING,
  HOSTING_ROW_ID,
  hostingNeedsSecret,
  hostingObjectKey,
  hostingProbe,
  hostingPublicUrl,
  hostingReadiness,
  hostingConfigOf,
  hostingRowOf,
  sha256Hex,
  signAwsV4,
  signCloudinary,
  signOss,
  tmpfilesDirectUrl,
} from './hosting'

/**
 * 签名断言**不拿被测实现自证**：这里用 WebCrypto 把同一串**手工写出来**的原文再算一遍。
 * 两边一致才说明"我们拼的原文"与"官方口径"是同一件事（拼接错一个换行都会红）。
 *
 * 为什么不 import `node:crypto`：本仓库的 `tsconfig` 没开 node 类型（测试与业务同一套配置），
 * 引进来就得为几个断言动全局类型开关 —— 不值。WebCrypto 在 node 20+ 是全局的，
 * 而且下面这几行本身就是**独立于被测代码**的另一条实现路径。
 */
const hex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
const b64 = (bytes: ArrayBuffer): string => {
  let out = ''
  for (const b of new Uint8Array(bytes)) out += String.fromCharCode(b)
  return btoa(out)
}
const digestHex = async (algorithm: 'SHA-256' | 'SHA-1', text: string): Promise<string> =>
  hex(await crypto.subtle.digest(algorithm, new TextEncoder().encode(text)))
const hmacRaw = async (
  algorithm: 'SHA-256' | 'SHA-1',
  key: string | ArrayBuffer,
  text: string,
): Promise<ArrayBuffer> => {
  const raw = typeof key === 'string' ? new TextEncoder().encode(key) : key
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: algorithm }, false, [
    'sign',
  ])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(text))
}

/**
 * 素材传输（图床）口径（用户 2026-10-03「图床设置页单独设置一个页面」）。
 *
 * 这里钉的都是**踩过的坑**：默认关闭、脏数据不许抛、以及「页面地址 ≠ 直链」。
 */
describe('素材传输配置', () => {
  it('没配过 / 脏数据 → 一律回落默认（关闭 + 24 小时），不抛', () => {
    expect(hostingConfigOf(undefined)).toEqual(DEFAULT_HOSTING)
    expect(hostingConfigOf({ provider: 'something', expireSeconds: 'x' })).toEqual(DEFAULT_HOSTING)
    expect(hostingConfigOf({ provider: 'tmpfiles', expireSeconds: 60 })).toEqual({
      provider: 'tmpfiles',
      expireSeconds: DEFAULT_HOSTING.expireSeconds,
    })
  })

  it('读写走 `presets` 表的固定行，值原样往返', () => {
    const row = hostingRowOf({ provider: 'tmpfiles', expireSeconds: 172_800 })
    expect(row.id).toBe(HOSTING_ROW_ID)
    expect(hostingConfigOf(row)).toEqual({ provider: 'tmpfiles', expireSeconds: 172_800 })
  })

  it('★★ tmpfiles 返回的是**页面地址**，直链必须换成 `/dl/`', () => {
    expect(
      tmpfilesDirectUrl({ status: 'success', data: { url: 'https://tmpfiles.org/abc123/cat.png' } }),
    ).toBe('https://tmpfiles.org/dl/abc123/cat.png')
  })

  it('不是 tmpfiles 的地址 / 没有地址 → null（不把别家的页面地址当直链发出去）', () => {
    expect(tmpfilesDirectUrl({ data: { url: 'https://example.com/x.png' } })).toBeNull()
    expect(tmpfilesDirectUrl({ data: {} })).toBeNull()
    expect(tmpfilesDirectUrl(null)).toBeNull()
  })
})

/**
 * 多服务支持（对账 #260）：用户要的是 **阿里云 OSS / 七牛 / Cloudinary（免费）/ S3 兼容自填**，
 * 配置**自己填**，并且要有一个**测连通性**按钮。
 *
 * 这里钉三件事：① 各家"缺哪几项"要能逐条说出来；② 直链怎么拼（拼错了上游抓到 404，
 * 而用户会以为是自己图的问题）；③ 三套签名的原文与签名值 —— 签名用 `node:crypto` **独立算一遍**
 * 对照（不是拿同一份实现自证）。
 */
describe('素材传输 · 多服务（#260）', () => {
  const oss = {
    provider: 'aliyun-oss' as const,
    expireSeconds: 86_400,
    endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    region: 'cn-hangzhou',
    bucket: 'my-bucket',
    accessKeyId: 'AKIDEXAMPLE',
  }

  it('★★ 就绪校验逐条说出缺什么（不是只给一个 false）', () => {
    expect(hostingReadiness({ provider: 'tmpfiles', expireSeconds: 86_400 }).ready).toBe(true)
    const bare = hostingReadiness({ provider: 'aliyun-oss', expireSeconds: 86_400 })
    expect(bare.ready).toBe(false)
    expect(bare.missing).toEqual(['Endpoint', 'Region', 'Bucket', 'AccessKey ID'])
    expect(hostingReadiness(oss).ready).toBe(true)
  })

  it('★★ 七牛的**公网域名是必填**（对象地址 = 你的域名 + key，没域名就没有直链）', () => {
    const qiniu = { ...oss, provider: 'qiniu' as const, endpoint: 'https://s3-cn-east-1.qiniucs.com' }
    expect(hostingReadiness(qiniu).missing).toContain('公网访问前缀')
    expect(hostingReadiness({ ...qiniu, publicBaseUrl: 'https://cdn.my.com' }).ready).toBe(true)
  })

  it('★ Cloudinary 只要三样：cloud name / api key / api secret（后者走凭据层，不进配置）', () => {
    expect(hostingReadiness({ provider: 'cloudinary', expireSeconds: 86_400 }).missing).toEqual([
      'Cloud name',
      'API Key',
    ])
    expect(hostingNeedsSecret('cloudinary')).toBe(true)
    expect(hostingNeedsSecret('tmpfiles')).toBe(false)
  })

  it('★★ 密钥字段**永远进不了 `presets` 行**（白名单持久化）', () => {
    const row = hostingRowOf({ ...oss, pathPrefix: 'q/', publicBaseUrl: 'https://cdn.my.com' })
    expect(Object.keys(row).sort()).toEqual(
      [
        'accessKeyId',
        'bucket',
        'endpoint',
        'expireSeconds',
        'id',
        'pathPrefix',
        'publicBaseUrl',
        'provider',
        'region',
      ].sort(),
    )
    expect(JSON.stringify(row)).not.toContain('secret')
  })

  it('★ 对象名带时间戳（同名两张不互相覆盖）+ 前缀规范', () => {
    expect(hostingObjectKey({ provider: 's3', expireSeconds: 1, pathPrefix: '/q/' }, 'cat.png', 1700000000000)).toBe(
      'q/1700000000000-cat.png',
    )
    expect(hostingObjectKey({ provider: 's3', expireSeconds: 1 }, 'a b/c?.png', 1)).toBe('1-a-b-c-.png')
  })

  it('★★ 直链拼法：OSS 走桶域名、S3 走 path-style、自定义域名优先；缺料返回 null 不猜', () => {
    expect(hostingPublicUrl(oss, 'q/1.png')).toBe('https://my-bucket.oss-cn-hangzhou.aliyuncs.com/q/1.png')
    expect(
      hostingPublicUrl({ ...oss, provider: 's3', endpoint: 'https://minio.local:9000' }, '1.png'),
    ).toBe('https://minio.local:9000/my-bucket/1.png')
    expect(hostingPublicUrl({ ...oss, publicBaseUrl: 'https://cdn.my.com/' }, '1.png')).toBe(
      'https://cdn.my.com/1.png',
    )
    expect(hostingPublicUrl({ provider: 's3', expireSeconds: 1, bucket: 'b' }, '1.png')).toBeNull()
    // Cloudinary 的地址由它自己返回，不走这套拼接
    expect(hostingPublicUrl({ provider: 'cloudinary', expireSeconds: 1 }, '1.png')).toBeNull()
  })

  it('★★ OSS 签名：string-to-sign 与 HMAC-SHA1 都被 node:crypto 独立复算对上', async () => {
    const now = new Date('2026-10-06T04:05:06Z')
    const signed = await signOss({
      verb: 'PUT',
      bucket: 'my-bucket',
      key: 'q/1.png',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'SECRET',
      contentType: 'image/png',
      now,
    })
    const expectedString = [
      'PUT',
      '',
      'image/png',
      '',
      `x-oss-date:${now.toUTCString()}\n/my-bucket/q/1.png`,
    ].join('\n')
    expect(signed.stringToSign).toBe(expectedString)
    const expected = b64(await hmacRaw('SHA-1', 'SECRET', expectedString))
    expect(signed.authorization).toBe(`OSS AKIDEXAMPLE:${expected}`)
  })

  it('★★ SigV4 签名：canonical request 逐字对 + 签名链用 node:crypto 独立复算', async () => {
    const now = new Date('2026-10-06T04:05:06Z')
    const payloadHash = await sha256Hex('hello')
    const signed = await signAwsV4({
      method: 'PUT',
      url: 'https://s3.example.com/my-bucket/q/1.png',
      region: 'us-east-1',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'SECRET',
      payloadHash,
      headers: { 'content-type': 'image/png' },
      now,
    })
    const expectedCanonical = [
      'PUT',
      '/my-bucket/q/1.png',
      '',
      'content-type:image/png\nhost:s3.example.com\nx-amz-content-sha256:' + payloadHash + '\nx-amz-date:20261006T040506Z\n',
      'content-type;host;x-amz-content-sha256;x-amz-date',
      payloadHash,
    ].join('\n')
    expect(signed.canonicalRequest).toBe(expectedCanonical)

    /** 独立复算：日期→区域→服务→aws4_request 四段派生密钥，再 HMAC 一次 string-to-sign */
    const scope = '20261006/us-east-1/s3/aws4_request'
    const expectedStringToSign = [
      'AWS4-HMAC-SHA256',
      '20261006T040506Z',
      scope,
      await digestHex('SHA-256', expectedCanonical),
    ].join('\n')
    expect(signed.stringToSign).toBe(expectedStringToSign)
    const kDate = await hmacRaw('SHA-256', 'AWS4SECRET', '20261006')
    const kRegion = await hmacRaw('SHA-256', kDate, 'us-east-1')
    const kService = await hmacRaw('SHA-256', kRegion, 's3')
    const kSigning = await hmacRaw('SHA-256', kService, 'aws4_request')
    expect(signed.signature).toBe(hex(await hmacRaw('SHA-256', kSigning, expectedStringToSign)))
    expect(signed.headers.authorization).toContain(`Credential=AKIDEXAMPLE/${scope}`)
    expect(signed.headers['x-amz-date']).toBe('20261006T040506Z')
  })

  it('★★ Cloudinary 签名：排序拼接 + SHA-1（node:crypto 复算）', async () => {
    const { signature, toSign } = await signCloudinary(
      { timestamp: '1700000000', folder: 'qinghua', file: '（文件本体不参与签名）', api_key: '123' },
      'APISECRET',
    )
    expect(toSign).toBe('folder=qinghua&timestamp=1700000000APISECRET')
    expect(signature).toBe(await digestHex('SHA-1', toSign))
  })

  it('★ 测连通性：每家打一发"能分辨对错"的只读请求；字段不全就返回 null', () => {
    expect(hostingProbe(oss)).toMatchObject({
      method: 'HEAD',
      url: 'https://my-bucket.oss-cn-hangzhou.aliyuncs.com/',
    })
    expect(
      hostingProbe({ ...oss, provider: 's3', endpoint: 'https://minio.local:9000/' }),
    ).toMatchObject({ url: 'https://minio.local:9000/my-bucket' })
    expect(hostingProbe({ provider: 'cloudinary', expireSeconds: 1, cloudName: 'c', apiKey: 'k' })).toMatchObject({
      basicUser: 'k',
    })
    expect(hostingProbe({ provider: 'aliyun-oss', expireSeconds: 1 })).toBeNull()
    expect(hostingProbe({ provider: 'off', expireSeconds: 1 })).toBeNull()
  })
})
