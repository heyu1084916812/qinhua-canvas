/**
 * 组件陈列室（`/_preview`）的**截图回归基线**（产品文档 §14.3 DoD 第 5 条）。
 *
 * 为什么要有它：DoD 写着"关键页面完成一次视觉验收，并纳入 `/_preview` 的截图回归基线"，
 * 而在此之前全仓**没有任何截图比对机制** —— 历次"视觉验收"都靠一次性探针，跑完就没了。
 * 于是 token / 间距 / 圆角这类改动只能靠人眼，没人看的时候悄悄变了也没人知道。
 *
 * 用法：
 *   node scripts/check-preview-baseline.mjs            # 比对（红 = 视觉有变）
 *   node scripts/check-preview-baseline.mjs --update   # 重拍基线（**人眼看过了**再拍）
 *
 * 三条刻意的设计：
 * ① **确定性优先**：`reducedMotion: 'reduce'` + 注入 CSS 关掉动画/过渡 + 等 `document.fonts.ready`
 *    —— 否则同一份代码两次截图自己就不一样，判据永远红。
 * ② **比对在浏览器里做**：PNG 解码交给 `createImageBitmap` / canvas，不引第三方图像库
 *    （项目一直避免新增依赖，而这一步浏览器本来就最擅长）。
 * ③ **判据是"差异像素占比"**：抗锯齿在个别像素上天然会抖，逐像素全等必然假红；
 *    阈值给 0.2%，并把**差异图**写到 `.playwright-verify/` 供人看"哪儿变了"。
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.PREVIEW_BASE ?? 'http://127.0.0.1:1420'
const BASELINE_DIR = path.join('src', 'dev', 'preview', 'baseline')
const OUT_DIR = '.playwright-verify'

/**
 * 判据（**标定过的**，不是拍脑袋）：
 *
 * 实测同一份代码连跑两次：**差异像素 0**（reduced-motion + 关动画让渲染逐像素可复现）；
 * 而把一个圆角令牌从 `14px` 改成 `16px`：差异 5.3k–5.7k 像素（**0.073%–0.088%**）。
 * 第一版把阈值定成 0.2%，结果**那次真改动被判成"通过"** —— 典型的假绿。
 * 现在两条判据：① 差异占比 > 0.01%（该页约 600–750 像素）；② 单通道差 > 120 且差异 > 200 像素
 * （抓"某一小块颜色/描边变了"这种局部强差异）。
 */
const MAX_DIFF_RATIO = 0.0001
/** 局部强差异（颜色令牌被改之类） */
const STRONG_DELTA = 120
const STRONG_PIXELS = 200
/** 单通道差多少才算"这个像素变了" */
const PIXEL_DELTA = 8

/** 档位：DoD §14.2 列了 1024×720 / 1440×900 / 1920×1080；深色只拍主档 */
const CASES = [
  { name: 'light-1024x720', width: 1024, height: 720, theme: 'light' },
  { name: 'light-1440x900', width: 1440, height: 900, theme: 'light' },
  { name: 'light-1920x1080', width: 1920, height: 1080, theme: 'light' },
  { name: 'dark-1440x900', width: 1440, height: 900, theme: 'dark' },
]

const update = process.argv.includes('--update')
mkdirSync(OUT_DIR, { recursive: true })
if (update) mkdirSync(BASELINE_DIR, { recursive: true })

const browser = await chromium.launch({ channel: 'chrome' })
const results = []

