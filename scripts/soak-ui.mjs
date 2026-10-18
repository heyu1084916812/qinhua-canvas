/**
 * 长时间 UI 巡检：循环访问一级页面，检查白屏、空渲染、页面异常和 5xx。
 *
 * 用法：
 *   SOAK_SECONDS=300 node scripts/soak-ui.mjs
 *
 * 前提：对应的 Vite / shared-store 已经启动。脚本只读，不创建项目或素材。
 */
import { chromium } from 'playwright'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:1420'
const durationSeconds = Math.max(30, Number(process.env.SOAK_SECONDS ?? 300))
const allRoutes = [
  ['首页', '/'],
  ['项目', '/projects'],
  ['画布', '/canvas'],
  ['电商', '/ecommerce'],
  ['漫剧', '/storyboard'],
  ['技能库', '/skills'],
  ['灵感库', '/inspiration'],
  ['素材库', '/assets'],
  ['渠道设置', '/settings'],
]
const onlyPath = String(process.env.SOAK_ONLY ?? '').trim()
const routes = onlyPath ? allRoutes.filter(([, path]) => path === onlyPath) : allRoutes
if (routes.length === 0) throw new Error(`SOAK_ONLY 没有匹配路由：${onlyPath}`)

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript(() => {
  try {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
  } catch {
    /* ignore */
  }
})
const page = await context.newPage()
const failures = []
let cycles = 0
let navigations = 0
const started = Date.now()
const deadline = started + durationSeconds * 1000

page.on('pageerror', (error) => {
  failures.push(`pageerror: ${String(error).slice(0, 240)}`)
})
page.on('response', (response) => {
  if (response.status() >= 500 && response.url().includes('127.0.0.1:1420')) {
    failures.push(`HTTP ${response.status()}: ${response.url()}`)
  }
})

while (Date.now() < deadline) {
  cycles += 1
  for (const [label, path] of routes) {
    const before = Date.now()
    try {
      await page.goto(`${BASE}${path}`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      })
      await page.waitForFunction(
        () => {
          const root = document.querySelector('#root')
          return !!root && root.children.length > 0 && document.body.innerText.trim().length > 20
        },
        null,
        { timeout: 15_000 },
      )
      const textLength = await page.evaluate(() => document.body.innerText.trim().length)
      if (textLength < 20) {
        failures.push(`${label}: 正文过短 (${textLength})`)
      }
    } catch (error) {
      failures.push(`${label}: ${String(error?.message ?? error).slice(0, 260)}`)
    }
    navigations += 1
    const elapsed = Date.now() - before
    if (elapsed > 20_000) {
      failures.push(`${label}: 单页加载 ${elapsed}ms`)
    }
  }

  if (cycles % 5 === 0) {
    const health = await fetch('http://127.0.0.1:18765/health').catch(() => null)
    if (!health?.ok) failures.push('shared-store health 请求失败')
    console.log(
      `[soak] cycles=${cycles} navigations=${navigations} elapsed=${Math.round((Date.now() - started) / 1000)}s failures=${failures.length}`,
    )
  }
  await new Promise((resolve) => setTimeout(resolve, 1200))
}

await page.screenshot({ path: '.playwright-verify/soak-final.png' })
const elapsedSeconds = Math.round((Date.now() - started) / 1000)
console.log(
  `[soak] done cycles=${cycles} navigations=${navigations} elapsed=${elapsedSeconds}s failures=${failures.length}`,
)
for (const failure of failures.slice(0, 30)) console.log(`[soak] FAIL ${failure}`)
await browser.close()
if (failures.length > 0) process.exitCode = 1
