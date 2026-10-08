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
  /**
   * 用密钥登录的**落点**（用户 2026-10-08 第 3 条：「看看 github 上能不能把目前实现不了
   * 一键自动安装的 cli 给做好」）：
   *
   * - `'stdin'`：把密钥喂给 `keyLoginArgs` 那条命令的 stdin（Codex 的
   *   `login --with-api-key` 就是这条）；
   * - `'config'`：写进**该工具自己的配置文件**——现在只有 RunningHub：它的
   *   `rh auth set-key <KEY>` 把 Key 当**位置参数**读（源码 `account`/`main` 实测），
   *   而本机约定是"密钥不进 argv" ⇒ 由壳写它认的 `%APPDATA%\rh\config.toml`
   *   （`rh_cli/config.py` 的 `resolve_api_key` 认这一行），效果与手敲那条命令一致，
   *   而且是持久的：用户自己终端里的 `rh` 也立刻变成登录态；
   * - `''`：这个工具不支持密钥登录（只能走可见窗口那条路，或者根本没有官方 CLI）。
   */
  keyLoginKind: 'stdin' | 'config' | ''
  /**
   * **登录方式的一句话**（用户 2026-10-08 给的参考图一：那张卡的登录区是一个小框 ——
   * 一行说明 + 一枚主按钮）。
   *
   * 与 `note` 的分工：`note` 是"这个工具是干什么的"（现在挂在名称上做悬停提示），
   * 这条是"**我要怎么登录**" —— 它直接决定用户按哪个按钮，所以留在版面上，
   * 但**只给一行**（不许再长成一段介绍：用户明确说过不要介绍文字）。
   */
  loginHint: string
  /** 怎么把它装上（一句话：官网 / 安装命令），显示在"没找到命令"旁边 */
  installHint: string
  /**
   * **一键安装**要跑的那条命令（用户 2026-10-06 第 14 批第 3 条：
   * 「cli 的那我做成一键安装并且登录不就行了吗？」）。
   *
   * 空格分隔、`"引号"` 可包住含空格的一段（与 `argsTemplate` 同一套切词，走 `parseArgs`）；
   * 第一个 token 是程序名（`npm` / `winget` / `brew`…），其余是参数。
   *
   * **空串是有意义的值**：「这个工具没有能自动装的官方途径」（即梦 / RunningHub 都是
   * 社区封装或纯网站），这时面板只显示 `installHint`，不给一个按下去必然失败的按钮。
   */
  installCommand: string
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
      keyLoginKind: 'stdin',
      loginHint: '在本机终端登录一次，或把 API Key 粘到右边用密钥登录。',
      installHint: '已装的话 `codex --version` 能看到版本；没装去 https://github.com/openai/codex 按说明装。',
      installCommand: 'npm install -g @openai/codex',
      quotaWhere: 'CLI 只报登录态；余额在 ChatGPT 的用量页看。',
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
      keyLoginKind: '',
      loginHint: '即梦没有官方 CLI：先把命令名填进「高级」，再按那份封装的说明登录。',
      installHint: '即梦官方没有命令行工具：要接就先弄一层封装（社区脚本 / 自己写），再把命令名填上面。',
      installCommand: '',
      quotaWhere: '积分在即梦 App / 网页的「我的」里看。',
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
      keyLoginKind: '',
      loginHint: '第一次运行会在浏览器里完成授权 —— 点下面的按钮会打开一个终端。',
      installHint: '装它：`npm i -g @google/gemini-cli`（需要 Node 18+），装完先运行一次 `gemini` 完成登录。',
      installCommand: 'npm install -g @google/gemini-cli',
      quotaWhere: '用量在 Google 账号的用量页看；CLI 只报版本。',
    },
    {
      id: 'runninghub',
      name: 'RunningHub',
      /**
       * 命令名是 **`rh`**（官方 CLI 装完注册的就是它）。
       *
       * ⚠️ 这一条以前写的是 `runninghub` + 「官方没有 CLI」—— **2026-10-08 实测推翻了**：
       * 官方有了（`HM-RunningHub/RH_CLI`，Apache-2.0），`python -m pip install .` 装完注册 `rh`，
       * 本机已装并跑通 `rh --json check`（读到余额与 RH 币）。故照实改。
       */
      program: 'rh',
      /*
       * 走 `model run --task {model}`（不写 `--endpoint`）：
       *  - `--task` 由**官方目录**挑该任务下最优的端点，用户不必记端点 id；
       *  - 关键是它**不会弹交互式选择** —— 而 `rh image` / `rh video` 在没给 `-m` 时走
       *    `typer.prompt`，非交互调用会被挂住（集成到应用里就是「点了没反应」）。
       *
       * ⚠️ `{out}` **不能省**：出的是图 / 视频，媒体只能落在文件里 ——
       * 模板里没有 `{out}`，产物就无处落地（适配器会直接拒绝并指出这一点，
       * 而不是让你等到「命令跑完了但读不到产物」）。
       */
      argsTemplate: 'model run --task {model} --prompt {prompt} --output {out}',
      /**
       * 模型 = 它自己的**任务名**（`--task` 的取值）。只列文生两类：
       * 图生那两类要 `-i 参考图`，而本机的参数模板还没有图片占位符 ——
       * 列出来只会让用户选中一个必然失败的档。
       */
      models: [
        { id: 'text-to-image', category: 'image' },
        { id: 'text-to-video', category: 'video' },
      ],
      timeoutMs: 20 * MINUTE,
      needsCwd: false,
      docUrl: 'https://github.com/HM-RunningHub/RH_CLI',
      note: '官方 CLI（`rh`）。模型那两行是它的任务名，`--task` 会按官方目录自动挑端点；要图生图 / 图生视频得带 `-i 参考图`，本机模板暂时没有图片占位符。',
      /**
       * 实测（2026-10-08）：`rh --json check` 回 `balance` 与 `coins` ——
       * 四个默认工具里**唯一真能读到额度的**（Codex 只报登录态、Gemini 只报版本、
       * 即梦没有官方 CLI）。用 `--json` 而不是默认输出：那行中文在非 UTF-8 控制台会乱码。
       */
      statusArgs: '--json check',
      /**
       * 一键登录：**空串**是如实回答 —— 官方 CLI 的 `rh auth set-key <KEY>` 把 Key 当
       * **位置参数**读（不是 stdin），而本机的约定是「密钥只走 stdin、不进 argv」，
       * 所以"打开一个窗口让它自己登录"这条路走不通。
       *
       * ⇒ 登录改走 `keyLoginKind: 'config'`（壳写它的配置文件，等效于手敲那条命令，
       * 见 `keyLoginKind` 与 `platform/ports.ts` 的 `rhSetApiKey`）。这一格保持空串，
       * 是为了**别给用户一个按下去没用的按钮**。
       */
      loginArgs: '',
      keyLoginArgs: '',
      /**
       * **由壳写它的配置文件**（见 `keyLoginKind` 的说明）——
       * 这是本轮把"RunningHub 登录不了"变成"点一下就好"的落点。
       */
      keyLoginKind: 'config',
      loginHint: '把 API Key 粘到右边点「用密钥登录」：写进它自己的配置，之后一直是登录态。',
      installHint: '装它：先有 Python 3.10+，再 `python -m pip install git+https://github.com/HM-RunningHub/RH_CLI.git`；装完在本机跑一次 `rh auth set-key <你的Key>`（Key 在 https://www.runninghub.cn/enterprise-api/sharedApi 取），之后一直是登录态。',
      installCommand: 'python -m pip install git+https://github.com/HM-RunningHub/RH_CLI.git',
      quotaWhere: '`rh check` 能直接读余额与 RH 币（上面那个按钮跑的就是它）。',
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
 * **目录里改过默认值的字段**：旧默认 → 现默认（老配置的迁移表）。
 *
 * 为什么需要它：库里只存"用户改过的字段"，但**旧目录的默认值当年也是写进库里的** ——
 * 用户没动过它，可它已经过时，而读取时它照样会**压过新默认**。
 *
 * 2026-10-08 真机实测踩到：RunningHub 的 CLI 从"官方没有 CLI"改成官方 `rh` 之后，
 * 老库里存着 `program: 'runninghub'` 与旧参数模板 ⇒ 面板上点「检测 / 查状态」
 * 报「找不到命令「runninghub」」，而**用户从没填过这个名字**（那是上一版目录给的）。
 *
 * 判据因此是"**存的值等于旧默认 ⇒ 当作没改过**，用现默认；等于别的值才认作用户自定义"。
 * 加新条目时把**旧默认原样**抄进来（一个字符不同就不生效）。
 */
const SUPERSEDED_DEFAULTS: Record<
  string,
  {
    program?: string[]
    argsTemplate?: string[]
    /**
     * 「查状态 / 额度」那一格：老目录给的是**空串**（= 那时候判定"它没有可查的命令"），
     * 实测推翻之后才有 `--json check`。空串在这两个字段里是**合法值**，
     * 所以"等于旧默认"这条判据在这里尤其关键 —— 否则老用户永远查不到额度。
     */
    statusArgs?: string[]
    /** 同上：老目录给的空串表示"没有能自动装的途径"，现在是官方 pip 一行。 */
    installCommand?: string[]
  }
> = {
  runninghub: {
    program: ['runninghub'],
    argsTemplate: ['run --workflow {workflow} --out {out} --prompt {prompt}'],
    statusArgs: [''],
    installCommand: [''],
  },
}

/** 存的值是旧默认就往回落（见 `SUPERSEDED_DEFAULTS`）；否则原样认。 */
function notSuperseded(value: string, fallback: string, oldDefaults?: string[]): string {
  if (oldDefaults && oldDefaults.includes(value)) return fallback
  return value
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
    const superseded = SUPERSEDED_DEFAULTS[tool.id]
    return {
      ...tool,
      program: notSuperseded(str(patch.program, tool.program), tool.program, superseded?.program),
      argsTemplate: notSuperseded(
        str(patch.argsTemplate, tool.argsTemplate),
        tool.argsTemplate,
        superseded?.argsTemplate,
      ),
      timeoutMs: clampToolTimeout(patch.timeoutMs, tool.timeoutMs),
      /*
       * 这三条也允许用户改（他装的那份 CLI 子命令可能不同）。
       * 注意"空串是**合法值**"——它的意思是"这个工具没有这条命令"，所以这里不能用
       * `str()`（那个会把空串当坏值回落默认），要用一个允许空串的读法。
       */
      statusArgs: notSuperseded(
        text(patch.statusArgs, tool.statusArgs),
        tool.statusArgs,
        superseded?.statusArgs,
      ),
      loginArgs: text(patch.loginArgs, tool.loginArgs),
      keyLoginArgs: text(patch.keyLoginArgs, tool.keyLoginArgs),
      /* 同上：空串 = "这个工具没有能自动装的途径"，也是合法值 */
      installCommand: notSuperseded(
        text(patch.installCommand, tool.installCommand),
        tool.installCommand,
        superseded?.installCommand,
      ),
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
    installCommand: tool.installCommand,
  }
}
