// 一次性探针：**强杀进程之后，数据还在不在**（产品文档 §14.1 的 E2E-10 —— 那一条一直没有判据）。
//
// 为什么必须用桌面壳而不是浏览器：这条的 Given 是"强制结束进程"。
// 浏览器里只能 reload（那是另一回事：reload 会走正常的关闭路径、还会 flush），
// 只有真把 exe 杀掉，才验得到"数据是靠落库活下来的、不是靠内存/关闭钩子"。
//
// 隔离做法沿用 `probe-fresh-install.mjs`：把 exe 拷进临时目录、预建一个空
// `data\EBWebView\Default\IndexedDB`（Rust 侧 `migrate_profile()` 的判据就是它存在即整体跳过）
// ⇒ 拿到一个干净 profile，**真实 profile 只被读、这次根本没读**。
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { chromium } from 'playwright'

const ROOT = process.cwd()
// 用 **debug 壳**：它加载 `devUrl`（127.0.0.1:1420），跑的是**当前这份源码**；
// release 壳里嵌的是上次打包那版，拿它验"现在的代码"没意义。
const EXE = path.join(ROOT, 'src-tauri/target/debug/qinghua.exe')
const SCRATCH = path.join(ROOT, '.playwright-verify/kill-restore')
const APP = path.join(SCRATCH, 'app')
const DATA = path.join(SCRATCH, 'data')
const PORT = Number(process.env.QH_CDP_PORT ?? 9551)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

if (!existsSync(EXE)) {
  console.error(`缺 ${EXE}（先 npm run tauri dev 或 tauri build --debug）`)
  process.exit(1)
}
rmSync(SCRATCH, { recursive: true, force: true })
mkdirSync(APP, { recursive: true })
copyFileSync(EXE, path.join(APP, 'qinghua.exe'))
mkdirSync(path.join(DATA, 'EBWebView/Default/IndexedDB'), { recursive: true })
console.log(`临时布局：${SCRATCH}（data\\ 里预建空 IndexedDB ⇒ 不走迁移，profile 干净）`)

/** 起一次壳，等到 CDP 上能拿到页面 */
async function launch() {
  const app = spawn(path.join(APP, 'qinghua.exe'), [], {
    cwd: APP,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore',
  })
  const t0 = Date.now()
  let up = false
  while (Date.now() - t0 < 60000 && !up) {
    try {
      up = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok
    } catch {
      /* 等它起来 */
    }
    if (!up) await sleep(500)
  }
  if (!up) throw new Error('没等到调试端口')
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
  let page = null
  for (let i = 0; i < 60 && !page; i++) {
    page =
      browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http')) ?? null
    if (!page) await sleep(500)
  }
  if (!page) throw new Error('没拿到页面')
  return { app, browser, page }
}

const kill = (app) => {
  spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
}

/** 直连库读节点（与冒烟 `readNodeData` 同一条口径） */
const readNodes = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('qinghua')
        req.onsuccess = () => {
          const db = req.result
          const q = db.transaction('nodes', 'readonly').objectStore('nodes').getAll()
          q.onsuccess = () => resolve(q.result ?? [])
          q.onerror = () => resolve([])
        }
        req.onerror = () => resolve([])
      }),
  )

// ── 第一次启动：建项目 → 加一个提示词节点 → 写一句话 → 等落盘 ──
let first = await launch()
{
  const { browser, page } = first
  await page
    .locator('[data-home-page], [data-getting-started]')
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {})
  const skip = page.locator('[data-onboarding-skip]')
  if (await skip.count()) {
    await skip.first().click()
    await sleep(300)
  }
  check('首启：干净 profile 起来了（无未捕获异常即视为成立）', await page.locator('[data-home-page]').count() > 0)

  await page.locator('[data-home-new]').click({ timeout: 20000 })
  await page.locator('[data-canvas-surface]').waitFor({ timeout: 25000 })
  await sleep(600)
  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  // 用**生成节点**而不是提示词节点：它的创作面板里有现成的提示词框（`[data-panel-prompt]`），
  // 能像用户那样把字写进去（提示词节点本体是 contenteditable，自动化打字那条路更绕）。
  await page.locator('[data-toolbar-menu-item="generation"]').click()
  await sleep(500)
  const panel = page.locator('[data-creation-panel]')
  await panel.waitFor({ state: 'visible', timeout: 10000 })
  const ta = panel.locator('[data-panel-prompt]')
  await ta.click()
  await ta.fill('强杀验收')
  await ta.blur() // 失焦立即落库（面板提示词是本地草稿 + 300ms 防抖）
  await sleep(500)
  const before = await page.locator('[data-node-id]').count()
  check('画布上建出一个节点', before === 1, `节点=${before}`)

  // 800ms 防抖 + 余量：**等它真落库**再杀，这条验的是"落库之后强杀不丢"
  await sleep(1600)
  const rows = await readNodes(page)
  const texts = rows.map((r) => r?.data?.prompt ?? '')
  check(
    '★ 强杀**之前**，那一行已经在库里（不是"等重启才写"）',
    rows.length === 1 && texts[0] === '强杀验收',
    `rows=${rows.length} text=${JSON.stringify(texts)}`,
  )

  kill(first.app)
  await browser.close().catch(() => {})
  await sleep(1500)
}

// ── 第二次启动：同一份 data\，看数据在不在 ──
const second = await launch()
{
  const { app, browser, page } = second
  await page
    .locator('[data-home-page], [data-getting-started]')
    .first()
    .waitFor({ timeout: 30000 })
    .catch(() => {})
  const skip = page.locator('[data-onboarding-skip]')
  if (await skip.count()) {
    await skip.first().click()
    await sleep(300)
  }

  await page.locator('[data-sidebar-item="/projects"]').click().catch(() => {})
  await sleep(800)
  const cards = await page.locator('[data-project-card]').count()
  check('★★ 重启后项目还在（项目页有卡片）', cards >= 1, `卡片=${cards}`)

  await page.locator('[data-project-card]').first().click()
  await page.locator('[data-canvas-surface]').waitFor({ timeout: 25000 })
  await sleep(900)
  const nodes = await page.locator('[data-node-id]').count()
  check('★★ 重启后画布上的节点还在（渲染出来了）', nodes >= 1, `节点=${nodes}`)

  const rows = await readNodes(page)
  const texts = rows.map((r) => r?.data?.prompt ?? '')
  check(
    '★★ 库里的内容一字不差（提示词 = 强杀验收）',
    rows.length === 1 && texts[0] === '强杀验收',
    `rows=${rows.length} text=${JSON.stringify(texts)}`,
  )

  kill(app)
  await browser.close().catch(() => {})
}

const failed = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - failed.length} passed / ${failed.length} failed / ${results.length} total =====`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(` - ${f.name}`)
}
process.exit(failed.length ? 1 : 0)
