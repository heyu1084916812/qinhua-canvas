import { assetMimeOfName } from '../../domain/shared/assetLocation'
import {
  CLI_TOOLS_ROW_ID,
  buildArgs,
  defaultToolForProtocol,
  mergeTools,
  modelCapabilitiesOf,
  outExtFor,
  toolIdForProtocol,
  type CliPlaceholder,
  type CliTool,
} from '../../domain/shared/cliTools'
import type { ModelCapability } from '../../domain/shared/capability'
import { fingerprintBytes } from '../../domain/shared/hash'
import { imageSizeFromHeader } from '../../domain/shared/imageSize'
import { sniffMimeFromBytes } from '../../domain/shared/mimeSniff'
import type { CliOutcome, SafeChannelConfig } from '../ports'
import {
  ChannelError,
  type ChannelAdapter,
  type ChannelDeps,
  type GeneratedAsset,
  type ImageRunRequest,
  type TextRunRequest,
  type VideoRunRequest,
  type VerifyResult,
} from './types'

/**
 * **真的跑本机 CLI** 的渠道适配器（用户 2026-10-06 第 11 批第 4 条的后半段，对账 #308）。
 *
 * 用户原话：「我的要求和目的就是**链接后能用里面的额度调用模型生成图片或者视频，或者对话**，
 * runninghub 也要，**需要真的能跑本机的 cli**」。
 *
 * ## 与 `cliGateway.ts` 的分工（同一族的两种活法）
 *
 * - 桌面壳里**有** `CliPort` ⇒ 走这里：直接起子进程，花的是用户本机那份登录态与额度，
 *   **不需要**他另跑一个网关；
 * - 浏览器里**没有**子进程 ⇒ 回落 `cliGateway.ts`：仍然只能访问用户自建的网关。
 *   两条路都在，谁在就用谁 —— 不是把老路删掉，而是把"能真的跑"这件事补上。
 *   选择点写在 `registry.ts` 的 `case 'cli-gateway'`（一处，不散）。
 *
 * ## 命令怎么来、产物怎么回
 *
 * - **命令与参数**：用户在「全局设置 → CLI」里按工具填（命令名 + 参数模板 + 超时）。
 *   适配器**每次调用现读**那行配置（`presets` 表），改完下一次生成就生效；
 * - **对话**：stdout 就是正文（末尾空行去掉）；
 * - **图 / 视频**：参数模板里的 `{out}` 换成 `<数据目录>/cli-out/<id>.<ext>`，
 *   跑完再把那个文件读回来当素材。**类型按字节魔数认**（CLI 可能忽略后缀），
 *   认不出才回落扩展名 —— 绝不"按扩展名假装它是 PNG"。
 *
 * ## 出错如实说
 *
 * 非零退出 / 超时 / 被取消 / 命令找不到，各自给一条**带命令原话**的中文错误
 * （`AppError` 的 `cli` 那一档），不吞、不假装成功。
 */

let seq = 0

/**
 * 这条协议要的配置：与 `cliGateway.ts` 同形（`SafeChannelConfig` + 已解出的令牌）。
 *
 * 刻意**不**从 `registry.ts` 引 `ResolvedChannelConfig`：那是"工厂注册表"的类型，
 * 而 registry 反过来要引本文件（路由到这条实现）⇒ 两边互引。类型相同就自己声明一份
 * （结构类型，形状对得上就行），宁可多一行也不要一个环。
 */
export interface CliRunConfig extends SafeChannelConfig {
  apiKey: string | null
}

/** 给每一次调用一个编号：`kill` 按它找人，日志里也能对上 */
function runIdFor(protocolId: string): string {
  seq += 1
  return `${protocolId}-${Date.now().toString(36)}-${seq}`
}

/**
 * 拼产物路径。
 *
 * 按目录里出现过的分隔符决定（壳给的是 Windows 路径，单测里是 posix）——
 * 不猜平台，只看手上这个字符串。
 */
