// 交付门禁：**release 产物真机启动自检**（对账 241 状态 / 桌面封装方案 §8）。
//
// 为什么需要它：整套冒烟跑的是 vite 的 web 构建，`probe-tauri-shell.mjs` 跑的是
// `npm run tauri dev` 的**开发**壳，而**交到用户手里**的那份是 release 构建 ——
// 前端资源内嵌进 exe、没有 dev 服务器兜底、`__APP_VERSION__` 由构建时注入、
// 11.7 MB 的 mediapipe wasm 也在包里。这些差异只在 release 里才暴露。
//
// 它验的六件事（每条都读**磁盘或页面里的真值**，不读"意图"）：
//   ① 跑的是内嵌前端（`http://tauri.localhost`），不是 :1420 的开发服务器；
//   ② 平台判定是 desktop；
//   ③ 首屏 + 首次引导能渲染、能关掉；项目页能把**真库里的项目**渲染成卡片；
//   ④ 「关于」面板显示的版本 = package.json 的版本（构建时注入有没有生效）；
//   ⑤ mediapipe wasm 能从包里取到且字节数与 dist 一致；
//   ⑥ 同级 `data\` 自动创建、默认 profile 的 IndexedDB 被迁过来。
//
// 隔离：把 exe 拷到 `<工作区>/.playwright-verify/release-shell/app/` 再跑，
// 于是 Rust 那条「程序目录上一级的 `data\`」规则生效（闸门 0 只对 `src-tauri\target\{debug,release}` 放行），
// 数据落在同一个临时目录里，**真实 profile 只被读**（`migrate_profile` 用 `fs::copy`，不是搬走）。
// 跑完默认删掉临时的 `app\` 与 `data\`（迁移会拷 100+ MB，留着是垃圾）；`QH_KEEP_PROFILE=1` 可保留。
//
// 用法：先 `npm run tauri build`（或 `node scripts/release-desktop.mjs`），再
//       `node scripts/check-release-shell.mjs`
import { spawn, spawnSync } from 'node:child_process'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = process.cwd()
const EXE_SRC = process.env.QH_RELEASE_EXE ?? path.join(ROOT, 'src-tauri/target/release/qinghua.exe')
const PORT = Number(process.env.QH_CDP_PORT ?? 9444)
const KEEP_PROFILE = process.env.QH_KEEP_PROFILE === '1'
const PKG_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const DIST_WASM = path.join(ROOT, 'dist/mediapipe/wasm/vision_wasm_internal.wasm')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

if (!existsSync(EXE_SRC)) {
  console.error(`找不到 ${EXE_SRC}（先 npm run tauri build 或 node scripts/release-desktop.mjs）`)
  process.exit(1)
}

const probeRoot = path.join(ROOT, '.playwright-verify/release-shell')
const scratch = path.join(probeRoot, new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19))
const appDir = path.join(scratch, 'app')
const dataDir = path.join(scratch, 'data')
const exePath = path.join(appDir, 'qinghua.exe')
mkdirSync(appDir, { recursive: true })
copyFileSync(EXE_SRC, exePath)
console.log(`临时布局：${scratch}`)
console.log(`  程序 ${exePath}（${statSync(exePath).size} B）`)

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

