/**
 * **素材传输（图床）**领域口径（用户 2026-10-03：单独一个设置页）。
 *
 * 为什么需要它：Agnes 的参考图 / 首尾帧按文档要求「公网可访问的素材」。
 * 我们实测它**也吃 Data URI（Base64）**（对账清单 #115），所以本地素材在多数情况下
 * 不需要图床；图床解决的是另外两件事：① 素材很大时不要把请求体撑到几 MB；
 * ② 想要一条能被别处复用的公网直链。故这里**默认关闭**，开着才上传。
 *
 * 纯数据 + 纯函数：不依赖 platform / state / React，可在 node 下单测。
 */

export type HostingProviderId = 'off' | 'tmpfiles' | 'aliyun-oss' | 'qiniu' | 'cloudinary' | 's3'

export interface HostingConfig {
  provider: HostingProviderId
  /**
   * 临时图床的保留时长（秒）。
   *
   * `tmpfiles.org` 只认四个值：`3600` / `21600` / `86400` / `172800`
   * （2026-10-03 实读其上传表单）。默认 24 小时——视频任务从排队到出片通常几分钟，
   * 但用户可能改了参数重跑，留足窗口比省那点存储重要。
   */
  expireSeconds: number
  /**
   * **对象存储家族**（阿里云 OSS / 七牛 / S3 兼容 / 自填端点）的字段。
   *
   * 四家共用同一组字段，差别只在"默认值"与"签名算法"：
   *  - 阿里云 OSS：`endpoint` 形如 `https://oss-cn-hangzhou.aliyuncs.com`（**不含**桶名），
   *    签名走 OSS 原生的 HMAC-SHA1（它并不实现 S3 协议）；
   *  - 七牛：用它的 **S3 兼容端点**（`https://s3-<region>.qiniucs.com`）
   *    + 绑定的公网域名（`publicBaseUrl`）—— 七牛的对象地址是"你自己的域名 + key"，
   *    不填域名就**没有可用的直链**（这是它的产品形态，不是我们偷懒）；
   *  - S3 兼容 / 自填：endpoint 由用户自己填（AWS / MinIO / R2 / B2 …），签名走 AWS SigV4。
   */
  endpoint?: string
  region?: string
  bucket?: string
  accessKeyId?: string
  /**
   * 公网访问前缀（CDN / 自定义域），如 `https://cdn.example.com`。
   * 留空时按各家默认规则拼（OSS 走 `<bucket>.<endpoint主机>/<key>`；S3/自填走 `endpoint/bucket/key`）。
   */
  publicBaseUrl?: string
  /** 对象名前缀（相当于桶里的"文件夹"），可留空 */
  pathPrefix?: string
  /** Cloudinary 的云名（它每个账号一个 cloud name，接口地址里带它） */
  cloudName?: string
  /** Cloudinary 的 api key（公开值，明文存即可；api secret 走凭据层） */
  apiKey?: string
}

/** 设置存在 `presets` 表里的固定行（与选路策略同一套「全局偏好」机制，不新增表） */
export const HOSTING_ROW_ID = 'hosting:config'

export const DEFAULT_HOSTING: HostingConfig = { provider: 'off', expireSeconds: 86_400 }

/**
 * **密钥的引用名**（明文永远不落 `presets` 表）。
 *
 * 与渠道那条同一套：`presets` 只存"去哪儿找密钥"，真值在凭据层（桌面端是加密的
 * OS 凭据库）。按服务分开引用：换服务时旧密钥**不会**被新服务误用。
 */
export function hostingSecretRef(provider: HostingProviderId): string {
  return `hosting:${provider}:secret`
}