export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`
}

/** 读这条协议对应的工具（用户改过就用改过的，读库失败回落默认） */
async function resolveTool(deps: ChannelDeps, protocolId: string): Promise<CliTool> {
  const fallback = defaultToolForProtocol(protocolId)
  if (!fallback) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
  if (!deps.storage) return fallback
  const toolId = toolIdForProtocol(protocolId)
  try {
    const rows = await deps.storage.query('presets', { id: CLI_TOOLS_ROW_ID })
    return mergeTools(rows[0]).find((tool) => tool.id === toolId) ?? fallback
  } catch {
    // 读不到 Preferences 不该让"生成"整体不可用：默认值本身是能跑的
    return fallback
  }
}

/** 交给 CLI 的那段正文：有 messages（Agent 多轮）就以它为准，与其它适配器同一口径 */
function promptOf(request: TextRunRequest | ImageRunRequest | VideoRunRequest): string {
  const messages = request.messages
  if (messages?.length) {
    return messages
      .map((message) => (message.role === 'system' ? `[system] ${message.content}` : message.content))
      .join('\n\n')
  }
  return request.prompt
}

function varsOf(
  request: TextRunRequest | ImageRunRequest | VideoRunRequest,
): Partial<Record<CliPlaceholder, string>> {
  const vars: Partial<Record<CliPlaceholder, string>> = {
    prompt: promptOf(request),
    model: request.model,
  }
  /*
   * `{workflow}` 只有 RunningHub 这类用得上：值从 `params.workflow` 拿（用户在参数里带就填，
   * 不带就**原样留着** —— 那种"占据位符"的形态会在命令输出里直接看见，比静默变空串好查）。
   */
  const workflow = request.params?.workflow
  if (typeof workflow === 'string' && workflow.trim()) vars.workflow = workflow
  return vars
}

/** 起进程。壳抛的是人话，这里只做"包装成人话的 AppError" */
async function runTool(
  deps: ChannelDeps,
  tool: CliTool,
  args: string[],
  signal: AbortSignal,
): Promise<CliOutcome> {
  const cli = deps.cli
  if (!cli) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
  const id = runIdFor(tool.id)
  /*
   * 已经取消了就别起进程：`resolveTool` 是异步的（要读一次库），
   * 这中间用户点了"取消"的话，监听器还没挂上、`kill` 也就没人调用 ⇒ 白跑一趟。
   * 这条与下面那条监听器一起，把"取消"在两个时间点上都堵住。
   */
  if (signal.aborted) throw new ChannelError({ kind: 'cli', detail: 'canceled' })
  /* 用户点"取消"⇒ 掐掉子进程；Rust 侧会把这次调用标成 `cancelled` 返回，不是抛异常 */
  const onAbort = () => {
    void cli.kill(id)
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    return await cli.run({
      id,
      program: tool.program,
      args,
      timeoutMs: tool.timeoutMs,
    })
  } catch (err) {
    const message = String(err)
    // 壳里"找不到命令"那条自带人话，这里把它归到对应的一档，界面上才能给出"去哪儿改"
    const notFound = message.includes('找不到命令')
    throw new ChannelError({
      kind: 'cli',
      detail: notFound ? 'notfound' : 'failed',
      message,
    })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** 退出码 / 超时 / 取消三件事，各自归成一条**能照着修**的错误 */
function assertOk(out: CliOutcome): void {
  if (out.cancelled) throw new ChannelError({ kind: 'cli', detail: 'canceled' })
  if (out.timedOut) {
    throw new ChannelError({
      kind: 'cli',
      detail: 'timeout',
      message: `跑了 ${Math.round(out.ms / 1000)} 秒被掐掉（超时可在「全局设置 → CLI」里调大）`,
    })
  }
  if (out.code !== 0) {
    const tail = [out.stderr, out.stdout]
      .map((text) => text.trim())
      .filter(Boolean)
      .join('\n')
      .split('\n')
      .filter(Boolean)
      .slice(-3)
      .join(' / ')
    throw new ChannelError({
      kind: 'cli',
      detail: 'failed',
      message: tail || `退出码 ${out.code ?? '未知'}`,
    })
  }
}

export function createCliRunAdapter(
  config: CliRunConfig,
  deps: ChannelDeps,
): ChannelAdapter {
  const capabilities = config.protocolDefinition?.capabilities ?? []

  /** 图 / 视频走同一条路，只有扩展名与"认类型"的兜底不同 */
  const generateMedia = async (
    request: ImageRunRequest | VideoRunRequest,
    kind: 'image' | 'video',
    signal: AbortSignal,
  ): Promise<GeneratedAsset[]> => {
    const cli = deps.cli
    if (!cli) throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    if (!capabilities.includes(kind)) {
      throw new ChannelError({ kind: 'channel', detail: 'unsupported' })
    }
    const tool = await resolveTool(deps, config.protocol)
    const outPath = joinPath(await cli.outDir(), `${runIdFor(config.protocol)}.${outExtFor(kind)}`)
    const args = buildArgs(tool.argsTemplate, { ...varsOf(request), out: outPath })
    /*
     * 模板里没有 `{out}` ⇒ 产物无处落地。**当场拒掉并说清怎么修**：
     * 让它跑下去只会得到"命令跑完了但读不到产物"，而那句话没有指出去哪儿补占位符。
     */
    if (!args.includes(outPath)) {
      throw new ChannelError({
        kind: 'cli',
        detail: 'failed',
        message: `「${tool.name}」的参数模板里没有 {out}，产物没地方落地 —— 去「全局设置 → CLI」把它的模板补上 {out}`,
      })
    }
    const outcome = await runTool(deps, tool, args, signal)
    assertOk(outcome)

    let bytes: Uint8Array
    try {
      bytes = await cli.readOut(outPath)
    } catch (err) {
      throw new ChannelError({
        kind: 'cli',
        detail: 'failed',
        message: `命令跑完了但没读到产物（${String(err)}）`,
      })
    }
    if (bytes.length === 0) {
      throw new ChannelError({ kind: 'cli', detail: 'failed', message: '产物是个空文件' })
    }

    const mime =
      sniffMimeFromBytes(bytes) ??
      assetMimeOfName(outPath) ??
      (kind === 'video' ? 'video/mp4' : 'image/png')
    const size = kind === 'image' ? imageSizeFromHeader(bytes) : null
    const hash = await fingerprintBytes(bytes)
    return [
      {
        hash,
        mime,
        bytes,
        ...(size ? { width: size.width, height: size.height } : {}),
      },
    ]
  }

  return {
    protocol: config.protocol,

    /**
     * 「验证」= **看这个命令在不在**（不执行任何东西）。
     *
     * 用户点这个按钮想知道的正是"我的命令填对没有"，而 CLI 没有可探测的 HTTP 地址；
     * 真正"能不能跑通"由一次生成回答。
     */
    async verify(): Promise<VerifyResult> {
      const tool = await resolveTool(deps, config.protocol)
      const cli = deps.cli
      if (!cli) return { ok: false, error: { kind: 'channel', detail: 'unsupported' } }
      const found = await cli.which(tool.program)
      if (!found) {
        return {
          ok: false,
          error: { kind: 'cli', detail: 'notfound' },
          message: `本机找不到命令「${tool.program}」——去「全局设置 → CLI」改命令名，或者填完整路径`,
        }
      }
      return { ok: true, models: modelCapabilitiesOf(tool) }
    },

    /**
     * 能列出什么模型：**这个工具报得出的那几个逻辑名**（见 `CliModel` 的说明）。
     *
     * 不查它的登录态、不猜云上的模型清单 —— 用户可以在渠道的「模型映射」里
     * 把逻辑名改成真正的上游名，那个名字会经 `{model}` 进参数模板。
     */
    async listModels(): Promise<ModelCapability[]> {
      return modelCapabilitiesOf(await resolveTool(deps, config.protocol))
    },

    generateImage: (request, signal) => generateMedia(request, 'image', signal),
    generateVideo: (request, signal) => generateMedia(request, 'video', signal),

    async completeText(request, signal) {
      const tool = await resolveTool(deps, config.protocol)
      const outcome = await runTool(
        deps,
        tool,
        buildArgs(tool.argsTemplate, varsOf(request)),
        signal,
      )
      assertOk(outcome)
      const text = outcome.stdout.trim()
      if (!text) {
        throw new ChannelError({
          kind: 'cli',
          detail: 'failed',
          message: '命令跑成功了但没有任何输出（确认参数模板会把结果打到 stdout）',
        })
      }
      return { text, finishReason: 'stop' }
    },
  }
}
