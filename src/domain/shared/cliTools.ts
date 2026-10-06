import type { ModelCapability } from './capability'

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

/**
 * 这个工具对外**能报出来的模型**（对账 #308 后半段的关键一条）。
 *
 * 为什么需要它：渠道的模型下拉里有什么，是由「渠道能列出的模型」决定的
 * （`listModels` → 模型映射 → 节点面板）。CLI 没法真的"列模型"（各家要么没有
 * 这个子命令、要么列出来的是云上的名字），所以这里给**逻辑名**：
 * 用户在渠道的「模型映射」里把它改成真正的上游名（例如 `codex` → `gpt-5-codex`），
 * 那个名字就会经 `{model}` 占位符进到参数模板里。
 *
 * ⇒ 一处也不编造模型：编造的名字会以"配好了却跑不通"的形式出现在用户面前。
 */
export interface CliModel {
  /** 逻辑名（会出现在节点的模型下拉里） */
  id: string
  category: CliCapability
}

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
  /** 这个工具能报出来的模型（见 `CliModel` 的说明） */
  models: CliModel[]
  /** 单次调用最长等多久（毫秒）。Rust 侧还会再夹一次 [1s, 30min] */
  timeoutMs: number
  /** 是否需要在某个目录里跑（工作流 / 项目文件那类） */
  needsCwd: boolean
  docUrl: string
  /** 给用户的一句话：这个工具的坑在哪、要先做什么 */
  note: string
  /**
   * 「查状态 / 查额度」的命令参数（用户 2026-10-06 第 13 批第 2 条：
   * 「codex 的 cli 我想要读取到额度…如果查不了额度，我如何显示额度」）。
   *
   * ⚠️ 现实是：**多数 CLI 不报余额**。所以这一档能查到什么就显示什么（原话照贴），
   * 查不到的由 `quotaWhere` 说清"去哪儿看"——**不许编一个数字**。
   */
  statusArgs: string
  /**
   * 「一键登录」在**可见窗口**里跑的命令参数（交互式：浏览器授权 / 输密码）。
   *
   * 空串 = 直接跑这个程序本身（有些工具没有 `login` 子命令，第一次运行就是登录）。
   */
  loginArgs: string
  /**
   * 用**密钥**登录的命令参数：密钥走 `stdin`，**不进 argv**（不进命令行历史、也不进日志）。
   * 空串 = 这个工具不支持密钥登录（那就只能走可见窗口那条路）。
   */
  keyLoginArgs: string
  /** 怎么把它装上（一句话：官网 / 安装命令），显示在"没找到命令"旁边 */
  installHint: string
  /** 额度 / 余额**到底在哪儿看** —— 工具自己不报时，这句话就是答案 */
  quotaWhere: string
}

/** 参数模板里认得的占位符 */
export const CLI_PLACEHOLDERS = ['prompt', 'out', 'model', 'workflow'] as const

export type CliPlaceholder = (typeof CLI_PLACEHOLDERS)[number]

export const CLI_MIN_TIMEOUT_MS = 1_000
export const CLI_MAX_TIMEOUT_MS = 30 * 60 * 1000

/**
 * 用户改过的工具配置存在哪一行（`presets` 表）。
 *
 * **放在这里而不是各层各写一个字面量**：写库的（设置面板）与读库的（渠道适配器）
 * 必须认同一个 id，两处各写一遍迟早会漂移成"配置存进去、执行时读不到"。
 */
