/**
 * 壳层几何守卫（对账 #269 / #274；**2026-10-06 第 11 批改过口径**）。
 *
 * **旧口径**是一条算式：「自绘标题栏 + 上方留白 = 侧栏折叠宽度」（49 + 15 = 64）。
 * **新口径**（用户 2026-10-06 第 11 批第 3 条：「原生栏太高了，缩小三分之一，
 * 但是文字和文字所在的容器不要缩小」）：标题栏压到 **33px**（49 的 2/3 ≈ 32.7，
 * 向上取整），侧栏折叠宽度仍是 64、四周留白仍是 15 —— 算式作废，两者不再相关。
 *
 * 守卫改成钉**新的意图**：33 必须 ≈（64 − 15）的 2/3（±1px）。它同时挡住两种退化 ——
 * 有人把它改回 49（那正是用户嫌高的那一版）、或者随手写个别的数。
 *
 * （放在脚本里而不是单测里：单测跑在 node 环境，
 * 而 `?raw` 导入的 CSS 会被 vitest stub 成空串，读不到真实令牌。）
 */
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')

const sidebarSource = read('../src/app/sidebarState.ts')
const tokensSource = read('../src/ui/tokens.css')
const sidebarCss = read('../src/app/AppSidebar.module.css')
const projectTreeCss = read('../src/app/ProjectTree.module.css')

const sidebarCollapsed = sidebarSource.match(/SIDEBAR_COLLAPSED_W\s*=\s*(\d+)/)?.[1]
const gap = tokensSource.match(/--shell-gap:\s*(\d+)px/)?.[1]
const titleBar = tokensSource.match(/--title-bar-h:\s*(\d+)px/)?.[1]

const problems = []
if (!sidebarCollapsed) problems.push('读不到 SIDEBAR_COLLAPSED_W（src/app/sidebarState.ts）')
if (!gap) problems.push('读不到 --shell-gap（src/ui/tokens.css）')
if (!titleBar) {
  problems.push('读不到 --title-bar-h（应为固定 px，如 33px）')
} else if (sidebarCollapsed && gap) {
  const oldRhythm = Number(sidebarCollapsed) - Number(gap) // 旧口径：64 − 15 = 49
  const want = (oldRhythm * 2) / 3 // 「缩小三分之一」⇒ 2/3 ≈ 32.67
  if (Math.abs(Number(titleBar) - want) > 1) {
    problems.push(
      `--title-bar-h = ${titleBar}px，但「缩小三分之一」要求 ≈ ${want.toFixed(1)}px（旧值 ${oldRhythm}px 的 2/3，±1px）`,
    )
  }
}

if (problems.length > 0) {
  console.error('✖ 壳层几何守卫失败\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\n等式口径（用户 2026-10-06）：自绘标题栏 + 上方留白 = 侧栏折叠宽度。')
  process.exit(1)
}

const compactStart = sidebarCss.indexOf('@media (max-height: 920px)')
const compactSidebar = compactStart >= 0 ? sidebarCss.slice(compactStart) : ''
const compactTreeStart = projectTreeCss.indexOf('@media (max-height: 920px)')
const compactTree = compactTreeStart >= 0 ? projectTreeCss.slice(compactTreeStart) : ''
const compactRules = [
  [compactSidebar, /\.newBtn\s*\{[^}]*height:\s*36px/, '短视口必须把“新建项目”收到 36px'],
  [compactSidebar, /\.item\s*\{[^}]*height:\s*36px/, '短视口必须把一级导航收到 36px'],
  [compactSidebar, /\.footBtn\s*\{[^}]*height:\s*36px/, '短视口必须把全局设置按钮收到 36px'],
  [compactTree, /\.root\s*\{[^}]*margin-top:\s*var\(--space-3\)/, '短视口必须收紧项目树顶部间距'],
  [compactTree, /\.groupRow,[\s\S]*?\.projectRow\s*\{[^}]*height:\s*28px/, '短视口必须把项目树行高收到 28px'],
]
for (const [source, pattern, message] of compactRules) {
  if (!pattern.test(source)) problems.push(message)
}

if (problems.length > 0) {
  console.error('✖ 壳层短视口守卫失败\n')
  for (const problem of problems) console.error(`  - ${problem}`)
  console.error('\n1178×762 下项目树必须保留可滚动空间，不能让底部设置区压住第三组项目。')
  process.exit(1)
}

console.log(
  `✔ 壳层几何自洽：标题栏 ${titleBar}px ≈ 旧口径 ${Number(sidebarCollapsed) - Number(gap)}px 的三分之二；短视口侧栏 36px、项目树 28px 行高规则存在`,
)
