import { useEffect, useMemo, useState } from 'react'
import { usePlatform } from '../../app/providers/PlatformProvider'
import {
  buildArgs,
  capabilityLabel,
  capabilitiesOfTool,
  clampToolTimeout,
  defaultCliTools,
  type CliTool,
} from '../../domain/shared/cliTools'
import type { CliOutcome } from '../../platform/ports'
import { createCliToolStore } from '../../state/project/cliToolStore'
import styles from './CliPanel.module.css'

/**
 * 「全局设置 → CLI」面板（用户 2026-10-06 第 11 批第 4 条，对账 #308）。
 *
 * ## 用户口径（原话）
 *
 * - 「CLI 可以单独设置在全局设置里面了，就在渠道配置的下面，重新设计界面，保持整体的风格统一，
 *   当前是在每个渠道的页面里面」；
 * - 「我的要求和目的就是**链接后能用里面的额度调用模型生成图片或者视频，或者对话**，
 *   runninghub 也要，**需要真的能跑本机的 cli**」。
 *
 * ## 这一版**真的能跑**：不是表单摆设
 *
 * - 「检测」→ `CliPort.which`（只看文件在不在，不执行任何东西）；
 * - 「测试运行」→ `CliPort.run`（真起子进程，把退出码 / stdout / stderr 原样贴出来）。
 *
 * 两条都给**如实**结论：找不到就说找不到，退码非零就贴非零，超时就写"已掐掉"。
 *
 * ## 浏览器里怎么办
 *
 * 端口缺席时（浏览器、测试用的内存平台）**界面照旧显示**、配置照旧能改能存
 * —— 这是用户定过的口径（「不管是桌面才可以用的，但是 UI 需要给我显示出来」），
 * 但两个按钮禁用并写明"只在桌面应用里可用"，不假装能跑。
 */
export function CliPanel() {
  const platform = usePlatform()
  const cli = platform.cli
  const store = useMemo(() => createCliToolStore(platform.storage), [platform.storage])

  const [tools, setTools] = useState<CliTool[]>(() => defaultCliTools())
  const [probes, setProbes] = useState<Record<string, string>>({})
  const [runs, setRuns] = useState<Record<string, string>>({})
  /** 正在跑的那件小事（`<toolId>:which` / `<toolId>:run`）；空串 = 空闲 */
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

  /**
   * 改一个字段：**先改内存、再写库**。
   * 反过来的话输入框要等一次异步落库才更新，打字会一顿一顿的。
   */
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
      setProbes((prev) => ({
        ...prev,
        [tool.id]: found
          ? `找到了：${found}`
          : `没找到「${tool.program}」：确认名字，或者改填完整路径（.cmd / .exe 都行）`,
      }))
    } catch (err) {
      setProbes((prev) => ({ ...prev, [tool.id]: `检测失败：${String(err)}` }))
    } finally {
      setBusy('')
    }
  }

  const testRun = async (tool: CliTool) => {
    if (!cli || busy) return
    const args = buildArgs(tool.argsTemplate, { prompt: TEST_PROMPT })
    setBusy(`${tool.id}:run`)
    setRuns((prev) => ({ ...prev, [tool.id]: `$ ${tool.program} ${args.join(' ')}\n…正在跑` }))
    try {
      const out = await cli.run({
        id: `cli-test-${tool.id}`,
        program: tool.program,
        args,
        timeoutMs: tool.timeoutMs,
      })
      const lines = [
        `$ ${tool.program} ${args.join(' ')}`,
        describeOutcome(out),
        out.stdout.trim() ? `— 输出 —\n${tail(out.stdout)}` : '',
        out.stderr.trim() ? `— 错误输出 —\n${tail(out.stderr)}` : '',
      ].filter(Boolean)
      setRuns((prev) => ({ ...prev, [tool.id]: lines.join('\n') }))
    } catch (err) {
      setRuns((prev) => ({ ...prev, [tool.id]: `跑不起来：${String(err)}` }))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className={styles.panel} data-cli-panel>
      <section className={styles.block}>
        <h3 className={styles.title}>本机 CLI</h3>
        <p className={styles.desc}>
          这里配的是你本机已经装好的命令行工具：轻画负责把它跑起来、把输出原样给你看，
          花的是你自己那份额度。命令不经过 shell（参数是一个数组），
          所以提示词里带引号、分号、$ 都不会被当成别的命令。
        </p>
        <p className={styles.desc}>
          填好后先点「检测」（只看命令在不在），再点「测试运行」（真跑一条命令看输出）。
          参数模板里可以写占位符：<code className={styles.code}>{'{prompt}'}</code>
          <code className={styles.code}>{'{out}'}</code>
          <code className={styles.code}>{'{model}'}</code>
          <code className={styles.code}>{'{workflow}'}</code>
          ，跑之前会被换掉；没给值的占位符原样留着，好在输出里一眼看出缺什么。
        </p>
        {!cli && (
          <p className={styles.notice} data-cli-desktop-only>
            本机 CLI 只在桌面应用里可用（浏览器打不开子进程）。这里的配置照旧能改、能存，
            换到桌面版就生效。
          </p>
        )}
      </section>

      {tools.map((tool) => (
        <section className={styles.card} key={tool.id} data-cli-tool={tool.id}>
          <header className={styles.cardHead}>
            <span className={styles.cardName}>{tool.name}</span>
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
          <p className={styles.note}>{tool.note}</p>

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
            <span className={styles.label}>参数模板</span>
            <input
              className={styles.input}
              data-cli-args={tool.id}
              value={tool.argsTemplate}
              spellCheck={false}
              onChange={(e) => patchTool(tool.id, { argsTemplate: e.target.value })}
            />
          </label>

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btn}
              data-cli-detect={tool.id}
              disabled={!cli || busy !== ''}
              onClick={() => void detect(tool)}
            >
              检测
            </button>
            <button
              type="button"
              className={styles.btn}
              data-cli-run={tool.id}
              disabled={!cli || busy !== ''}
              onClick={() => void testRun(tool)}
            >
              测试运行
            </button>
          </div>

          {probes[tool.id] && (
            <p className={styles.result} data-cli-probe={tool.id}>
              {probes[tool.id]}
            </p>
          )}
          {runs[tool.id] && (
            <pre className={styles.output} data-cli-runout={tool.id}>
              {runs[tool.id]}
            </pre>
          )}
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
  return text.length <= OUTPUT_TAIL ? text : `…（前 ${text.length - OUTPUT_TAIL} 字已省略）\n${text.slice(-OUTPUT_TAIL)}`
}

function describeOutcome(out: CliOutcome): string {
  if (out.cancelled) return `已取消 · ${out.ms}ms`
  if (out.timedOut) return `超时（${out.ms}ms）：已经掐掉它`
  if (out.code === 0) return `退出码 0（成功）· ${out.ms}ms`
  return `退出码 ${out.code ?? '（系统没给）'} · ${out.ms}ms`
}