export const CLI_TOOLS_ROW_ID = 'cli:tools'

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
      models: [{ id: 'codex', category: 'chat' }],
      timeoutMs: 5 * MINUTE,
      needsCwd: true,
      docUrl: 'https://github.com/openai/codex',
      note: '用你登录的 Codex 额度跑对话 / 写代码。先在本机终端登录一次，子命令以 `codex --help` 为准。',
      /* 实测：`codex login status` 回「Logged in using an API key - ***」，它只报登录态。 */
      statusArgs: 'login status',
      loginArgs: 'login',
      /* `codex login --with-api-key` 从 stdin 读密钥（官方 help 里写明的） */
      keyLoginArgs: 'login --with-api-key',
      installHint: '已装的话 `codex --version` 能看到版本；没装去 https://github.com/openai/codex 按说明装。',
      quotaWhere: 'Codex 的**额度不在命令行里**（CLI 只能报"登录态"）——余额去 ChatGPT 的用量页看。',
    },
    {
      id: 'jimeng',
      name: '即梦',
      program: 'jimeng',
      argsTemplate: 'generate --prompt {prompt} --out {out}',
      models: [
        { id: 'jimeng-image', category: 'image' },
        { id: 'jimeng-video', category: 'video' },
      ],
      timeoutMs: 10 * MINUTE,
      needsCwd: false,
      docUrl: '',
      note: '即梦没有官方 CLI，能跑的是社区那层封装：命令名与子命令按你装的那份 `--help` 填。',
      statusArgs: '',
      loginArgs: '',
      keyLoginArgs: '',
      installHint: '即梦官方没有命令行工具：要接就先弄一层封装（社区脚本 / 自己写），再把命令名填上面。',
      quotaWhere: '即梦的积分在**即梦 App / 网页的「我的」**里看，CLI 这条链路读不到它。',
    },
    {
      id: 'gemini',
      name: 'Gemini',
      program: 'gemini',
      argsTemplate: '-p {prompt}',
      models: [{ id: 'gemini', category: 'chat' }],
      timeoutMs: 5 * MINUTE,
      needsCwd: true,
      docUrl: 'https://github.com/google-gemini/gemini-cli',
      note: 'Google 官方 Gemini CLI，走你本机登录的账号额度。',
      statusArgs: '--version',
      /* 它没有 login 子命令：第一次运行就会引导登录（浏览器授权） */
      loginArgs: '',
      keyLoginArgs: '',
      installHint: '装它：`npm i -g @google/gemini-cli`（需要 Node 18+），装完先运行一次 `gemini` 完成登录。',
      quotaWhere: 'Gemini 的用量在 **Google 账号的用量页**看；CLI 只报版本与登录态。',
    },
    {
      id: 'runninghub',
      name: 'RunningHub',
      program: 'runninghub',
      /*
       * ⚠️ `{out}` **不能省**：RunningHub 出的是图 / 视频，而媒体只能落在文件里 ——
       * 模板里没有 `{out}`，产物就无处落地（适配器会直接拒绝并指出这一点，
       * 而不是让你等到"命令跑完了但读不到产物"）。
       */
      argsTemplate: 'run --workflow {workflow} --out {out} --prompt {prompt}',
      models: [
        { id: 'runninghub-image', category: 'image' },
        { id: 'runninghub-video', category: 'video' },
      ],
      timeoutMs: 20 * MINUTE,
      needsCwd: false,
      docUrl: 'https://www.runninghub.cn/',
      note: 'RunningHub 是在线工作流平台，官方没有 CLI：这里填你本机那层封装脚本 / 工具的命令名。',
      statusArgs: '',
      loginArgs: '',
      keyLoginArgs: '',
      installHint: '官方没有 CLI：先在它网站拿到 API Key，再用社区 SDK / 自己写一个小脚本，把命令名填上面。',
      quotaWhere: 'RunningHub 的余额在**它网站的「个人中心」**里看。',
    },
  ]
}

/** 每个工具都给一样长的一行说明，用户扫一眼就知道"这行是干嘛的" */
export function capabilityLabel(cap: CliCapability): string {
  if (cap === 'image') return '出图'
  if (cap === 'video') return '出视频'
  return '对话'
}

