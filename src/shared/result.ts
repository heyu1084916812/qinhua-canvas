/**
 * 错误在产生处分类，在展示处映射文案（架构 §6.2）
 */
export type AppError =
  | { kind: 'network'; detail: 'dns' | 'tls' | 'cors' | 'timeout' | 'aborted' }
  | { kind: 'http'; status: number; body?: string; verbatim?: boolean }
  | { kind: 'parse'; raw: string }
  | { kind: 'storage'; detail: 'quota' | 'corrupt' | 'permission' }
  | { kind: 'validation'; field: string; reason: string }
  | {
      kind: 'channel'
      detail: 'missingChannel' | 'missingKey' | 'missingModel' | 'unsupported'
    }
  /**
   * 上游已经受理任务，但后续轮询 / 取结果失败。
   *
   * 这类错误**不可重试整个生成**：再次调用会重新提交一笔付费任务。调用方应展示
   * 任务 id / 服务端原因，并让用户稍后查询或手动决定。
   */
  | { kind: 'execution'; detail: 'accepted'; message?: string }
  /**
   * **本机命令行**（对账 #308）：桌面壳里真的起了一条 CLI 进程，它不认账时用这个。
   *
   * 为什么单独一个 kind 而不是塞进 `channel`：它压根不是渠道的事 ——
   * 没网也能发生（命令没装、没登录、参数写错），而 `channel` 那三个 detail
   * 说的是"渠道没配好"。混进去会让用户照着"检查令牌"去修一个"命令名写错"的问题。
   * `message` 带**命令自己的原话**（stderr 尾部），那句通常就是答案。
   */
  | { kind: 'cli'; detail: 'notfound' | 'failed' | 'timeout' | 'canceled'; message?: string }

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

/**
 * 把服务端原始响应裁成一段**能读的**摘要。
 *
 * 为什么要剥 HTML：comfly / 网关在地区限制、WAF、登录页上会回一整页 HTML，
 * 直接把 `<html><h1>…` 塞进日志，用户看到的仍是"格式对不上"。
 * 这里只做确定性文本处理，不猜服务端语义：
 * - 非 HTML：原样裁断；
 * - HTML：去 script/style/tag、还原常见实体，再裁断。
 */
export function rawSnippetOf(raw: string, limit = 300): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  const text = trimmed.startsWith('<')
    ? trimmed
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
    : trimmed
  return text.replace(/\s+/g, ' ').trim().slice(0, limit)
}

/**
 * 从 HTTP 错误响应体里抠出**服务端自己给的原因**。
 *
 * 放在 shared 而不是 platform：**产生错误的地方要解析它，展示错误的地方也要解析它**，
 * 而 shared 是两者唯一的共同下层。放到 platform 会让 shared 反向依赖 platform（架构禁止）。
 *
 * OpenAI 兼容格式是 `{"error":{"message":"..."}}`；少数中转把原因放在顶层
 * `message` / `detail`。都不是就返回 null —— **不猜**，宁可只显示状态码。
 * 不是 JSON 时原样回一段（截断），总比什么都不给强。
 */
export function serverReasonOf(body?: string): string | null {
  if (!body) return null
  const raw = body.trim()
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const err = (parsed as { error?: unknown }).error
    if (typeof err === 'string' && err.trim()) return err.trim()
    if (err && typeof err === 'object') {
      const msg = (err as { message?: unknown }).message
      if (typeof msg === 'string' && msg.trim()) return msg.trim()
    }
    for (const key of ['message', 'detail'] as const) {
      const v = (parsed as Record<string, unknown>)[key]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return rawSnippetOf(raw)
  } catch {
    return rawSnippetOf(raw)
  }
}

export function Ok<T>(value: T): Result<T> {
  return { ok: true, value }
}

export function Err<T = never>(error: AppError): Result<T> {
  return { ok: false, error }
}

export function isOk<T>(r: Result<T>): r is { ok: true; value: T } {
  return r.ok
}

/**
 * 枚举 → 中文。**这张表是「报错不许露代码」的唯一落点。**
 *
 * 用户 2026-10-05 第 3 批原话：「他显示报错的时候能否把中文发我，而不是代码」。
 * 在这之前 `describeError` 是把枚举值原样拼进句子的 ——
 * `网络错误：cors`、`渠道错误：missingKey`、`存储错误：quota` 这种，
 * 用户看到的是一串英文标识符，既不知道出了什么事，也不知道该怎么办。
 *
 * 维护纪律：`AppError` 新增一个 kind / detail 时，**这里必须同时加一行**；
 * `result.test.ts` 有一条「一条都不许漏」的断言（遍历全部取值、逐个断言译文非空且不含英文标识符）。
 */
const NETWORK_TEXT: Record<'dns' | 'tls' | 'cors' | 'timeout' | 'aborted', string> = {
  dns: '解析不了对方的地址（检查网络或代理）',
  tls: '安全连接建不起来（证书 / TLS 被拒）',
  cors: '被对方的跨域策略挡下了（网页直连不被允许）',
  timeout: '等太久，超时了',
  aborted: '请求被取消',
}

const STORAGE_TEXT: Record<'quota' | 'corrupt' | 'permission', string> = {
  quota: '本地空间不够了',
  corrupt: '本地数据损坏了',
  permission: '浏览器没给存储权限',
}

const CHANNEL_TEXT: Record<
  'missingChannel' | 'missingKey' | 'missingModel' | 'unsupported',
  string