export const HOSTING_PROVIDERS: readonly {
  id: HostingProviderId
  label: string
  hint: string
}[] = [
  { id: 'off', label: '关闭', hint: '不上传。参考类生成改用内联 Base64（实测上游认）' },
  {
    id: 'tmpfiles',
    label: 'tmpfiles.org',
    hint: '免注册、匿名直传；单文件 ≤100MB，到期自动删除',
  },
  {
    id: 'aliyun-oss',
    label: '阿里云 OSS',
    hint: '填 endpoint / 桶 / AccessKey；签名走 OSS 原生算法，公网直链默认走桶域名',
  },
  {
    id: 'qiniu',
    label: '七牛云',
    hint: '用七牛的 S3 兼容端点上传；**必须**填你绑定的公网域名，否则拿不到可用直链',
  },
  {
    id: 'cloudinary',
    label: 'Cloudinary（免费额度）',
    hint: '只要 cloud name / api key / api secret；上传后用它返回的 secure_url',
  },
  {
    id: 's3',
    label: 'S3 兼容（自填）',
    hint: 'AWS S3 / MinIO / Cloudflare R2 / Backblaze B2 等**实现 S3 协议**的服务，端点自己填',
  },
]

/**
 * 密钥字段名。它们**不属于** `HostingConfig`：明文只进凭据层，
 * 配置对象里连字段都不留（留一个 `secretAccessKey?: string` 迟早会被谁顺手存进 `presets` 表）。
 */
export type HostingSecretKey = 'secretAccessKey' | 'apiSecret'

/** 表单字段的描述（UI 照着渲染，不在页面里写死六家的差异） */
export interface HostingField {
  key: keyof HostingConfig | HostingSecretKey
  label: string
  placeholder: string
  hint?: string
  /** 密钥类：不进 `presets`，走凭据层 */
  secret?: boolean
  /** 选填（缺了也能跑，只是直链按默认规则拼） */
  optional?: boolean
}

const S3_LIKE_FIELDS: readonly HostingField[] = [
  { key: 'endpoint', label: 'Endpoint', placeholder: 'https://oss-cn-hangzhou.aliyuncs.com', hint: '不含桶名' },
  { key: 'region', label: 'Region', placeholder: 'cn-hangzhou' },
  { key: 'bucket', label: 'Bucket', placeholder: 'my-bucket' },
  { key: 'accessKeyId', label: 'AccessKey ID', placeholder: 'AKIA...' },
  {
    key: 'secretAccessKey',
    label: 'AccessKey Secret',
    placeholder: '只保存在本机凭据库里',
    secret: true,
  },
  {
    key: 'publicBaseUrl',
    label: '公网访问前缀',
    placeholder: 'https://cdn.example.com',
    hint: '选填：留空按默认规则拼直链',
    optional: true,
  },
  { key: 'pathPrefix', label: '对象名前缀', placeholder: 'qinghua/', hint: '选填', optional: true },
]

/**
 * 每家要填哪些字段。
 *
 * 七牛的 `publicBaseUrl` **不是选填**（见 `hostingReadiness`）：它的对象地址是
 * "你自己的域名 + key"，没域名就没有能交给上游的直链。
 */
export const HOSTING_FIELDS: Record<HostingProviderId, readonly HostingField[]> = {
  off: [],
  tmpfiles: [],
  'aliyun-oss': S3_LIKE_FIELDS,
  qiniu: S3_LIKE_FIELDS.map((f) =>
    f.key === 'publicBaseUrl' ? { ...f, optional: false, hint: '七牛必须填：对象地址 = 你的域名 + key' } : f,
  ),
  cloudinary: [
    { key: 'cloudName', label: 'Cloud name', placeholder: 'my-cloud' },
    { key: 'apiKey', label: 'API Key', placeholder: '123456789012345' },
    { key: 'apiSecret', label: 'API Secret', placeholder: '只保存在本机凭据库里', secret: true },
    { key: 'pathPrefix', label: '上传目录', placeholder: 'qinghua', hint: '选填', optional: true },
  ],
  s3: S3_LIKE_FIELDS,
}

/** 哪些服务走"自己拼对象地址"（Cloudinary 由它返回 secure_url，不需要拼） */
export function buildsPublicUrl(provider: HostingProviderId): boolean {
  return provider === 'aliyun-oss' || provider === 'qiniu' || provider === 's3'
}

