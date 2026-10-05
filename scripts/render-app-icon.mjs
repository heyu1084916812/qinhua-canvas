/**
 * 图标源渲染：`src/assets/logo-loop.svg`（会动的猫 logo）→ `src-tauri/app-icon.png`。
 *
 * 为什么需要这一道：`npm run tauri icon` 要一张**方形**图，而这个 logo 有两个"不合适"：
 *   ① 画布 800.97×803.69 —— 差 0.3% 不是正方形；
 *   ② 自带 SMIL 动画（眨眼 + 摆动）—— 直接喂进去，取到哪一帧由工具决定。
 * 这里用同一个渲染引擎（Chrome）取 **`t=0` 帧**（睁眼、无旋转），再按图标规范给底。
 *
 * 底色三选（`ICON_BG` 环境变量，缺省 `white`）：
 *   - `white`（**当前采用**）：白底圆角 —— 黑 logo 在任何壁纸 / 任务栏上都看得见。
 *     为什么不用透明底：这 logo 是"黑块 + 猫形镂空"，纯透明版放在**深色任务栏**上会整块消失
 *     （应用内是靠 `filter: invert(1)` 翻白解决的，系统图标没有"跟着主题走"这回事）。
 *   - `dark`：深底圆角 + logo 反相（等同应用深色主题里的样子）。
 *   - `transparent`：忠于原设计，不加底（自行承担深色背景上不可见的风险）。
 *
 * 用法：`node scripts/render-app-icon.mjs`（改底：`$env:ICON_BG='dark'; node scripts/render-app-icon.mjs`）
 * 出图之后：`npm run tauri icon src-tauri/app-icon.png`
 */
import { chromium } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'

const SVG = readFileSync('src/assets/logo-loop.svg', 'utf8')
const BG = process.env.ICON_BG ?? 'white'
const SIZE = 1024
/** 白底版：logo 占画布的比例（其余是留白，缩到 16px 也不糊边） */
const INNER = 0.72

/**
 * 三种底：透明 / 白底圆角 / 深底圆角（深底那份把 logo 反相成白色）。
 * 圆角用 `border-radius` 切出、圆角外保持透明 —— 系统图标自己会再叠圆角，
 * 但直接给"方角白块"在深色桌面上会显脏，故这里自己先圆角。
 */
const page_html = (bg, radius) => `<!doctype html><html><body style="margin:0;background:transparent">
<div style="width:${SIZE}px;height:${SIZE}px;display:flex;align-items:center;justify-content:center;
  background:${bg};border-radius:${radius};overflow:hidden">
  <div style="width:${Math.round(SIZE * INNER)}px;height:${Math.round(SIZE * INNER)}px">${SVG}</div>
</div></body></html>`

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE } })

const VARIANTS = {
  transparent: { bg: 'transparent', invert: false },
  white: { bg: '#ffffff', invert: false },
  dark: { bg: '#171716', invert: true },
}
if (!VARIANTS[BG]) throw new Error(`ICON_BG 只能是 transparent / white / dark，收到：${BG}`)
{
  const { bg, invert } = VARIANTS[BG]
  await page.setContent(page_html(bg, `${Math.round(SIZE * 0.22)}px`))
  await page.evaluate(() => {
    document.querySelectorAll('svg').forEach((s) => {
      s.style.width = '100%'
      s.style.height = '100%'
      s.removeAttribute('width')
      s.removeAttribute('height')
    })
  })
  await page.evaluate((inv) => {
    document.querySelectorAll('svg').forEach((s) => {
      s.style.filter = inv ? 'invert(1)' : 'none'
    })
  }, invert)
  await page.waitForTimeout(200)
  const buf = await page.screenshot({ omitBackground: true })
  const out = 'src-tauri/app-icon.png'
  writeFileSync(out, buf)
  console.log(`${out}  ${buf.length} 字节（底=${BG}）`)
}

await browser.close()
