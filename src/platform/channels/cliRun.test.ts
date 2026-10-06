import { describe, expect, it } from 'vitest'
import { CLI_TOOLS_ROW_ID } from '../../domain/shared/cliTools'
import { protocolById } from '../../domain/project/protocol'
import type { AppError } from '../../shared/result'
import type { CliOutcome, CliPort } from '../ports'
import { createMemoryPlatform } from '../memory/index'
import { createCliRunAdapter, joinPath, type CliRunConfig } from './cliRun'
import type { ChannelDeps } from './types'

/** 用**真实目录**里的协议定义（顺带证明那四条 entry 本身是可用的） */
function configOf(protocol: string): CliRunConfig {
  return {
    id: 'ch-1',
    protocol,
    baseUrl: '',
    credentialRef: null,
    apiKey: null,
    protocolDefinition: protocolById(protocol),
  }
}

function pngBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  bytes.set([0x49, 0x48, 0x44, 0x52], 12) // 'IHDR'（长度 8..12 留空无所谓，头读取只认签名与这个位置）
  const view = new DataView(bytes.buffer)
  view.setUint32(16, width)
  view.setUint32(20, height)
  return bytes
}

function jpegBytes(): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0)
  return bytes
}

function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x00, 0x00, 0x00, 0x18], 0)
  bytes.set([0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d], 4) // 'ftyp' + 'isom'
  return bytes
}

interface FakeOptions {
  /** `which` 找不到命令 */
  missing?: boolean
  /** 命令的 stdout（对话用） */
  stdout?: string
  /** 非零退出时给这个退出码 */
  code?: number
  stderr?: string
  /** 产物写入：拿到 `{out}` 的路径，返回要"写进文件"的字节 */
  write?: (outPath: string) => Uint8Array
  /** 覆盖 run 的返回值（超时 / 取消那类） */
  outcome?: Partial<CliOutcome>
}

/** 一个记账用的假壳：把"前端要求壳做什么"原样记下来 */
function fakeCli(options: FakeOptions = {}) {
  const calls: { program: string; args: string[]; timeoutMs?: number }[] = []
  const files = new Map<string, Uint8Array>()
  const port: CliPort = {
    async which(program) {
      return options.missing ? null : `C:\\bin\\${program}.exe`
    },
    async run(req) {
      calls.push({ program: req.program, args: req.args, timeoutMs: req.timeoutMs })
      const outPath = req.args.find((arg) => /\.[a-z0-9]+$/i.test(arg) && arg.includes('cli-out'))
      if (options.write && outPath) files.set(outPath, options.write(outPath))
      return {
        code: options.code ?? 0,
        stdout: options.stdout ?? '',
        stderr: options.stderr ?? '',
        timedOut: false,
        cancelled: false,
        ms: 12,
        ...options.outcome,
      }
    },
    async kill() {
      return true
    },
    /* 适配器不用它（那是"一键登录"的通道，见 CliPanel）；这里给个空实现凑齐端口形状 */
    async spawnWindow() {},
    async outDir() {
      return 'C:\\data\\cli-out'
    },
    async readOut(path) {
      const found = files.get(path)
      if (!found) throw new Error('读不到本机 CLI 的产物')
      return found
    },
  }
  return { port, calls, files }
}

function depsOf(cli: CliPort | undefined): ChannelDeps {
  return { ...createMemoryPlatform(), cli }
}

/**
 * 取 `ChannelError` 里那枚 `AppError`。
 *
 * 断言必须打在 `appError` 上：`ChannelError.message` 只是调试串（`[channel] cli`），
 * 用户看到的文案在 `appError` 里 —— 对着 `message` 断言等于测了个内部标识符。
 */
async function cliErrorOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise
  } catch (err) {
    const app = (err as { appError?: AppError }).appError
    if (!app) throw new Error(`抛出的不是 ChannelError：${String(err)}`)
    return app
  }
  throw new Error('本该抛错，却成功了')
}

