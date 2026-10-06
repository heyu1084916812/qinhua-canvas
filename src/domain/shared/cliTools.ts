/**
 * 本机 CLI 工具目录（用户 2026-10-06 第 11 批第 4 条，对账 #308）。
 *
 * ## 用户口径（原话）
 *
 * - 「CLI 可以单独设置在全局设置里面了，就在渠道配置的下面，重新设计界面，保持整体的风格统一，
 *   当前是在每个渠道的页面里面」；
 * - 「GPT CLI 改成 **Codex**，配置字段你按照可以选项来填写」；
 * - 「我的要求和目的就是**链接后能用里面的额度调用模型生成图片或者视频，或者对话**，
 *   **RunningHub 也要**，**需要真的能跑本机的 cli**」。
 *
 * ## 这里放什么、不放什么
 *
 * 只放**纯数据 + 纯函数**：默认命令名、参数模板、占位符替换、坏值归一化。
 * 「真的起子进程」是平台层的事（`platform/ports.ts` 的 `CliPort`），
 * 「把这些画出来」是 UI 的事 —— 与仓库里其它领域模块同一条分层线。
 *
 * ## ⚠️ 默认值只是**起点**，不是"官方标准答案"
 *
 * 这几个工具的子命令各家版本都不一样（同一个工具换一版参数就可能变），
 * 所以每条都带一句 `note`，让用户先按 `--help` 对齐；
 * 「检测」只回答"这个命令在不在"，**不替你验证参数对不对** ——
 * 参数对不对由「测试运行」那条真命令回答。宁可说清边界，也不假装知道。
 */

/** 这个工具能干什么（给用户看的两三个字，也是"去哪儿用"的依据） */
export type CliCapability = 'image' | 'video' | 'chat'

export interface CliTool {
  id: string
  name: string
  /** 命令名或完整路径。用户自己填（壳不替他猜） */
  program: string
  /**
   * 参数模板：空格分隔，`"引号"` 可包住含空格的一段。
   * 占位符见 `CLI_PLACEHOLDERS`，执行前由 `buildArgs` 替换。
   */
  argsTemplate: string
  capabilities: CliCapability[]
  /** 单次调用最长等多久（毫秒）。Rust 侧还会再夹一次 [1s, 30min] */
  timeoutMs: number
  /** 是否需要在某个目录里跑（工作流 / 项目文件那类） */
  needsCwd: boolean
  docUrl: string
  /** 给用户的一句话：这个工具的坑在哪、要先做什么 */
  note: string
}

/** 参数模板里认得的占位符 */
export const CLI_PLACEHOLDERS = ['prompt', 'out', 'model', 'workflow'] as const

export type CliPlaceholder = (typeof CLI_PLACEHOLDERS)[number]

export const CLI_MIN_TIMEOUT_MS = 1_000
export const CLI_MAX_TIMEOUT_MS = 30 * 60 * 1000

const MINUTE = 60 * 1000

/**
 * 四个默认工具。顺序 = 用户点名顺序（Codex → 即梦 → Gemini → RunningHub）。
 *
 * ⚠️ `program` 与 `argsTemplate` 是**起点**：用户装的那份 CLI 如果子命令不同，
 * 在面板里改就行（改完点「检测」和「测试运行」各验一次）。
 */
export function defaultCliTools(): CliTool[] {
  return [
    {
      id: 'codex',
      name: 'Codex',
      program: 'codex',
      argsTemplate: 'exec {prompt}',
      capabilities: ['chat'],
      timeoutMs: 5 * MINUTE,
      needsCwd: true,
      docUrl: 'https://github.com/openai/codex',
      note: '用你登录的 Codex 额度跑对话 / 写代码。先在本机终端登录一次，子命令以 `codex --help` 为准。',
    },
    {
      id: 'jimeng',
      name: '即梦',
      program: 'jimeng',
      argsTemplate: 'generate --prompt {prompt} --out {out}',
      capabilities: ['image', 'video'],
      timeoutMs: 10 * MINUTE,
      needsCwd: false,
      docUrl: '',
      note: '即梦没有官方 CLI，能跑的是社区那层封装：命令名与子命令按你装的那份 `--help` 填。',
    },
    {
      id: 'gemini',
      name: 'Gemini',
      program: 'gemini',
      argsTemplate: '-p {prompt}',
      capabilities: ['image', 'chat'],
      timeoutMs: 5 * MINUTE,
      needsCwd: true,
      docUrl: 'https://github.com/google-gemini/gemini-cli',
      note: 'Google 官方 Gemini CLI，走你本机登录的账号额度。',
    },
    {
      id: 'runninghub',
      name: 'RunningHub',
      program: 'runninghub',
      argsTemplate: 'run --workflow {workflow} --prompt {prompt}',
      capabilities: ['image', 'video'],
      timeoutMs: 20 * MINUTE,
      needsCwd: false,
      docUrl: 'https://www.runninghub.cn/',
      note: 'RunningHub 是在线工作流平台，官方没有 CLI：这里填你本机那层封装脚本 / 工具的命令名。',
    },
  ]
}

