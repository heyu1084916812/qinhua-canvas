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

export type HostingProviderId = 'off' | 'tmpfiles'

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
}

/** 设置存在 `presets` 表里的固定行（与选路策略同一套「全局偏好」机制，不新增表） */
export const HOSTING_ROW_ID = 'hosting:config'

export const DEFAULT_HOSTING: HostingConfig = { provider: 'off', expireSeconds: 86_400 }

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
]

export const HOSTING_EXPIRES: readonly { seconds: number; label: string }[] = [
  { seconds: 3_600, label: '1 小时' },
  { seconds: 21_600, label: '6 小时' },
  { seconds: 86_400, label: '24 小时' },
  { seconds: 172_800, label: '48 小时' },
]

function isProviderId(v: unknown): v is HostingProviderId {
  return v === 'off' || v === 'tmpfiles'
}

/** `presets` 表的一行 → 配置；缺字段 / 脏数据一律回落到默认值（不抛） */
export function hostingConfigOf(row: unknown): HostingConfig {
  const r = (row ?? {}) as { provider?: unknown; expireSeconds?: unknown }
  const provider = isProviderId(r.provider) ? r.provider : DEFAULT_HOSTING.provider
  const expire = Number(r.expireSeconds)
  const known = HOSTING_EXPIRES.some((e) => e.seconds === expire)
  return { provider, expireSeconds: known ? expire : DEFAULT_HOSTING.expireSeconds }
}

/** 配置 → `presets` 表的一行 */
export function hostingRowOf(config: HostingConfig): { id: string } & Record<string, unknown> {
  return { id: HOSTING_ROW_ID, provider: config.provider, expireSeconds: config.expireSeconds }
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
