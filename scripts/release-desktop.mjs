#!/usr/bin/env node
/**
 * 桌面版发版（《轻画-桌面封装方案.md》§5.2 / 对账 #223）。
 *
 * 干三件事，**只在本机产出文件，不推任何东西**：
 *  1. 三方版本号对齐检查（`package.json` / `tauri.conf.json` / `Cargo.toml`）——
 *     它们不一致时安装包的版本、界面显示的版本、更新比较用的版本会各说各话；
 *  2. 构建 + **签名**（`npm run tauri build`，私钥来自 `TAURI_SIGNING_PRIVATE_KEY`）；
 *  3. 把安装包 + `latest.json`（Tauri 更新清单）整理进 `release/<版本>/`，可直接上传 ——
 *     顺带**核对签名**：这份 `.sig` 必须是 `tauri.conf.json` 里那枚公钥签的（Ed25519 真验签）。
 *  4. **交付门禁**：拿这份 release 产物真机启动一次（`scripts/check-release-shell.mjs`，对账 #438）——
 *     包"生成出来"不等于"装上去能打开"；不过门禁就不该上传。
 *
 * 用法：
 *   node scripts/release-desktop.mjs                     # 构建 + 出品
 *   node scripts/release-desktop.mjs --skip-build        # 复用已有产物，只出品
 *   node scripts/release-desktop.mjs --notes "改了啥"     # 写进清单，客户端会看到
 *   node scripts/release-desktop.mjs --notes-file x.txt  # 从 UTF-8 文件读取，避免 PowerShell 中文编码坑
 *   node scripts/release-desktop.mjs --base-url <地址>    # 覆盖下载地址前缀
 *   node scripts/release-desktop.mjs --no-shell-check    # 跳过启动自检（不推荐）
 */
import { createHash, createPublicKey, verify } from 'node:crypto'
import { execFileSync, execSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import process from 'node:process'

const ROOT = path.resolve(import.meta.dirname, '..')
const args = process.argv.slice(2)
const has = (name) => args.includes(name)
const valueOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

function releaseNotesFor(version) {
  const lines = readFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), 'utf8').split(/\r?\n/)
  const start = lines.findIndex((line) => line.startsWith(`## ${version} `))
  if (start < 0) return `轻画 ${version}`
  const section = []
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === '---') break
    section.push(line)
  }
  return section.join('\n').trim() || `轻画 ${version}`
}

/** 产物名**必须 ASCII**：中文名在 URL 里要百分号编码，换一个宿主就可能取不到文件 */
const assetName = (version) => `qinghua_${version}_x64-setup.exe`
const TARGET = 'windows-x86_64'

function readVersions() {
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const conf = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'))
  const cargo = readFileSync(path.join(ROOT, 'src-tauri/Cargo.toml'), 'utf8')
  const cargoVersion = /^\s*version\s*=\s*"([^"]+)"/m.exec(cargo.split('[dependencies]')[0])?.[1] ?? null
  return { pkg: pkg.version, conf: conf.version, cargo: cargoVersion, conf_json: conf }
}

function assertVersionsAligned({ pkg, conf, cargo }) {
  const all = [pkg, conf, cargo]
  if (all.some((v) => !v)) {
    throw new Error(`版本号读不全：package.json=${pkg} tauri.conf.json=${conf} Cargo.toml=${cargo}`)
  }
  if (new Set(all).size !== 1) {
    throw new Error(
      `三处版本号不一致：package.json=${pkg} / tauri.conf.json=${conf} / Cargo.toml=${cargo}\n` +
        '先统一（发版时一起升），否则安装包版本、界面显示、更新比较会各说各话。',
    )
  }
  return pkg
}

/**
 * 更新地址必须在配置里、且是**稳定别名**（对账 #239 的坑 / #439 状态④）。
 *
 * 这条链最隐蔽的一处：客户端只认**装包时写死**的那一个地址 ⇒
 * 地址里带了版本号，装出去的那一版就永远只看得见自己的清单、**永远发现不了新版**；
 * 地址为空则表现为"点检查更新只会说还没接更新地址"。两种都不会报错，只会在用户侧静默失效。
 *
 * 放在构建**之前**：地址不对就别浪费 3 分钟去编 Rust。
 */