/** 哪些服务用 S3 协议（SigV4）；OSS 是自家的 HMAC-SHA1 */
export function usesAwsV4(provider: HostingProviderId): boolean {
  return provider === 'qiniu' || provider === 's3'
}

/**
 * 「能不能用了」——测连通 / 上传之前先过这一关。
 *
 * 返回**缺哪几项**（而不是一个 false）：界面上要能直接说"还缺 Bucket 与 AccessKey"，
 * 只灰掉按钮等于让用户自己猜。
 */
export function hostingReadiness(config: HostingConfig): { ready: boolean; missing: string[] } {
  if (config.provider === 'off') return { ready: false, missing: [] }
  if (config.provider === 'tmpfiles') return { ready: true, missing: [] }
  const missing: string[] = []
  for (const field of HOSTING_FIELDS[config.provider]) {
    if (field.secret) continue // 密钥在凭据层，由调用方单独确认（见 `hostingNeedsSecret`）
    if (field.optional) continue
    /** 密钥字段已经 `continue` 掉了，这里剩下的都是配置字段（断言给类型看） */
    const value = config[field.key as keyof HostingConfig]
    if (typeof value !== 'string' || value.trim() === '') missing.push(field.label)
  }
  return { ready: missing.length === 0, missing }
}

/** 这家服务要不要密钥（密钥不在 config 里，故单独问一次） */
export function hostingNeedsSecret(provider: HostingProviderId): boolean {
  return HOSTING_FIELDS[provider].some((f) => f.secret)
}

/**
 * 对象名：`<前缀><时间戳>-<原名>`。
 *
 * 带时间戳是为了**同名的两张图不互相覆盖**（用户连点两次生成很容易撞名）；
 * 原文件名保留是为了桶里看得懂（`qinghua/1730000000-cat.png` 一眼认得）。
 */
