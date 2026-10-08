import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  buildArgs,
  capabilityLabel,
  capabilitiesOfTool,
  clampToolTimeout,
  defaultCliTools,
  parseArgs,
  type CliTool,
} from '../../domain/shared/cliTools'
import type { CliOutcome } from '../../platform/ports'
import { createCliToolStore } from '../../state/project/cliToolStore'
import styles from './CliPanel.module.css'

/**
 * 「全局设置 → CLI」面板（用户 2026-10-06 第 11 批第 4 条 + 第 13 批第 2 条）。
 *
 * ## 用户口径
 *
 * - 第 11 批：「CLI 可以单独设置在全局设置里面了，就在渠道配置的下面…我的要求和目的就是
 *   链接后能用里面的额度调用模型生成图片或者视频，或者对话，runninghub 也要，需要真的能跑本机的 cli」；
 * - 第 13 批：「codex 的 cli 我想要读取到额度，即梦的我想要读取到积分，我试了一下测试 gemini
 *   和即梦都不行，runninghub 也不行，是我还需要什么嘛？」＋「如果查不了额度，我如何显示额度，
 *   我要解决这个问题，还有我如何使用的问题，我不太懂怎么设置这个 cli，
 *   我希望是我一键设置，然后输入密码或者其他的就可以保持登录」。
 *
 * ## 于是每一张卡按"用户会问的顺序"排
 *
 * 0. **一键设置**（第 14 批第 3 条：「cli 的那我做成一键安装并且登录不就行了吗？」）——
 *    一个按钮把"装 + 登录"串起来：没装就开一个安装窗口，装好了就开登录窗口。
 *    每一步都**如实说**它这一刻在做什么、做完要回来点哪里；
 * 1. **装没装**（检测）—— 没装就直接告诉他怎么装（`installHint`），能自动装的给「一键安装」；
 * 2. **登录**——「一键登录」在可见窗口里跑它自己的登录命令（浏览器授权 / 输密码都行），
 *    或用密钥登录（密钥走 stdin，不进 argv、不落我们的库）；
 * 3. **查状态 / 额度**——能查就把工具的原话贴出来（含 stderr：很多 CLI 把有效信息打在那儿）；
 *    查不到就直说，并写明去哪儿看（`quotaWhere`）——绝不编一个余额数字；
 * 4. **高级**（默认折起）——命令名 / 参数模板 / 超时 / 各条命令，以及"测试运行"。
 *
 * 浏览器里没有子进程：整块照旧显示（用户要的"桌面专属也要看得见"），
 * 但按钮禁用并写明"只在桌面应用里可用"，不假装能跑。
 */