function assertUpdaterEndpointWired(confJson) {
  const list = confJson?.plugins?.updater?.endpoints
  if (!Array.isArray(list) || list.length === 0) {
    throw new Error(
      'tauri.conf.json 的 plugins.updater.endpoints 是空的 —— 这种包发出去，用户永远收不到更新。\n' +
        '先填好稳定别名（本项目：…/releases/latest/download/latest.json）再打包。',
    )
  }
  const versioned = list.find((u) => /\/v?\d+\.\d+\.\d+(\/|$)/.test(String(u)))
  if (versioned) {
    throw new Error(
      `更新地址里带了版本号：${versioned}\n` +
        '客户端只认**装包时写死**的那一个 ⇒ 等于"装出去的那一版永远只看得见自己的清单"。\n' +
        '改成稳定别名：…/releases/latest/download/latest.json',
    )
  }
  console.log(`[release] 更新地址：${list[0]}（稳定别名，不带版本号）`)
}

function privateKeyPath() {
  const fromEnv = process.env.TAURI_SIGNING_PRIVATE_KEY
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  if (fromEnv) return fromEnv // 也可能直接是密钥字符串
  return path.join(homedir(), '.tauri', 'qinghua-updater.key')
}

/**
 * 签名核对（2026-10-12 加，对账 #439 状态③）：**签这个包的私钥，必须与配置里的公钥成对**。
 *
 * 为什么值得单独挡一道：签名是真的、脚本也跑得完，但**钥匙不对**时，
 * 已经装出去的老版本（它们只认自己配置文件里那枚公钥）更新时会验签失败 ——
 * 用户那边看到"更新失败"，发布机上却什么都看不出来。
 *
 * 做法不是"比 key id"而是**真验签**（对账 #439 状态③ 的故障注入暴露了比 key id 太松：
 * 改掉算法字节 key id 照样相等）：minisign 形态下
 * 公钥 42 B = alg(2) + keyid(8) + key(32)；签名 74 B = alg(2) + keyid(8) + sig(64)，
 * 第二字节 `D` 表示**预哈希** ⇒ 对 `BLAKE2b-512(安装包字节)` 做 Ed25519 验签。
 *
 * ⚠️ 两层编码：`.sig` 与配置里的 `pubkey` 都是**「minisign 文本」的 base64**
 * （文本里还有一行英文注释 + 一行 base64），少解一层就会拿注释的字节去当密钥
 * （那会得到 `alg=117,110` 这种一看就不对的数字）。
 */
function unpackMinisign(outerBase64) {
  const text = Buffer.from(String(outerBase64 ?? '').trim(), 'base64').toString('utf8')
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => /^[A-Za-z0-9+/=]{40,}$/.test(l))
  if (!line) return null
  return Buffer.from(line, 'base64')
}

function assertSignatureVerifies(confJson, setupFile, sigFile) {
  const pub = unpackMinisign(confJson?.plugins?.updater?.pubkey)
  const sig = unpackMinisign(readFileSync(sigFile, 'utf8'))
  if (!pub || !sig) throw new Error('读不出签名密钥 id（pubkey 或 .sig 的格式变了？）')
  const pubKeyId = pub.subarray(2, 10).toString('hex')
  const sigKeyId = sig.subarray(2, 10).toString('hex')
  if (pubKeyId !== sigKeyId) {
    throw new Error(
      `签名密钥与配置里的公钥不是同一把：配置 ${pubKeyId} / 本次签名 ${sigKeyId}\n` +
        '后果很重：**已经装出去的老版本只认配置里那枚公钥**，钥匙换过就再也收不到自动更新\n' +
        '（用户只能手动重装一次）。先确认 TAURI_SIGNING_PRIVATE_KEY 指的是当初那一把私钥。',
    )
  }
  const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex') // Ed25519 的 SPKI 头
  const key = createPublicKey({
    key: Buffer.concat([SPKI_PREFIX, pub.subarray(10, 42)]),
    format: 'der',
    type: 'spki',
  })
  const digest = createHash('blake2b512').update(readFileSync(setupFile)).digest()
  const ok = verify(null, digest, key, sig.subarray(10, 74))
  if (!ok) {
    throw new Error(
      '安装包的签名**验不过**（Ed25519 + BLAKE2b-512 预哈希）。\n' +
        '别上传：老版本更新时会验签失败，而且发布机上其它检查全是绿的。\n' +
        `  安装包：${setupFile}\n  签名：${sigFile}\n  配置公钥：src-tauri/tauri.conf.json → plugins.updater.pubkey`,
    )
  }
  console.log(`[release] 签名核对：Ed25519 验签通过（keyid ${sigKeyId}，与配置里的公钥同一把）`)
}

