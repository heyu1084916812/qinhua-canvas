/**
 * Real Tauri UI-freeze geometry gate.
 *
 * This script intentionally talks to the page-level WebView2 CDP target instead
 * of Playwright's connectOverCDP. WebView2 exposes shared-worker targets that
 * have previously triggered an internal Playwright assertion on this project.
 *
 * Usage:
 *   node scripts/check-tauri-ui-freeze.mjs
 *   node scripts/check-tauri-ui-freeze.mjs --launch
 *
 * The default mode only attaches to an already-running app. `--launch`
 * temporarily starts the debug desktop shell, requiring Vite on :1420.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = path.resolve(import.meta.dirname, '..')
const PORT = Number(process.env.QH_CDP_PORT ?? 9339)
const ENDPOINT = `http://127.0.0.1:${PORT}`
const DEV_URL = 'http://127.0.0.1:1420'
const OUT_DIR = path.join(
  os.tmpdir(),
  'qinghua-ui-freeze-geometry',
  new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19),
)
const EXPECTED_REAL = { width: 1440, height: 900, dpr: 1 }
const AUXILIARY_VIEWPORTS = [
  { width: 1024, height: 700 },
  { width: 1178, height: 762 },
]
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function formatRect(rect) {
  if (!rect) return 'missing'
  return `${rect.x.toFixed(1)},${rect.y.toFixed(1)} ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`
}

function compareExpected(result) {
  const problems = []
  if (Math.abs(result.viewport.width - EXPECTED_REAL.width) > 1) {
    problems.push(`innerWidth=${result.viewport.width}，期望 ${EXPECTED_REAL.width}`)
  }
  if (Math.abs(result.viewport.height - EXPECTED_REAL.height) > 1) {
    problems.push(`innerHeight=${result.viewport.height}，期望 ${EXPECTED_REAL.height}`)
  }
  if (Math.abs(result.viewport.dpr - EXPECTED_REAL.dpr) > 0.01) {
    problems.push(`DPR=${result.viewport.dpr}，期望 ${EXPECTED_REAL.dpr}`)
  }
  if (!result.isTauri) problems.push('当前 CDP 页面不是真实 Tauri WebView')
  if (!result.sidebar) problems.push('缺少 [data-app-sidebar]')
  if (!result.projectTree) problems.push('缺少 [data-sidebar-project-tree]')
  if (!result.settings) problems.push('缺少 [data-sidebar-settings]')
  if (
    result.sidebar &&
    result.projectTree &&
    result.settings &&
    !(result.projectTree.bottom < result.settings.top)
  ) {
    problems.push(
      `项目树 bottom=${result.projectTree.bottom.toFixed(1)} 未小于设置区 top=${result.settings.top.toFixed(1)}`,
    )
  }
  if (result.horizontalOverflow > 0) {
    problems.push(`页面横向溢出 ${result.horizontalOverflow}px`)
  }
  if (!result.projectTree?.contentFullyAccessible) {
    problems.push('项目树滚动到底后仍有内容无法完整访问')
  }
  if (result.projectTree?.projectRows === 0) {
    problems.push('项目树没有项目行，无法证明真实内容可访问')
  }
  return problems
}

function summarizeAuxiliary(result) {
  const problems = []
  if (!result.projectTree || !result.settings) {
    problems.push('辅助视口缺少项目树或设置区')
    return problems
  }
  if (!(result.projectTree.bottom < result.settings.top)) {
    problems.push(
      `项目树 bottom=${result.projectTree.bottom.toFixed(1)} 未小于设置区 top=${result.settings.top.toFixed(1)}`,
    )
  }
  if (result.horizontalOverflow > 0) problems.push(`横向溢出 ${result.horizontalOverflow}px`)
  if (!result.projectTree.contentFullyAccessible) problems.push('项目树内容不可完整访问')
  return problems
}

export function evaluateGate(real, auxiliary = []) {
  const realProblems = compareExpected(real)
  const auxiliaryProblems = auxiliary.map((item) => ({
    viewport: item.viewport,
    problems: summarizeAuxiliary(item),
  }))
  return {
    ok: realProblems.length === 0,
    realProblems,
    auxiliaryProblems,
  }
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exitCode = 1
}

async function fetchJson(url, timeoutMs = 1500) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

async function waitForCdp(timeoutMs, child = null) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (child && child.exitCode !== null) return null
    try {
      return await fetchJson(`${ENDPOINT}/json/version`, 1000)
    } catch {
      await sleep(300)
    }
  }
  return null
}

async function ensureDevServer() {
  try {
    const response = await fetch(DEV_URL, { signal: AbortSignal.timeout(10_000) })
    await response.text()
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
  } catch (error) {
    throw new Error(
      `--launch 使用调试版桌面壳，需要 Vite 已在 ${DEV_URL} 运行。请先执行 npm run dev:vite。` +
        `\n探测失败：${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function defaultExe() {
  if (process.env.QH_APP_EXE) return path.resolve(process.env.QH_APP_EXE)
  const debugExe = path.join(ROOT, 'src-tauri', 'target', 'debug', 'qinghua.exe')
  if (existsSync(debugExe)) return debugExe
  const releaseExe = path.join(ROOT, 'src-tauri', 'target', 'release', 'qinghua.exe')
  if (existsSync(releaseExe)) return releaseExe
  return null
}

async function maybeLaunch(shouldLaunch) {
  if (!shouldLaunch) return null
  const exe = defaultExe()
  if (!exe || !existsSync(exe)) {
    throw new Error('找不到桌面壳可执行文件；可用 QH_APP_EXE 指定 qinghua.exe。')
  }
  if (exe.includes(`${path.sep}debug${path.sep}`)) await ensureDevServer()
  const logPath = path.join(OUT_DIR, 'desktop-app.log')
  const log = []
  const child = spawn(exe, [], {
    cwd: path.dirname(exe),
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => log.push(String(chunk)))
  child.stderr.on('data', (chunk) => log.push(String(chunk)))
  child.on('exit', (code) => log.push(`[exit] ${code ?? 'signal'}\n`))
  const version = await waitForCdp(60_000, child)
  writeFileSync(logPath, log.join(''), 'utf8')
  if (!version) {
    killTree(child)
    if (child.exitCode !== null) {
      throw new Error(
        `桌面壳在开放 CDP ${ENDPOINT} 前退出（code=${child.exitCode}）。` +
          '\n如果界面上已经有轻画窗口，请先完全退出旧实例再重试；Tauri 单实例会把新进程转交给旧窗口。' +
          `\n启动日志：${logPath}`,
      )
    }
    throw new Error(
      `桌面壳已启动但 60 秒内没有开放 CDP ${ENDPOINT}。启动日志：${logPath}`,
    )
  }
  console.log(`临时桌面壳 PID=${child.pid}，调试端口 ${PORT}`)
  return { child, logPath }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      child.kill('SIGTERM')
    }
  } catch {
    child.kill()
  }
}

async function pickPageTarget() {
  const targets = await fetchJson(`${ENDPOINT}/json/list`)
  const pages = targets.filter(
    (target) => target.type === 'page' && target.webSocketDebuggerUrl,
  )
  return (
    pages.find((target) => target.url.startsWith('http://tauri.localhost')) ??
    pages.find((target) => target.url.startsWith(DEV_URL)) ??
    pages[0] ??
    null
  )
}

class CdpSession {
  constructor(target) {
    this.socket = new WebSocket(target.webSocketDebuggerUrl)
    this.nextId = 0
    this.pending = new Map()
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const entry = this.pending.get(message.id)
      if (!entry) return
      this.pending.delete(message.id)
      if (message.error) entry.reject(new Error(message.error.message))
      else entry.resolve(message.result)
    })
    this.socket.addEventListener('close', () => {
      for (const entry of this.pending.values()) {
        entry.reject(new Error('CDP socket closed'))
      }
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    const id = ++this.nextId
    this.socket.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text ?? 'Runtime.evaluate failed')
    }
    return response.result?.value
  }

  close() {
    this.socket.close()
  }
}

async function waitForShell(session, timeoutMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const ready = await session
      .evaluate(
        `Boolean(
          document.querySelector('[data-app-sidebar]') &&
          document.querySelector('[data-sidebar-project-tree]') &&
          document.querySelector('[data-sidebar-settings]')
        )`,
      )
      .catch(() => false)
    if (ready) return
    await sleep(200)
  }
  throw new Error('真实 Tauri 页面已连接，但侧栏 / 项目树 / 设置区在 20 秒内没有就绪')
}

async function readGeometry(session) {
  return session.evaluate(`(() => {
    const rectOf = (element) => {
      if (!element) return null
      const rect = element.getBoundingClientRect()
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      }
    }
    const sidebar = document.querySelector('[data-app-sidebar]')
    const tree = document.querySelector('[data-sidebar-project-tree]')
    const settings = document.querySelector('[data-sidebar-settings]')
    const doc = document.documentElement
    const body = document.body
    const overflow = Math.max(
      0,
      doc.scrollWidth - doc.clientWidth,
      body ? body.scrollWidth - body.clientWidth : 0,
    )
    let treeScroll = null
    if (tree) {
      treeScroll =
        Array.from(tree.querySelectorAll('*'))
          .filter((element) => {
            const overflowY = getComputedStyle(element).overflowY
            return (
              (overflowY === 'auto' || overflowY === 'scroll') &&
              element.clientHeight > 0
            )
          })
          .sort((left, right) => right.clientHeight - left.clientHeight)[0] ?? null
    }
    let contentFullyAccessible = true
    let scrollMetrics = null
    if (treeScroll) {
      const previous = treeScroll.scrollTop
      const maxScrollTop = Math.max(0, treeScroll.scrollHeight - treeScroll.clientHeight)
      treeScroll.scrollTop = maxScrollTop
      const scrollRect = treeScroll.getBoundingClientRect()
      const contentChildren = Array.from(treeScroll.querySelectorAll('*')).filter(
        (element) => element.getBoundingClientRect().height > 0,
      )
      const lastBottom = contentChildren.reduce(
        (bottom, element) => Math.max(bottom, element.getBoundingClientRect().bottom),
        scrollRect.top,
      )
      contentFullyAccessible =
        treeScroll.scrollHeight <= treeScroll.clientHeight + 1 ||
        (maxScrollTop > 0 && lastBottom <= scrollRect.bottom + 1)
      scrollMetrics = {
        clientHeight: treeScroll.clientHeight,
        scrollHeight: treeScroll.scrollHeight,
        scrollTop: treeScroll.scrollTop,
        maxScrollTop,
        lastContentBottom: lastBottom,
        viewportBottom: scrollRect.bottom,
        reachedMax: Math.abs(treeScroll.scrollTop - maxScrollTop) <= 1,
      }
      treeScroll.scrollTop = previous
    }
    return {
      url: location.href,
      isTauri:
        Boolean(window.__TAURI_INTERNALS__) ||
        document.documentElement.dataset.platform === 'desktop',
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      },
      sidebar: rectOf(sidebar),
      projectTree: tree
        ? {
            ...rectOf(tree),
            clientHeight: tree.clientHeight,
            scrollHeight: tree.scrollHeight,
            projectRows: tree.querySelectorAll('[data-project-tree-item]').length,
            groupRows: tree.querySelectorAll('[data-project-tree-group]').length,
            scrollMetrics,
            contentFullyAccessible,
          }
        : null,
      settings: rectOf(settings),
      horizontalOverflow: overflow,
      sidebarOpen: sidebar?.getAttribute('data-sidebar-open') ?? null,
    }
  })()`)
}

async function captureScreenshot(session, filename) {
  const result = await session.send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const target = path.join(OUT_DIR, filename)
  writeFileSync(target, Buffer.from(result.data, 'base64'))
  return target
}

async function emulateViewport(session, viewport) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  })
  await sleep(400)
}

async function clearViewportOverride(session) {
  await session.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
}

function report(result, gate, screenshots) {
  console.log('\n真实 Tauri WebView')
  console.log(
    `  viewport ${result.viewport.width}x${result.viewport.height} @ DPR ${result.viewport.dpr}`,
  )
  console.log(`  侧栏     ${formatRect(result.sidebar)}`)
  console.log(`  项目树   ${formatRect(result.projectTree)}`)
  console.log(`  设置区   ${formatRect(result.settings)}`)
  if (result.projectTree?.scrollMetrics) {
    const metrics = result.projectTree.scrollMetrics
    console.log(
      `  项目树滚动区 client=${metrics.clientHeight} scroll=${metrics.scrollHeight} max=${metrics.maxScrollTop} 最后内容 bottom=${metrics.lastContentBottom.toFixed(1)} viewport bottom=${metrics.viewportBottom.toFixed(1)}`,
    )
  }
  console.log(`  横向溢出 ${result.horizontalOverflow}px`)
  console.log(`  project rows=${result.projectTree?.projectRows ?? 0}`)
  console.log(`  真实门禁 ${gate.realProblems.length === 0 ? '通过' : '失败'}`)
  for (const problem of gate.realProblems) console.log(`    - ${problem}`)
  for (const item of gate.auxiliaryProblems) {
    console.log(
      `辅助 ${item.viewport.width}x${item.viewport.height}: ${item.problems.length === 0 ? '通过' : '失败'}`,
    )
    for (const problem of item.problems) console.log(`    - ${problem}`)
  }
  console.log(`截图目录 ${OUT_DIR}`)
  for (const screenshot of screenshots) console.log(`  ${screenshot}`)
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const shouldLaunch = process.argv.includes('--launch')
  let launched = null
  let session = null
  let artifactsCreated = false
  try {
    const existingVersion = await waitForCdp(500)
    if (!existingVersion && !shouldLaunch) {
      return fail(
        `无法连接真实 Tauri WebView 的 CDP：${ENDPOINT}\n` +
          `请先用带 --remote-debugging-port=${PORT} 的桌面调试壳启动，或运行：\n` +
          `  npm run dev:vite\n  node scripts/check-tauri-ui-freeze.mjs --launch\n` +
          '脚本默认不会自动拉起应用，避免误连普通浏览器。',
      )
    }
    launched = await maybeLaunch(shouldLaunch)
    if (!(await waitForCdp(3_000))) {
      return fail(
        `找不到 CDP 目标 ${ENDPOINT}。若应用已开但未加 --remote-debugging-port=${PORT}，请重启。`,
      )
    }
    const target = await pickPageTarget()
    if (!target) {
      return fail(
        `CDP ${ENDPOINT} 已开放，但没有 page 目标。请确认启动的是 Tauri app，而不是普通浏览器页面。`,
      )
    }
    session = new CdpSession(target)
    await session.open()
    await session.send('Page.enable')
    await session.send('Runtime.enable')
    await waitForShell(session)
    await sleep(500)

    const real = await readGeometry(session)
    const screenshots = [await captureScreenshot(session, 'real-tauri-1440x900.png')]
    artifactsCreated = true
    const auxiliary = []
    for (const viewport of AUXILIARY_VIEWPORTS) {
      await emulateViewport(session, viewport)
      const geometry = await readGeometry(session)
      auxiliary.push(geometry)
      screenshots.push(
        await captureScreenshot(
          session,
          `auxiliary-${viewport.width}x${viewport.height}.png`,
        ),
      )
    }
    await clearViewportOverride(session)
    const gate = evaluateGate(real, auxiliary)
    const reportData = {
      generatedAt: new Date().toISOString(),
      endpoint: ENDPOINT,
      expectedReal: EXPECTED_REAL,
      real,
      auxiliary,
      gate,
      screenshots,
      note: '1024x700 and 1178x762 use CDP emulation and are advisory only.',
    }
    writeFileSync(path.join(OUT_DIR, 'report.json'), JSON.stringify(reportData, null, 2))
    report(real, gate, screenshots)
    console.log(`报告 ${path.join(OUT_DIR, 'report.json')}`)
    if (!gate.ok) process.exitCode = 1
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  } finally {
    if (session) {
      await clearViewportOverride(session)
      session.close()
    }
    if (launched?.child) {
      killTree(launched.child)
      await sleep(800)
      if (launched.child.exitCode === null) {
        console.log(`⚠ 临时桌面壳仍在退出中，PID=${launched.child.pid}`)
      } else {
        console.log(`临时桌面壳已停止，日志 ${launched.logPath}`)
      }
    } else if (session) {
      console.log('使用已有桌面壳：未关闭用户进程')
    }
    if (artifactsCreated) console.log(`截图保留供对比：${OUT_DIR}`)
  }
}

const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) await main()
