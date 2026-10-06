/**
 * 壳层几何守卫（对账 #269 / #274）。
 *
 * 用户的口径是一条**算式**：「自绘标题栏 + 上方留白 = 侧栏折叠宽度」。
 * 这个等式横跨两处来源 —— `ui/tokens.css` 的令牌 与 `app/sidebarState.ts` 的常量 ——
 * 天然会漂移：改了一边、另一边没人提醒，表现是"这根条怎么比侧栏高了"。
 *
 * 所以把它变成 `npm run check` 里的一条硬检查：两边对不上就红，
 * 而不是等用户看出来。（放在脚本里而不是单测里：单测跑在 node 环境，
 * 而 `?raw` 导入的 CSS 会被 vitest stub 成空串，读不到真实令牌。）
 */
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const sidebarSource = read('../src/app/sidebarState.ts')
const tokensSource = read('../src/ui/tokens.css')

const sidebarCollapsed = sidebarSource.match(/SIDEBAR_COLLAPSED_W\s*=\s*(\d+)/)?.[1]
const gap = tokensSource.match(/--shell-gap:\s*(\d+)px/)?.[1]
const titleBarMinuend = tokensSource.match(/--title-bar-h:\s*calc\((\d+)px\s*-\s*var\(--shell-gap\)\)/)?.[1]

const problems = []
if (!sidebarCollapsed) problems.push('读不到 SIDEBAR_COLLAPSED_W（src/app/sidebarState.ts）')
if (!gap) problems.push('读不到 --shell-gap（src/ui/tokens.css）')
if (!titleBarMinuend) {
  problems.push('读不到 --title-bar-h 的算式（应为 calc(64px - var(--shell-gap))）')
} else if (titleBarMinuend !== sidebarCollapsed) {
  problems.push(
    `标题栏算式里的 ${titleBarMinuend}px 与 SIDEBAR_COLLAPSED_W（${sidebarCollapsed}px）不一致`,
  )
}

if (problems.length > 0) {
  console.error('✖ 壳层几何守卫失败\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\n等式口径（用户 2026-10-06）：自绘标题栏 + 上方留白 = 侧栏折叠宽度。')
  process.exit(1)
}

console.log(
  `✔ 壳层几何自洽：标题栏 ${Number(titleBarMinuend) - Number(gap)}px = 侧栏折叠 ${sidebarCollapsed}px − 留白 ${gap}px`,
)
