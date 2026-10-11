#!/usr/bin/env node
/**
 * 交付门禁（**手动**，Windows）：把安装包真装一遍再卸掉（对账 #438 状态② / 桌面封装方案 §6）。
 *
 * 它验的是 `scripts/check-release-shell.mjs` 验不到的那半：**用户双击安装包之后发生的事** ——
 * 静默安装 → 装出来的 exe 就是刚验过启动的那一份 → 装上后能打开、数据落在同级 `data\`
 * → 静默卸载 → `app\` 清空、**同级 `data\` 原封不动**、快捷方式与卸载登记都清掉。
 *
 * ⚠️ 前置条件：**本机没有已安装的正式版**（它要写 HKCU 的卸载登记与桌面 / 开始菜单快捷方式）。
 *    条件不满足会直接退出，不硬来。
 * ⚠️ 它**不会**进 `npm run check`：装软件这种事不该在每个提交上自动发生 ——
 *    发第一版、或改动过安装器配置（`tauri.conf.json` 的 `bundle` / NSIS 设置）时手动跑一次。
 * ✅ 安装器会往 `HKCU\Software\qinghua\轻画` 的默认值写"这次装到哪了"（静默升级要用），
 *    脚本跑完会把**原值**写回去，并在最后一条断言里核对。
 *
 * 用法：先 `node scripts/release-desktop.mjs`，再
 *       `node scripts/check-installer-windows.mjs`
 *
 * 一条实现笔记（2026-10-12 实测）：安装器铺出来的 exe 与 `src-tauri/target/release/qinghua.exe`
 * **必然不同** —— Tauri 会在打进包的那份里把标记 `__TAURI_BUNDLE_TYPE_VAR_UNK` 改成 `..._NSS`
 * （NSS = NSIS），**恰好 3 个字节**、PE 时间戳不变。所以判据不是"逐字节相同"，
 * 而是"同尺寸 + 同 PE 时间戳 + 差异只落在这个标记上"。
 */
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { chromium } from 'playwright'

const ROOT = process.cwd()
/** 默认安装包按 `package.json` 的版本取 —— 写死版本号会在下次升版后指到旧产物（第一版就是写死的 0.1.0） */
const VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const SETUP =
  process.env.QH_SETUP ?? path.join(ROOT, `release/${VERSION}/qinghua_${VERSION}_x64-setup.exe`)
const BUILT = path.join(ROOT, 'src-tauri/target/release/qinghua.exe')
const SCRATCH = path.join(ROOT, '.playwright-verify/install-check')
const APP = path.join(SCRATCH, 'app')
const DATA = path.join(SCRATCH, 'data')
const PORT = Number(process.env.QH_CDP_PORT ?? 9446)
const REMEMBER_KEY = 'HKCU\\Software\\qinghua\\轻画'
const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\轻画'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex')

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

function reg(args) {
  /*
   * ⚠️ `reg.exe` 的输出走控制台代码页（本机 936 = GBK），**不是 UTF-8**。
   * 当 UTF-8 读会得到乱码，而且"读乱码 → 写回去"会把注册表值真的写坏（实测踩过一次）。
   */
  const r = spawnSync('reg', args, { windowsHide: true })
  const dec = new TextDecoder('gbk')
  const out = `${r.stdout ? dec.decode(r.stdout) : ''}${r.stderr ? dec.decode(r.stderr) : ''}`
  return { status: r.status, out }
}
function regKeyExists(key) {
  return reg(['query', key]).status === 0
}
/** 读一个键的默认值（输出按 REG_SZ 切，避开中英文本地化差异） */
function regReadDefault(key) {
  if (!regKeyExists(key)) return null
  const { out } = reg(['query', key, '/ve'])
  const line = out.split(/\r?\n/).find((l) => /REG_SZ|REG_EXPAND_SZ/.test(l))
  if (!line) return null
  return line.split(/REG_SZ|REG_EXPAND_SZ/)[1]?.trim() ?? null
}
function regWriteDefault(key, value) {
  return reg(['add', key, '/ve', '/t', 'REG_SZ', '/d', value, '/f']).status === 0
}
function peStamp(buf) {
  const peOff = buf.readUInt32LE(0x3c)
  return { sig: buf.toString('ascii', peOff, peOff + 4), stamp: buf.readUInt32LE(peOff + 8) }
}
async function waitFor(fn, timeoutMs = 90000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true
    await sleep(500)
  }
  return false
}

// ── 前置：机器上不能已经有装好的正式版 ───────────────────────────────
const defaultInstall = path.join(process.env.LOCALAPPDATA ?? '', '轻画')
if (existsSync(path.join(defaultInstall, 'qinghua.exe')) || regKeyExists(UNINSTALL_KEY)) {
  console.error(
    `本机已经有装好的轻画（${defaultInstall} 或 ${UNINSTALL_KEY}）——\n` +
      '这条门禁会写同一套注册表登记，别在有你正在用的安装版时跑。先卸载那个，或换一台机器。',
  )
  process.exit(1)
}
for (const f of [SETUP, BUILT]) {
  if (!existsSync(f)) {
    console.error(`缺 ${f}（先 node scripts/release-desktop.mjs）`)
    process.exit(1)
  }
}

const rememberedBefore = regReadDefault(REMEMBER_KEY)
console.log(`安装包：${SETUP}（${statSync(SETUP).size} B）`)
console.log(`安装到：${APP}`)
console.log(`记住的位置键（跑前）：${rememberedBefore ?? '（无）'}`)

mkdirSync(SCRATCH, { recursive: true })
const install = spawnSync(SETUP, ['/S', `/D=${APP}`], { stdio: 'ignore', windowsHide: true })
check('静默安装进程退出码 0', install.status === 0, `status=${install.status}`)