export function hostingObjectKey(config: HostingConfig, name: string, now: number): string {
  const prefix = (config.pathPrefix ?? '').trim().replace(/^\/+/, '').replace(/\/*$/, '')
  const safe = name
    .trim()
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(-64)
  const withPrefix = prefix ? `${prefix}/${now}-${safe}` : `${now}-${safe}`
  return withPrefix || `${now}-asset`
}

function stripTrailingSlash(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

/**
 * 对象的**公网直链**（S3 家族）。
 *
 * 三条规则，按优先级：
 *  1. 填了 `publicBaseUrl`（CDN / 自定义域）⇒ 用它；
 *  2. 阿里云 OSS ⇒ `<bucket>.<endpoint 主机>/<key>`（与 OSS 控制台给的地址一致）；
 *  3. 其余 ⇒ `<endpoint>/<bucket>/<key>`（S3 的 path-style，MinIO / R2 都吃）。
 *
 * 缺 endpoint / bucket 时返回 `null`：**不猜**地址 —— 猜出来的直链交给上游只会得到一个 404
 * （而 404 会被上游报成"参考图无法访问"，用户会去查图，查不出问题）。
 */
export function hostingPublicUrl(config: HostingConfig, key: string): string | null {
  if (!buildsPublicUrl(config.provider)) return null
  const base = (config.publicBaseUrl ?? '').trim()
  if (base) return `${stripTrailingSlash(base)}/${key}`

  const endpoint = (config.endpoint ?? '').trim()
  const bucket = (config.bucket ?? '').trim()
  if (!endpoint || !bucket) return null
  try {
    const url = new URL(endpoint)
    if (config.provider === 'aliyun-oss') {
      return `${url.protocol}//${bucket}.${url.host}/${key}`
    }
    return `${stripTrailingSlash(endpoint)}/${bucket}/${key}`
  } catch {
    return null
  }
}

export const HOSTING_EXPIRES: readonly { seconds: number; label: string }[] = [
  { seconds: 3_600, label: '1 小时' },
  { seconds: 21_600, label: '6 小时' },
  { seconds: 86_400, label: '24 小时' },
  { seconds: 172_800, label: '48 小时' },
]

const PROVIDER_IDS: readonly HostingProviderId[] = [
  'off',
  'tmpfiles',
  'aliyun-oss',
  'qiniu',
  'cloudinary',
  's3',
]

function isProviderId(v: unknown): v is HostingProviderId {
  return typeof v === 'string' && (PROVIDER_IDS as readonly string[]).includes(v)
}

/** `presets` 行里**允许持久化**的字段（白名单：密钥字段不在其中，也就永远存不进去） */
const PERSISTED_KEYS = [
  'provider',
  'endpoint',
  'region',
  'bucket',
  'accessKeyId',
  'publicBaseUrl',
  'pathPrefix',
  'cloudName',
  'apiKey',
] as const satisfies readonly (keyof HostingConfig)[]

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/** `presets` 表的一行 → 配置；缺字段 / 脏数据一律回落到默认值（不抛） */
export function hostingConfigOf(row: unknown): HostingConfig {
  const r = (row ?? {}) as Record<string, unknown>
  const provider = isProviderId(r.provider) ? r.provider : DEFAULT_HOSTING.provider
  const expire = Number(r.expireSeconds)
  const known = HOSTING_EXPIRES.some((e) => e.seconds === expire)
  return {
    provider,
    expireSeconds: known ? expire : DEFAULT_HOSTING.expireSeconds,
    endpoint: textOf(r.endpoint),
    region: textOf(r.region),
    bucket: textOf(r.bucket),
    accessKeyId: textOf(r.accessKeyId),
    publicBaseUrl: textOf(r.publicBaseUrl),
    pathPrefix: textOf(r.pathPrefix),
    cloudName: textOf(r.cloudName),
    apiKey: textOf(r.apiKey),
  }
}

/** 配置 → `presets` 表的一行（只写白名单里的键） */
export function hostingRowOf(config: HostingConfig): { id: string } & Record<string, unknown> {
  const row: { id: string } & Record<string, unknown> = {
    id: HOSTING_ROW_ID,
    provider: config.provider,
    expireSeconds: config.expireSeconds,
  }
  for (const key of PERSISTED_KEYS) {
    const value = config[key]
    if (typeof value === 'string' && value.trim() !== '') row[key] = value.trim()
  }
  return row
}

/**
 * `tmpfiles.org` 上传响应 → **能被上游抓到的直链**。
 *
 * 它返回的是**页面地址**（`https://tmpfiles.org/<id>/<名字>`），
 * 而裸 GET 那个地址拿到的是 HTML 页；真正的字节在 `/dl/<id>/<名字>`。
 * 拿页面地址交给上游 = 上游抓到一个 HTML（这正是大雄那边踩过的同一个坑）。
 */
export function tmpfilesDirectUrl(body: unknown): string | null {
  const page = (body as { data?: { url?: unknown } } | null)?.data?.url
  if (typeof page !== 'string') return null
  const trimmed = page.trim()
  if (!/^https?:\/\/tmpfiles\.org\//.test(trimmed)) return null
  return trimmed.replace('tmpfiles.org/', 'tmpfiles.org/dl/')
}

// ─────────────────────────────────────────────────────────────
// 签名与连通性探测（对账 #260）
// ─────────────────────────────────────────────────────────────

const encoder = new TextEncoder()

function hexOf(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64Of(bytes: ArrayBuffer): string {
  let binary = ''
  for (const b of new Uint8Array(bytes)) binary += String.fromCharCode(b)
  return btoa(binary)
}

async function hmac(
  algorithm: 'SHA-256' | 'SHA-1',
  key: BufferSource | string,
  data: string,
): Promise<ArrayBuffer> {
  const raw = typeof key === 'string' ? encoder.encode(key) : key
  const cryptoKey = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: algorithm }, false, [
    'sign',
  ])
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data))
}