function runBuild(key) {
  if (typeof key === 'string' && path.isAbsolute(key) && !existsSync(key)) {
    throw new Error(
      `找不到更新私钥：${key}\n` +
        '没有它签不出更新包 —— 而**已经装出去的老版本只认这一对密钥**。\n' +
        '找回来再发版；实在丢了，用户只能手动重装一次新版本（那是唯一一次必须手动的更新）。',
    )
  }
  console.log('[release] 构建中（前端 + Rust + NSIS 安装包 + 签名）…')
  execSync('npm run tauri build -- --bundles nsis', {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key },
  })
}

/** 从 origin 推出下载地址前缀（GitHub Releases 的固定形态）；推不出就返回 null */
function defaultBaseUrl(version) {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote)
    if (m) return `https://github.com/${m[1]}/${m[2]}/releases/download/v${version}`
  } catch {
    /* 没有 origin：回落到占位符，并大声提醒 */
  }
  return null
}

/**
 * 更新清单的**稳定**地址（要写进 `tauri.conf.json` 的那一行）。
 *
 * ⚠️ 它和上面那个 `defaultBaseUrl(version)` 是**两件事**，别混：
 *   - `defaultBaseUrl(version)` 是**这一次**安装包的下载前缀 ⇒ 写进 `latest.json` 的 `url`，**必须带版本号**；
 *   - 这里是**客户端去查"有没有新版"的地址** ⇒ 它被**写死在每个已装出去的包里**，老版本只认自己那一个。
 *     带上版本号的话，用户装的那一版就永远只看得见那一版的清单、永远发现不了新版。
 * 故这里用 GitHub 的 `releases/latest/download` **别名**：永远指向最新一次 Release 的同名资产。
 */
function defaultEndpointUrl() {
  try {
    const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim()
    const m = /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote)
    if (m) return `https://github.com/${m[1]}/${m[2]}/releases/latest/download/latest.json`
  } catch {
    /* 没有 origin：回落到本次地址，并在下面提醒 */
  }
  return null
}

const versions = readVersions()
const version = assertVersionsAligned(versions)
console.log(`[release] 版本 ${version}（三处一致）`)
assertUpdaterEndpointWired(versions.conf_json)
const notesFile = valueOf('--notes-file')
const notes = notesFile
  ? readFileSync(path.resolve(ROOT, notesFile), 'utf8').trim()
  : (valueOf('--notes') ?? releaseNotesFor(version))

const key = privateKeyPath()
if (!has('--skip-build')) runBuild(key)
else console.log('[release] --skip-build：复用已有构建产物')

/**
 * 发布门禁：`dist/` 里不该有"清数据 / 重置"这类**危险的一次性页面**。
 *
 * 背景：`public/` 会被原样拷进 `dist` ⇒ 一个临时做来清库的 `__cleanup_195.html`
 * （点一下删 nodes / edges / assets / …）会**跟着安装包发出去**。它没有界面入口，
 * 但没必要让用户机器上多一个"清库按钮"。
 * 这里**不替谁删文件**（开发期可能还要用）——只在发布时拦住，并说清怎么处理。
 */
const RISKY_PAGE = /cleanup|reset|wipe|清库|清空|清理/i
const riskyPages = []
for (const dir of ['public', 'dist']) {
  const abs = path.join(ROOT, dir)
  if (!existsSync(abs)) continue
  for (const f of readdirSync(abs)) if (RISKY_PAGE.test(f)) riskyPages.push(`${dir}/${f}`)
}
if (riskyPages.length > 0) {
  throw new Error(
    `这些页面不该随包发布：${riskyPages.join(' / ')}\n` +
      '理由：`public/` 会被原样拷进 dist，再被打进安装包；“清库 / 重置”这类一次性工具会让用户机器上' +
      '多一个按钮一点就删数据的入口（它不在界面上暴露，但没必要带着发货）。\n' +
      '处理办法：把它移出 public/（挪到 scripts/ 或项目根都行），确认无用就直接删掉；然后重新构建再发版。',
  )
}

const nsisDir = path.join(ROOT, 'src-tauri/target/release/bundle/nsis')
if (!existsSync(nsisDir)) throw new Error(`没有构建产物：${nsisDir}`)
/**
 * ⚠️ 必须**按版本号**挑产物，不能"第一个 `*-setup.exe` 就是它"。
 *
 * makensis 不会清理上一次的输出 ⇒ `bundle/nsis/` 里会同时躺着 0.1.0 和 0.1.1 两个安装包。
 * 按第一个匹配拿，就会把**旧版本**的包装进新版本的 `latest.json`：
 * 客户端拉到"0.1.1 有新版本"、下下来却是 0.1.0 ⇒ 用户"升级"回了旧版，而且因为签名是真的，**验签也会通过**。
 * （这不是推演：本地演练第二次发版时就拿到了 0.1.0 的包与签名，是签名里的 `file:`/`version:` 把它暴露出来的。）
 */