describe('本机 CLI 适配器 · 对话', () => {
  it('stdout 就是正文，参数按模板替换（prompt 带空格也不拆开）', async () => {
    const cli = fakeCli({ stdout: '  你好，我是 Codex  \n' })
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(cli.port))
    const result = await adapter.completeText(
      {
        kind: 'text',
        channelId: 'ch-1',
        model: 'codex',
        prompt: '写 一句 话',
        inputs: [],
        params: {},
      },
      new AbortController().signal,
    )
    expect(result.text).toBe('你好，我是 Codex')
    // 默认模板 `exec {prompt}`：整句提示词是**一个** argv，不被空格切开
    expect(cli.calls[0]?.args).toEqual(['exec', '写 一句 话'])
    expect(cli.calls[0]?.program).toBe('codex')
  })

  it('★ 用的是「全局设置 → CLI」里**当前**那份配置（改完命令名立刻生效）', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('presets', {
      id: CLI_TOOLS_ROW_ID,
      tools: [{ id: 'codex', program: 'D:/tools/codex.cmd', argsTemplate: 'run {prompt}' }],
    } as never)
    const cli = fakeCli({ stdout: 'ok' })
    const adapter = createCliRunAdapter(configOf('gpt-cli'), { ...platform, cli: cli.port })
    await adapter.completeText(
      { kind: 'text', channelId: 'ch-1', model: 'codex', prompt: 'hi', inputs: [], params: {} },
      new AbortController().signal,
    )
    expect(cli.calls[0]?.program).toBe('D:/tools/codex.cmd')
    expect(cli.calls[0]?.args).toEqual(['run', 'hi'])
  })

  it('多轮 messages 以它为准（Agent 走同一条路）', async () => {
    const cli = fakeCli({ stdout: 'ok' })
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(cli.port))
    await adapter.completeText(
      {
        kind: 'text',
        channelId: 'ch-1',
        model: 'codex',
        prompt: '被忽略',
        inputs: [],
        params: {},
        messages: [
          { role: 'system', content: '你是助手' },
          { role: 'user', content: '你好' },
        ],
      },
      new AbortController().signal,
    )
    expect(cli.calls[0]?.args[1]).toBe('[system] 你是助手\n\n你好')
  })

  it('命令没输出 ⇒ 如实报错，不假装成功', async () => {
    const cli = fakeCli({ stdout: '   ' })
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(cli.port))
    const app = await cliErrorOf(
      adapter.completeText(
        { kind: 'text', channelId: 'ch-1', model: 'codex', prompt: 'x', inputs: [], params: {} },
        new AbortController().signal,
      ),
    )
    expect(app).toMatchObject({ kind: 'cli', detail: 'failed' })
    expect(app.kind === 'cli' ? app.message : '').toMatch(/没有任何输出/)
  })
})

