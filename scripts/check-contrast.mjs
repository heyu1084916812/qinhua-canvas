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
let worstPanel = Infinity
/** 「观感」那组检查跑了几条（悬停/选中 + 小块底与浮层底，见循环里的说明） */
let lookChecks = 0

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
  /**
   * ③ **面板容器底色上的文字**（2026-10-09 加）。
   *
   * 全局设置的容器底从 `--bg-surface` 改成 `--bg-subtle` 之后，次级文字落在
   * `#f5f5f5` 上而不是白底 —— 浅色下那条正好把 `--text-2` 压到 4.35:1（不达 AA），
   * 而"肉眼看还行"正是这类问题最容易蒙混过去的地方。两套主题 × 两层底 × 两个文字档，
   * 全部按正文口径 4.5:1 验。
   */
  for (const surface of ['--bg-surface', '--bg-subtle']) {
    const bg = resolve(surface, scope)
    for (const textToken of ['--text-1', '--text-2']) {
      const t = contrast(resolve(textToken, scope), bg)
      worstPanel = Math.min(worstPanel, t)
      if (t < TEXT_MIN) {
        problems.push(
          `${themeLabel} · ${surface} 上的 ${textToken}：${t.toFixed(2)}:1 < ${TEXT_MIN}:1`,
        )
      }
    }
  }
  /**
   * ④ **悬停底与选中底必须两两不同、方向对、且看得见**（用户 2026-10-14 的四色口径）。
   *
   * 为什么放进守卫：这几支同值时**没有任何现成信号**能发现它 —— 差 0、截图看着"就是这样的设计"，
   * 结果是"悬停一个未选项"跟"选中它"长得一模一样。2026-10-16 就是这么栽的：
   * `--bg-hover` 与 `--bg-selected` 同值（浅 #e2e2e2 / 深 #333333），参数面板里那些比例格
   * 悬停 == 选中，直到有人真去数色值才发现（对账 #529 / #531 的残留）。
   *
   * 四条判据：① 两支悬停 + 一支选中**两两不等**；② 悬停必须比选中**弱**
   * （浅色更浅、深色更暗 —— 按相对亮度判方向）；③ 悬停与它垫的那层卡面至少差 4/255
   * （太接近等于没有反馈）；④ 深色下悬停必须比卡面**亮**（深色里"更重"= 更亮）。
   */
  {
    const hover = resolve('--bg-hover', scope)
    const subtle = resolve('--bg-subtle', scope)
    const selected = resolve('--bg-selected', scope)
    const surface = resolve('--bg-surface', scope)
    const hex = (c) =>
      `#${[c.r, c.g, c.b].map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')}`
    const same = (a, b) => a.r === b.r && a.g === b.g && a.b === b.b
    const lightTheme = themeLabel === '浅色'
    for (const [aName, a, bName, b] of [
      ['--bg-hover', hover, '--bg-selected', selected],
      ['--bg-hover', hover, '--bg-subtle', subtle],
      ['--bg-subtle', subtle, '--bg-selected', selected],
    ]) {
      lookChecks += 1
      if (same(a, b)) {
        problems.push(`${themeLabel}：${aName} 与 ${bName} 同值（${hex(a)}）—— 悬停会被看成选中`)
      }
    }
    const lHover = luminance(hover)
    const lSelected = luminance(selected)
    lookChecks += 1
    if (lightTheme ? !(lHover > lSelected) : !(lHover < lSelected)) {
      problems.push(
        `${themeLabel}：悬停底不比选中底"弱"（悬停 ${hex(hover)} / 选中 ${hex(selected)}）—— 分不出主次`,
      )
    }
    lookChecks += 1
    const delta = Math.max(
      Math.abs(hover.r - surface.r),
      Math.abs(hover.g - surface.g),
      Math.abs(hover.b - surface.b),
    )
    if (delta < 4) {
      problems.push(`${themeLabel}：悬停底与卡面底只差 ${delta.toFixed(0)}/255 —— 等于没有悬停反馈`)
    }
    if (!lightTheme) {
      lookChecks += 1
      if (luminance(hover) <= luminance(surface)) {
        problems.push(`${themeLabel}：悬停底没比卡面底亮 —— 深色里"更重"= 更亮`)
      }
    }
    /**
     * ⑤ **浮层里那块「小块底」要与浮层底分得开**（对账 #544，收口 #529 残留②）。
     *
     * 参数面板的比例格（`.ratioCell`）用的就是 `--bg-app`：浅色 #f5f5f5 vs 浮层 #ffffff 差 10、
     * 深色 #1a1a1a vs #222222 差 8。**改之前深色用的是 `--bg-subtle` #1f1f1f，差只有 3** ——
     * 屏幕上那一格"容器的边界"等于没有，而用户 2026-10-15 明确要过「直接抄他的比例，
     * **包括容器的边界**」。判据两条：通道最大差 ≥ 6/255；且**小块要比它所在的面更暗**
     * （浅色 / 深色方向一致 —— 深色里"凹下去"同样用更暗来表示）。
     */
    {
      const cell = resolve('--bg-app', scope)
      const cellDelta = Math.max(
        Math.abs(cell.r - surface.r),
        Math.abs(cell.g - surface.g),
        Math.abs(cell.b - surface.b),
      )
      lookChecks += 1
      if (cellDelta < 6) {
        problems.push(
          `${themeLabel}：小块底（--bg-app）与浮层底只差 ${cellDelta.toFixed(0)}/255 —— 那一格「块底」等于看不见`,
        )
      }
      lookChecks += 1
      if (luminance(cell) >= luminance(surface)) {
        problems.push(`${themeLabel}：小块底没比浮层底更暗（两套主题里"块"都该是更暗的那一块）`)
      }
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
    `网格线 ${TONES.length * 2} 组（最低 ${worstGrid.toFixed(2)}:1 ≥ ${GRID_MIN}）+ ` +
    `面板底 8 组（最低 ${worstPanel.toFixed(2)}:1 ≥ ${TEXT_MIN}）+ ` +
    `观感 ${lookChecks} 条（两支悬停与选中两两不同、方向对、与卡面可辨；小块底与浮层底可辨）`,
)
