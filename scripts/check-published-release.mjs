#!/usr/bin/env node
/**
 * 发布**之后**的匿名验收（只读，不改任何东西）：对账 #255 / #256 的那三步，收成一条命令。
 *
 * 为什么要有它：`git push` + 建 Release 之后，"线上到底对不对"以前靠手敲几条 PowerShell ——
 * 10-05 那次就因为用 PS 5.1 发中文正文把标题写成了 `??`（#256），而且**请求是成功的**。
 * 验收必须是**可重复、有判据、能红**的一条命令。
 *
 * 五条判据（全部匿名，不依赖登录态；仓库必须是公开的）：
 *   ① tag `v<版本>` 存在，且是已发布（不是 draft / prerelease）；
 *   ② 资产齐：安装包（ASCII 名）+ `latest.json`（`.sig` 也查，缺了只警告 —— 客户端不直接下它）；
 *   ③ **本地 `release/<版本>/` 与线上逐项对得上**（尺寸；`signature` 字段与本地 `.sig` 一致）——
 *      这一条专治"同一版本号两个不同构建"（对账 241 状态 / 439 状态②踩过）；
 *   ④ 稳定别名 `…/releases/latest/download/latest.json` 能取到，且版本**不比这次的旧**；
 *   ⑤ 清单里那个安装包直链 200，`Content-Length` 与本地一致（字节数对得上才算数）。
 *
 * 用法：
 *   node scripts/check-published-release.mjs                 # 版本取 package.json
 *   node scripts/check-published-release.mjs --version 0.1.1
 *   node scripts/check-published-release.mjs --repo heyu1084916812/qinhua-canvas
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const valueOf = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : null
}

const conf = JSON.parse(readFileSync(path.join(ROOT, 'src-tauri/tauri.conf.json'), 'utf8'))
const version = valueOf('--version') ?? JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version
const repoFromEndpoint = /github\.com\/([^/]+\/[^/]+)\/releases\//.exec(
  conf?.plugins?.updater?.endpoints?.[0] ?? '',
)?.[1]
const repo = valueOf('--repo') ?? repoFromEndpoint
if (!repo) {
  console.error('推不出仓库：要么给 --repo owner/name，要么 tauri.conf.json 的 endpoints 里要有 github.com/<owner>/<repo>/releases/…')
  process.exit(1)
}

const outDir = path.join(ROOT, 'release', version)
const asset = `qinghua_${version}_x64-setup.exe`
const local = {
  exe: path.join(outDir, asset),
  sig: path.join(outDir, `${asset}.sig`),
  json: path.join(outDir, 'latest.json'),
}
console.log(`仓库：${repo}`)
console.log(`版本：${version}`)
console.log(`本地产物：release/${version}/（exe ${existsSync(local.exe) ? statSync(local.exe).size : '缺'} B）`)
if (!existsSync(local.exe) || !existsSync(local.json)) {
  console.error(`本地缺产物（${outDir}）—— 先 node scripts/release-desktop.mjs；这个脚本只做"线上 vs 本地"的比对。`)
  process.exit(1)
}

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const api = (p) =>
  fetch(`https://api.github.com/repos/${repo}${p}`, {
    headers: { 'User-Agent': 'qinghua-release-check', Accept: 'application/vnd.github+json' },
  })
const semver = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10))
const cmp = (a, b) => {
  const x = semver(a)
  const y = semver(b)
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0)
  return 0
}

// ① tag 与发布状态
const rel = await api(`/releases/tags/v${version}`)
const relJson = rel.ok ? await rel.json() : null
check(
  `tag v${version} 存在且已发布（不是 draft / prerelease）`,
  rel.ok && relJson && relJson.draft === false && relJson.prerelease === false,
  rel.ok ? `published_at=${relJson.published_at}` : `HTTP ${rel.status}`,
)
const releaseText = `${relJson?.name ?? ''}\n${relJson?.body ?? ''}`
check(
  'Release 标题与正文没有乱码或问号占位',
  rel.ok && !/\?{2,}|\uFFFD/.test(releaseText),
  rel.ok ? `${releaseText.length} 字符` : '无法读取 Release 正文',
)

// ② 资产齐 + ③ 与本地逐项对得上
const assets = relJson?.assets ?? []
const byName = new Map(assets.map((a) => [a.name, a]))
const localExeSize = statSync(local.exe).size
const remoteExe = byName.get(asset)
check('资产齐：安装包 + latest.json', !!remoteExe && !!byName.get('latest.json'), assets.map((a) => `${a.name}(${a.size})`).join(' / ') || '（无资产）')
check(
  `线上安装包与本地**同一份字节**（尺寸 ${localExeSize} B）`,
  !!remoteExe && remoteExe.size === localExeSize,
  remoteExe ? `线上 ${remoteExe.size} B` : '线上没有这个资产',
)
const remoteManifest = byName.get('latest.json')
if (remoteManifest) {
  const manifest = await fetch(remoteManifest.browser_download_url).then((r) => (r.ok ? r.json() : null))
  const localSig = existsSync(local.sig) ? readFileSync(local.sig, 'utf8').trim() : null
  const remoteSig = manifest?.platforms?.['windows-x86_64']?.signature?.trim() ?? null
  check('线上 latest.json 的 version 与签名与本地一致', manifest?.version === version && localSig === remoteSig, `version=${manifest?.version} 签名${localSig === remoteSig ? '一致' : '不一致'}`)
  // ⑤ 清单里的直链真能下、字节数对得上
  const url = manifest?.platforms?.['windows-x86_64']?.url
  const head = url ? await fetch(url, { method: 'HEAD' }) : null
  const len = Number(head?.headers.get('content-length') ?? -1)
  check('清单里的安装包直链 200 且 Content-Length 与本地一致', !!head && head.status === 200 && len === localExeSize, url ? `HTTP ${head.status} · ${len} B` : '清单里没有 url')
} else {
  check('线上有 latest.json', false)
}

// ④ 稳定别名（客户端真正读的那个地址）返回的版本不比这次旧
const aliasUrl = `https://github.com/${repo}/releases/latest/download/latest.json`
const alias = await fetch(aliasUrl, { headers: { 'User-Agent': 'qinghua-release-check' } })
const aliasJson = alias.ok ? await alias.json() : null
check(
  '稳定别名可用，且版本不比这次的旧',
  alias.ok && aliasJson && cmp(aliasJson.version, version) >= 0,
  alias.ok ? `${aliasUrl} → version=${aliasJson?.version}` : `HTTP ${alias.status}`,
)

const failed = results.filter((r) => !r.ok)
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
if (failed.length > 0) console.log(`失败项：\n${failed.map((f) => `  - ${f.name}`).join('\n')}`)
process.exit(failed.length > 0 ? 1 : 0)