describe('本机 CLI 适配器 · 图 / 视频', () => {
  it('★ 图生图那条路真的走通：{out} 落文件 → 读回字节 → 认出类型与像素', async () => {
    const cli = fakeCli({ write: () => pngBytes(640, 480) })
    const adapter = createCliRunAdapter(configOf('jimeng-cli'), depsOf(cli.port))
    const assets = await adapter.generateImage(
      {
        kind: 'image',
        channelId: 'ch-1',
        model: 'jimeng-image',
        prompt: '一只猫',
        inputs: [],
        params: {},
      },
      new AbortController().signal,
    )
    expect(assets).toHaveLength(1)
    expect(assets[0]?.mime).toBe('image/png')
    expect(assets[0]?.width).toBe(640)
    expect(assets[0]?.height).toBe(480)
    expect(assets[0]?.hash).toMatch(/^[0-9a-f]{16,}$/)
    // `{out}` 真的被换成了产物目录下的路径（编号每次不同，只钉形状）
    const outArg = cli.calls[0]?.args.find((arg) => arg.includes('cli-out'))
    expect(outArg).toMatch(/^C:\\data\\cli-out\\jimeng-cli-[a-z0-9]+-\d+\.png$/)
  })

  it('★★ CLI 忽略后缀写了 JPEG ⇒ 类型按**字节**认，不跟着 .png 错', async () => {
    const cli = fakeCli({ write: () => jpegBytes() })
    const adapter = createCliRunAdapter(configOf('jimeng-cli'), depsOf(cli.port))
    const assets = await adapter.generateImage(
      { kind: 'image', channelId: 'ch-1', model: 'jimeng-image', prompt: 'x', inputs: [], params: {} },
      new AbortController().signal,
    )
    expect(assets[0]?.mime).toBe('image/jpeg')
  })

  it('视频产物同理（MP4 的 ftyp）', async () => {
    const cli = fakeCli({ write: () => mp4Bytes() })
    const adapter = createCliRunAdapter(configOf('runninghub'), depsOf(cli.port))
    const assets = await adapter.generateVideo(
      { kind: 'video', channelId: 'ch-1', model: 'runninghub-video', prompt: 'x', inputs: [], params: {} },
      new AbortController().signal,
    )
    expect(assets[0]?.mime).toBe('video/mp4')
    expect(cli.calls[0]?.args.some((a) => a.endsWith('.mp4'))).toBe(true)
  })

  it('命令跑成功但没写出文件 ⇒ 说清楚"没读到产物"，不给一张空图', async () => {
    const cli = fakeCli({})
    const adapter = createCliRunAdapter(configOf('jimeng-cli'), depsOf(cli.port))
    const app = await cliErrorOf(
      adapter.generateImage(
        { kind: 'image', channelId: 'ch-1', model: 'jimeng-image', prompt: 'x', inputs: [], params: {} },
        new AbortController().signal,
      ),
    )
    expect(app).toMatchObject({ kind: 'cli', detail: 'failed' })
    expect(app.kind === 'cli' ? app.message : '').toMatch(/没读到产物/)
  })

  it('协议没声明这个能力 ⇒ unsupported（不悄悄发一个它不支持的请求）', async () => {
    const cli = fakeCli({ write: () => pngBytes(8, 8) })
    // Codex 那条只有对话能力
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(cli.port))
    const app = await cliErrorOf(
      adapter.generateImage(
        { kind: 'image', channelId: 'ch-1', model: 'codex', prompt: 'x', inputs: [], params: {} },
        new AbortController().signal,
      ),
    )
    expect(app).toMatchObject({ kind: 'channel', detail: 'unsupported' })
    expect(cli.calls).toHaveLength(0)
  })

  it('★ 模板里忘了写 {out} ⇒ 当场拒掉并指出去哪儿补（不是等到"读不到产物"）', async () => {
    const platform = createMemoryPlatform()
    await platform.storage.put('presets', {
      id: CLI_TOOLS_ROW_ID,
      tools: [{ id: 'jimeng', argsTemplate: 'generate --prompt {prompt}' }],
    } as never)
    const cli = fakeCli({ write: () => pngBytes(8, 8) })
    const adapter = createCliRunAdapter(configOf('jimeng-cli'), { ...platform, cli: cli.port })
    const app = await cliErrorOf(
      adapter.generateImage(
        { kind: 'image', channelId: 'ch-1', model: 'jimeng-image', prompt: 'x', inputs: [], params: {} },
        new AbortController().signal,
      ),
    )
    expect(app.kind === 'cli' ? app.message : '').toMatch(/\{out\}/)
    // 一次都没跑 —— 明知落不了地就不该花用户的钱
    expect(cli.calls).toHaveLength(0)
  })
})

