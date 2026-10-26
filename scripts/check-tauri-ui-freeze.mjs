/**
 * Real Tauri UI-freeze gate.
 *
 * The script talks to the page-level WebView2 CDP target instead of using
 * Playwright connectOverCDP. WebView2 exposes shared-worker targets that have
 * triggered an internal Playwright assertion in this project.
 *
 * Usage:
 *   node scripts/check-tauri-ui-freeze.mjs
 *   node scripts/check-tauri-ui-freeze.mjs --launch
 *   node scripts/check-tauri-ui-freeze.mjs --compare-baseline
 *   node scripts/check-tauri-ui-freeze.mjs --write-baseline --baseline-ref=199a6d9
 *
 * Default mode checks all three viewports, stable DOM snapshots and runtime
 * errors. Baseline comparison is opt-in so an explicit two-stage gate is
 * possible. Writing a baseline requires an explicit source commit.
 */
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
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
const DEFAULT_BASELINE_DIR = path.join(
  ROOT,
  'scripts',
  'fixtures',
  'tauri-ui-freeze-baseline',
)
const REAL_VIEWPORT = {
  name: 'real-tauri-1440x900',
  width: 1440,
  height: 900,
  dpr: 1,
  real: true,
}
const AUXILIARY_VIEWPORTS = [
  { name: 'auxiliary-1024x700', width: 1024, height: 700, dpr: 1, real: false },
  { name: 'auxiliary-1178x762', width: 1178, height: 762, dpr: 1, real: false },
]
const BASELINE_SCHEMA_VERSION = 1
const MAX_DIFF_RATIO = 0.0001
const PIXEL_DELTA = 8
const STRONG_DELTA = 120
const STRONG_PIXELS = 200

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalize(value[key])]),
  )
}

export function stableJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function hashSnapshot(value) {
  return sha256(stableJson(value))
}

export function normalizeVolatileText(value) {
  return String(value).replace(
    /\d+\s*(秒|分钟|小时|天|周|个月|年)\s*前/g,
    'N $1前',
  )
}

function formatRect(rect) {
  if (!rect) return 'missing'
  return `${rect.x.toFixed(1)},${rect.y.toFixed(1)} ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}`
}

function viewportProblems(result, expected) {
  const problems = []
  if (Math.abs(result.viewport.width - expected.width) > 1) {
    problems.push(`innerWidth=${result.viewport.width}, expected ${expected.width}`)
  }
  if (Math.abs(result.viewport.height - expected.height) > 1) {
    problems.push(`innerHeight=${result.viewport.height}, expected ${expected.height}`)
  }
  if (Math.abs(result.viewport.dpr - expected.dpr) > 0.01) {
    problems.push(`DPR=${result.viewport.dpr}, expected ${expected.dpr}`)
  }
  return problems
}

function shellProblems(result) {
  const problems = []
  if (!result.isTauri) problems.push('CDP page is not the real Tauri WebView')
  if (!result.sidebar) problems.push('missing [data-app-sidebar]')
  if (!result.projectTree) problems.push('missing [data-sidebar-project-tree]')
  if (!result.settings) problems.push('missing [data-sidebar-settings]')
  if (
    result.sidebar &&
    result.projectTree &&
    result.settings &&
    !(result.projectTree.bottom < result.settings.top)
  ) {
    problems.push(
      `project tree bottom=${result.projectTree.bottom.toFixed(1)} is not above settings top=${result.settings.top.toFixed(1)}`,
    )
  }
  if (result.horizontalOverflow > 0) {
    problems.push(`page horizontal overflow ${result.horizontalOverflow}px`)
  }
  if (!result.projectTree?.contentFullyAccessible) {
    problems.push('project tree content is not fully accessible after scrolling to the end')
  }
  if (result.projectTree?.projectRows === 0) {
    problems.push('project tree has no rows, so real content accessibility is unproven')
  }
  return problems
}

function summarizeViewport(result, expected) {
  return [...viewportProblems(result, expected), ...shellProblems(result)]
}

export function evaluateGate(
  real,
  auxiliary = [],
  expectedAuxiliary = AUXILIARY_VIEWPORTS,
) {
  const realProblems = summarizeViewport(real, REAL_VIEWPORT)
  const auxiliaryProblems = expectedAuxiliary.map((expected, index) => {
    const result = auxiliary[index]
    if (!result) {
      return {
        viewport: { width: expected.width, height: expected.height, dpr: expected.dpr },
        problems: ['missing viewport result'],
      }
    }
    return {
      viewport: result.viewport,
      problems: summarizeViewport(result, expected),
    }
  })
  if (auxiliary.length !== expectedAuxiliary.length) {
    auxiliaryProblems.push({
      viewport: null,
      problems: [
        `expected ${expectedAuxiliary.length} auxiliary viewports, received ${auxiliary.length}`,
      ],
    })
  }
  return {
    ok:
      realProblems.length === 0 &&
      auxiliaryProblems.every((item) => item.problems.length === 0),
    realProblems,
    auxiliaryProblems,
  }
}