for (const c of CASES) {
  const ctx = await browser.newContext({
    viewport: { width: c.width, height: c.height },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  await ctx.addInitScript((theme) => {
    try {
      localStorage.setItem('flow:theme', theme)
      localStorage.setItem('flow:onboarded', '1')
      localStorage.setItem('flow:canvasGuideDismissed', '1')
    } catch {
      /* 写不进去也没关系：陈列室不读这两个键以外的东西 */
    }
  }, c.theme)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/_preview`, { waitUntil: 'networkidle' })
  await page.locator('h2').first().waitFor({ state: 'visible', timeout: 15000 })
  // 关掉动画/过渡/光标闪烁：截图判据要的是**静态外观**，不是"某一帧恰好长这样"
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}`,
  })
  await page.evaluate(() => document.fonts?.ready)
  await page.waitForTimeout(400)
  const shot = await page.screenshot({ fullPage: true })
  await ctx.close()

  const file = path.join(BASELINE_DIR, `${c.name}.png`)
  if (update) {
    writeFileSync(file, shot)
    console.log(`📸 已写基线 ${file}（${Math.round(shot.length / 1024)} KB）`)
    results.push({ name: c.name, ok: true, detail: '已更新基线' })
    continue
  }
  if (!existsSync(file)) {
    console.log(`❌ ${c.name}：没有基线文件（先跑 --update，并人眼确认那几张图）`)
    results.push({ name: c.name, ok: false, detail: '缺基线' })
    continue
  }

  // 比对放在**新开的页面**里做（与截图那个 context 无关，避免带着主题样式干扰）
  const cmpCtx = await browser.newContext()
  const cmp = await cmpCtx.newPage()
  const baselineB64 = `data:image/png;base64,${readFileSync(file).toString('base64')}`
  const freshB64 = `data:image/png;base64,${shot.toString('base64')}`
  const diff = await cmp.evaluate(
    async ([a, b, delta]) => {
      const load = async (dataUrl) => {
        const img = new Image()
        img.src = dataUrl
        await img.decode()
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth
        canvas.height = img.naturalHeight
        canvas.getContext('2d').drawImage(img, 0, 0)
        return canvas
      }
      const ca = await load(a)
      const cb = await load(b)
      if (ca.width !== cb.width || ca.height !== cb.height) {
        return { sizeMismatch: `${ca.width}x${ca.height} ≠ ${cb.width}x${cb.height}` }
      }
      const da = ca.getContext('2d').getImageData(0, 0, ca.width, ca.height).data
      const db = cb.getContext('2d').getImageData(0, 0, cb.width, cb.height).data
      const out = new ImageData(ca.width, ca.height)
      let changed = 0
      let max = 0
      for (let i = 0; i < da.length; i += 4) {
        const d = Math.max(
          Math.abs(da[i] - db[i]),
          Math.abs(da[i + 1] - db[i + 1]),
          Math.abs(da[i + 2] - db[i + 2]),
        )
        if (d > max) max = d
        if (d > delta) {
          changed += 1
          out.data[i] = 255
          out.data[i + 1] = 0
          out.data[i + 2] = 0
          out.data[i + 3] = 255
        } else {
          out.data[i] = 236
          out.data[i + 1] = 236
          out.data[i + 2] = 236
          out.data[i + 3] = 255
        }
      }
      const c2 = document.createElement('canvas')
      c2.width = ca.width
      c2.height = ca.height
      c2.getContext('2d').putImageData(out, 0, 0)
      return {
        total: ca.width * ca.height,
        changed,
        max,
        ratio: changed / (ca.width * ca.height),
        diffUrl: c2.toDataURL('image/png'),
      }
    },
    [baselineB64, freshB64, PIXEL_DELTA],
  )
  await cmpCtx.close()

  if (diff.sizeMismatch) {
    console.log(`❌ ${c.name}：尺寸变了 ${diff.sizeMismatch}`)
    results.push({ name: c.name, ok: false, detail: `尺寸 ${diff.sizeMismatch}` })
    continue
  }
  const pct = (diff.ratio * 100).toFixed(3)
  const tooMany = diff.ratio > MAX_DIFF_RATIO
  const strong = diff.max > STRONG_DELTA && diff.changed > STRONG_PIXELS
  const ok = !tooMany && !strong
  if (!ok) {
    const diffPath = path.join(OUT_DIR, `preview-diff-${c.name}.png`)
    writeFileSync(diffPath, Buffer.from(diff.diffUrl.split(',')[1], 'base64'))
    const why = tooMany
      ? `差异占比 ${pct}% > 阈值 ${(MAX_DIFF_RATIO * 100).toFixed(2)}%`
      : `局部强差异（最大通道差 ${diff.max}，差异像素 ${diff.changed}）`
    console.log(`❌ ${c.name}：${why} → 差异图 ${diffPath}`)
  } else {
    console.log(`✅ ${c.name}：差异像素 ${diff.changed}/${diff.total}（${pct}%，最大通道差 ${diff.max}）`)
  }
  results.push({ name: c.name, ok, detail: `${pct}% / max ${diff.max}` })
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - failed.length} passed / ${failed.length} failed / ${results.length} total =====`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(` - ${f.name}（${f.detail}）`)
  console.log('\n若这次变化是**有意**的：先打开差异图确认没坏，再 `node scripts/check-preview-baseline.mjs --update`')
}
process.exit(failed.length ? 1 : 0)
