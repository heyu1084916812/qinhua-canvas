import { describe, expect, it } from 'vitest'
import {
  CLI_MAX_TIMEOUT_MS,
  CLI_MIN_TIMEOUT_MS,
  buildArgs,
  clampToolTimeout,
  defaultCliTools,
  fillArgs,
  mergeTools,
  parseArgs,
  toolPatchOf,
} from './cliTools'

describe('CLI 参数模板', () => {
  it('按空格切词，引号里的空格不算分隔', () => {
    expect(parseArgs('exec --prompt a b')).toEqual(['exec', '--prompt', 'a', 'b'])
    expect(parseArgs('generate --prompt "两 个 词" --out x')).toEqual([
      'generate',
      '--prompt',
      '两 个 词',
      '--out',
      'x',
    ])
    expect(parseArgs("--model 'a b'")).toEqual(['--model', 'a b'])
  })

  it('纯空白不产生 token，但显式空引号算一个空 token', () => {
    expect(parseArgs('   ')).toEqual([])
    expect(parseArgs('run ""')).toEqual(['run', ''])
  })

  it('替换占位符；没有值的原样留着（不静默变空串）', () => {
    const tokens = parseArgs('run --prompt {prompt} --out {out} --model {model}')
    expect(fillArgs(tokens, { prompt: '一只猫', out: 'D:/a.png' })).toEqual([
      'run',
      '--prompt',
      '一只猫',
      '--out',
      'D:/a.png',
      '--model',
      '{model}',
    ])
  })

  it('提示词里的 $ 不会被当成替换语法（值原样进去）', () => {
    expect(buildArgs('exec {prompt}', { prompt: '价格 $100 与 $& 符号' })).toEqual([
      'exec',
      '价格 $100 与 $& 符号',
    ])
  })

  it('同一个占位符出现两次都会被替换', () => {
    expect(buildArgs('{prompt} --retry {prompt}', { prompt: 'hi' })).toEqual(['hi', '--retry', 'hi'])
  })
})

describe('CLI 工具配置的归一化', () => {
  it('超时夹在 [1s, 30min]，给不出数字回落默认', () => {
    expect(clampToolTimeout(undefined, 5_000)).toBe(5_000)
    expect(clampToolTimeout('3000', 5_000)).toBe(5_000)
    expect(clampToolTimeout(Number.NaN, 5_000)).toBe(5_000)
    expect(clampToolTimeout(0, 5_000)).toBe(CLI_MIN_TIMEOUT_MS)
    expect(clampToolTimeout(CLI_MAX_TIMEOUT_MS + 1, 5_000)).toBe(CLI_MAX_TIMEOUT_MS)
    expect(clampToolTimeout(12_345.6, 5_000)).toBe(12_346)
  })

  it('默认四个工具都在，且 id 不重复', () => {
    const tools = defaultCliTools()
    expect(tools.map((t) => t.id)).toEqual(['codex', 'jimeng', 'gemini', 'runninghub'])
    expect(new Set(tools.map((t) => t.id)).size).toBe(tools.length)
    // 用户点名的改名：GPT CLI → Codex
    expect(tools.find((t) => t.id === 'codex')?.name).toBe('Codex')
  })

  it('库里只覆盖"用户改得动"的字段，其余跟代码走', () => {
    const tools = mergeTools({
      tools: [{ id: 'codex', program: 'D:/tools/codex.cmd', argsTemplate: 'run {prompt}' }],
    })
    const codex = tools.find((t) => t.id === 'codex')
    expect(codex?.program).toBe('D:/tools/codex.cmd')
    expect(codex?.argsTemplate).toBe('run {prompt}')
    // 没存过的字段：默认值原样
    expect(codex?.timeoutMs).toBe(defaultCliTools()[0]?.timeoutMs)
    expect(codex?.name).toBe('Codex')
    // 没被改过的其它工具也在（目录以代码为准）
    expect(tools.find((t) => t.id === 'runninghub')?.program).toBe('runninghub')
  })

  it('坏值回落默认，认不出的 id 直接丢掉', () => {
    const tools = mergeTools({
      tools: [
        { id: 'codex', program: '   ', argsTemplate: 42, timeoutMs: -5 },
        { id: 'gone-tool', program: 'x' },
        'not-an-object',
      ],
    })
    const codex = tools.find((t) => t.id === 'codex')
    expect(codex?.program).toBe('codex')
    expect(codex?.argsTemplate).toBe('exec {prompt}')
    expect(codex?.timeoutMs).toBe(CLI_MIN_TIMEOUT_MS)
    expect(tools).toHaveLength(defaultCliTools().length)
  })

  it('读不懂的行（null / 字符串 / 缺 tools）等价于"全默认"', () => {
    for (const row of [null, undefined, 'nope', {}, { tools: 'x' }]) {
      expect(mergeTools(row)).toEqual(defaultCliTools())
    }
  })

  it('写库只写三个字段（别的不许落盘，免得下一次升级被旧值钉住）', () => {
    const tool = defaultCliTools()[0]!
    expect(Object.keys(toolPatchOf(tool)).sort()).toEqual([
      'argsTemplate',
      'id',
      'program',
      'timeoutMs',
    ])
  })
})