function shortJson(value, maxLength = 180) {
  const text = stableJson(value)
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`
}

export function diffDomSnapshots(expected, actual, limit = 40) {
  const differences = []

  function walk(left, right, pointer) {
    if (differences.length >= limit) return
    if (Object.is(left, right)) return
    if (typeof left === 'string' && typeof right === 'string') {
      const normalizedLeft = normalizeVolatileText(left)
      const normalizedRight = normalizeVolatileText(right)
      if (normalizedLeft === normalizedRight) return
      differences.push(
        `${pointer || '$'}: baseline=${shortJson(normalizedLeft)} current=${shortJson(normalizedRight)}`,
      )
      return
    }

    if (Array.isArray(left) && Array.isArray(right)) {
      if (left.length !== right.length) {
        differences.push(`${pointer}: array length ${left.length} -> ${right.length}`)
      }
      const length = Math.max(left.length, right.length)
      for (let index = 0; index < length && differences.length < limit; index += 1) {
        const childPointer = `${pointer}[${index}]`
        if (index >= left.length) {
          differences.push(`${childPointer}: missing baseline item; current=${shortJson(right[index])}`)
        } else if (index >= right.length) {
          differences.push(`${childPointer}: missing current item; baseline=${shortJson(left[index])}`)
        } else {
          walk(left[index], right[index], childPointer)
        }
      }
      return
    }

    const leftObject = left && typeof left === 'object'
    const rightObject = right && typeof right === 'object'
    if (leftObject && rightObject) {
      const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
      for (const key of keys) {
        if (differences.length >= limit) return
        const childPointer = pointer ? `${pointer}.${key}` : key
        if (!(key in left)) {
          differences.push(`${childPointer}: missing in baseline; current=${shortJson(right[key])}`)
        } else if (!(key in right)) {
          differences.push(`${childPointer}: missing in current; baseline=${shortJson(left[key])}`)
        } else {
          walk(left[key], right[key], childPointer)
        }
      }
      return
    }

    differences.push(
      `${pointer || '$'}: baseline=${shortJson(left)} current=${shortJson(right)}`,
    )
  }

  walk(expected, actual, '$')
  if (differences.length >= limit) differences.push(`...stopped after ${limit} differences`)
  return differences
}

export function evaluateRuntimeEvents(events) {
  const groups = [
    ['consoleErrors', events.consoleErrors],
    ['pageErrors', events.pageErrors],
    ['logErrors', events.logErrors],
    ['resourceFailures', events.resourceFailures],
    ['httpErrors', events.httpErrors],
  ]
  const problems = []
  for (const [name, entries] of groups) {
    for (const entry of entries ?? []) {
      problems.push(`${name}: ${entry.message ?? entry.text ?? shortJson(entry)}`)
    }
  }
  return { ok: problems.length === 0, problems }
}

export function evaluateImageDiff(diff) {
  if (diff.sizeMismatch) {
    return {
      ok: false,
      reason: `size mismatch: ${diff.sizeMismatch}`,
    }
  }
  const tooMany = diff.ratio > MAX_DIFF_RATIO
  const strong =
    diff.maxChannelDelta > STRONG_DELTA && diff.differencePixels > STRONG_PIXELS
  return {
    ok: !tooMany && !strong,
    reason: tooMany
      ? `difference ratio ${(diff.ratio * 100).toFixed(4)}% exceeds ${(MAX_DIFF_RATIO * 100).toFixed(2)}%`
      : strong
        ? `strong local difference: max channel delta ${diff.maxChannelDelta}, pixels ${diff.differencePixels}`
        : null,
  }
}

function fail(message) {
  console.error(`\nFAIL: ${message}\n`)
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
      `--launch uses the debug desktop shell and requires Vite at ${DEV_URL}. Run npm run dev:vite first.` +
        `\nProbe failed: ${error instanceof Error ? error.message : String(error)}`,
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
    throw new Error('desktop shell executable not found; set QH_APP_EXE to qinghua.exe')
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
        `desktop shell exited before opening CDP ${ENDPOINT} (code=${child.exitCode}).` +
          '\nIf an existing Qinghua window is open, fully exit it before retrying because Tauri is single-instance.' +
          `\nLaunch log: ${logPath}`,
      )
    }
    throw new Error(`desktop shell did not open CDP ${ENDPOINT} within 60 seconds. Log: ${logPath}`)
  }
  console.log(`Temporary desktop shell PID=${child.pid}, CDP port ${PORT}`)
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
  constructor(target, onEvent = null) {
    this.socket = new WebSocket(target.webSocketDebuggerUrl)
    this.nextId = 0
    this.pending = new Map()
    this.onEvent = onEvent
  }

  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) {
        this.onEvent?.(message)
        return
      }
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

function formatRemoteArgument(argument) {
  if (!argument) return ''
  if ('value' in argument) return String(argument.value)
  return argument.description ?? argument.type ?? ''
}

function formatConsoleArguments(args = []) {
  return args.map(formatRemoteArgument).filter(Boolean).join(' ')
}

function createRuntimeCollector() {
  const consoleErrors = []
  const consoleWarnings = []
  const pageErrors = []
  const logErrors = []
  const resourceFailures = []
  const httpErrors = []
  const seenResources = new Set()
  const seenHttpErrors = new Set()

  function ingest(event) {
    if (event.method === 'Runtime.consoleAPICalled') {
      const type = event.params.type
      const message = formatConsoleArguments(event.params.args)
      const stack = event.params.stackTrace?.callFrames?.[0]
      const record = {
        type,
        message,
        url: stack?.url ?? null,
        lineNumber: stack?.lineNumber ?? null,
      }
      if (type === 'error' || type === 'assert') consoleErrors.push(record)
      else if (type === 'warning') consoleWarnings.push(record)
      return
    }
    if (event.method === 'Runtime.exceptionThrown') {
      const details = event.params.exceptionDetails
      pageErrors.push({
        message:
          details.exception?.description ??
          details.text ??
          'uncaught runtime exception',
        url: details.url ?? null,
        lineNumber: details.lineNumber ?? null,
        columnNumber: details.columnNumber ?? null,
      })
      return
    }
    if (event.method === 'Log.entryAdded') {
      const entry = event.params.entry
      if (entry.level === 'error') {
        logErrors.push({
          source: entry.source,
          message: entry.text,
          url: entry.url ?? null,
          lineNumber: entry.lineNumber ?? null,
        })
      }
      return
    }
    if (event.method === 'Network.loadingFailed') {
      if (event.params.canceled || seenResources.has(event.params.requestId)) return
      seenResources.add(event.params.requestId)
      resourceFailures.push({
        requestId: event.params.requestId,
        resourceType: event.params.type,
        message: event.params.errorText,
        blockedReason: event.params.blockedReason ?? null,
      })
      return
    }
    if (event.method === 'Network.responseReceived') {
      const response = event.params.response
      if (response.status < 400) return
      const key = `${event.params.requestId}:${response.status}:${response.url}`
      if (seenHttpErrors.has(key)) return
      seenHttpErrors.add(key)
      httpErrors.push({
        requestId: event.params.requestId,
        resourceType: event.params.type,
        status: response.status,
        statusText: response.statusText,
        message: `${response.status} ${response.statusText} ${response.url}`,
      })
    }
  }

  return {
    ingest,
    snapshot() {
      return {
        consoleErrors,
        consoleWarnings,
        pageErrors,
        logErrors,
        resourceFailures,
        httpErrors,
      }
    },
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
  throw new Error('real Tauri page connected, but shell/project tree/settings did not become ready within 20 seconds')
}

async function waitForProjectRows(session, timeoutMs = 20_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const rows = await session
      .evaluate(
        `document.querySelectorAll('[data-sidebar-project-tree] [data-project-tree-item]').length`,
      )
      .catch(() => 0)
    if (rows > 0) return rows
    await sleep(200)
  }
  return 0
}

const STABILIZE_EXPRESSION = `(async () => {
  const styleId = '__qh_ui_freeze_stability__'
  if (!document.getElementById(styleId)) {
    const style = document.createElement('style')
    style.id = styleId
    style.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}'
    document.head.appendChild(style)
  }

  await Promise.race([
    document.fonts?.ready ?? Promise.resolve(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ])

  const updateControl = document.querySelector('[data-update-check]')
  if (updateControl) {
    const started = Date.now()
    while (
      Date.now() - started < 30_000 &&
      (updateControl.hasAttribute('data-busy') ||
        /正在检查|checking/i.test(updateControl.textContent ?? ''))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  const imagePromises = Array.from(document.images).map(async (image) => {
    if (image.complete) {
      if (image.naturalWidth > 0) await image.decode?.().catch(() => {})
      return
    }
    await new Promise((resolve) => {
      const done = () => resolve()
      image.addEventListener('load', done, { once: true })
      image.addEventListener('error', done, { once: true })
      setTimeout(done, 5000)
    })
    await image.decode?.().catch(() => {})
  })
  await Promise.race([
    Promise.all(imagePromises),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ])

  const twoFrames = () =>
    new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    )

  const readSignature = () => {
    const root = document.documentElement
    const body = document.body
    const regions = Array.from(
      document.querySelectorAll(
        '[data-app-sidebar],[data-sidebar-project-tree],[data-sidebar-settings],[data-canvas-surface],[data-agent-panel],[data-settings-panel],[role="dialog"],main,nav,aside,header',
      ),
    ).map((element) => {
      const rect = element.getBoundingClientRect()
      return [
        element.tagName,
        Math.round(rect.x * 10) / 10,
        Math.round(rect.y * 10) / 10,
        Math.round(rect.width * 10) / 10,
        Math.round(rect.height * 10) / 10,
      ]
    })
    return JSON.stringify({
      viewport: [innerWidth, innerHeight, devicePixelRatio],
      document: [root.scrollWidth, root.scrollHeight],
      body: body ? [body.scrollWidth, body.scrollHeight] : null,
      regions,
    })
  }

  let previous = ''
  let stableSamples = 0
  for (let sample = 0; sample < 30; sample += 1) {
    await twoFrames()
    const signature = readSignature()
    if (signature === previous) stableSamples += 1
    else stableSamples = 0
    previous = signature
    if (stableSamples >= 2) {
      return { stable: true, samples: sample + 1 }
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return { stable: false, samples: 30 }
})()`

async function stabilizeForCapture(session) {
  const result = await session.evaluate(STABILIZE_EXPRESSION)
  if (!result?.stable) {
    throw new Error('UI did not produce two consecutive stable layout samples')
  }
}

async function clearCaptureStability(session) {
  if (!session) return
  await session
    .evaluate(
      `document.getElementById('__qh_ui_freeze_stability__')?.remove(); true`,
    )
    .catch(() => {})
}

const READ_DOM_SNAPSHOT_EXPRESSION = `(() => {
  const round = (value) => Math.round(value * 10) / 10
  const normalize = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim()
  const isVisible = (element) => {
    if (!(element instanceof Element)) return false
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity) > 0.01 &&
      rect.width > 0 &&
      rect.height > 0
    )
  }
  const rectOf = (element) => {
    const rect = element.getBoundingClientRect()
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      left: round(rect.left),
    }
  }
  const labelOf = (element) =>
    normalize(
      element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.innerText ||
        element.textContent,
    )
  const anchorOf = (element) =>
    Array.from(element.attributes)
      .filter((attribute) =>
        attribute.name.startsWith('data-') ||
        attribute.name === 'id' ||
        attribute.name === 'role' ||
        attribute.name === 'aria-label',
      )
      .map((attribute) => [attribute.name, attribute.value])
      .sort((left, right) => left[0].localeCompare(right[0]))

  const regionElements = Array.from(
    new Set(
      document.querySelectorAll(
        '[data-app-sidebar],[data-sidebar-project-tree],[data-sidebar-settings],[data-canvas-surface],[data-ecommerce-workbench],[data-storyboard-workbench],[data-agent-panel],[data-settings-panel],[role="dialog"],main,nav,aside,header',
      ),
    ),
  ).filter(isVisible)

  const navigation = Array.from(
    document.querySelectorAll(
      'a,button,[role="tab"],[role="menuitem"],[data-nav-item]',
    ),
  )
    .filter(isVisible)
    .map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: element.getAttribute('role'),
      label: labelOf(element),
      anchor: anchorOf(element),
    }))
    .filter((item) => item.label || item.anchor.length > 0)

  const decorativeImages = Array.from(
    document.querySelectorAll('img[aria-hidden="true"],svg[aria-hidden="true"]'),
  )
    .filter(isVisible)
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        tag: element.tagName.toLowerCase(),
        src: element.currentSrc || element.getAttribute('src') || '',
        rect: {
          x: round(rect.x),
          y: round(rect.y),
          width: round(rect.width),
          height: round(rect.height),
          top: round(rect.top),
          right: round(rect.right),
          bottom: round(rect.bottom),
          left: round(rect.left),
        },
      }
    })

  const root = document.documentElement
  const body = document.body
  return {
    url: location.pathname + location.search,
    viewport: {
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    },
    visibleText: normalize(body?.innerText ?? ''),
    navigation,
    decorativeImages,
    regions: regionElements.map((element) => ({
      tag: element.tagName.toLowerCase(),
      anchor: anchorOf(element),
      rect: rectOf(element),
      overflow: {
        horizontal: element.scrollWidth > element.clientWidth + 1,
        vertical: element.scrollHeight > element.clientHeight + 1,
      },
    })),
    overflow: {
      horizontal: Math.max(
        0,
        root.scrollWidth - root.clientWidth,
        body ? body.scrollWidth - body.clientWidth : 0,
      ),
      vertical: Math.max(0, root.scrollHeight - root.clientHeight),
    },
  }
})()`

async function readDomSnapshot(session) {
  return session.evaluate(READ_DOM_SNAPSHOT_EXPRESSION)
}

async function readVolatileTextRects(session) {
  return session.evaluate(`(() => {
    const pattern = /\\d+\\s*(秒|分钟|小时|天|周|个月|年)\\s*前/
    const isVisible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number(style.opacity) > 0.01 &&
        rect.width > 0 &&
        rect.height > 0
      )
    }
    return Array.from(document.querySelectorAll('body *'))
      .filter(
        (element) =>
          element.children.length === 0 &&
          pattern.test(element.textContent ?? '') &&
          isVisible(element),
      )
      .map((element) => {
        const rect = element.getBoundingClientRect()
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
        }
      })
  })()`)
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
  const buffer = Buffer.from(result.data, 'base64')
  const target = path.join(OUT_DIR, filename)
  writeFileSync(target, buffer)
  return {
    name: filename,
    path: target,
    bytes: buffer.length,
    sha256: sha256(buffer),
    buffer,
  }
}

async function emulateViewport(session, viewport) {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.dpr,
    mobile: false,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  })
}

async function clearViewportOverride(session) {
  await session.send('Emulation.clearDeviceMetricsOverride').catch(() => {})
}

async function captureViewport(session, viewport) {
  if (!viewport.real) await emulateViewport(session, viewport)
  await stabilizeForCapture(session)
  const geometry = await readGeometry(session)
  await stabilizeForCapture(session)
  const dom = await readDomSnapshot(session)
  const volatileTextRects = await readVolatileTextRects(session)
  const screenshot = await captureScreenshot(session, `${viewport.name}.png`)
  return {
    viewport,
    geometry,
    dom,
    domHash: hashSnapshot(dom),
    volatileTextRects,
    screenshot,
  }
}

function screenshotForReport(screenshot) {
  return {
    name: screenshot.name,
    path: screenshot.path,
    bytes: screenshot.bytes,
    sha256: screenshot.sha256,
  }
}

function captureForReport(capture) {
  return {
    viewport: capture.viewport,
    geometry: capture.geometry,
    domHash: capture.domHash,
    screenshot: screenshotForReport(capture.screenshot),
  }
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function readBaseline(baselineDir) {
  const manifestPath = path.join(baselineDir, 'manifest.json')
  const domPath = path.join(baselineDir, 'dom-snapshots.json')
  if (!existsSync(manifestPath)) {
    throw new Error(`baseline manifest is missing: ${manifestPath}`)
  }
  if (!existsSync(domPath)) {
    throw new Error(`baseline DOM snapshot is missing: ${domPath}`)
  }
  const manifest = readJson(manifestPath)
  if (manifest.schemaVersion !== BASELINE_SCHEMA_VERSION) {
    throw new Error(
      `baseline schema ${manifest.schemaVersion} is unsupported; expected ${BASELINE_SCHEMA_VERSION}`,
    )
  }
  const domBuffer = readFileSync(domPath)
  const domHash = sha256(domBuffer)
  if (manifest.domSnapshotSha256 !== domHash) {
    throw new Error(
      `baseline DOM snapshot hash mismatch: manifest ${manifest.domSnapshotSha256}, file ${domHash}`,
    )
  }
  const domSnapshots = JSON.parse(domBuffer.toString('utf8'))
  const viewports = new Map()
  for (const viewport of manifest.viewports ?? []) {
    const screenshotPath = path.join(baselineDir, viewport.screenshot)
    if (!existsSync(screenshotPath)) {
      throw new Error(`baseline screenshot is missing: ${screenshotPath}`)
    }
    const buffer = readFileSync(screenshotPath)
    const fileHash = sha256(buffer)
    if (fileHash !== viewport.sha256) {
      throw new Error(
        `baseline screenshot hash mismatch for ${viewport.name}: manifest ${viewport.sha256}, file ${fileHash}`,
      )
    }
    const dom = domSnapshots[viewport.name]
    if (!dom) throw new Error(`baseline DOM snapshot is missing for ${viewport.name}`)
    const domSnapshotHash = hashSnapshot(dom)
    if (domSnapshotHash !== viewport.domSha256) {
      throw new Error(
        `baseline DOM snapshot hash mismatch for ${viewport.name}: manifest ${viewport.domSha256}, file ${domSnapshotHash}`,
      )
    }
    viewports.set(viewport.name, {
      ...viewport,
      path: screenshotPath,
      buffer,
      dom,
    })
  }
  return { manifest, domSnapshots, domPath, manifestPath, viewports }
}

function gitOutput(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    return { ok: false, stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' }
  }
  return { ok: true, stdout: result.stdout?.trim() ?? '', stderr: '' }
}

function currentCommit() {
  const result = gitOutput(['rev-parse', 'HEAD'])
  return result.ok ? result.stdout : null
}

function uiSourceStatus() {
  const result = gitOutput([
    'status',
    '--porcelain',
    '--untracked-files=all',
    '--',
    'src',
    'src-tauri',
    'index.html',
    'vite.config.ts',
    'vite.config.js',
  ])
  return result.ok ? result.stdout : null
}

function verifyBaselineWriteAllowed(options, commit) {
  if (!options.baselineRef) {
    throw new Error(
      '--write-baseline requires --baseline-ref=<commit> so the baseline source is never implicit',
    )
  }
  if (!commit) {
    throw new Error('cannot write a UI baseline without a resolvable git HEAD')
  }
  if (!commit.startsWith(options.baselineRef) && !options.allowBaselineCommitMismatch) {
    throw new Error(
      `git HEAD ${commit} does not match --baseline-ref=${options.baselineRef}; ` +
        'use --allow-baseline-commit-mismatch only when the desktop binary is known to come from that ref',
    )
  }
  const dirtyUiSources = uiSourceStatus()
  if (dirtyUiSources === null) {
    throw new Error('cannot inspect UI source status; refusing to write an unverified baseline')
  }
  if (dirtyUiSources && !options.allowDirtyBaseline) {
    throw new Error(
      'refusing to write a baseline from dirty UI source. Commit/stash changes or pass ' +
        `--allow-dirty-baseline only after explicit review:\n${dirtyUiSources}`,
    )
  }
}

function writeBaseline(baselineDir, captures, options, commit) {
  mkdirSync(baselineDir, { recursive: true })
  const domSnapshots = {}
  const viewports = []
  for (const capture of captures) {
    const screenshotName = `${capture.viewport.name}.png`
    const screenshotPath = path.join(baselineDir, screenshotName)
    writeFileSync(screenshotPath, capture.screenshot.buffer)
    domSnapshots[capture.viewport.name] = capture.dom
    viewports.push({
      name: capture.viewport.name,
      width: capture.viewport.width,
      height: capture.viewport.height,
      dpr: capture.viewport.dpr,
      screenshot: screenshotName,
      bytes: capture.screenshot.buffer.length,
      sha256: sha256(capture.screenshot.buffer),
      domSha256: hashSnapshot(capture.dom),
    })
  }
  const domBuffer = Buffer.from(JSON.stringify(domSnapshots, null, 2))
  writeFileSync(path.join(baselineDir, 'dom-snapshots.json'), domBuffer)
  const manifest = {
    schemaVersion: BASELINE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    baselineRef: options.baselineRef,
    sourceCommit: commit,
    sourceCommitMatchesBaselineRef: commit.startsWith(options.baselineRef),
    dirtyUiSourcesAllowed: options.allowDirtyBaseline,
    viewports,
    domSnapshotSha256: sha256(domBuffer),
    note:
      'Baseline screenshots and DOM snapshots are written only from an explicitly requested and verified capture.',
  }
  writeFileSync(
    path.join(baselineDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
  )
  return manifest
}

async function comparePngBuffers(
  session,
  baselineBuffer,
  currentBuffer,
  ignoredRects = [],
  viewportWidth,
) {
  const baselineBase64 = baselineBuffer.toString('base64')
  const currentBase64 = currentBuffer.toString('base64')
  const ignoredRectsJson = JSON.stringify(ignoredRects)
  return session.evaluate(`(async () => {
    const load = async (dataUrl) => {
      const image = new Image()
      image.src = dataUrl
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = image.naturalWidth
      canvas.height = image.naturalHeight
      canvas.getContext('2d').drawImage(image, 0, 0)
      return canvas
    }
    const baseline = await load('data:image/png;base64,${baselineBase64}')
    const current = await load('data:image/png;base64,${currentBase64}')
    if (baseline.width !== current.width || baseline.height !== current.height) {
      return {
        sizeMismatch: baseline.width + 'x' + baseline.height + ' != ' + current.width + 'x' + current.height,
      }
    }
    const baselineData = baseline.getContext('2d').getImageData(0, 0, baseline.width, baseline.height).data
    const currentData = current.getContext('2d').getImageData(0, 0, current.width, current.height).data
    const output = new ImageData(baseline.width, baseline.height)
    const pixelScale = baseline.width / ${JSON.stringify(viewportWidth)}
    const ignored = ${ignoredRectsJson}.map((rect) => ({
      left: Math.max(0, Math.floor(rect.left * pixelScale) - 1),
      top: Math.max(0, Math.floor(rect.top * pixelScale) - 1),
      right: Math.min(
        baseline.width,
        Math.ceil(rect.right * pixelScale) + 1,
      ),
      bottom: Math.min(
        baseline.height,
        Math.ceil(rect.bottom * pixelScale) + 1,
      ),
    }))
    let differencePixels = 0
    let ignoredPixels = 0
    let maxChannelDelta = 0
    for (let index = 0; index < baselineData.length; index += 4) {
      const pixel = index / 4
      const x = pixel % baseline.width
      const y = Math.floor(pixel / baseline.width)
      if (
        ignored.some(
          (rect) =>
            x >= rect.left &&
            x < rect.right &&
            y >= rect.top &&
            y < rect.bottom,
        )
      ) {
        ignoredPixels += 1
        output.data[index] = 210
        output.data[index + 1] = 210
        output.data[index + 2] = 210
        output.data[index + 3] = 255
        continue
      }
      const delta = Math.max(
        Math.abs(baselineData[index] - currentData[index]),
        Math.abs(baselineData[index + 1] - currentData[index + 1]),
        Math.abs(baselineData[index + 2] - currentData[index + 2]),
      )
      if (delta > maxChannelDelta) maxChannelDelta = delta
      if (delta > ${PIXEL_DELTA}) {
        differencePixels += 1
        output.data[index] = 255
        output.data[index + 1] = 0
        output.data[index + 2] = 0
        output.data[index + 3] = 255
      } else {
        output.data[index] = 236
        output.data[index + 1] = 236
        output.data[index + 2] = 236
        output.data[index + 3] = 255
      }
    }
    const diffCanvas = document.createElement('canvas')
    diffCanvas.width = baseline.width
    diffCanvas.height = baseline.height
    diffCanvas.getContext('2d').putImageData(output, 0, 0)
    const totalPixels = baseline.width * baseline.height
    return {
      width: baseline.width,
      height: baseline.height,
      totalPixels,
      differencePixels,
      ratio: differencePixels / totalPixels,
      ignoredPixels,
      ignoredRects: ignored.length,
      maxChannelDelta,
      diffDataUrl: diffCanvas.toDataURL('image/png'),
    }
  })()`)
}

async function compareWithBaseline(session, baseline, captures) {
  const comparisons = []
  const files = []
  for (const capture of captures) {
    const baselineViewport = baseline.viewports.get(capture.viewport.name)
    if (!baselineViewport) {
      comparisons.push({
        name: capture.viewport.name,
        viewport: capture.viewport,
        ok: false,
        problems: ['viewport is missing from baseline manifest'],
      })
      continue
    }
    const rawDiff = await comparePngBuffers(
      session,
      baselineViewport.buffer,
      capture.screenshot.buffer,
      [
        ...(capture.dom.decorativeImages?.map((image) => image.rect) ?? []),
        ...(capture.volatileTextRects ?? []),
      ],
      capture.viewport.width,
    )
    const imageGate = evaluateImageDiff(rawDiff)
    let diffPath = null
    let diffSha256 = null
    if (rawDiff.diffDataUrl) {
      const diffBuffer = Buffer.from(rawDiff.diffDataUrl.split(',')[1], 'base64')
      diffPath = path.join(OUT_DIR, `diff-${capture.viewport.name}.png`)
      writeFileSync(diffPath, diffBuffer)
      diffSha256 = sha256(diffBuffer)
    }
    const domDifferences = diffDomSnapshots(baselineViewport.dom, capture.dom)
    const image = {
      ok: imageGate.ok,
      reason: imageGate.reason,
      width: rawDiff.width ?? null,
      height: rawDiff.height ?? null,
      totalPixels: rawDiff.totalPixels ?? null,
      differencePixels: rawDiff.differencePixels ?? null,
      ratio: rawDiff.ratio ?? null,
      ignoredPixels: rawDiff.ignoredPixels ?? null,
      ignoredRects: rawDiff.ignoredRects ?? null,
      maxChannelDelta: rawDiff.maxChannelDelta ?? null,
      baselineSha256: baselineViewport.sha256,
      currentSha256: capture.screenshot.sha256,
      diffPath,
      diffSha256,
    }
    const dom = {
      ok: domDifferences.length === 0,
      baselineSha256: baselineViewport.domSha256,
      currentSha256: capture.domHash,
      differences: domDifferences,
    }
    comparisons.push({
      name: capture.viewport.name,
      viewport: capture.viewport,
      ok: image.ok && dom.ok,
      image,
      dom,
      problems: [
        ...(image.ok ? [] : [image.reason ?? 'image differs from baseline']),
        ...(dom.ok ? [] : [`DOM snapshot differs in ${domDifferences.length} place(s)`]),
      ],
    })
    if (diffPath) files.push(diffPath)
  }
  return { comparisons, diffFiles: files }
}

function writeReport(reportData) {
  const reportPath = path.join(OUT_DIR, 'report.json')
  writeFileSync(reportPath, JSON.stringify(reportData, null, 2))
  return reportPath
}

function printReport(reportData, reportPath) {
  const { commits, geometryGate, runtimeGate, baselineComparison, captures, gate } =
    reportData
  console.log('\nReal Tauri WebView')
  console.log(`  current commit ${commits.current ?? 'unknown'}`)
  if (commits.baselineRef) {
    console.log(`  baseline ref   ${commits.baselineRef}`)
  }
  for (const capture of captures) {
    const result = capture.geometry
    console.log(
      `  ${capture.viewport.name}: ${result.viewport.width}x${result.viewport.height} @ DPR ${result.viewport.dpr}`,
    )
    console.log(`    sidebar    ${formatRect(result.sidebar)}`)
    console.log(`    projectTree ${formatRect(result.projectTree)}`)
    console.log(`    settings   ${formatRect(result.settings)}`)
    console.log(`    overflow   ${result.horizontalOverflow}px`)
    console.log(`    DOM hash   ${capture.domHash}`)
    console.log(`    PNG        ${capture.screenshot.sha256}`)
  }
  console.log(`\n  geometry gate ${geometryGate.ok ? 'PASS' : 'FAIL'}`)
  for (const problem of geometryGate.realProblems) console.log(`    - ${problem}`)
  for (const item of geometryGate.auxiliaryProblems) {
    const size = item.viewport
      ? `${item.viewport.width}x${item.viewport.height}`
      : 'coverage'
    console.log(`    ${size}: ${item.problems.length === 0 ? 'PASS' : 'FAIL'}`)
    for (const problem of item.problems) console.log(`      - ${problem}`)
  }
  console.log(`  runtime gate ${runtimeGate.ok ? 'PASS' : 'FAIL'}`)
  for (const problem of runtimeGate.problems) console.log(`    - ${problem}`)
  if (baselineComparison) {
    console.log(`  baseline compare ${baselineComparison.ok ? 'PASS' : 'FAIL'}`)
    for (const problem of baselineComparison.problems ?? []) {
      console.log(`    - ${problem}`)
    }
    for (const comparison of baselineComparison.comparisons) {
      console.log(
        `    ${comparison.name}: ${comparison.ok ? 'PASS' : 'FAIL'}` +
          (comparison.image?.ratio != null
            ? ` (PNG diff ${comparison.image.differencePixels}/${comparison.image.totalPixels})`
            : ''),
      )
      for (const problem of comparison.problems) console.log(`      - ${problem}`)
    }
  } else {
    console.log('  baseline compare SKIPPED (pass --compare-baseline)')
  }
  console.log(`\n  overall ${gate.ok ? 'PASS' : 'FAIL'}`)
  console.log(`  screenshots ${OUT_DIR}`)
  console.log(`  report ${reportPath}`)
}

function parseArgs(argv) {
  const options = {
    launch: false,
    mode: 'capture',
    baselineDir:
      process.env.QH_UI_FREEZE_BASELINE_DIR
        ? path.resolve(process.env.QH_UI_FREEZE_BASELINE_DIR)
        : DEFAULT_BASELINE_DIR,
    baselineRef: null,
    allowDirtyBaseline: false,
    allowBaselineCommitMismatch: false,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--launch') options.launch = true
    else if (argument === '--write-baseline') {
      if (options.mode !== 'capture') throw new Error('choose only one baseline mode')
      options.mode = 'write'
    } else if (argument === '--compare-baseline') {
      if (options.mode !== 'capture') throw new Error('choose only one baseline mode')
      options.mode = 'compare'
    } else if (argument === '--allow-dirty-baseline') {
      options.allowDirtyBaseline = true
    } else if (argument === '--allow-baseline-commit-mismatch') {
      options.allowBaselineCommitMismatch = true
    } else if (argument.startsWith('--baseline-dir=')) {
      options.baselineDir = path.resolve(argument.slice('--baseline-dir='.length))
    } else if (argument === '--baseline-dir') {
      const value = argv[index + 1]
      if (!value) throw new Error('--baseline-dir requires a path')
      options.baselineDir = path.resolve(value)
      index += 1
    } else if (argument.startsWith('--baseline-ref=')) {
      options.baselineRef = argument.slice('--baseline-ref='.length)
    } else if (argument === '--baseline-ref') {
      const value = argv[index + 1]
      if (!value) throw new Error('--baseline-ref requires a commit')
      options.baselineRef = value
      index += 1
    } else if (argument === '--help' || argument === '-h') {
      console.log(
        [
          'Usage: node scripts/check-tauri-ui-freeze.mjs [options]',
          '  --launch                         temporarily start the debug desktop shell',
          '  --compare-baseline               compare all three viewports with a saved baseline',
          '  --write-baseline                 write a baseline after an explicit reviewed capture',
          '  --baseline-ref=<commit>          source commit required with --write-baseline',
          '  --baseline-dir=<path>            override baseline directory',
          '  --allow-dirty-baseline           permit writing after explicit review of dirty UI source',
          '  --allow-baseline-commit-mismatch permit a known desktop binary from another commit',
          '',
        ].join('\n'),
      )
      process.exitCode = 0
      return null
    } else {
      throw new Error(`unknown argument: ${argument}`)
    }
  }
  return options
}

async function main() {
  let options
  let commit
  try {
    options = parseArgs(process.argv.slice(2))
    if (!options) return
    commit = currentCommit()
    if (options.mode === 'write') verifyBaselineWriteAllowed(options, commit)
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }
  mkdirSync(OUT_DIR, { recursive: true })

  let launched = null
  let session = null
  let artifactsCreated = false
  const runtimeCollector = createRuntimeCollector()

  try {
    const existingVersion = await waitForCdp(500)
    if (!existingVersion && !options.launch) {
      return fail(
        `cannot connect to real Tauri WebView CDP at ${ENDPOINT}\n` +
          `start a desktop debug shell with --remote-debugging-port=${PORT}, or run:\n` +
          '  npm run dev:vite\n  node scripts/check-tauri-ui-freeze.mjs --launch\n' +
          'The script never attaches to an ordinary browser by default.',
      )
    }
    launched = await maybeLaunch(options.launch)
    if (!(await waitForCdp(3_000))) {
      return fail(
        `CDP target ${ENDPOINT} was not found. Restart an existing app with --remote-debugging-port=${PORT}.`,
      )
    }
    const target = await pickPageTarget()
    if (!target) {
      return fail(
        `CDP ${ENDPOINT} is open, but there is no page target. Confirm the launched app is Tauri, not an ordinary browser.`,
      )
    }

    session = new CdpSession(target, runtimeCollector.ingest)
    await session.open()
    await session.send('Page.enable')
    await session.send('Runtime.enable')
    await session.send('Log.enable')
    await session.send('Network.enable')
    await waitForShell(session)
    await waitForProjectRows(session)

    const captures = []
    try {
      captures.push(await captureViewport(session, REAL_VIEWPORT))
      for (const viewport of AUXILIARY_VIEWPORTS) {
        captures.push(await captureViewport(session, viewport))
      }
    } finally {
      await clearViewportOverride(session)
      await clearCaptureStability(session)
    }
    artifactsCreated = true

    const realGeometry = captures[0]?.geometry
    const auxiliaryGeometry = captures.slice(1).map((capture) => capture.geometry)
    const geometryGate = evaluateGate(realGeometry, auxiliaryGeometry)
    const runtimeEvents = runtimeCollector.snapshot()
    const runtimeGate = evaluateRuntimeEvents(runtimeEvents)

    let baseline = null
    let baselineComparison = null
    let writtenBaseline = null
    if (options.mode === 'compare') {
      try {
        baseline = readBaseline(options.baselineDir)
        const comparison = await compareWithBaseline(session, baseline, captures)
        baselineComparison = {
          ok: comparison.comparisons.every((item) => item.ok),
          comparisons: comparison.comparisons,
          problems: [],
          diffFiles: comparison.diffFiles,
        }
      } catch (error) {
        baselineComparison = {
          ok: false,
          comparisons: [],
          problems: [
            error instanceof Error ? error.message : String(error),
          ],
          diffFiles: [],
        }
      }
    } else if (options.mode === 'write') {
      if (!geometryGate.ok || !runtimeGate.ok) {
        baselineComparison = {
          ok: false,
          comparisons: [],
          problems: [
            'baseline was not written because geometry or runtime checks failed',
          ],
          diffFiles: [],
        }
      } else {
        try {
          writtenBaseline = writeBaseline(options.baselineDir, captures, options, commit)
        } catch (error) {
          baselineComparison = {
            ok: false,
            comparisons: [],
            problems: [
              `baseline write failed: ${error instanceof Error ? error.message : String(error)}`,
            ],
            diffFiles: [],
          }
        }
      }
    }

    const gate = {
      ok:
        geometryGate.ok &&
        runtimeGate.ok &&
        (baselineComparison?.ok ?? true),
      geometry: geometryGate.ok,
      runtime: runtimeGate.ok,
      baseline: baselineComparison?.ok ?? null,
    }
    const reportData = {
      generatedAt: new Date().toISOString(),
      schemaVersion: BASELINE_SCHEMA_VERSION,
      endpoint: ENDPOINT,
      outputDir: OUT_DIR,
      commits: {
        current: commit,
        baselineRef: options.baselineRef,
        baselineSource: baseline?.manifest.sourceCommit ?? null,
      },
      mode: options.mode,
      baselineDir: options.mode === 'capture' ? null : options.baselineDir,
      expectedReal: REAL_VIEWPORT,
      expectedAuxiliary: AUXILIARY_VIEWPORTS,
      captures: captures.map(captureForReport),
      geometryGate,
      runtimeEvents,
      runtimeGate,
      baselineComparison,
      writtenBaseline,
      gate,
      files: {
        report: path.join(OUT_DIR, 'report.json'),
        domSnapshots: path.join(OUT_DIR, 'dom-snapshots.json'),
      },
      note:
        'All geometry checks are authoritative. 1024x700 and 1178x762 use CDP emulation but are no longer advisory. Baseline comparison compares PNG pixels and normalized DOM snapshots.',
    }
    writeFileSync(
      reportData.files.domSnapshots,
      JSON.stringify(
        Object.fromEntries(captures.map((capture) => [capture.viewport.name, capture.dom])),
        null,
        2,
      ),
    )
    const reportPath = writeReport(reportData)
    printReport(reportData, reportPath)
    if (!gate.ok) process.exitCode = 1
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  } finally {
    if (session) {
      await clearViewportOverride(session)
      await clearCaptureStability(session)
      session.close()
    }
    if (launched?.child) {
      killTree(launched.child)
      await sleep(800)
      if (launched.child.exitCode === null) {
        console.log(`Temporary desktop shell is still exiting, PID=${launched.child.pid}`)
      } else {
        console.log(`Temporary desktop shell stopped; log ${launched.logPath}`)
      }
    } else if (session) {
      console.log('Attached to an existing desktop shell; it was left running.')
    }
    if (artifactsCreated) console.log(`Screenshots retained for review: ${OUT_DIR}`)
  }
}

const invokedDirectly =
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url

if (invokedDirectly) await main()