const candidates = readdirSync(nsisDir).filter((f) => f.endsWith('-setup.exe'))
const setupName = candidates.find((f) => f.includes(`_${version}_`))
if (!setupName) {
  throw new Error(
    `bundle/nsis 里没有 ${version} 的安装包（现有：${candidates.join(' / ') || '（空）'}）。\n` +
      '先确认这次构建真的成功了、且三处版本号一致 —— **别拿上一次的旧产物当新版本发**。',
  )
}
const setupPath = path.join(nsisDir, setupName)
const sigPath = `${setupPath}.sig`
if (!existsSync(sigPath)) {
  throw new Error(
    `没有签名文件：${sigPath}\n` +
      '说明这次构建没带更新私钥（TAURI_SIGNING_PRIVATE_KEY）—— 没有签名的包**不能**用于自动更新。',
  )
}
assertSignatureVerifies(versions.conf_json, setupPath, sigPath)

const baseUrl = valueOf('--base-url') ?? defaultBaseUrl(version)
const base = baseUrl ?? `https://REPLACE-ME.example.com/v${version}`
const outDir = path.join(ROOT, 'release', version)
mkdirSync(outDir, { recursive: true })

const asset = assetName(version)
copyFileSync(setupPath, path.join(outDir, asset))
copyFileSync(sigPath, path.join(outDir, `${asset}.sig`))

const manifest = {
  version,
  notes,
  pub_date: new Date().toISOString(),
  platforms: {
    [TARGET]: { signature: readFileSync(sigPath, 'utf8').trim(), url: `${base}/${asset}` },
  },
}
writeFileSync(path.join(outDir, 'latest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

console.log(`\n[release] 出品目录：release/${version}`)
for (const f of [asset, `${asset}.sig`, 'latest.json']) console.log(`  - ${f}`)

/**
 * 交付门禁（对账 #438）：**产物生成出来 ≠ 装上去能打开**。
 *
 * 这一道把"要交给用户的那个二进制"真的启动一次：拷进临时布局跑起来，用 CDP 断言
 * 内嵌前端 / 平台判定 / 首屏 / 版本号 / mediapipe wasm / 同级 `data\` 与迁移 / 无运行时报错。
 * 它只看**磁盘与页面里的真值**，跑完自动清掉临时 profile（详见 `check-release-shell.mjs` 头部注释）。
 *
 * 为什么放在发版脚本里而不是留给人工：这是唯一一个"必须真启动"的判据 ——
 * 漏了它，安装包看着一切正常（有大小、有签名、清单也对），用户双击却可能什么都不弹。
 */
if (!has('--no-shell-check')) {
  console.log('\n[release] 交付门禁：release 产物真机启动自检')
  const gate = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-release-shell.mjs')], {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env,
  })
  if (gate.error) throw new Error(`启动自检没跑起来：${gate.error.message}`)
  if (gate.status !== 0) {
    throw new Error(
      `release 产物启动自检没过（退出码 ${gate.status}）⇒ 这一版**不算打好了，别上传**。\n` +
        '  单独复跑看细节：node scripts/check-release-shell.mjs\n' +
        '  真要跳过这一道（不推荐）：node scripts/release-desktop.mjs --no-shell-check',
    )
  }
} else {
  console.log('\n[release] ⚠️ 已跳过启动自检（--no-shell-check）：这一版没被真启动验证过。')
}

console.log('\n[release] 接下来（都在发布机外，脚本不代做）：')
console.log(`  1. 把 release/${version}/ 里的 ${asset} 与 latest.json 上传到 tag v${version} 的 Release`)
console.log(`  2. 让「更新地址」指向**稳定**清单：src-tauri/tauri.conf.json`)
console.log(`     plugins.updater.endpoints = ["${defaultEndpointUrl() ?? `${base}/latest.json`}"]`)
console.log('     （别用带版本号的地址：客户端只认**装包时写死**的那一个，带了版本号就永远发现不了新版）')
console.log('  3. 之后每次发版：升三处版本号 → node scripts/release-desktop.mjs → 重复第 1 步')
if (!baseUrl) {
  console.log('\n⚠️ 没能从 git origin 推出下载地址：latest.json 里的 url 还是占位符，上传前用 --base-url 重跑一次。')
}
console.log('⚠️ 走 GitHub Releases 时仓库必须**公开**；私有仓库的直链要带 token，不能给客户端用。')
console.log(`⚠️ 更新私钥（${key}）丢一次，所有已装出去的版本就再也收不到自动更新 —— 备份它。`)