/** `sha256` 的 hex（SigV4 的 payload hash 与 string-to-sign 都要它） */
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  return hexOf(await crypto.subtle.digest('SHA-256', bytes as BufferSource))
}

function amzDateOf(now: Date): { amzDate: string; dateStamp: string } {
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { amzDate: iso, dateStamp: iso.slice(0, 8) }
}

export interface OssSignature {
  date: string
  authorization: string
  stringToSign: string
}

/**
 * **阿里云 OSS** 的自家签名（HMAC-SHA1）。
 *
 * 为什么不套 SigV4：OSS **不实现** S3 协议 —— 它有自己的一整套签名，
 * 拿 SigV4 去请求只会得到 `SignatureDoesNotMatch`（这种错最难猜，因为算法本身是对的）。
 *
 * ⚠️ 用 **`x-oss-date`** 而不是 `Date`：浏览器里 `Date` 是**禁止设置的请求头**
 * （Fetch 规范会把它丢掉），签了也发不出去 —— 表现为"签名算对了但服务端说不对"。
 * 于是 `Date` 那一段留空，时间进 `CanonicalizedOSSHeaders`（OSS 官方给客户端的做法）。
 * 字符串：`VERB\nContent-MD5\nContent-Type\n\nx-oss-date:<GMT>\n/<bucket>/<key>`。
 */
export async function signOss(args: {
  verb: string
  bucket: string
  key: string
  accessKeyId: string
  secretAccessKey: string
  contentType?: string
  now: Date
}): Promise<OssSignature> {
  const date = args.now.toUTCString()
  const stringToSign = [
    args.verb,
    '',
    args.contentType ?? '',
    '',
    `x-oss-date:${date}\n/${args.bucket}/${args.key}`,
  ].join('\n')
  return {
    date,
    authorization: `OSS ${args.accessKeyId}:${base64Of(await hmac('SHA-1', args.secretAccessKey, stringToSign))}`,
    stringToSign,
  }
}