export function CliPanel() {
  const platform = usePlatform()
  const cli = platform.cli
  const store = useMemo(() => createCliToolStore(platform.storage), [platform.storage])

  const [tools, setTools] = useState<CliTool[]>(() => defaultCliTools())
  const [probes, setProbes] = useState<Record<string, string>>({})
  const [runs, setRuns] = useState<Record<string, string>>({})
  const [statusOut, setStatusOut] = useState<Record<string, string>>({})
  const [loginMsg, setLoginMsg] = useState<Record<string, string>>({})
  const [keys, setKeys] = useState<Record<string, string>>({})
  /** 正在跑的那件小事（`<toolId>:<action>`）；空串 = 空闲 */
  const [busy, setBusy] = useState('')

  useEffect(() => {
    let alive = true
    void store.load().then((loaded) => {
      if (alive) setTools(loaded)
    })
    return () => {
      alive = false
    }
  }, [store])

  /** 改一个字段：先改内存、再写库（反过来的话打字会等一次异步落库、一顿一顿） */
  const patchTool = (id: string, patch: Partial<CliTool>) => {
    const next = tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool))
    setTools(next)
    void store.save(next)
  }

  const detect = async (tool: CliTool) => {
    if (!cli || busy) return
    setBusy(`${tool.id}:which`)
    try {
      const found = await cli.which(tool.program)
      setProbes((prev) => ({ ...prev, [tool.id]: found ? `找到了：${found}` : '没找到' }))
    } catch (err) {
      setProbes((prev) => ({ ...prev, [tool.id]: `检测失败：${String(err)}` }))
    } finally {
      setBusy('')
    }
  }

  /** 跑一条命令并把输出原样写进指定槽位（测试运行 / 查状态 共用） */
  const runInto = async (tool: CliTool, slot: 'run' | 'status', args: string[], stdin?: string) => {
    if (!cli || busy) return
    const head = `$ ${tool.program} ${args.join(' ')}`
    const write = (text: string) => {
      const setter = slot === 'status' ? setStatusOut : setRuns
      setter((prev) => ({ ...prev, [tool.id]: text }))
    }
    setBusy(`${tool.id}:${slot}`)
    write(`${head}\n…正在跑`)
    try {
      const out = await cli.run({
        id: `cli-${slot}-${tool.id}`,
        program: tool.program,
        args,
        ...(stdin === undefined ? {} : { stdin }),
        timeoutMs: tool.timeoutMs,
      })
      write(describeRun(head, out))
    } catch (err) {
      write(`${head}\n跑不起来：${String(err)}`)
    } finally {
      setBusy('')
    }
  }

  /** 一键登录：把它自己的登录命令丢进一个可见窗口，用户在那边完成 */
  const openLogin = async (tool: CliTool) => {
    if (!cli || busy) return
    setBusy(`${tool.id}:login`)
    try {
      const args = tool.loginArgs.trim() ? buildArgs(tool.loginArgs, {}) : []
      await cli.spawnWindow({ program: tool.program, args })
      setLoginMsg((prev) => ({
        ...prev,
        [tool.id]: `已经打开一个窗口跑「${[tool.program, ...args].join(' ')}」——在那里完成登录（浏览器授权或输密码都行）；完成后回来点「检测 / 查状态」确认。`,
      }))
    } catch (err) {
      setLoginMsg((prev) => ({ ...prev, [tool.id]: `打不开登录窗口：${String(err)}` }))
    } finally {
      setBusy('')
    }
  }

  /**
   * **一键设置**（用户 2026-10-06 第 14 批第 3 条：「我希望能一键设置，然后输入密码或者
   * 其他的就可以保持登录」）。
   *
   * 三步如实走：① 检测 → ② 没装就开**安装窗口**（`installCommand`，可见窗口，进度与
   * 交互提示都在那儿）→ ③ 装好了就开**登录窗口**（工具自己的登录命令，浏览器授权 / 输密码）。
   *
   * 为什么走完安装要**回来再点一次**：安装是另一个窗口里的事，我们不知道它什么时候完
   * —— 等它就会把界面卡住（登录动辄几分钟）。所以这里只在消息里写清"装完再点一次"，
   * 不假装一步到位。
   */
  const oneClickSetup = async (tool: CliTool) => {
    if (!cli || busy) return
    setBusy(`${tool.id}:setup`)
    const say = (text: string) => setLoginMsg((prev) => ({ ...prev, [tool.id]: text }))
    try {
      const found = await cli.which(tool.program)
      setProbes((prev) => ({ ...prev, [tool.id]: found ? `找到了：${found}` : '没找到' }))
      if (!found) {
        const cmd = parseArgs(tool.installCommand.trim())
        if (cmd.length === 0) {
          say(`本机没有「${tool.program}」，而这个工具没有能自动装的官方途径 —— ${tool.installHint}`)
          return
        }
        await cli.spawnWindow({ program: cmd[0], args: cmd.slice(1) })
        say(
          `没装「${tool.program}」→ 已经打开安装窗口跑「${tool.installCommand}」。` +
            `等那个窗口跑完（可能要一两分钟），回来**再点一次「一键设置」**就会进下一步（登录）。`,
        )
        return
      }
      /**
       * 登录这一步分两种落点：能开窗口的自己开（浏览器授权 / 输密码），
       * 只能靠密钥的（`keyLoginKind === 'config'`，RunningHub 就是）把用户引到下面那格去 ——
       * 不给一个按下去没用的"登录窗口"。
       */
      if (tool.keyLoginKind === 'config') {
        say(
          `已经装好了 → 把 API Key 粘到下面那一格，点「用密钥登录」就完成登录` +
            `（写进它自己的配置，之后一直是登录态）。`,
        )
        return
      }
      const args = tool.loginArgs.trim() ? buildArgs(tool.loginArgs, {}) : []
      await cli.spawnWindow({ program: tool.program, args })
      say(
        `已经装好了 → 打开了登录窗口「${[tool.program, ...args].join(' ')}」：` +
          `在那里完成登录（浏览器授权或输密码都行），完成后点「查状态」确认。`,
      )
    } catch (err) {
      say(`一键设置没走通：${String(err)}`)
    } finally {
      setBusy('')
    }
  }

  /** 只装：跳过登录，直接开安装窗口（已经装过的人不用它，但"重装 / 升级"时有用） */
  const installOnly = async (tool: CliTool) => {
    if (!cli || busy) return
    const cmd = parseArgs(tool.installCommand.trim())
    if (cmd.length === 0) return
    setBusy(`${tool.id}:install`)
    try {
      await cli.spawnWindow({ program: cmd[0], args: cmd.slice(1) })
      setLoginMsg((prev) => ({
        ...prev,
        [tool.id]: `已经打开安装窗口跑「${tool.installCommand}」；装完回来点「检测」确认。`,
      }))
    } catch (err) {
      setLoginMsg((prev) => ({ ...prev, [tool.id]: `打不开安装窗口：${String(err)}` }))
    } finally {
      setBusy('')
    }
  }

  /**
   * 用密钥登录。两条落点（见 `CliTool.keyLoginKind`）：
   *
   * - `'stdin'`：把密钥喂给那条命令的 stdin（不进 argv、不进日志、用完即清）；
   * - `'config'`：**由壳写该工具自己的配置文件**（RunningHub 那条路的落点）——
   *   官方 CLI 的 `rh auth set-key <KEY>` 要位置参数，而本机约定是"密钥不进 argv"，
   *   所以壳直接写它认的 `%APPDATA%\rh\config.toml`，写完**当场用「查状态」验一次**
   *   （用户 2026-10-08 第 3 条要的是"按钮的功能要确实要生效"）。
   */
  const loginWithKey = async (tool: CliTool) => {
    const secret = (keys[tool.id] ?? '').trim()
    if (!cli || busy || !secret) return

    if (tool.keyLoginKind === 'config') {
      if (!cli.rhSetApiKey) return
      setBusy(`${tool.id}:key`)
      let written = ''
      try {
        written = await cli.rhSetApiKey(secret)
        setKeys((prev) => ({ ...prev, [tool.id]: '' }))
        setLoginMsg((prev) => ({
          ...prev,
          [tool.id]: `Key 已写入 ${written}（与手敲 \`rh auth set-key\` 等效，密钥没有进命令行）——下面立刻查一次状态。`,
        }))
      } catch (err) {
        setLoginMsg((prev) => ({ ...prev, [tool.id]: `写配置失败：${String(err)}` }))
      } finally {
        setBusy('')
      }
      /* `runInto` 自带 busy 门，所以这一句必须等上面释放了再调 */
      if (written) await runInto(tool, 'status', buildArgs(tool.statusArgs, {}))
      return
    }

    const args = buildArgs(tool.keyLoginArgs, {})
    setKeys((prev) => ({ ...prev, [tool.id]: '' }))
    await runInto(tool, 'status', args, `${secret}\n`)
  }

  const hasLocalCli = cli !== undefined

  return (
    <div className={styles.panel} data-cli-panel>
      {/*
        用户 2026-10-08 第 3 条：「cli 面板那边的介绍内容太多了，用户是不会去看的，
        反而影响排版，不需要文字介绍，只需要按钮」。
        于是这一段**只剩标题 + 一句"只在桌面应用可用"的状态说明**（那是状态，不是介绍）：
        原来的两段导语（"这里配的是你本机装着的命令行工具…" / "每张卡的顺序就是你要做的事…"）
        与每张卡的 `note` 全部删掉 —— 每一步该做什么已经写在按钮上。
      */}
      <section className={styles.block}>
        <h3 className={styles.title}>本机 CLI</h3>
        {!hasLocalCli && (
          <p className={styles.notice} data-cli-desktop-only>
            本机 CLI 只在桌面应用里可用（浏览器打不开子进程）。这里的配置照旧能改、能存，
            换到桌面版就生效。
          </p>
        )}
      </section>

      {tools.map((tool) => (
        <section className={styles.card} key={tool.id} data-cli-tool={tool.id}>
          <header className={styles.cardHead}>
            {/*
              原来这里有一行小字（`tool.note`）介绍这个工具是什么 —— 用户 2026-10-08：
              「不需要文字介绍，只需要按钮」。文字改成**悬停提示**：信息还在，
              但不再占版面（卡片上只剩名称 / 能力小标 / 文档链接 / 按钮）。
            */}
            <span className={styles.cardName} title={tool.note}>
              {tool.name}
            </span>
            <span className={styles.caps}>
              {capabilitiesOfTool(tool).map((cap) => (
                <span className={styles.cap} key={cap}>
                  {capabilityLabel(cap)}
                </span>
              ))}
            </span>
            {tool.docUrl && (
              <a className={styles.link} href={tool.docUrl} target="_blank" rel="noreferrer">
                文档
              </a>
            )}
          </header>
          {/* ⓿ 一键设置：装 + 登录（第 14 批第 3 条） */}
          <div className={styles.row}>
            <button
              type="button"
              className={`${styles.btn} ${styles.primary}`}
              data-cli-setup={tool.id}
              disabled={!hasLocalCli || busy !== ''}
              onClick={() => void oneClickSetup(tool)}
            >
              一键设置（安装 + 登录）
            </button>
          </div>

          {/* ① 装没装 */}
          <div className={styles.row}>
            <button
              type="button"
              className={styles.btn}
              data-cli-detect={tool.id}
              disabled={!hasLocalCli || busy !== ''}
              onClick={() => void detect(tool)}
            >
              检测
            </button>
            {tool.installCommand.trim() !== '' && (
              <button
                type="button"
                className={styles.btn}
                data-cli-install={tool.id}
                disabled={!hasLocalCli || busy !== ''}
                onClick={() => void installOnly(tool)}
              >
                一键安装（打开窗口）
              </button>
            )}
            {probes[tool.id] && (
              <span className={styles.result} data-cli-probe={tool.id}>
                {probes[tool.id]}
              </span>
            )}
          </div>
          {probes[tool.id] === '没找到' && (
            <p className={styles.hint} data-cli-install-hint={tool.id}>
              {tool.installHint}
            </p>
          )}

          {/* ② 登录 */}
          {/*
            **参考图一那种"说明框 + 主按钮"**（用户 2026-10-08 给的参考）：
            框里只有一行「怎么登录」（`loginHint`），主按钮就在它下面；次要动作留在框外。
            这次刻意的例外：登录方式**留在版面上**（不像 `note` 那样收成悬停提示）——
            它直接决定用户按哪个按钮，而参考图也把它摆在最显眼处。
          */}
          <div className={styles.loginBox} data-cli-login-box={tool.id}>
            <p className={styles.loginHint} data-cli-login-hint={tool.id}>
              {tool.loginHint}
            </p>
            <div className={styles.row}>
              {/*
                「打开窗口登录」只对**真有交互式登录**的工具摆出来。

                用户 2026-10-08 第 3 条：「按钮的功能要确实要生效」——
                RunningHub 的官方 CLI 没有登录子命令（`rh` 不带参数只打印帮助），
                它的登录只能靠写配置文件（`keyLoginKind === 'config'`），
                所以这里**不给一个按下去只会弹帮助的按钮**。
              */}
              {(tool.loginArgs.trim() !== '' || tool.keyLoginKind !== 'config') && (
                <button
                  type="button"
                  className={tool.keyLoginKind === 'config' ? styles.btn : `${styles.btn} ${styles.primary}`}
                  data-cli-login={tool.id}
                  disabled={!hasLocalCli || busy !== ''}
                  onClick={() => void openLogin(tool)}
                >
                  一键登录（打开窗口）
                </button>
              )}
              {/* 密钥登录那一格：`stdin` 与 `config` 两种落点都要摆出输入框（见 `loginWithKey`） */}
              {tool.keyLoginKind !== '' && (
                <>
                  <input
                    className={styles.input}
                    type="password"
                    placeholder={
                      tool.keyLoginKind === 'config'
                        ? '粘贴 API Key（写进这个工具自己的配置）'
                        : '粘贴密钥（走 stdin，不落库）'
                    }
                    data-cli-key={tool.id}
                    value={keys[tool.id] ?? ''}
                    onChange={(e) => setKeys((prev) => ({ ...prev, [tool.id]: e.target.value }))}
                  />
                  <button
                    type="button"
                    className={
                      tool.keyLoginKind === 'config' ? `${styles.btn} ${styles.primary}` : styles.btn
                    }
                    data-cli-key-login={tool.id}
                    disabled={!hasLocalCli || busy !== '' || !(keys[tool.id] ?? '').trim()}
                    onClick={() => void loginWithKey(tool)}
                  >
                    用密钥登录
                  </button>
                </>
              )}
            </div>
          </div>
          {loginMsg[tool.id] && (
            <p className={styles.result} data-cli-login-msg={tool.id}>
              {loginMsg[tool.id]}
            </p>
          )}

          {/* ③ 查状态 / 额度 */}
          <div className={styles.row}>
            <button
              type="button"
              className={styles.btn}
              data-cli-status={tool.id}
              disabled={!hasLocalCli || busy !== '' || tool.statusArgs.trim() === ''}
              onClick={() => void runInto(tool, 'status', buildArgs(tool.statusArgs, {}))}
            >
              查状态 / 额度
            </button>
            {tool.statusArgs.trim() === '' && (
              <span className={styles.result} data-cli-status-none={tool.id}>
                这个工具没有可查的命令
              </span>
            )}
          </div>
          <p className={styles.hint} data-cli-quota-where={tool.id}>
            {tool.quotaWhere}
          </p>
          {statusOut[tool.id] && (
            <pre className={styles.output} data-cli-statusout={tool.id}>
              {statusOut[tool.id]}
            </pre>
          )}

          {/* ④ 高级 */}
          <details className={styles.advanced} data-cli-advanced={tool.id}>
            <summary className={styles.summary}>高级（命令与参数）</summary>
            <div className={styles.grid}>
              <label className={styles.field}>
                <span className={styles.label}>命令名或完整路径</span>
                <input
                  className={styles.input}
                  data-cli-program={tool.id}
                  value={tool.program}
                  spellCheck={false}
                  onChange={(e) => patchTool(tool.id, { program: e.target.value })}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>超时（秒）</span>
                <input
                  className={styles.input}
                  type="number"
                  min={1}
                  max={1800}
                  data-cli-timeout={tool.id}
                  value={Math.round(tool.timeoutMs / 1000)}
                  onChange={(e) =>
                    patchTool(tool.id, {
                      timeoutMs: clampToolTimeout(Number(e.target.value) * 1000, tool.timeoutMs),
                    })
                  }
                />
              </label>
            </div>
            <label className={styles.field}>
              <span className={styles.label}>参数模板（生成 / 对话用）</span>
              <input
                className={styles.input}
                data-cli-args={tool.id}
                value={tool.argsTemplate}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { argsTemplate: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>查状态命令（留空 = 这个工具没有）</span>
              <input
                className={styles.input}
                data-cli-status-args={tool.id}
                value={tool.statusArgs}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { statusArgs: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>登录窗口命令（留空 = 直接运行它自己）</span>
              <input
                className={styles.input}
                data-cli-login-args={tool.id}
                value={tool.loginArgs}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { loginArgs: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>密钥登录命令（留空 = 不支持密钥登录）</span>
              <input
                className={styles.input}
                data-cli-key-args={tool.id}
                value={tool.keyLoginArgs}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { keyLoginArgs: e.target.value })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>安装命令（留空 = 没有能自动装的途径）</span>
              <input
                className={styles.input}
                data-cli-install-args={tool.id}
                placeholder="例如 npm install -g 包名"
                value={tool.installCommand}
                spellCheck={false}
                onChange={(e) => patchTool(tool.id, { installCommand: e.target.value })}
              />
            </label>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.btn}
                data-cli-run={tool.id}
                disabled={!hasLocalCli || busy !== ''}
                onClick={() =>
                  void runInto(tool, 'run', buildArgs(tool.argsTemplate, { prompt: TEST_PROMPT }))
                }
              >
                测试运行
              </button>
            </div>
            {runs[tool.id] && (
              <pre className={styles.output} data-cli-runout={tool.id}>
                {runs[tool.id]}
              </pre>
            )}
          </details>
        </section>
      ))}
    </div>
  )
}