describe('本机 CLI 适配器 · 出错如实说', () => {
  it('非零退出 ⇒ 把命令自己的 stderr 尾部带出来', async () => {
    const cli = fakeCli({ code: 1, stderr: 'line1\nline2\nnot logged in, run `codex login`' })
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(cli.port))
    const app = await cliErrorOf(
      adapter.completeText(
        { kind: 'text', channelId: 'ch-1', model: 'codex', prompt: 'x', inputs: [], params: {} },
        new AbortController().signal,
      ),
    )
    expect(app).toMatchObject({ kind: 'cli', detail: 'failed' })
    expect(app.kind === 'cli' ? app.message : '').toMatch(/not logged in/)
  })

  it('超时 ⇒ 归到 timeout，并告诉用户去哪儿调大', async () => {
    const cli = fakeCli({ outcome: { timedOut: true, code: null, ms: 120_000 } })
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(cli.port))
    const app = await cliErrorOf(
      adapter.completeText(
        { kind: 'text', channelId: 'ch-1', model: 'codex', prompt: 'x', inputs: [], params: {} },
        new AbortController().signal,
      ),
    )
    expect(app).toMatchObject({ kind: 'cli', detail: 'timeout' })
    expect(app.kind === 'cli' ? app.message : '').toMatch(/120 秒被掐掉/)
  })

  it('取消 ⇒ 掐掉子进程并归到 canceled（不是"失败"）', async () => {
    const controller = new AbortController()
    const killed: string[] = []
    let finish: ((outcome: CliOutcome) => void) | null = null
    let markStarted: () => void = () => {}
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const port: CliPort = {
      async which() {
        return 'C:\\bin\\codex.exe'
      },
      run: () =>
        new Promise<CliOutcome>((resolve) => {
          finish = resolve
          markStarted()
        }),
      async kill(id) {
        killed.push(id)
        finish?.({ code: null, stdout: '', stderr: '', timedOut: false, cancelled: true, ms: 30 })
        return true
      },
      async spawnWindow() {},
      async outDir() {
        return 'C:\\data\\cli-out'
      },
      async readOut() {
        return new Uint8Array()
      },
    }
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(port))
    const pending = cliErrorOf(
      adapter.completeText(
        { kind: 'text', channelId: 'ch-1', model: 'codex', prompt: 'x', inputs: [], params: {} },
        controller.signal,
      ),
    )
    // 等它**真的起起来**再取消 —— 否则测的是"还没开始就取消"，不是"跑到一半被掐"
    await started
    controller.abort()
    const app = await pending
    expect(app).toMatchObject({ kind: 'cli', detail: 'canceled' })
    expect(killed).toHaveLength(1)
  })

  it('★ 命令名写错 ⇒ 归到 notfound，文案指向「全局设置 → CLI」', async () => {
    const port = fakeCli().port
    port.run = async () => {
      throw new Error('找不到命令「codex」：先在设置里确认它的命令名或完整路径')
    }
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(port))
    const app = await cliErrorOf(
      adapter.completeText(
        { kind: 'text', channelId: 'ch-1', model: 'codex', prompt: 'x', inputs: [], params: {} },
        new AbortController().signal,
      ),
    )
    expect(app).toMatchObject({ kind: 'cli', detail: 'notfound' })
    expect(app.kind === 'cli' ? app.message : '').toMatch(/找不到命令/)
  })
})

describe('本机 CLI 适配器 · 验证与模型清单', () => {
  it('验证 = 看命令在不在（不执行任何东西），找到就顺手报出模型', async () => {
    const cli = fakeCli({})
    const adapter = createCliRunAdapter(configOf('gpt-cli'), depsOf(cli.port))
    const result = await adapter.verify(configOf('gpt-cli'), new AbortController().signal)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.models.map((m) => m.id)).toEqual(['codex'])
    expect(cli.calls).toHaveLength(0) // 一次都没跑
  })

  it('找不到 ⇒ 明确说"去全局设置改命令名"，而不是丢一个英文标识符', async () => {
    const cli = fakeCli({ missing: true })
    const adapter = createCliRunAdapter(configOf('gemini-cli'), depsOf(cli.port))
    const result = await adapter.verify(configOf('gemini-cli'), new AbortController().signal)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/本机找不到命令/)
      expect(result.message).toMatch(/全局设置/)
    }
  })

  it('能列出的模型 = 工具报得出的那几个（即梦一个能出图、一个能出视频）', async () => {
    const cli = fakeCli({})
    const adapter = createCliRunAdapter(configOf('jimeng-cli'), depsOf(cli.port))
    const models = await adapter.listModels(configOf('jimeng-cli'), new AbortController().signal)
    expect(models.map((m) => [m.id, m.category])).toEqual([
      ['jimeng-image', 'image'],
      ['jimeng-video', 'video'],
    ])
  })
})

describe('产物路径拼接', () => {
  it('按目录里出现过的分隔符拼（Windows / posix 都不出错）', () => {
    expect(joinPath('C:\\data\\cli-out', 'a.png')).toBe('C:\\data\\cli-out\\a.png')
    expect(joinPath('C:\\data\\cli-out\\', 'a.png')).toBe('C:\\data\\cli-out\\a.png')
    expect(joinPath('/home/u/cli-out', 'a.png')).toBe('/home/u/cli-out/a.png')
  })
})