/** URL → SigV4 的 canonical uri / query（query 必须按 key 排序） */
function canonicalParts(url: URL): { uri: string; query: string } {
  const uri =
    url.pathname
      .split('/')
      .map((seg) => encodeURIComponent(decodeURIComponent(seg)))
      .join('/') || '/'
  const query = [...url.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&')
  return { uri, query }
}

export interface AwsV4Signature {
  authorization: string
  canonicalRequest: string
  stringToSign: string
  signature: string
  headers: Record<string, string>
}

/**
 * **AWS SigV4**（S3 协议族：七牛 S3 端点 / MinIO / Cloudflare R2 / B2 / AWS 自己）。
 *
 * 顺带返回 canonical request 与 string-to-sign：签名一旦不对（`SignatureDoesNotMatch`），
 * 唯一能定位的线索就是这两段原文 —— 各家文档都拿它们对照，留在返回值里省得再猜一次。
 */
export async function signAwsV4(args: {
  method: string
  url: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  payloadHash: string
  service?: string
  headers?: Record<string, string>
  now: Date
}): Promise<AwsV4Signature> {
  const url = new URL(args.url)
  const service = args.service ?? 's3'
  const { amzDate, dateStamp } = amzDateOf(args.now)
  const { uri, query } = canonicalParts(url)

  /** 参与签名的头：host + x-amz-* + 调用方给的。**空值不签**（本地签了、服务端没有 = 必然不一致） */
  const signable: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': args.payloadHash,
    'x-amz-date': amzDate,
    ...Object.fromEntries(
      Object.entries(args.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()]),
    ),
  }
  const names = Object.keys(signable)
    .filter((k) => signable[k] !== '')
    .sort()
  const canonicalHeaders = names.map((k) => `${k}:${signable[k]}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [
    args.method.toUpperCase(),
    uri,
    query,
    canonicalHeaders,
    signedHeaders,
    args.payloadHash,
  ].join('\n')

  const scope = `${dateStamp}/${args.region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')

  const kDate = await hmac('SHA-256', `AWS4${args.secretAccessKey}`, dateStamp)
  const kRegion = await hmac('SHA-256', kDate, args.region)
  const kService = await hmac('SHA-256', kRegion, service)
  const kSigning = await hmac('SHA-256', kService, 'aws4_request')
  const signature = hexOf(await hmac('SHA-256', kSigning, stringToSign))

  const headers: Record<string, string> = {
    ...Object.fromEntries(names.map((k) => [k, signable[k]])),
    /** 小写统一（HTTP 头大小写不敏感；混着来会让"取头"的地方各写一遍） */
    authorization:
      `AWS4-HMAC-SHA256 Credential=${args.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  }
  return { authorization: headers.Authorization!, canonicalRequest, stringToSign, signature, headers }
}

/**
 * **Cloudinary** 表单签名：参数按 key 排序拼成 `k=v&…`，末尾接 api secret，取 SHA-1 hex
 * （它自己的文档就是这么定的）。`file` / `api_key` / `signature` 本身不参与签名。
 */
export async function signCloudinary(
  params: Record<string, string>,
  apiSecret: string,
): Promise<{ signature: string; toSign: string }> {
  const toSign =
    Object.keys(params)
      .filter((k) => params[k] !== '' && k !== 'file' && k !== 'api_key' && k !== 'signature')
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&') + apiSecret
  return { signature: hexOf(await crypto.subtle.digest('SHA-1', encoder.encode(toSign))), toSign }
}

/** Cloudinary 的上传端点（云名进地址） */
export function cloudinaryUploadUrl(cloudName: string): string {
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName.trim())}/auto/upload`
}

/**
 * 「测连通性」要发的那一发请求（**纯描述**，由调用方去发）。
 *
 * 刻意**不做一次真实上传**：那会在用户的桶里留下垃圾对象（还要额外权限去删）。
 * 打的是"能分辨对错"的只读请求：
 *  - S3 家族：`HEAD` 桶地址（200 = 公开可读；403 = 桶在、需要凭据；404 = 桶名或端点不对）；
 *  - Cloudinary：带 Basic 认证列一张资源（200 = 云名与密钥都对；401 = 密钥错）；
 *  - tmpfiles：GET 站点首页（它不需要配置，只验网络可达）。
 *
 * 返回 `null` = "连测试都发不出去"（缺字段），调用方据此提示缺哪几项。
 */
export interface HostingProbe {
  method: 'HEAD' | 'GET'
  url: string
  /** 需要 Basic 认证时的用户名（密钥由调用方从凭据层取，不进这里） */
  basicUser?: string
  note: string
}

export function hostingProbe(config: HostingConfig): HostingProbe | null {
  if (config.provider === 'tmpfiles') {
    return { method: 'GET', url: 'https://tmpfiles.org/', note: '确认能连上 tmpfiles.org' }
  }
  if (config.provider === 'cloudinary') {
    const cloud = (config.cloudName ?? '').trim()
    const key = (config.apiKey ?? '').trim()
    if (!cloud || !key) return null
    return {
      method: 'GET',
      url: `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/resources/image?max_results=1`,
      basicUser: key,
      note: '用 api key / secret 列一张资源，验凭据是否可用',
    }
  }
  if (!buildsPublicUrl(config.provider)) return null
  const endpoint = (config.endpoint ?? '').trim()
  const bucket = (config.bucket ?? '').trim()
  if (!endpoint || !bucket) return null
  try {
    const url = new URL(endpoint)
    const target =
      config.provider === 'aliyun-oss'
        ? `${url.protocol}//${bucket}.${url.host}/`
        : `${endpoint.replace(/\/+$/, '')}/${bucket}`
    return {
      method: 'HEAD',
      url: target,
      note: 'HEAD 桶地址：200 = 可读；403 = 桶在但需要凭据；404 = 桶名或端点不对',
    }
  } catch {
    return null
  }
}