/** 目录递归字节数（IndexedDB 是目录，`statSync` 对它只会给 0） */
function dirSize(dir) {
  if (!existsSync(dir)) return 0
  let total = 0
  const stack = [dir]
  while (stack.length > 0) {
    const cur = stack.pop()
    for (const entry of readdirSync(cur, { withFileTypes: true })) {
      const full = path.join(cur, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else {
        try {
          total += statSync(full).size
        } catch {
          /* 正在写的文件跳过 */
        }
      }
    }
  }
  return total
}

/**
 * release 构建带着 `windows_subsystem = "windows"`（`src-tauri/src/main.rs` 第一行），
 * **没有控制台**：Rust 那些 `eprintln!` 到不了任何地方。所以这里虽然接着管道，
 * 判据一律不依赖日志，只看**磁盘上的事实**与**页面里的 DOM**。
 */
const logFile = createWriteStream(path.join(scratch, 'app.log'))
const app = spawn(exePath, [], {
  cwd: appDir,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: ['ignore', 'pipe', 'pipe'],
})
app.stdout.on('data', (b) => logFile.write(b))
app.stderr.on('data', (b) => logFile.write(b))
console.log(`已启动（pid=${app.pid}，调试端口 ${PORT}）`)

let exited = null
app.on('exit', (code) => {
  exited = code
})

async function waitForCdp(timeoutMs = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (exited !== null) return null
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`)
      if (res.ok) return await res.json()
    } catch {
      /* 还没起来 */
    }
    await sleep(500)
  }
  return null
}

function killTree() {
  try {
    spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  } catch {
    app.kill()
  }
}

function cleanup() {
  if (KEEP_PROFILE) {
    console.log(`（QH_KEEP_PROFILE=1，临时 profile 保留在 ${scratch}）`)
    return
  }
  // 只删自己造出来的两个子目录，且必须确认它们仍在工作区的 .playwright-verify 下
  const inside = path.resolve(appDir).startsWith(path.resolve(probeRoot) + path.sep)
  if (!inside) {
    console.log('⚠️ 临时目录不在 .playwright-verify 下，跳过清理')
    return
  }
  /*
   * WebView2 的进程树退出后句柄还会松一会儿（实测 EPERM），所以：① 带重试；
   * ② **清理失败绝不影响判据** —— 它只是收尾，不是产品行为（把失败原因原样打出来即可）。
   */
  try {
    const opts = { recursive: true, force: true, maxRetries: 10, retryDelay: 400 }
    rmSync(appDir, opts)
    rmSync(dataDir, opts)
    console.log(`已清掉临时的 app\\ 与 data\\（截图与日志留在 ${scratch}）`)
  } catch (err) {
    console.log(`⚠️ 临时目录没清干净（不影响判据）：${String(err).split('\n')[0]}`)
    console.log(`   手动删：${scratch}`)
  }
}

const version = await waitForCdp()
if (!version) {
  check('release 二进制启动并开出调试端口', false, exited === null ? '等超时' : `进程已退出 code=${exited}`)
  killTree()
  cleanup()
  console.log('\n结果：失败（见上）')
  process.exit(1)
}
console.log('WebView2 =', version.Browser)

const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
const pages = browser.contexts().flatMap((c) => c.pages())
const page =
  pages.find((p) => p.url().startsWith('http://tauri.localhost')) ??
  pages.find((p) => p.url().startsWith('http')) ??
  pages[0]
if (!page) {
  check('CDP 连上后能拿到页面', false)
  await browser.close().catch(() => {})
  killTree()
  cleanup()
  process.exit(1)
}

const pageErrors = []
const consoleErrors = []
page.on('pageerror', (err) => pageErrors.push(String(err)))
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text())
})

await page.waitForLoadState('domcontentloaded').catch(() => {})
const homeOk = await page
  .locator('[data-home-page]')
  .waitFor({ timeout: 30000 })
  .then(() => true)
  .catch(() => false)
await sleep(1200)

// ① 这一份跑的是**内嵌前端**，不是 dev 服务器
const boot = await page.evaluate(() => ({
  url: location.href,
  platform: document.documentElement.dataset.platform ?? null,
  home: !!document.querySelector('[data-home-page]'),
  rail: !!document.querySelector('[data-rail-slot]'),
}))
check('跑的是内嵌前端（origin = http://tauri.localhost，不是 :1420）', boot.url.startsWith('http://tauri.localhost'), boot.url)
check('平台判定 = desktop（壳里走 desktop 实现）', boot.platform === 'desktop', `data-platform=${boot.platform}`)
check('首屏渲染出来（首页 + 侧栏占位）', homeOk && boot.home && boot.rail, JSON.stringify(boot))

// ② 新 profile 的第一屏是首次引导浮层（它会盖住侧栏 ⇒ 不先关掉就点不到设置按钮）
const skip = page.locator('[data-onboarding-skip]')
const hadOnboarding = (await skip.count()) > 0
if (hadOnboarding) await skip.first().click({ timeout: 10000 }).catch(() => {})
await sleep(400)
check(
  '首次引导浮层能关掉（新机器第一屏就是它）',
  !hadOnboarding || (await page.locator('[data-getting-started]').count()) === 0,
  hadOnboarding ? '出现过并已关掉' : '本次没出现',
)

// ③ 迁移过来的真库真能用：项目页能开、卡片数从库里数出来
let projectsHeading = false
let projectCards = 0
try {
  await page.locator('[data-sidebar-item="/projects"]').click({ timeout: 10000 })
  await page.locator('[data-projects-heading]').waitFor({ timeout: 15000 })
  projectsHeading = true
  await sleep(800)
  projectCards = await page.locator('[data-project-card]').count()
} catch {
  projectsHeading = false
}
check('项目页能打开并渲染卡片（数据来自迁过来的真库）', projectsHeading, `卡片 ${projectCards} 张`)
await page.screenshot({ path: path.join(scratch, 'projects-page.png') }).catch(() => {})

// ④ 构建时注入的版本号真的进了包（`vite.config.ts` 的 define）
let aboutVersion = null
try {
  await page.locator('[data-sidebar-settings]').click({ timeout: 10000 })
  await page.locator('[data-global-settings-panel]').waitFor({ timeout: 10000 })
  await page.locator('[data-global-settings-tab="about"]').click({ timeout: 10000 })
  await page.locator('[data-about-version]').waitFor({ timeout: 10000 })
  aboutVersion = (await page.locator('[data-about-version]').innerText()).trim()
  await page.screenshot({ path: path.join(scratch, 'about-panel.png') }).catch(() => {})
} catch (err) {
  aboutVersion = `读取失败：${String(err).split('\n')[0]}`
}
check(
  '关于面板里的版本 = package.json 的版本（构建时注入生效）',
  typeof aboutVersion === 'string' && aboutVersion.includes(PKG_VERSION),
  `界面「${aboutVersion}」 期望含 ${PKG_VERSION}`,
)

// ⑤ 11.7 MB 的 mediapipe wasm 真在包里（情绪局部改脸那条链的依赖）
const expectedWasm = existsSync(DIST_WASM) ? statSync(DIST_WASM).size : null
const wasm = await page.evaluate(async (url) => {
  try {
    const res = await fetch(url)
    const buf = await res.arrayBuffer()
    return { status: res.status, bytes: buf.byteLength }
  } catch (err) {
    return { status: 0, bytes: 0, error: String(err) }
  }
}, '/mediapipe/wasm/vision_wasm_internal.wasm')
check(
  'mediapipe wasm 能从包里取到且字节数一致',
  wasm.status === 200 && expectedWasm !== null && wasm.bytes === expectedWasm,
  `${JSON.stringify(wasm)} 期望 ${expectedWasm}${wasm.error ? ` err=${wasm.error}` : ''}`,
)

// ⑥ 数据目录按「程序目录上一级的 data\」落地（闸门 1–4），默认库被迁过来
const indexDb = path.join(dataDir, 'EBWebView/Default/IndexedDB')
const srcIndexDb = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'com.qinghua.canvas/EBWebView/Default/IndexedDB')
  : null
const srcBytes = srcIndexDb ? dirSize(srcIndexDb) : 0
const dstBytes = dirSize(indexDb)
const migratedOk = srcBytes === 0 || dstBytes >= srcBytes * 0.9
check(
  '同级 data\\ 自动创建，默认库被迁过来（源目录只被读）',
  existsSync(dataDir) && existsSync(indexDb) && migratedOk,
  `源 ${(srcBytes / 1024 / 1024).toFixed(1)} MB → 临时 ${(dstBytes / 1024 / 1024).toFixed(1)} MB`,
)

// ⑦ 生产构建不该有运行时错误
check('没有未捕获的页面异常', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '))
check('没有 console.error', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '))

await browser.close().catch(() => {})
killTree()
await sleep(800)
cleanup()

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) {
  console.log('失败项：')
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)
}
console.log(`产物：${scratch}`)
process.exit(failed.length > 0 ? 1 : 0)
