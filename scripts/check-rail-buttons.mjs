/**
 * 侧栏行的不变式守卫（对账 #313 / #323，都是用户报同一枚「检查更新」的两次）。
 *
 * ## 为什么要有它
 *
 * 侧栏底部那一列有五行（新建项目 / 一级导航 / 全局设置 / 检查更新 / 主题），
 * 它们在**开合两态**和**忙闲两态**下都必须"看起来没动过"。这两条各翻过一次车：
 *
 * 1. **折叠时跳**（#313）—— 每行的左内距必须吃 `--rail-icon-left`（两态同值），
 *    不许写 `justify-content: center`（居中跟实时宽度算，折叠首帧会把图标甩出去）。
 *    当年整列改齐时，`update.module.css` 里的那枚**漏了**，于是用户看到
 *    「差一个图标，自动更新那个图标还是闪的」。
 * 2. **忙态闪**（#323）—— 检查更新那 ~2 秒按钮是 `disabled`，样式写了
 *    `color: var(--text-3)`，于是图标**从灰跳回深**（实测 t=42ms 灰 → t=2081ms 深）。
 *    用户的原话还是那句「自动更新那个图标还是闪的」—— 因为上一轮修的是位置，
 *    颜色这条根本没动过。忙态要表达"在查"，靠**动画 + 文案**，不靠改颜色。
 *
 * 为什么是独立脚本而不是单测：单测跑在 node 环境，`?raw` 导入的 CSS 会被 vitest
 * stub 成空串，读不到真实令牌（同 `check-shell-geometry.mjs` 的理由）。
 *
 * 用法：node scripts/check-rail-buttons.mjs（已接进 `npm run check`）
 */
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8')
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

const sidebar = stripComments(read('../src/app/AppSidebar.module.css'))
const update = stripComments(read('../src/app/update.module.css'))
const updateTsx = read('../src/app/UpdateNotice.tsx')

const problems = []

/** 取一条规则的声明体（`选择器 { ... }`），取不到就当规则消失了 */
const block = (css, selector) => {
  const at = css.indexOf(`${selector} {`)
  if (at < 0) return null
  const end = css.indexOf('}', at)
  return end < 0 ? null : css.slice(at, end)
}

/**
 * 不变式 1：左内距走"轴对齐"口径。
 *
 * `--rail-icon-left` 那两个 0 值也一起认下来（`0 var(--space-2) 0 var(--rail-icon-left)`），
 * 判据是"这一行的 padding 里出现了它"，而不是"padding 长得完全一样"。
 */
const rows = [
  ['src/app/AppSidebar.module.css', '.newBtn', block(sidebar, '.newBtn')],
  ['src/app/AppSidebar.module.css', '.item', block(sidebar, '.item')],
  ['src/app/AppSidebar.module.css', '.footBtn', block(sidebar, '.footBtn')],
  ['src/app/update.module.css', '.sideBtn', block(update, '.sideBtn')],
]
for (const [file, selector, body] of rows) {
  if (body === null) {
    problems.push(`读不到 ${file} 的 ${selector} 规则（改名了？守门脚本要跟着改）`)
    continue
  }
  if (!/padding:[^;]*var\(--rail-icon-left/.test(body)) {
    problems.push(
      `${file} 的 ${selector} 左内距没吃 var(--rail-icon-left) —— ` +
        `两态落点会不一致，折叠时这一行的图标会跳（#313 就是这么漏掉「检查更新」的）`,
    )
  }
}

/**
 * 不变式 2：忙 / 禁用态不许改颜色。
 *
 * 只认 `:disabled` 与 `[data-busy]` 这两类选择器里的 `color` 声明 ——
 * 悬停变色（`:hover`）是交互反馈，不在此列。
 */
const stateRules = [...update.matchAll(/([^{}]*)\{([^}]*)\}/g)]
for (const [, selector, body] of stateRules) {
  /*
   * ⚠️ 判据必须先摘掉 `:not(...)`：`.sideBtn:hover:not(:disabled)` 里含 `:disabled` 字样，
   * 但它**不是**禁用态，而是悬停反馈（悬停变色本来就是对的，不该拦）。
   */
  const s = selector.replace(/:not\([^)]*\)/g, '')
  if (!/:disabled|\[data-busy/.test(s)) continue
  if (/(^|[\s;])color\s*:/.test(body)) {
    problems.push(
      `src/app/update.module.css 的「${selector.trim()}」里改了 color —— ` +
        `忙态（检查更新那 ~2 秒）会看到图标从灰跳回深，用户报过「还是闪的」（#323）。` +
        `要表达"在查"，用动画 + 文案`,
    )
  }
}

/** 不变式 3：忙态得有转圈，且系统"减少动态效果"时能停 */
if (!/\[data-busy='true'\]\s*svg\s*\{[^}]*animation:/.test(update)) {
  problems.push('src/app/update.module.css 少了「忙态转圈」：`[data-busy=\'true\'] svg { animation: … }`')
}
if (!/@media\s*\(prefers-reduced-motion:\s*reduce\)/.test(update)) {
  problems.push('src/app/update.module.css 的忙态动画缺 `prefers-reduced-motion: reduce` 兜底')
}
if (!/data-busy=/.test(updateTsx)) {
  problems.push('src/app/UpdateNotice.tsx 没给按钮挂 `data-busy` —— 忙态样式就落不了地')
}

if (problems.length > 0) {
  console.error('✗ 侧栏行不变式失守\n')
  for (const p of problems) console.error(`  - ${p}`)
  console.error('\n口径：开合两态图标不动（左内距同值）、忙态不改颜色（动画 + 文案代替）。')
  process.exit(1)
}

console.log('✓ 侧栏行不变式自洽：四行左内距同轴、忙态不改颜色、转圈有 reduced-motion 兜底')
