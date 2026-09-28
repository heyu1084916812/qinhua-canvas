/**
 * 文档 ↔ 代码 / 运行时 自动对账（产品文档 §4–§6 的可量化声明）
 *
 * 用法：SMOKE_BASE=http://127.0.0.1:1420 node scripts/audit-doc.mjs
 *
 * 为什么需要它：`轻画-功能对账清单.md` 是**人工**核对的，人工核对只在写清单的那一刻成立。
 * 文档里的数字（最小尺寸 / 间距 / 上限 / 次数）改了代码不会有人知道，改了文档更不会有人
 * 知道——而「文档写了 = 已实现」这个项目已经栽过三次。本脚本把**能量化的那部分**变成
 * 可复跑的断言：改哪一边都会变红。
 *
 * 两层判据：
 *   1. **源码常量**：直接读源码里的实际值（这些常量就是行为本身——`NODE_MINIMUMS` 是
 *      缩放钳制 `sizing.min` 的唯一来源，不是注释里的一句话）。
 *   2. **运行时实测**：少数常量要证明「确实作用于界面」——把节点拖到最小，量真实像素。
 *
 * 覆盖不到的部分（交互手感、视觉规范、文案）仍需人工，本脚本不假装覆盖。
 */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.SMOKE_BASE || 'http://127.0.0.1:1420'

const src = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ────────────────────────────────────────────────────────────
// 1. 源码常量层
// ────────────────────────────────────────────────────────────

const LAYOUT = 'src/domain/canvas/layout/constants.ts'

/** 从 `NODE_MINIMUMS` 字面量里取出某类型的 {w,h} */
function nodeMinimum(type) {
  const text = src(LAYOUT)
  const block = text.match(/NODE_MINIMUMS[^=]*=\s*\{([\s\S]*?)\n\}/)
  if (!block) return null
  const row = block[1].match(new RegExp(`${type}:\\s*\\{\\s*w:\\s*(\\d+),\\s*h:\\s*(\\d+)\\s*\\}`))
  return row ? { w: Number(row[1]), h: Number(row[2]) } : null
}

/** `export const X = 数字` */
function constNum(rel, name) {
  const m = src(rel).match(new RegExp(`export const ${name}\\s*[:=][^=]*?=?\\s*([\\d.]+)`))
  return m ? Number(m[1]) : null
}

/** `export const X: Size = { w: N, h: N }` */
function constSize(rel, name) {
  const m = src(rel).match(new RegExp(`${name}\\s*:\\s*Size\\s*=\\s*\\{\\s*w:\\s*(\\d+),\\s*h:\\s*(\\d+)\\s*\\}`))
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null
}

const fmt = (v) => (v == null ? '(读不到)' : typeof v === 'object' ? `${v.w} × ${v.h}` : String(v))
const eq = (a, b) => a != null && b != null && String(a.w ?? a) === String(b.w ?? b) && String(a.h ?? a) === String(b.h ?? b)

/** [章节, 声明, 文档值, 实测值] */
const CODE_CLAIMS = [
  ['§6.6 / §6.16', '提示词节点最小尺寸', { w: 240, h: 160 }, () => nodeMinimum('prompt')],
  ['§6.6 / §6.8 / §6.16', '图片·视频生成节点最小尺寸', { w: 200, h: 160 }, () => nodeMinimum('generation')],
  ['§6.6 / §6.10 / §6.16', '对比节点最小尺寸', { w: 240, h: 180 }, () => nodeMinimum('compare')],
  ['§6.6 / §6.11', '分组节点空容器最小尺寸', { w: 240, h: 192 }, () => nodeMinimum('group')],
  ['§6.6 / §6.12', '批量节点空容器最小尺寸', { w: 240, h: 192 }, () => nodeMinimum('batch')],
  ['§6.6 / §6.13 / §6.16', '画板节点最小尺寸', { w: 320, h: 240 }, () => nodeMinimum('board')],
  ['§6.11 / §6.12', '分组·批量内部单元尺寸', { w: 200, h: 160 }, () => constSize(LAYOUT, 'PACKED_CELL')],
  ['§6.11', '分组·批量每排最多（3×3）', 3, () => constNum(LAYOUT, 'PACKED_MAX_COLUMNS')],
  ['§6.11', '分组·批量单元间距', 16, () => constNum(LAYOUT, 'CONTAINER_GAP')],
  ['§6.11', '分组·批量容器内边距', 20, () => constNum(LAYOUT, 'CONTAINER_PADDING')],
  ['§6.9', '结果组位于来源节点右侧', 32, () => constNum(LAYOUT, 'RESULT_GROUP_OFFSET')],
  ['§6.9', '结果组内边距', 16, () => constNum(LAYOUT, 'RESULT_GROUP_PADDING')],
  ['§6.9', '结果组内节点间距', 16, () => constNum(LAYOUT, 'RESULT_GROUP_GAP')],
  ['§6.16', '结果组内格位', { w: 200, h: 200 }, () => constSize(LAYOUT, 'RESULT_CELL')],
  ['§6.9', '结果组折叠态尺寸', { w: 160, h: 120 }, () => constSize('src/domain/canvas/layout/resultGroupLayout.ts', 'COLLAPSED_SIZE')],
  ['§6.8', '素材节点最长边上限', 320, () => constNum('src/domain/canvas/layout/assetNodeSize.ts', 'ASSET_NODE_MAX_SIDE')],
  ['§6.19.6', '单任务失败自动重试次数', 2, () => Number((src('src/features/shared/execution/runEngine.ts').match(/maxRetries:\s*(\d+)/) || [])[1] ?? null)],
  ['§6.7', '「反推」一次最多发几张上游图', 4, () => constNum('src/domain/shared/execution/inputs.ts', 'MAX_IMAGE_INPUTS')],
  ['§6.3', '缩放下限', 0.1, () => Number((src('src/domain/canvas/geometry/transform.ts').match(/min:\s*([\d.]+)/) || [])[1])],
  ['§6.3', '缩放上限', 5, () => Number((src('src/domain/canvas/geometry/transform.ts').match(/max:\s*([\d.]+)/) || [])[1])],
]

