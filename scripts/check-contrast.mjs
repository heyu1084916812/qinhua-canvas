/**
 * 对比度守卫：**任意预设组合下正文都读得清**（对账 #379 的 C6）。
 *
 * ## 为什么需要它
 *
 * 画布底色从「一个写死的值」变成「六档色调 + 明暗两套主题」之后，
 * 组合从 2 种变成 12 种。人眼只会检查当前正开着的那一种，其余 11 种靠运气 ——
 * 而"某个色调下标题糊在底上"是那种**上线很久才被某个用户撞见**的缺陷。
 * 与主题守卫同一类：写错了没有任何信号，故用算式钉住。
 *
 * ## 判据
 *
 * 1. **正文**（`--text-1`）对每一种画布底色（6 档色调 × 明暗 2 套）≥ 4.5:1 —— WCAG AA 正文口径；
 * 2. **网格线**（`--canvas-grid-line`，由底色与正文派生）对底色可辨：比值落在 1.15–3 之间 ——
 *    低于 1.15 等于看不见，高于 3 会喧宾夺主（网格是背景，不是内容）。
 *
 * 只读 `src/ui/tokens.css`（令牌唯一来源），不读组件 CSS ——
 * 组件里写字面量颜色本来就已被 `check-theme.mjs` 拦下。
 *
 * 用法：node scripts/check-contrast.mjs（已接进 `npm run check`）
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const TOKENS = join(ROOT, 'src', 'ui', 'tokens.css')
const raw = readFileSync(TOKENS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** 抽出一个选择器块里的 `--x: value` 声明（够用即可：本文件没有嵌套规则） */
function blockOf(selector) {
  const at = raw.indexOf(`${selector} {`)
  if (at < 0) throw new Error(`tokens.css 里找不到选择器块：${selector}`)
  const open = raw.indexOf('{', at)
  const close = raw.indexOf('}', open)
  const body = raw.slice(open + 1, close)
  const map = new Map()
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    map.set(m[1], m[2].trim())
  }
  return map
}

const light = blockOf(':root')
const dark = blockOf("[data-theme='dark']")
/**
 * 画布底色与网格线的派生根（声明在带 `data-canvas-tone` 的元素上，见 tokens.css）。
 * 网格线的公式住在这里，逐档改 `--canvas-bg` 再解析它就是"六档各验一遍"。
 */
const derived = blockOf('[data-canvas-tone]')

/** 解析一个 CSS 颜色到 {r,g,b}；认 hex 与 rgb()/rgba()（本仓库令牌只出现这两种） */
function parseColor(value) {
  const v = value.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(v)
  if (hex) {
    const h = hex[1]
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    }
  }
  const fn = /^rgba?\(([^)]+)\)$/i.exec(v)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite)) {
      return { r: parts[0], g: parts[1], b: parts[2] }
    }
  }
  return null
}

/**
 * 把一个令牌值解析成颜色。
 *
 * 支持三种形态（本仓库实际用到的）：
 *  - 直接颜色：`#ffffff`
 *  - 变量引用：`var(--x)`
 *  - 派生混色：`color-mix(in srgb, var(--a) 88%, var(--b))`
 */
function resolve(name, scope, seen = new Set()) {
  if (seen.has(name)) throw new Error(`令牌循环引用：${name}`)
  seen.add(name)
  const value = scope.get(name) ?? light.get(name)
  if (value === undefined) throw new Error(`令牌未定义：${name}`)

  const direct = parseColor(value)
  if (direct) return direct

  const varOnly = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value)
  if (varOnly) return resolve(varOnly[1], scope, seen)

  const mix = /^color-mix\(\s*in srgb\s*,\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*([\d.]+)%\s*,\s*var\(\s*(--[a-z0-9-]+)\s*\)\s*\)$/i.exec(
    value,
  )
  if (mix) {
    const a = resolve(mix[1], scope, new Set(seen))
    const b = resolve(mix[3], scope, new Set(seen))
    const wa = Number(mix[2]) / 100
    return {
      r: a.r * wa + b.r * (1 - wa),
      g: a.g * wa + b.g * (1 - wa),
      b: a.b * wa + b.b * (1 - wa),
    }
  }
  throw new Error(`不认识的令牌写法：${name}: ${value}（守卫只认 hex / rgb / var / color-mix 两色）`)
}

/** WCAG 相对亮度 */
function luminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

/** WCAG 对比度：1 ~ 21 */
function contrast(a, b) {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la > lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

const TONES = ['slate', 'blue', 'green', 'amber', 'rose', 'violet']
const TEXT_MIN = 4.5
const GRID_MIN = 1.15
const GRID_MAX = 3

const problems = []
let worstText = Infinity
let worstGrid = Infinity

for (const [themeLabel, scope] of [
  ['浅色', light],
  ['深色', dark],
]) {
  const text = resolve('--text-1', scope)
  for (const tone of TONES) {
    const bg = resolve(`--canvas-tone-${tone}`, scope)
    const t = contrast(text, bg)
    worstText = Math.min(worstText, t)
    if (t < TEXT_MIN) {
      problems.push(
        `${themeLabel} · ${tone}：正文对比度 ${t.toFixed(2)}:1 < ${TEXT_MIN}:1`,
      )
    }
  }
  for (const tone of TONES) {
    // 网格线由「底色 + 正文」派生 ⇒ 逐档改 --canvas-bg 再解析同一份公式
    const scopeWithTone = new Map([...light, ...scope, ...derived])
    scopeWithTone.set('--canvas-bg', `var(--canvas-tone-${tone})`)
    const bg = resolve('--canvas-bg', scopeWithTone)
    const grid = resolve('--canvas-grid-line', scopeWithTone)
    const g = contrast(grid, bg)
    worstGrid = Math.min(worstGrid, g)
    if (g < GRID_MIN || g > GRID_MAX) {
      problems.push(
        `${themeLabel} · ${tone}：网格线对比度 ${g.toFixed(2)}:1 不在 ${GRID_MIN}–${GRID_MAX} 之间`,
      )
    }
  }
}

if (problems.length) {
  console.error(`✘ 对比度守卫失败：${problems.length} 组不合格\n`)
  for (const p of problems) console.error(`    - ${p}`)
  console.error('\n处理：调 src/ui/tokens.css 里对应的画布色档（六档都要过），别改阈值。')
  process.exit(1)
}

console.log(
  `✔ 对比度守卫通过：正文 ${TONES.length * 2} 组（最低 ${worstText.toFixed(2)}:1 ≥ ${TEXT_MIN}）+ ` +
    `网格线 ${TONES.length * 2} 组（最低 ${worstGrid.toFixed(2)}:1 ≥ ${GRID_MIN}）`,
)