> = {
  missingChannel: '这个渠道已经删除，请重新选择平台',
  missingKey: '还没填令牌（API Key）',
  missingModel: '这个渠道里没有你选的那个模型',
  unsupported: '这个渠道不支持这次请求',
}

const CLI_TEXT: Record<'notfound' | 'failed' | 'timeout' | 'canceled', string> = {
  notfound: '本机上找不到这个命令（去「全局设置 → CLI」里改命令名或填完整路径）',
  failed: '命令跑失败了',
  timeout: '命令跑太久，已经掐掉',
  canceled: '命令被取消了',
}

const EXECUTION_TEXT: Record<'accepted', string> = {
  accepted: '请求已经提交，但后续状态查询失败',
}

export function describeError(e: AppError): string {
  switch (e.kind) {
    case 'network':
      return `连不上：${NETWORK_TEXT[e.detail]}`
    case 'http': {
      if (e.verbatim && e.body) return e.body
      /**
       * **服务端的原话优先**（它通常就是中文，比如「预扣费不足」）——
       * 状态码只作为括号里的补充，原因看不清时也留一句人话，不把裸码丢给用户。
       *
       * 为什么还留状态码：403 / 402 / 429 的成因差得远，用户拿这句去问客服时，
       * 那个数字是唯一能对齐的东西（英文标识符没有这个作用）。
       */
      const reason = e.body ? serverReasonOf(e.body) : null
      const head = `服务端返回错误（HTTP ${e.status}）`
      if (!reason) return `${head}，而且没给原因`
      /**
       * 服务端给什么原话就带什么（它自己的话通常比我们编的准）。
       * `serverReasonOf` 已经把 `{"error":{"message":…}}` 这类壳剥掉了，
       * 剥不出来时才回一段截断原文 —— 那种情况下也仍然以中文句子开头。
       */
      return `${head}：${reason}`
    }
    case 'parse': {
      const snippet = rawSnippetOf(e.raw)
      return snippet
        ? `看不懂服务端返回的内容（格式对不上）。服务端原文：${snippet}`
        : '看不懂服务端返回的内容（格式对不上）'
    }
    case 'storage':
      return `本地存储出错：${STORAGE_TEXT[e.detail]}`
    case 'validation':
      return `这个设置不对（${e.field}）：${e.reason}`
    case 'channel':
      return `渠道还没配好：${CHANNEL_TEXT[e.detail]}`
    case 'execution': {
      const head = EXECUTION_TEXT[e.detail]
      return e.message ? `${head} —— ${e.message}` : head
    }
    case 'cli': {
      /* 命令自己的原话优先（`stderr` 里通常就是答案，例如「not logged in」） */
      const head = `本机命令行出错：${CLI_TEXT[e.detail]}`
      return e.message ? `${head} —— ${e.message}` : head
    }
  }
}

/**
 * 从任意抛出物里取出归一化后的 `AppError`。
 *
 * 平台层抛出的**不是 Error 实例**：
 *  - 网络端口直接抛 AppError 字面量（如 `throw { kind: 'network', detail: 'dns' }`）；
 *  - 渠道层抛 `ChannelError`，真载荷在 `appError` 字段上。
 *
 * 于是「只认 `instanceof Error`」的调用方会掉进两个坑：
 * 走 `String(e)` 得到 `[object Object]`（用户完全看不懂），
 * 或拿到 `ChannelError` 的调试串 `[channel] network`（内部术语泄漏到 UI）。
 * 故凡是要展示错误信息的地方，先过这一层。
 */
export function asAppError(e: unknown): AppError | null {
  if (!e || typeof e !== 'object') return null
  if ('appError' in e) {
    const inner = (e as { appError?: unknown }).appError
    if (inner && typeof inner === 'object' && 'kind' in inner) return inner as AppError
  }
  return 'kind' in e ? (e as AppError) : null
}

/**
 * 任意抛出物 → 人能读的一句话。
 *
 * 渠道层抛的常常**不是 `Error` 实例**（是 `ChannelError`、或 `{kind, detail}` 这类普通对象），
 * 直接 `String(e)` 会得到 `[object Object]`，等于把真实原因吞了。
 * 用户 2026-10-03 在 Agent 循环里踩过一次，2026-10-14 又在新增的工具能力探测里踩了一次 ——
 * **同一个坑**，说明它不能靠「每个新模块自己记得」来防，得有一个共用入口。
 *
 * 顺序：先按 AppError 翻成中文，再试常见字段名，再退到 JSON，最后才是兜底文案。
 */
export function errorTextOf(e: unknown): string {
  if (typeof e === 'string') return e
  /**
   * **先按 AppError 翻，再退回 `Error.message`。**
   *
   * 顺序不能反：渠道层抛的是 `ChannelError extends Error`，它的 `message` 是调试串
   * （`[channel] http`），真正的载荷在 `appError` 字段上。先看 `instanceof Error`
   * 会把调试串直接露给用户。2026-10-14 实测踩到，同一个坑的第三种形状。
   */
  if (e && typeof e === 'object') {
    const app = asAppError(e)
    if (app) return describeError(app)
  }
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const o = e as Record<string, unknown>
    for (const k of ['message', 'detail', 'raw', 'reason', 'error']) {
      const v = o[k]
      if (typeof v === 'string' && v.trim()) return v
    }
    try {
      const s = JSON.stringify(e)
      if (s && s !== '{}') return `遇到了没预料到的错误（详情：${s.slice(0, 300)}）`
    } catch {
      /* 循环引用之类，走最后的兜底 */
    }
    return '[错误对象没有可读信息]'
  }
  return String(e)
}