/** 「测试运行」喂给 `{prompt}` 的那句话 */
const TEST_PROMPT = '用一句话介绍你自己'
/** 输出贴回来的上限：CLI 可能吐几百行，界面只留尾部 */
const OUTPUT_TAIL = 2_000

function tail(text: string): string {
  return text.length <= OUTPUT_TAIL
    ? text
    : `…（前 ${text.length - OUTPUT_TAIL} 字已省略）\n${text.slice(-OUTPUT_TAIL)}`
}

function describeOutcome(out: CliOutcome): string {
  if (out.cancelled) return `已取消 · ${out.ms}ms`
  if (out.timedOut) return `超时（${out.ms}ms）：已经掐掉它`
  if (out.code === 0) return `退出码 0（成功）· ${out.ms}ms`
  return `退出码 ${out.code ?? '（系统没给）'} · ${out.ms}ms`
}

/**
 * 一次运行的结果块。
 *
 * `stderr` 单独一段：很多 CLI 把**有效信息**（例如 `codex login status` 的
 * 「Logged in using an API key - ***」）打在 stderr 上 —— 只看 stdout 会误判成"什么都没输出"。
 */
function describeRun(head: string, out: CliOutcome): string {
  return [
    head,
    describeOutcome(out),
    out.stdout.trim() ? `— 输出 —\n${tail(out.stdout)}` : '',
    out.stderr.trim() ? `— stderr —\n${tail(out.stderr)}` : '',
    !out.stdout.trim() && !out.stderr.trim() ? '（没有任何输出）' : '',
  ]
    .filter(Boolean)
    .join('\n')
}
