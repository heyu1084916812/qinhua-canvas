/**
 * 全局冒烟矩阵：每个组使用独立 LOCALAPPDATA/shared-store，避免组间数据污染。
 *
 * 用法：
 *   node scripts/smoke-matrix.mjs
 *   node scripts/smoke-matrix.mjs --start 0 --end 40
 *   node scripts/smoke-matrix.mjs g55 g95 g116
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SMOKE = path.join(ROOT, 'scripts/smoke.mjs')
const STORE_EXE = path.join(ROOT, 'shared-store/target/debug/qinghua-store.exe')
const OUT_ROOT = path.join(ROOT, '.playwright-verify/smoke-matrix')
const RUN = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const RUN_ROOT = path.join(OUT_ROOT, RUN)
const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:1420'
const STORE_TIMEOUT_MS = Number(process.env.SMOKE_MATRIX_STORE_TIMEOUT_MS ?? 20_000)
const GROUP_TIMEOUT_MS = Number(process.env.SMOKE_MATRIX_GROUP_TIMEOUT_MS ?? 300_000)

if (!existsSync(STORE_EXE)) {
  console.error(`找不到 store: ${STORE_EXE}`)
  process.exit(1)
}

const smokeSource = readFileSync(SMOKE, 'utf8')
const allGroupsMatch = smokeSource.match(/const ALL_GROUPS = \[([^\]]+)\]/)
if (!allGroupsMatch) {
  console.error('无法从 scripts/smoke.mjs 解析 ALL_GROUPS')
  process.exit(1)
}
const allGroups = allGroupsMatch[1]
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)

const args = process.argv.slice(2)
let groups = allGroups
if (args[0] === '--start' || args[0] === '--end') {
  const startIndex = args.includes('--start') ? Number(args[args.indexOf('--start') + 1]) : 0
  const endIndex = args.includes('--end') ? Number(args[args.indexOf('--end') + 1]) : allGroups.length
  groups = allGroups.slice(startIndex, endIndex)
} else if (args.length > 0) {
  const requested = new Set(args)
  groups = allGroups.filter((group) => requested.has(group))
  const unknown = args.filter((group) => !allGroups.includes(group))
  if (unknown.length > 0) {
    console.error(`未知组: ${unknown.join(', ')}`)
    process.exit(1)
  }
}
if (groups.length === 0) {
  console.error('没有可运行的组')
  process.exit(1)
}

mkdirSync(RUN_ROOT, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function killTree(child) {
  if (!child?.pid || child.exitCode !== null) return
  spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
}

async function waitHealth(expectedDir) {
  const deadline = Date.now() + STORE_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      const response = await fetch('http://127.0.0.1:18765/health')
      if (response.ok) {
        const body = await response.json()
        if (
          body.ok === true &&
          body.version >= 5 &&
          path.resolve(String(body.dataDir)) === path.resolve(expectedDir)
        ) {
          return true
        }
      }
    } catch {
      /* store 尚未启动 */
    }
    await sleep(150)
  }
  return false
}

const results = []
const summaryPath = path.join(RUN_ROOT, 'summary.json')
function writeSummary() {
  writeFileSync(summaryPath, JSON.stringify({ groups, results }, null, 2))
}

for (let index = 0; index < groups.length; index += 1) {
  const group = groups[index]
  const groupRoot = path.join(RUN_ROOT, `${String(index).padStart(3, '0')}-${group}`)
  const localAppData = path.join(groupRoot, 'localappdata')
  mkdirSync(localAppData, { recursive: true })
  const expectedStoreDir = path.join(
    localAppData,
    'com.qinghua.canvas',
    'shared-store-v1',
  )
  const storeOut = path.join(groupRoot, 'store.out.log')
  const storeErr = path.join(groupRoot, 'store.err.log')
  const smokeLog = path.join(groupRoot, 'smoke.log')
  const store = spawn(STORE_EXE, [], {
    cwd: ROOT,
    env: { ...process.env, LOCALAPPDATA: localAppData },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const storeOutStream = createWriteStream(storeOut)
  const storeErrStream = createWriteStream(storeErr)
  store.stdout.pipe(storeOutStream)
  store.stderr.pipe(storeErrStream)

  const healthy = await waitHealth(expectedStoreDir)
  if (!healthy) {
    killTree(store)
    results.push({
      group,
      ok: false,
      reason: 'store-start-failed',
      log: smokeLog,
      elapsedMs: 0,
    })
    console.log(`FAIL ${group} store-start-failed`)
    continue
  }

  const startedAt = Date.now()
  const smoke = spawn(process.execPath, [SMOKE], {
    cwd: ROOT,
    env: { ...process.env, SMOKE_ONLY: group, SMOKE_BASE: BASE },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const smokeStream = createWriteStream(smokeLog)
  smoke.stdout.pipe(smokeStream)
  smoke.stderr.pipe(smokeStream)
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    killTree(smoke)
  }, GROUP_TIMEOUT_MS)
  const code = await new Promise((resolve) => {
    smoke.on('exit', (exitCode) => resolve(exitCode))
  })
  clearTimeout(timer)
  await new Promise((resolve) => smokeStream.end(resolve))
  killTree(store)
  await sleep(250)

  const logText = readFileSync(smokeLog, 'utf8')
  const summary = logText.match(/=====\s*(\d+)\s+passed\s*\/\s*(\d+)\s+failed\s*\/\s*(\d+)\s+total\s*=====/)
  const result = {
    group,
    ok: code === 0 && !timedOut,
    code,
    timedOut,
    passed: summary ? Number(summary[1]) : null,
    failed: summary ? Number(summary[2]) : null,
    total: summary ? Number(summary[3]) : null,
    elapsedMs: Date.now() - startedAt,
    log: smokeLog,
    storeDir: expectedStoreDir,
  }
  results.push(result)
  writeSummary()
  console.log(
    `${result.ok ? 'PASS' : 'FAIL'} ${group} ${result.passed ?? '?'} / ${result.failed ?? '?'} / ${result.total ?? '?'} ${Math.round(result.elapsedMs / 1000)}s${timedOut ? ' TIMEOUT' : ''}`,
  )
}

writeSummary()
const failed = results.filter((result) => !result.ok)
console.log(`matrix done: ${results.length - failed.length}/${results.length} groups passed`)
console.log(`summary: ${summaryPath}`)
if (failed.length > 0) {
  console.log(`failed: ${failed.map((result) => result.group).join(', ')}`)
  process.exitCode = 1
}
