/**
 * 主题守卫：组件样式里不许出现字面量颜色。
 *
 * ## 为什么要有它
 *
 * `ui/tokens.css` 顶部写着「组件样式里出现字面量颜色即视为违规（由 lint 拦截）」，
 * 但**那句话此前是假的**——项目里没装 stylelint，也没有任何东西在查。
 * 结果是：主题是靠「换一份变量表」生效的，组件只要写死一个 `#xxx`，
 * 深色主题就静默退化成浅色那套，而 tsc / eslint / 单测 / 冒烟**全绿**
 * （冒烟默认只在浅色下跑，根本看不到）。
 *
 * 这类缺陷唯一的发现方式是「有人正好切到深色看一眼」，而深色主题上线后
 * 日常开发仍在浅色下做 —— 它会安静地烂掉很久。故加一道自动拦截。
 *
 * ## 为什么是独立脚本而不是 stylelint 规则
 *
 * 只需要「扫描 CSS 里的颜色字面量」这一件事，为此引入 stylelint + 配置 +
 * 一个开发依赖不划算；且这条规则要能解释**为什么**（每个例外都得有理由），
 * 写成脚本里的白名单比写进 stylelint 配置更好读。
 *
 * 用法：node scripts/check-theme.mjs（已接进 `npm run check`）
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const SRC = join(ROOT, 'src')

/**
 * 允许写字面量颜色的文件（每个都写了理由）。
 * 除 `ui/tokens.css` 外一律要求**带理由的例外**，且例外只在该文件内生效。
 */
const ALLOWED = new Map([
  // 令牌表本身就是唯一的定义处：明 / 暗两套值都写在这里
  ['src/ui/tokens.css', '令牌唯一来源'],
  /**
   * 小地图的点阵与视口框：SVG 的 fill / stroke **属性**写死后无法跟随主题，
   * 故颜色挪进 CSS 类；而它在同一份文件里需要给出明 / 暗**两组**值
   * （`[data-theme=dark]` 选择器），这些值本身就是主题定义的一部分。
   */
  ['src/workbenches/canvas/surface/Minimap.module.css', 'SVG 点阵的两组主题值'],
])

/** 注释里的说明文字不算违规（如「深色实底 #2E2E2D」这类描述） */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 一条违规：{ file, line, text }
 *
 * 判定两种写法：
 * - 十六进制：`#rgb` / `#rrggbb` / `#rrggbbaa`（含 `color: #fff` 这种简写）
 * - 函数式：`rgb(...)` / `rgba(...)`
 * 刻意**不**拦 `transparent` / `currentColor` / 具名安全色——它们不携带具体色相，
 * 在两套主题下都成立，拦了只会逼人写没意义的变量。
 */
const HEX = /#[0-9a-fA-F]{3,8}\b/
const RGB_FN = /\brgba?\(/

function findViolations(absPath, relPath) {
  const raw = readFileSync(absPath, 'utf8')
  const lines = stripComments(raw).split(/\r?\n/)
  const out = []
  lines.forEach((text, i) => {
    if (HEX.test(text) || RGB_FN.test(text)) {
      out.push({ file: relPath, line: i + 1, text: text.trim().slice(0, 120) })
    }
  })
  return out
}

/** 递归收集 src 下的 .css（跳过 node_modules / dist） */
function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue
      walk(abs, acc)
    } else if (name.endsWith('.css')) {
      acc.push(abs)
    }
  }
  return acc
}

const files = walk(SRC)
const violations = []
for (const abs of files) {
  const rel = relative(ROOT, abs).split(sep).join('/')
  if (ALLOWED.has(rel)) continue
  violations.push(...findViolations(abs, rel))
}

if (violations.length === 0) {
  console.log(`✔ 主题守卫通过：${files.length} 个 CSS 文件，无字面量颜色`)
  for (const [file, why] of ALLOWED) console.log(`  例外（${why}）：${file}`)
  process.exit(0)
}

console.error(`✖ 主题守卫失败：${violations.length} 处字面量颜色\n`)
console.error('组件样式必须只引用 ui/tokens.css 的令牌，否则深色主题会静默退化')
console.error('（写 var(--xxx) 即可让明暗两套同时生效；确需例外的请加进白名单并写明理由）\n')
for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`)
process.exit(1)