/** 声明性检查（有没有实现，而不是数字对不对） */
const CODE_FACTS = [
  [
    '§6.18',
    '日志按项目保留最近 500 条（应能找到裁剪）',
    () =>
      ['src/workbenches/canvas/panels/LogPanel.tsx', 'src/state/commands/reducer.ts', 'src/platform/web/indexedDbStorage.ts'].some(
        (f) => /slice\(0,\s*500\)|MAX_LOG_|LOG_LIMIT|LOG_MAX/.test(src(f)),
      ),
    '面板 / reducer / 仓储三处都找不到 500 条裁剪——日志会无限增长',
  ],
  [
    '§6.18',
    '日志记录读的是 `tasks` 表',
    () => /query\(\s*'tasks'/.test(src('src/workbenches/canvas/panels/LogPanel.tsx')),
    '日志面板实际读 `runRecords` 表（`query(\'runRecords\')`）；`tasks` 表存的是执行计划 / 成本记录，只有 reducer 写、没人读来出日志',
  ],
]

// ────────────────────────────────────────────────────────────
// 2. 运行时层：证明常量确实作用于界面
// ────────────────────────────────────────────────────────────

/**
 * 把某类型节点拖到最小，返回实测 {w,h}。
 * 缩放钳制走 `sizing.min`（= NODE_MINIMUMS），常量若只是「声明」而没被接进钳制，
 * 这里就会测出比常量更小的尺寸——即「文档/代码写了但界面上不作数」。
 */
async function measureMinSize(page, nodeType) {
  // 走左侧工具栏的「＋」→ 菜单项，锚点是 data-toolbar-*（顶栏「＋ X」那套文案另有一份）
  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  await page.locator(`[data-toolbar-menu-item="${nodeType}"]`).click()
  await sleep(500)
  const node = page.locator('[data-node-id]').last()
  const id = await node.getAttribute('data-node-id')
  if (!id) throw new Error('没建出节点')
  const handle = page.locator(`[data-node-id="${id}"] span[class*="resizeHandle"]`)
  if ((await handle.count()) === 0) throw new Error('找不到缩放手柄')
  const hb = await handle.boundingBox()
  const nb = await node.boundingBox()
  if (!hb || !nb) throw new Error('量不到位置')
  // 往节点内部狠拖：钳制生效就会停在最小尺寸
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
  await page.mouse.down()
  await page.mouse.move(nb.x + 40, nb.y + 40, { steps: 12 })
  await page.mouse.up()
  await sleep(300)
  const after = await page.locator(`[data-node-id="${id}"]`).boundingBox()
  return { w: Math.round(after.width), h: Math.round(after.height) }
}

async function runtimeChecks(browser) {
  const out = []
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const page = await ctx.newPage()
  try {
    // 模板库在应用壳改版后从 `/` 迁到 `/projects`（`/` 现在是欢迎页，没有模板按钮）
    await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' })
    await page.locator('[data-template="blank"]').click()
    await page.waitForURL(/\/canvas\//)
    await sleep(800)

    // 生成节点最小尺寸（文档 200×160）
    try {
      const got = await measureMinSize(page, 'generation')
      out.push(['§6.6 / §6.8 / §6.16', '生成节点拖到最小时的实际尺寸', { w: 200, h: 160 }, got])
    } catch (e) {
      out.push(['§6.6 / §6.8 / §6.16', '生成节点拖到最小时的实际尺寸', { w: 200, h: 160 }, null, String(e).slice(0, 80)])
    }

    // 画板节点最小尺寸（文档 320×240）
    try {
      const got = await measureMinSize(page, 'board')
      out.push(['§6.6 / §6.13 / §6.16', '画板节点拖到最小时的实际尺寸', { w: 320, h: 240 }, got])
    } catch (e) {
      out.push(['§6.6 / §6.13 / §6.16', '画板节点拖到最小时的实际尺寸', { w: 320, h: 240 }, null, String(e).slice(0, 80)])
    }

    /**
     * 工具栏排列方式数量（§6.5 ②）。
     * 8 种对齐已于 2026-09-19 下线，改为验证三种排列。
     * 面板由指针进入按钮范围展开（不再点击），故这里先 hover。
     */
    await page.locator('[data-toolbar-arrange-modes]').hover()
    await sleep(300)
    const arrangeModeCount = await page.locator('[data-toolbar-arrange-mode]').count()
    out.push(['§6.5', '工具栏排列方式数量', 3, arrangeModeCount])
    await page.keyboard.press('Escape')
    await sleep(200)

    // 新建节点菜单 6 项（§6.5 / §4.1）：同样改 hover 展开
    await page.locator('[data-toolbar-add]').hover()
    await sleep(300)
    const menuItems = await page.locator('[data-toolbar-menu-item]').count()
    out.push(['§6.5 / §4.1', '「新建节点」菜单项数量', 6, menuItems])
    await page.keyboard.press('Escape')
    await sleep(200)

    // §6.7 提示词节点：对账清单里唯一明写「M4 交付，未本轮复核」的 ✅，
    // 这里把「面板三部分 + 三个 LLM 按钮 + 本体胶囊」在运行时点一遍
    await page.locator('[data-toolbar-add]').click()
    await sleep(250)
    await page.locator('[data-toolbar-menu-item="prompt"]').click()
    await sleep(600)
    const promptPanel = await page.locator('[data-creation-panel]').count()
    out.push(['§6.7', '提示词节点有创作面板', 1, promptPanel])
    // 「优化 / 翻译 / 反推」三个按钮：只有「反推」挂了 data-* 锚点，另两个只能按文案数，
    // 这正是「自动化看不见」的一类缺口（对账清单维护规则 5）——功能在，但断言不稳。
    for (const [label, name] of [
      ['「优化」按钮', '优化'],
      ['「翻译」按钮', '翻译'],
    ]) {
      const n = await page.locator('[data-panel-prompt-tools] button', { hasText: name }).count()
      out.push(['§6.7 / LLM 行为', `面板${label}（按文案数）`, 1, n])
    }
    const anchored = await page.locator('[data-panel-prompt-tool]').count()
    out.push(['§6.7 / 可测性', '三个 LLM 按钮各有稳定 data-* 锚点', 3, anchored])
  } finally {
    await ctx.close()
  }
  return out
}

// ────────────────────────────────────────────────────────────
// 3. 跑 + 报
// ────────────────────────────────────────────────────────────

const rows = []
for (const [sec, claim, doc, probe] of CODE_CLAIMS) {
  let actual = null
  let err = null
  try {
    actual = probe()
  } catch (e) {
    err = String(e).slice(0, 80)
  }
  rows.push({ sec, claim, doc, actual, ok: err ? null : eq(doc, actual), err })
}

const facts = []
for (const [sec, claim, probe, note] of CODE_FACTS) {
  let ok = null
  let err = null
  try {
    ok = !!probe()
  } catch (e) {
    err = String(e).slice(0, 80)
  }
  facts.push({ sec, claim, ok, note, err })
}

const runtime = []
if (process.env.AUDIT_RUNTIME !== '0') {
  const browser = await chromium.launch({ channel: 'chrome' })
  try {
    for (const [sec, claim, doc, actual, err] of await runtimeChecks(browser)) {
      runtime.push({ sec, claim, doc, actual, ok: err ? null : eq(doc, actual), err })
    }
  } finally {
    await browser.close()
  }
}

const line = (r) =>
  `${r.ok === true ? '  ✅ 一致  ' : r.ok === false ? '  ❌ 不符  ' : '  ⚠️ 读不到'} │ ${r.sec} │ ${r.claim} │ 文档 ${fmt(r.doc)} │ 实测 ${fmt(r.actual)}${r.err ? ` │ ${r.err}` : ''}`

console.log('\n══════ 文档 ↔ 代码 自动对账（源码常量层）══════')
for (const r of rows) console.log(line(r))

console.log('\n══════ 文档 ↔ 界面 自动对账（浏览器实测层）══════')
for (const r of runtime) console.log(line(r))

console.log('\n══════ 声明性检查（有没有实现）══════')
for (const f of facts) {
  console.log(`  ${f.ok === true ? '✅ 有' : f.ok === false ? '❌ 无' : '⚠️ 读不到'} │ ${f.sec} │ ${f.claim}${f.ok === false ? ` │ ${f.note}` : ''}${f.err ? ` │ ${f.err}` : ''}`)
}

const bad = [...rows, ...runtime].filter((r) => r.ok === false)
const unknown = [...rows, ...runtime, ...facts].filter((r) => r.ok == null)
const factBad = facts.filter((f) => f.ok === false)

console.log(`\n────── 汇总：${rows.length + runtime.length} 项数值 + ${facts.length} 项声明性`)
console.log(`  一致 ${rows.length + runtime.length - bad.length - unknown.filter((u) => 'doc' in u).length} · 不符 ${bad.length} · 读不到 ${unknown.length} · 声明性缺失 ${factBad.length}\n`)