/** 每个工具都给一样长的一行说明，用户扫一眼就知道"这行是干嘛的" */
export function capabilityLabel(cap: CliCapability): string {
  if (cap === 'image') return '出图'
  if (cap === 'video') return '出视频'
  return '对话'
}

/**
 * 参数模板 → token 数组。
 *
 * 支持 `'单引号'` 与 `"双引号"` 包住含空格的一段（提示词里带空格是常态，
 * 不拆开就会被当成多个参数）。**不做变量展开、不做通配** —— 这里只切词，
 * 替换是 `fillArgs` 的事（两件事分开才好各自单测）。
 *
 * 空引号 `""` 会得到一个**空 token**（它是用户显式写的"这里给个空串"），
 * 而纯空白不产生 token。
 */
export function parseArgs(template: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false
  for (const ch of template) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) {
        out.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += ch
    started = true
  }
  if (started) out.push(current)
  return out
}

const PLACEHOLDER_RE = /\{([a-zA-Z_]+)\}/g

/**
 * 占位符替换。
 *
 * **没有值的占位符原样留着**（`{prompt}` 还是 `{prompt}`）：这样「测试运行」的输出里
 * 一眼能看出"哪个值没给"，比静默换成空串（命令照跑、结果莫名其妙）好得多。
 */
export function fillArgs(
  tokens: string[],
  vars: Partial<Record<CliPlaceholder, string>>,
): string[] {
  return tokens.map((token) =>
    token.replace(PLACEHOLDER_RE, (whole, rawName: string) => {
      const value = (vars as Record<string, string | undefined>)[rawName]
      return value === undefined || value === '' ? whole : value
    }),
  )
}

/** 一次把模板变成最终参数（UI 与将来的执行层都用这一条） */
export function buildArgs(
  template: string,
  vars: Partial<Record<CliPlaceholder, string>>,
): string[] {
  return fillArgs(parseArgs(template), vars)
}

/** 把超时夹进合法区间；给不出数字就回落默认 */
export function clampToolTimeout(ms: unknown, fallback: number): number {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return fallback
  return Math.min(Math.max(Math.round(ms), CLI_MIN_TIMEOUT_MS), CLI_MAX_TIMEOUT_MS)
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

/**
 * 落库的一行 → 工具列表。
 *
 * 三条口径：
 * 1. **目录以代码为准**：库里只存"用户改过的字段"，所以升级后新增的工具会自动出现；
 * 2. **坏值一律回落默认**：一条脏配置不该让整个面板打不开；
 * 3. `id` 对不上的行**直接丢掉**（那是被删掉的工具留下的残渣）。
 */
export function mergeTools(row: unknown): CliTool[] {
  const patches = new Map<string, Record<string, unknown>>()
  const raw = row && typeof row === 'object' ? (row as { tools?: unknown }).tools : undefined
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const record = item as Record<string, unknown>
      if (typeof record.id === 'string') patches.set(record.id, record)
    }
  }
  return defaultCliTools().map((tool) => {
    const patch = patches.get(tool.id)
    if (!patch) return tool
    return {
      ...tool,
      program: str(patch.program, tool.program),
      argsTemplate: str(patch.argsTemplate, tool.argsTemplate),
      timeoutMs: clampToolTimeout(patch.timeoutMs, tool.timeoutMs),
    }
  })
}

/** 写库前的归一化：只留"用户真的改得动"的三个字段（别的字段由代码说了算） */
export function toolPatchOf(tool: CliTool): Record<string, unknown> {
  return {
    id: tool.id,
    program: tool.program,
    argsTemplate: tool.argsTemplate,
    timeoutMs: tool.timeoutMs,
  }
}