const installedExe = path.join(APP, 'qinghua.exe')
check('装出了 qinghua.exe', existsSync(installedExe))

if (existsSync(installedExe)) {
  const a = readFileSync(installedExe)
  const b = readFileSync(BUILT)
  let diffs = 0
  let first = -1
  let last = -1
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      if (first < 0) first = i
      last = i
      diffs++
    }
  }
  // 标记本身有 22 个字符在**首个差异之前**（差的是结尾的 UNK→NSS），窗口要往前留够
  const window = a.toString('latin1', Math.max(0, first - 40), first + 64)
  const sameSize = a.length === b.length
  const sameStamp = peStamp(a).stamp === peStamp(b).stamp
  const markerOnly = diffs > 0 && diffs <= 8 && window.includes('__TAURI_BUNDLE_TYPE_VAR_')
  check(
    '装出来的是刚验过启动的那一份（同尺寸 + 同 PE 时间戳 + 只差打包标记）',
    sameSize && sameStamp && markerOnly,
    `尺寸 ${a.length}/${b.length} · PE ${peStamp(a).stamp}/${peStamp(b).stamp} · 差异 ${diffs} 字节 @0x${first.toString(16)}–0x${last.toString(16)}`,
  )
  console.log(`     （安装器哈希 ${sha256(installedExe).slice(0, 16)}… / release 哈希 ${sha256(BUILT).slice(0, 16)}…）`)
}

// 预放一个标记文件：卸载后它必须还在
mkdirSync(DATA, { recursive: true })
const marker = path.join(DATA, 'KEEP-ME.txt')
writeFileSync(marker, 'uninstall must keep this file\n', 'utf8')

// 启动**装出来的那份**：证明安装布局下也能打开，且数据落在同级 data\
let boot = null
if (existsSync(installedExe)) {
  const app = spawn(installedExe, [], {
    cwd: APP,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
    stdio: 'ignore',
  })
  const t0 = Date.now()
  let cdp = false
  while (Date.now() - t0 < 60000 && !cdp) {
    try {
      cdp = (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok
    } catch {
      /* 还没起来 */
    }
    if (!cdp) await sleep(500)
  }
  if (cdp) {
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`)
    const page = browser.contexts().flatMap((c) => c.pages())[0]
    await page?.waitForLoadState('domcontentloaded').catch(() => {})
    await page?.locator('[data-home-page]').waitFor({ timeout: 30000 }).catch(() => {})
    boot = await page?.evaluate(() => ({
      url: location.href,
      platform: document.documentElement.dataset.platform ?? null,
      home: !!document.querySelector('[data-home-page]'),
    }))
    await browser.close().catch(() => {})
  }
  spawnSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' })
  await sleep(1500)
  check('装出来的那份能打开（首页渲染 + desktop 平台）', !!boot?.home && boot?.platform === 'desktop', JSON.stringify(boot))
  check(
    '数据落在同级 data\\（闸门 1–4 在安装布局下生效）',
    existsSync(path.join(DATA, 'EBWebView')),
    DATA,
  )
}

// ── 卸载 ──────────────────────────────────────────────────────────
const uninstaller = path.join(APP, 'uninstall.exe')
check('安装目录里有 uninstall.exe', existsSync(uninstaller))
if (existsSync(uninstaller)) {
  spawnSync(uninstaller, ['/S'], { stdio: 'ignore', windowsHide: true })
  // NSIS 卸载器会把自己拷到临时目录再跑 ⇒ 不是"进程退出 = 卸完"
  const gone = await waitFor(() => !existsSync(installedExe), 90000)
  check('卸载后 qinghua.exe 消失', gone)
  check('卸载后 data\\ 与标记文件原封不动', existsSync(marker), marker)
  const desktopLnk = path.join(process.env.USERPROFILE ?? '', 'Desktop/轻画.lnk')
  const startMenu = path.join(process.env.APPDATA ?? '', 'Microsoft/Windows/Start Menu/Programs/轻画')
  check('桌面快捷方式已清掉', !existsSync(desktopLnk), desktopLnk)
  check('开始菜单条目已清掉', !existsSync(startMenu), startMenu)
  check('卸载登记已清掉', !regKeyExists(UNINSTALL_KEY), UNINSTALL_KEY)
}

// 还原"记住的位置"键（安装器会把它改成这次的临时目录）
let restored = true
if (rememberedBefore !== null) restored = regWriteDefault(REMEMBER_KEY, rememberedBefore)
const rememberedAfter = regReadDefault(REMEMBER_KEY)
check('记住的位置键已还原成本次跑之前的值', restored && rememberedAfter === rememberedBefore, `${rememberedAfter ?? '（无）'}`)

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
for (const f of failed) console.log(`  - ${f.name}${f.detail ? ` — ${f.detail}` : ''}`)

// 收尾：装出来的 app\ 已被卸载器清掉，但 data\ 里是**迁移过来的 160 MB profile**（脚本自己要留的），
// 不清就是垃圾。清理失败不影响判据 —— 它只是收尾。
if (process.env.QH_KEEP_PROFILE !== '1') {
  try {
    const opts = { recursive: true, force: true, maxRetries: 10, retryDelay: 400 }
    rmSync(APP, opts)
    rmSync(DATA, opts)
    console.log(`已清掉临时的 app\\ 与 data\\（日志留在 .playwright-verify/）`)
  } catch (err) {
    console.log(`⚠️ 临时目录没清干净（不影响判据）：${String(err).split('\n')[0]}`)
    console.log(`   手动删：${SCRATCH}`)
  }
}

process.exit(failed.length > 0 ? 1 : 0)