/** 这个工具实际能干什么 —— 由它报出的模型推出来（**不写第二份能力清单**） */
export function capabilitiesOfTool(tool: CliTool): CliCapability[] {
  const seen: CliCapability[] = []
  for (const model of tool.models) {
    if (!seen.includes(model.category)) seen.push(model.category)
  }
  return seen
}

/** 给渠道 `listModels` 用的形态（`domain/shared/capability` 的公共形状） */
export function modelCapabilitiesOf(tool: CliTool): ModelCapability[] {
  return tool.models.map((model) => {
    const category = model.category
    return {
      id: model.id,
      category,
      // 三类输入都收：提示词 + 参考图（视频还可能要首尾帧），由参数模板怎么用决定
      inputTypes: category === 'video' ? ['text', 'image', 'video'] : ['text', 'image'],
    }
  })
}

/**
 * 「渠道协议 id → 工具 id」。
 *
 * 一条协议对一个工具：用户在渠道里选「即梦 CLI」，就等价于说"这条渠道用即梦那个工具"，
 * 而**工具本身怎么调用**（命令名、参数模板、超时）只在「全局设置 → CLI」那一处填 ——
 * 这正是用户"CLI 单独设置在全局设置里、不要在每条渠道里各填一遍"的口径。
 *
 * ⚠️ 键是**协议 id**，不是工具 id：老渠道存的就是这些协议 id，改名会让它们变「未知协议」。
 * `gpt-cli` 对应工具 `codex`，是为了对应用户"GPT CLI 改成 Codex"那句改名。
 */
export const CLI_PROTOCOL_TOOL: Record<string, string> = {
  'gpt-cli': 'codex',
  'jimeng-cli': 'jimeng',
  'gemini-cli': 'gemini',
  runninghub: 'runninghub',
}

/** 这条协议该用哪个工具；不是 CLI 协议就返回 null（调用方据此走别的链路） */
export function toolIdForProtocol(protocolId: string): string | null {
  return CLI_PROTOCOL_TOOL[protocolId] ?? null
}

/** 用默认配置取一个工具（读不到用户覆盖值时用；找不到返回 null） */
export function defaultToolForProtocol(protocolId: string): CliTool | null {
  const toolId = toolIdForProtocol(protocolId)
  if (!toolId) return null
  return defaultCliTools().find((tool) => tool.id === toolId) ?? null
}

/**
 * 产物文件的扩展名。
 *
 * 它只是给 CLI 的一个**提示**（各家按 `--out` 的后缀决定格式），真正落地时
 * 以字节魔数为准 —— 万一它写了 JPEG 却叫 `.png`，我们不跟着错（见 `mimeSniff`）。
 */
export function outExtFor(kind: 'image' | 'video'): string {
  return kind === 'video' ? 'mp4' : 'png'
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
 * 与 `str` 的区别：**空串算合法值**（原样返回）。
 *
 * 用在 `statusArgs` / `loginArgs` / `keyLoginArgs` 上：空串在这些字段里有明确语义
 * ——「这个工具没有这条命令」。若按 `str` 的写法把空串当坏值回落默认，
 * 用户**永远关不掉**一条自己不支持的子命令（删了又自己长回来）。
 */
function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
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
      /*
       * 这三条也允许用户改（他装的那份 CLI 子命令可能不同）。
       * 注意"空串是**合法值**"——它的意思是"这个工具没有这条命令"，所以这里不能用
       * `str()`（那个会把空串当坏值回落默认），要用一个允许空串的读法。
       */
      statusArgs: text(patch.statusArgs, tool.statusArgs),
      loginArgs: text(patch.loginArgs, tool.loginArgs),
      keyLoginArgs: text(patch.keyLoginArgs, tool.keyLoginArgs),
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
    /* 这三条用户也改得动（他装的那份 CLI 子命令可能不同）；空串是合法值，见 `text()` */
    statusArgs: tool.statusArgs,
    loginArgs: tool.loginArgs,
    keyLoginArgs: tool.keyLoginArgs,
  }
}
