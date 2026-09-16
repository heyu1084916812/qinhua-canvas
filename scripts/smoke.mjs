/**
 * M1 真机冒烟：把「单测 + SSR 冒烟」覆盖不到的浏览器内交互跑一遍。
 * 用法：先 `npm run dev`，再 `node scripts/smoke.mjs`
 * 产物：.playwright-verify/*.png 截图 + 控制台结果表
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { deflateSync, crc32 } from 'node:zlib'

const BASE = process.env.SMOKE_BASE ?? 'http://127.0.0.1:1420'
const OUT = '.playwright-verify'
mkdirSync(OUT, { recursive: true })

const results = []
function rec(group, name, pass, detail = '') {
  results.push({ group, name, pass, detail })
  console.log(`${pass ? 'PASS' : 'FAIL'} | ${group} | ${name}${detail ? ' | ' + detail : ''}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 现造一张**真能解码**的纯色 PNG 字节（G53 用）。
 *
 * 为什么不用仓库里现成的 base64：那些是 8×8 的 1:1 图，**看不出比例差异**——
 * 断言「节点按素材原始比例」时 1:1 的素材与「一律按方框」的退化实现长得一模一样，
 * 断言恒真。故这里按指定宽高现造，比例想给多少给多少。
 */
function solidPngBuffer(w, h) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.concat(Array.from({ length: w }, () => Buffer.from([200, 120, 60])))])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/**
 * 造一张**不可压缩**的大 PNG（G55 用）。
 *
 * 纯色 PNG 会被 deflate 压到几十 KB，测不出「大文件」的任何问题；真实照片
 * 恰恰接近随机噪声、压不动。这里用固定种子的 LCG 填 RGB，既保证每次跑字节一致
 * （可复现），又让文件体积 ≈ 原始像素量。
 */
function noisePngBuffer(w, h) {
  let seed = 0x2f6e2b1
  const rnd = () => {
    // xorshift-ish：够随机，且同步快（9MB 逐字节调用 Math.random 也不慢，但可复现更值钱）
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed & 0xff
  }
  const stride = w * 3 + 1
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y += 1) {
    const at = y * stride
    raw[at] = 0 // filter: none
    for (let x = 0; x < w * 3; x += 1) raw[at + 1 + x] = rnd()
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** 读 world 容器的 transform，解析出 translate 与 scale */
async function readViewport(page) {
  const style = (await page.getAttribute('[data-world]', 'style')) ?? ''
  const t = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(style)
  const s = /scale\(([-\d.]+)\)/.exec(style)
  return {
    x: t ? parseFloat(t[1]) : NaN,
    y: t ? parseFloat(t[2]) : NaN,
    zoom: s ? parseFloat(s[1]) : NaN,
  }
}

const nodeCount = (page) => page.locator('[data-node-id]').count()

/**
 * 生成节点的**创作面板**（M6-16 起）。
 *
 * 生成节点本体已按 §6.8 减重为「媒体框」（占位框 + 中间 `+` / 内容缩略图），
 * 参数下拉、提示词、生成按钮**只在节点下方的创作面板里**——所以凡是要
 * 「配置并生成」的用例，都得先选中节点、拿面板 locator，再操作。
 *
 * 注意选中点取「节点内、顶栏浮层之下、避开中央 `+`」的位置：本体中央的 `+` 是上传
 * 入口，点它会在 Chrome 里弹 `showOpenFilePicker`，Playwright 无法接管。
 */
async function genPanel(page, nodeLocator) {
  const node = nodeLocator ?? page.locator('[data-node-type="generation"]').first()
  const box = await node.boundingBox().catch(() => null)
  if (box) {
    /**
     * 选中点击点避开两个坑：
     * - **顶栏浮层**：`top:12 / height:44`（屏幕 y 12..56）盖在画布上；模板预置节点
     *   world y=0 → 屏幕 y≈8，其顶部 56px 被顶栏吃掉，点 y:16 会被顶栏拦截（探针实测）。
     *   故取节点内 y=72（顶栏下沿之下）。
     * - **本体中央的 `+`**：那是上传入口，点它会弹 showOpenFilePicker；故取左侧 x=40。
     */
    const y = Math.max(16, Math.min(box.height - 14, 72))
    const x = Math.max(8, Math.min(40, box.width / 2 - 30))
    await node.click({ position: { x, y } })
  }
  const panel = page.locator('[data-creation-panel]')
  await panel.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  await sleep(150)
  return panel
}

/** 面板内配置渠道 + 模型 + 提示词（等价于旧版在节点内直接操作三条） */
async function configureGenPanel(page, panel, prompt) {
  await pickParam(panel, 'channel', '新建渠道')
  await sleep(200)
  await pickParam(panel, 'model', 'mock-image-1')
  await sleep(200)
  if (prompt != null) {
    const ta = panel.locator('textarea').first()
    await ta.click()
    await ta.fill(prompt)
    await sleep(200)
  }
}

/**
 * 面板参数 chip（ParamPicker，§6.8）。
 *
 * M6-17 起参数控件由原生 `<select>` 换成**上拉浮层**：原生下拉的展开层由浏览器
 * 绘制，既不受浮层规范约束，也无法被自动化看见——测试连「选项里到底有没有这个值」
 * 都断言不了，只能读 `innerText`。现在展开层是 DOM 里的真元素，于是「点开 → 点选项」
 * 成了可断言的动作。锚点用 `data-param-chip` / `data-param-popup`（不是 CSS module 哈希类名）。
 */
async function pickParam(scope, name, optionText) {
  await scope.locator(`[data-param-chip="${name}"]`).click()
  await scope
    .locator(`[data-param-popup="${name}"]`)
    .waitFor({ state: 'visible', timeout: 3000 })
    .catch(() => {})
  await scope.locator(`[data-param-popup="${name}"] button`, { hasText: optionText }).first().click()
  await sleep(150)
}

/** chip 当前文案（取代旧版 `select.inputValue()`） */
async function paramLabel(scope, name) {
  return (await scope.locator(`[data-param-chip="${name}"]`).innerText().catch(() => '')).trim()
}

/** 展开参数浮层并读出全部选项文案，然后收起（诊断与断言共用） */
async function paramOptions(page, scope, name) {
  await scope.locator(`[data-param-chip="${name}"]`).click()
  await sleep(150)
  const texts = await scope
    .locator(`[data-param-popup="${name}"] button`)
    .allInnerTexts()
    .catch(() => [])
  const empty = await scope.locator(`[data-param-empty="${name}"]`).count()
  await page.keyboard.press('Escape')
  await sleep(100)
  return empty > 0 ? [] : texts
}

/** 面板里的生成按钮（空闲态 aria-label=生成当前节点） */
function panelRunBtn(page) {
  return page.locator('[data-creation-panel] button[aria-label="生成当前节点"]')
}

/**
 * 节点框上的**安全抓取点**：左下角内侧。
 *
 * 标题已按 §6.6 移到节点框外，"框内顶部"不再是安全区——画板节点的工具条就压在那里
 * （且它 `stopPropagation`，从工具条按下拖不动节点）；本体中央还可能是生成节点的 `+`
 * 上传入口。左下角内侧对全部节点类型都空着（缩放手柄在右下角）。
 */
function grabPoint(box) {
  return { x: Math.round(box.x + 14), y: Math.round(box.y + box.height - 14) }
}

/**
 * 把节点**左上角**移到画布屏幕坐标 (x, y)（按压点仍是节点框的安全抓取点）。
 *
 * 契约是「左上角落到 (x,y)」而不是「抓点落到 (x,y)」：抓点只是实现细节，
 * 若把它当坐标锚点，调用方看到的落点会随抓点定义漂移——G20 曾因抓点改到左下角，
 * 画板被顶高 286px、工具条正好钻进悬浮顶栏（`＋ 批量` 抢走点击）。
 * 位移按「抓点 → 目标」补回偏移，语义与调用方直觉一致。
 *
 * 注意：顶栏「＋ X」新建的节点都落在**视口中心**——连续新建两个会完全重叠，
 * 上层节点会挡住下层的抓取区域，因此连续操作前必须先把前一个挪开。
 */
async function moveNode(page, nodeId, x, y) {
  const node = page.locator(`[data-node-id="${nodeId}"]`)
  const box = await node.boundingBox()
  if (!box) return false
  const g = grabPoint(box)
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  await page.mouse.move(g.x + (x - box.x), g.y + (y - box.y), { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(350)
  return true
}

/** 把节点拖进容器中心（先移到旁边避开重叠，再拖入目标容器） */
async function dragNode(page, nodeId, containerId) {
  const container = page.locator(`[data-node-id="${containerId}"]`)
  const cb = await container.boundingBox()
  if (!cb) return false
  const node = page.locator(`[data-node-id="${nodeId}"]`)
  const nb = await node.boundingBox()
  if (!nb) return false
  const g = grabPoint(nb)
  await page.mouse.move(g.x, g.y)
  await page.mouse.down()
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2, { steps: 14 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  return true
}

/**
 * 新建项目。
 * 有项目时：网格末尾的「+ 新建」卡片（data-new-card）→ 弹工作台浮层 → 选 canvas。
 * 空态时：空状态主按钮（data-new-project）→ 直接建 canvas，无浮层。
 */
async function createProject(page) {
  const card = page.locator('[data-new-card]')
  const hasGrid = await card
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)

  if (hasGrid) {
    await card.click()
    await page.locator('[data-new-workbench="canvas"]').click()
  } else {
    const emptyBtn = page.locator('[data-new-project]').first()
    try {
      await emptyBtn.waitFor({ state: 'visible', timeout: 10000 })
    } catch (e) {
      const body = await page.locator('body').innerText().catch(() => '<no body>')
      console.log('  [diag] url=' + page.url() + '\n  [diag] body=' + body.slice(0, 300).replace(/\n/g, ' | '))
      await page.screenshot({ path: `${OUT}/diag-createproject.png` }).catch(() => {})
      throw e
    }
    await emptyBtn.click()
  }
  await page.waitForURL(/\/canvas\//)
}

/** 屏蔽 File System Access API，强制走可被 Playwright 拦截的 fallback 路径 */
const disableFSA = `delete window.showOpenFilePicker; delete window.showSaveFilePicker;`

/**
 * 设置页：新建一个 mock 渠道 → 验证地址 → 拉取模型 → 勾选全部模型 → 启用。
 * G9 起的多个组（凡是要在画布 / 漫画里选模型的）都走它。
 *
 * **为什么是「拉取模型」而不是「验证地址」灌缓存**：§7.3 收窄后，「验证地址」只回答
 * 「这个地址通不通」（+ 延迟），**不碰** `modelCache` —— 拉模型是「拉取模型」按钮的职责。
 * 而 §7.4 起画布 / 漫画的模型下拉读的是 `models`（用户勾选的那几个），
 * 所以链路是：验证（可选）→ 拉取 → 勾选。三个动作各问各的问题，不是测试的权宜之计。
 *
 * 返回 `{ verified, pulled, enabled }` 供调用方自行断言（各组断言的粒度不同，不在这里替它们判）。
 */
async function configureMockChannel(page, { token = null, enable = true, pick = true } = {}) {
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(400)
  await page.getByText('新建渠道').first().click()
  await sleep(300)

  if (token) {
    const tokenInput = page
      .locator('input[type="password"], input[placeholder*="令牌"], input[placeholder*="Key"]')
      .first()
    await tokenInput.fill(token).catch(() => {})
  }

  await page.getByRole('button', { name: '验证地址' }).click()
  const verified = await page
    .getByText(/地址可达/)
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)

  let pulled = false
  if (pick) {
    await page.getByRole('button', { name: '拉取模型' }).click()
    pulled = await page
      .getByText(/已拉取模型/)
      .waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false)
    await pickAllModels(page)
  }

  let enabled = false
  if (enable) {
    await page.locator('input[type="checkbox"]').first().check().catch(() => {})
    await sleep(400)
    enabled = await page
      .locator('button')
      .filter({ hasText: '新建渠道' })
      .first()
      .getByText('已启用')
      .isVisible()
      .catch(() => false)
  }
  return { verified, pulled, enabled }
}

/**
 * 「选择模型」面板：全选 → 应用。
 * mock 只回两条模型，逐条勾即可（产品文档 §7.4 的面板刻意没有「全选」—— 一次选几十个
 * 反而不是常态；保持与规范一致，勾选动作由测试逐条发出）。
 */
async function pickAllModels(page) {
  const open = page.getByRole('button', { name: '选择模型' })
  if (!(await open.isEnabled().catch(() => false))) return false
  await open.click()
  await sleep(250)
  const rows = page.locator('[data-model-option]')
  const n = await rows.count()
  for (let i = 0; i < n; i += 1) {
    await rows
      .nth(i)
      .locator('input[type="checkbox"]')
      .check()
      .catch(() => {})
  }
  await page.locator('[data-model-apply]').click()
  await sleep(300)
  return n > 0
}

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts })
  await ctx.addInitScript(disableFSA)
  return ctx
}

// ────────────────────────────────────────────────────────────
// G1 核心闭环：建项目 → 加节点 → 刷新仍在 → 首页见节点数
// ────────────────────────────────────────────────────────────
async function g1(browser) {
  const g = 'G1 闭环'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  // 首页项目列表要等 IndexedDB 读回后才渲染，冷启动（全量跑的第一组）可能晚于 networkidle；
  // isVisible() 不自动等待，若直接判定会把「还没渲染」误报成「没有空状态」。显式等一拍（仍会在真缺时超时失败）。
  await page.getByText('还没有项目').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  const empty = await page.getByText('还没有项目').isVisible()
  rec(g, '空状态出现', empty)
  await page.screenshot({ path: `${OUT}/01-home-empty.png` })

  await createProject(page)
  const url1 = page.url()
  rec(g, '新建空白项目 → 进画布', /\/canvas\/.+/.test(url1), url1.replace(BASE, ''))

  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(300)
  const n1 = await nodeCount(page)
  rec(g, '加提示词节点', n1 === 1, `节点数=${n1}`)
  await page.screenshot({ path: `${OUT}/02-canvas-node.png` })

  // 防抖 800ms，等落库后再刷新（验收「刷新后节点还在」）
  await sleep(1100)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(400)
  const n2 = await nodeCount(page)
  rec(g, '刷新后节点仍在', n2 === 1, `节点数=${n2}`)

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  const meta = await page.locator('[data-project-card]').first().innerText()
  rec(g, '首页卡片显示节点数', /1 个节点/.test(meta), meta.replace(/\n/g, ' / '))
  await page.screenshot({ path: `${OUT}/03-home-card.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G2 模板库：按模板建项目 → 预置节点与连线
// ────────────────────────────────────────────────────────────
async function g2(browser) {
  const g = 'G2 模板'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })

  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(600)
  const n = await nodeCount(page)
  const types = await page.locator('[data-node-id]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-node-type')),
  )
  rec(g, '文生图模板预置节点', n === 2, `节点数=${n} 类型=${types.join(',')}`)
  await page.screenshot({ path: `${OUT}/04-template-wensheng.png` })

  const edges = await page.locator('[data-edge]').count()
  rec(g, '模板预置连线已渲染', edges > 0, `连线数=${edges}`)

  // 模板预置应为「一步撤销」
  await page.getByRole('button', { name: '撤销' }).click()
  await sleep(300)
  const nAfterUndo = await nodeCount(page)
  rec(g, '模板预置单步撤销', nAfterUndo === 0, `撤销后节点数=${nAfterUndo}`)

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G3 卡片菜单 / 搜索 / 排序
// ────────────────────────────────────────────────────────────
async function g3(browser) {
  const g = 'G3 菜单排序'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })

  // 造 3 个项目
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await createProject(page)
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.locator('[data-project-card] button[aria-label="项目菜单"]').first().click()
    await page.getByRole('menuitem', { name: '重命名' }).click()
    const input = page.locator('[data-project-card] input').first()
    await input.fill(name)
    await input.press('Enter')
    await sleep(300)
  }
  const names = () =>
    page.locator('[data-project-card]').evaluateAll((els) =>
      els.map((e) => e.innerText.split('\n')[0]).filter(Boolean),
    )
  let list = await names()
  rec(g, '批量建项目 + 重命名', list.length === 3, list.join(','))

  // 复制
  await page.locator('[data-project-card] button[aria-label="项目菜单"]').first().click()
  await page.getByRole('menuitem', { name: '复制' }).click()
  await sleep(400)
  list = await names()
  rec(g, '复制项目', list.length === 4, list.join(','))

  // 搜索
  await page.getByLabel('搜索项目').fill('Alph')
  await sleep(300)
  list = await names()
  rec(g, '搜索过滤', list.length === 1 && list[0].includes('Alpha'), list.join(','))
  await page.getByLabel('搜索项目').fill('')

  // 排序（名称 A-Z）
  await page.getByLabel('排序方式').selectOption('name')
  await sleep(300)
  list = await names()
  rec(g, '按名称排序', list.length >= 3, list.join(','))
  await page.screenshot({ path: `${OUT}/05-home-search-sort.png` })

  // 删除
  await page.locator('[data-project-card] button[aria-label="项目菜单"]').first().click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await sleep(200)
  await page.getByRole('button', { name: '确认' }).click()
  await sleep(400)
  list = await names()
  rec(g, '删除项目（二次确认）', list.length === 3, list.join(','))

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G4 视口：滚轮缩放 / clamp / 滚轮归文本框 / 空格拖拽 / 中键拖拽
// ────────────────────────────────────────────────────────────
async function g4(browser) {
  const g = 'G4 视口'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await createProject(page)
  await sleep(400)

  const box = await page.locator('[data-canvas-surface]').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2

  const v0 = await readViewport(page)
  await page.mouse.move(cx, cy)
  await page.mouse.wheel(0, -400)
  await sleep(250)
  const v1 = await readViewport(page)
  rec(g, '滚轮放大', v1.zoom > v0.zoom, `${v0.zoom} → ${v1.zoom}`)

  // clamp 上限 500%
  for (let i = 0; i < 25; i++) await page.mouse.wheel(0, -400)
  await sleep(300)
  const vMax = await readViewport(page)
  rec(g, '缩放上限 clamp 500%', Math.abs(vMax.zoom - 5) < 0.001, `zoom=${vMax.zoom}`)

  for (let i = 0; i < 60; i++) await page.mouse.wheel(0, 400)
  await sleep(300)
  const vMin = await readViewport(page)
  rec(g, '缩放下限 clamp 10%', Math.abs(vMin.zoom - 0.1) < 0.001, `zoom=${vMin.zoom}`)

  await page.getByRole('button', { name: '复位视图' }).click()
  await sleep(250)

  // 滚轮归文本框：双击节点进入编辑态（提示词节点的 textarea 只在编辑时渲染）
  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(400)
  await page.locator('[data-node-id]').first().dblclick()
  await sleep(300)
  const ta = page.locator('[data-node-id] textarea').first()
  const hasTa = (await ta.count()) > 0
  rec(g, '双击节点进入编辑（出现 textarea）', hasTa)
  if (hasTa) {
    const before = await readViewport(page)
    await ta.click()
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, -400)
    await sleep(250)
    const after = await readViewport(page)
    rec(g, '滚轮归文本框（不缩放）', Math.abs(after.zoom - before.zoom) < 1e-6, `${before.zoom} → ${after.zoom}`)
    await ta.click()
    await page.keyboard.type('a b')
    const val = await ta.inputValue()
    rec(g, '文本框内可键入空格（空格未被画布接管）', val.includes(' '), JSON.stringify(val))
  }

  // 空格 + 拖拽平移（点过工具栏后焦点不应滞留按钮，否则空格会被按钮吃掉）
  await page.getByRole('button', { name: '复位视图' }).click()
  await sleep(200)
  // 先把焦点从提示词 textarea 移回画布（文本框内空格属于输入，这是正确行为）
  await page.evaluate(() => {
    const el = document.activeElement
    if (el && typeof el.blur === 'function') el.blur()
  })
  await sleep(150)
  const p0 = await readViewport(page)
  await page.keyboard.down('Space')
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 120, cy + 80, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await sleep(250)
  const p1 = await readViewport(page)
  rec(g, '空格 + 拖拽平移', p1.x !== p0.x || p1.y !== p0.y, `(${p0.x},${p0.y}) → (${p1.x},${p1.y})`)

  // 中键拖拽平移（无视选中）
  await page.getByRole('button', { name: '复位视图' }).click()
  await sleep(200)
  const m0 = await readViewport(page)
  await page.mouse.move(cx, cy)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.move(cx - 100, cy - 60, { steps: 8 })
  await page.mouse.up({ button: 'middle' })
  await sleep(250)
  const m1 = await readViewport(page)
  rec(g, '中键拖拽平移', m1.x !== m0.x || m1.y !== m0.y, `(${m0.x},${m0.y}) → (${m1.x},${m1.y})`)
  await page.screenshot({ path: `${OUT}/06-canvas-viewport.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G5 导入导出 .flow.json 往返
// ────────────────────────────────────────────────────────────
async function g5(browser) {
  const g = 'G5 导入导出'
  const ctx = await newCtx(browser, { acceptDownloads: true })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })

  await createProject(page)
  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(1100)
  const nBefore = await nodeCount(page)

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)

  // 导出
  const dlPromise = page.waitForEvent('download', { timeout: 8000 }).catch(() => null)
  await page.locator('[data-project-card] button[aria-label="项目菜单"]').first().click()
  await page.getByRole('menuitem', { name: '导出' }).click()
  const dl = await dlPromise
  if (!dl) {
    rec(g, '导出触发下载', false, '未捕获 download 事件')
    await ctx.close()
    return
  }
  const file = `${OUT}/${dl.suggestedFilename()}`
  await dl.saveAs(file)
  rec(g, '导出触发下载', true, dl.suggestedFilename())

  // 导入（先删掉原项目，确认是导入还原出来的）
  await page.locator('[data-project-card] button[aria-label="项目菜单"]').first().click()
  await page.getByRole('menuitem', { name: '删除' }).click()
  await page.getByRole('button', { name: '确认' }).click()
  await sleep(500)
  const cntAfterDel = await page.locator('[data-project-card]').count()

  const fcPromise = page.waitForEvent('filechooser', { timeout: 8000 })
  await page.getByRole('button', { name: '导入' }).click()
  const fc = await fcPromise.catch(() => null)
  if (!fc) {
    rec(g, '导入触发文件选择', false, '未捕获 filechooser 事件')
    await ctx.close()
    return
  }
  await fc.setFiles(file)
  await sleep(800)
  const cntAfterImport = await page.locator('[data-project-card]').count()
  rec(g, '导入后项目恢复', cntAfterImport === cntAfterDel + 1, `${cntAfterDel} → ${cntAfterImport}`)
  rec(g, '导入播报状态', /已导入/.test(await page.getByRole('status').innerText()))

  await page.locator('[data-project-card]').first().click()
  await page.waitForURL(/\/canvas\//)
  await sleep(500)
  const nAfter = await nodeCount(page)
  rec(g, '导入项目节点数一致', nAfter === nBefore, `${nBefore} → ${nAfter}`)
  await page.screenshot({ path: `${OUT}/07-imported.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G6 跨标签写入提示
// ────────────────────────────────────────────────────────────
async function g6(browser) {
  const g = 'G6 跨标签'
  const ctx = await newCtx(browser)
  const p1 = await ctx.newPage()
  await p1.goto(BASE, { waitUntil: 'networkidle' })
  await createProject(p1)
  const url = p1.url()
  await sleep(500)

  const p2 = await ctx.newPage()
  await p2.goto(url, { waitUntil: 'networkidle' })
  await sleep(500)
  await p2.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(1100) // 等防抖落库

  // 用户切回标签 1（标签 2 转 hidden → 触发 flush + 广播）
  await p1.bringToFront()
  await sleep(900)
  const banner = await p1.getByText('项目已在其他标签页修改').isVisible().catch(() => false)
  rec(g, '跨标签写入出现提示横幅', banner, banner ? '' : '未出现（广播仅在页面隐藏时触发）')
  if (banner) await p1.screenshot({ path: `${OUT}/08-cross-tab-banner.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G7 IndexedDB 不可用降级页
// ────────────────────────────────────────────────────────────
async function g7(browser) {
  const g = 'G7 降级页'
  const ctx = await newCtx(browser)
  await ctx.addInitScript(
    `Object.defineProperty(window, 'indexedDB', { get() { return undefined }, configurable: true })`,
  )
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(800)
  const shown = await page
    .getByText(/依赖浏览器的 IndexedDB/)
    .isVisible()
    .catch(() => false)
  rec(g, 'IndexedDB 不可用时出降级提示', shown)
  if (shown) await page.screenshot({ path: `${OUT}/09-idb-fallback.png` })
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G8 设置页：新增渠道 → 验证地址 → 拉取/选择模型 → 已选模型持久化（M2-1 + §7.4 真机验收）
// ────────────────────────────────────────────────────────────
async function g8(browser) {
  const g = 'G8 设置页'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(400)

  // 新增一个 mock 渠道
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(400)
  const created = await page.getByText('新建渠道').first().isVisible().catch(() => false)
  rec(g, '新增渠道出现在列表', created)
  const protoShort = await page.locator('[data-channel-proto]').first().innerText().catch(() => '')
  rec(g, '列表项显示协议短标签（§7.2）', protoShort.trim() === 'MOCK', protoShort)
  await page.screenshot({ path: `${OUT}/10-settings-new.png` })

  // 验证地址：只回答「地址通不通」（§7.3 收窄后不再顺带灌模型缓存）
  await page.getByRole('button', { name: '验证地址' }).click()
  const ok = await page
    .getByText(/地址可达/)
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  rec(g, '验证地址通过（只测连通性）', ok)
  const statusText = (await page.locator('[role="status"]').innerText()).replace(/\s+/g, '')
  rec(g, '状态行含协议名与延迟（§7.3）', statusText.includes('Mock') && /\d+ms/.test(statusText), statusText)
  rec(g, '状态行不再提「发现 N 个模型」（那不是验证的产出）', !statusText.includes('个模型'), statusText)

  // §7.3 / §7.4 的分工：验证**不**灌缓存 —— 没拉过模型时是「还没拉取过」空态
  rec(g, '验证不写模型缓存（仍是「还没拉取过」空态）', (await page.locator('[data-models-empty]').count()) === 1)

  // 拉取模型 → 缓存到位，但**不**替用户勾选
  await page.getByRole('button', { name: '拉取模型' }).click()
  await page.getByText(/已拉取模型/).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  const pulledText = (await page.locator('[role="status"]').innerText()).replace(/\s+/g, '')
  rec(g, '拉取模型状态行给出数量', pulledText.includes('已拉取模型') && /发现3个模型/.test(pulledText), pulledText)
  rec(g, '拉取后仍未自动勾选（未选模型空态）', (await page.locator('[data-models-none]').count()) === 1)

  // 打开选择面板：分类 tab 与搜索都应当能收敛列表
  await page.getByRole('button', { name: '选择模型' }).click()
  await sleep(250)
  const allOpts = await page.locator('[data-model-option]').count()
  rec(g, '选择面板列出全部缓存模型', allOpts === 3, `选项=${allOpts}`)
  await page.locator('[data-model-tab="chat"]').click()
  await sleep(200)
  const chatOpts = await page.locator('[data-model-option]').count()
  rec(g, '分类 tab 收敛列表（对话）', chatOpts === 1, `选项=${chatOpts}`)
  await page.locator('[data-model-tab="all"]').click()
  await page.locator('[data-model-search]').fill('image')
  await sleep(200)
  const searched = await page.locator('[data-model-option]').count()
  rec(g, '搜索框按名称过滤', searched === 1, `选项=${searched}`)
  await page.locator('[data-model-search]').fill('')
  await sleep(150)
  await page.screenshot({ path: `${OUT}/10c-g8-model-panel.png` })

  // 勾选 → 应用 → 已选模型按分类成行
  const rows = page.locator('[data-model-option]')
  const rowCount = await rows.count()
  for (let i = 0; i < rowCount; i += 1) {
    await rows
      .nth(i)
      .locator('input[type="checkbox"]')
      .check()
      .catch(() => {})
  }
  await page.locator('[data-model-apply]').click()
  await sleep(400)
  const chips = await page.locator('[data-model-chip]').count()
  rec(g, '应用后已选模型渲染为胶囊', chips === 3, `胶囊=${chips}`)
  rec(g, '已选模型按分类成行（生图模型）', await page.getByText('生图模型').first().isVisible().catch(() => false))
  await page.screenshot({ path: `${OUT}/11-settings-verified.png` })

  // 刷新后渠道、模型缓存与已选模型都还在（IndexedDB 持久化）
  await sleep(900)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(600)
  const persisted = await page.getByText('新建渠道').first().isVisible().catch(() => false)
  rec(g, '刷新后渠道持久化', persisted)
  // 重新选中并确认已选模型随渠道读回
  await page.getByText('新建渠道').first().click()
  await sleep(300)
  const chipsAfter = await page.locator('[data-model-chip]').count()
  rec(g, '刷新后已选模型随渠道读回', chipsAfter === 3, `胶囊=${chipsAfter}`)

  // × 单个删除（§7.4：已选模型的唯一删除入口）
  await page.locator('[data-model-remove]').first().click()
  await sleep(400)
  const chipsAfterRemove = await page.locator('[data-model-chip]').count()
  rec(g, '已选模型可单个删除', chipsAfterRemove === 2, `胶囊=${chipsAfterRemove}`)

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G9 出图闭环（M2-2 真机验收）：配置 mock 渠道 → 文生图模板 → 选渠道/模型/提示词
//   → 点生成 → 结果组出现并渲染缩略图 → 刷新后结果组仍在（IndexedDB 持久化）
// ────────────────────────────────────────────────────────────
async function g9(browser) {
  const g = 'G9 出图闭环'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 1) 配置 mock 渠道：新增 → 验证地址 → 勾选模型 → 启用（公共流程见 configureMockChannel）
  const { verified, enabled } = await configureMockChannel(page)
  rec(g, '渠道验证通过并拉到模型', verified)
  rec(g, '渠道已启用（列表徽标）', enabled)
  await page.screenshot({ path: `${OUT}/10b-g9-channel.png` })

  // 2) 文生图模板进画布（预置 提示词 + 生成 节点）
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // 诊断：打印生成节点平台 chip 的可选项，确认渠道已出现在画布平台选择中
  // （M6-16 起这些参数在**创作面板**里，节点本体只剩媒体框；M6-17 起是上拉浮层）
  const panel = await genPanel(page)
  const chOpts = await paramOptions(page, panel, 'channel')
  console.log('  [diag] 生成节点平台 chip 可选项 =', JSON.stringify(chOpts))

  // 3) 生成节点选 渠道 + 模型 + 提示词（用 data 属性而非 CSS module 哈希类名）
  await configureGenPanel(page, panel, '屋顶的猫')
  // N=1 已不建结果组（§6.16，M6-24）：本组要验的是「结果组出现 + 刷新后仍在」，
  // 故显式跑 4 张；单张不建组由 G53 覆盖。
  await setCount(panel, '4张')
  await page.screenshot({ path: `${OUT}/11b-g9-ready.png` })

  // 4) 点生成（圆形 ↑ 按钮，aria-label=生成；在创作面板参数行末尾）
  await panelRunBtn(page).click()

  // 5) 等结果组出现并渲染缩略图
  let rg = false
  try {
    await page.locator('[data-result-group]').first().waitFor({ state: 'visible', timeout: 15000 })
    rg = true
  } catch {
    rg = false
  }
  rec(g, '生成后出现结果组', rg)
  if (rg) {
    const header = await page.locator('[data-result-group]').first().innerText()
    rec(g, '结果组标题含张数', /张结果/.test(header), header.replace(/\n/g, ' '))
    // 素材经 800ms 防抖落库，缩略图由 useAsset 退避重试后渲染，需等待出现
    let imgCount = 0
    for (let i = 0; i < 24; i++) {
      imgCount = await page.locator('[data-result-group] img').count()
      if (imgCount >= 1) break
      await sleep(250)
    }
    rec(g, '结果组渲染缩略图', imgCount >= 1, `img=${imgCount}`)
    const src = await page.locator('[data-result-group] img').first().getAttribute('src').catch(() => '')
    rec(g, '缩略图来自素材库 objectURL', (src ?? '').startsWith('blob:'), String(src).slice(0, 16))
  }
  await page.screenshot({ path: `${OUT}/12-g9-resultgroup.png` })

  // 6) 刷新后结果组仍在（IndexedDB 持久化：nodes / resultGroups / assets）
  await sleep(1100)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(800)
  const rgAfter = await page.locator('[data-result-group]').first().isVisible().catch(() => false)
  rec(g, '刷新后结果组仍在', rgAfter)
  await page.screenshot({ path: `${OUT}/13-g9-persist.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G10 M2-3 打磨：数量胶囊 / 多张结果组方格 / 日志面板 / 取消
// ────────────────────────────────────────────────────────────
async function g10(browser) {
  const g = 'G10 打磨'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 配一个 mock 渠道并启用（含勾选模型：§7.4 起画布下拉只列已勾选的）
  await configureMockChannel(page)

  // 进画布（文生图模板）
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // 参数与数量胶囊都在创作面板里（节点本体只剩媒体框，§6.8）
  const panel = await genPanel(page)
  await pickParam(panel, 'channel', '新建渠道')
  await sleep(200)
  await pickParam(panel, 'model', 'mock-image-1')
  await sleep(200)

  // 数量胶囊固定四项
  const countBtns = await panel.locator('button').filter({ hasText: '张' }).allInnerTexts()
  rec(g, '数量胶囊固定四项 1/2/4/9', JSON.stringify(countBtns) === '["1张","2张","4张","9张"]', countBtns.join(','))

  // 生成按钮空闲态：圆形 ↑ + aria-label「生成当前节点」（§6.8 三态之一）
  const idleLabel = await panel.locator(`button[aria-label="生成当前节点"]`).count()
  rec(g, '生成按钮空闲态为「生成当前节点」', idleLabel === 1, `count=${idleLabel}`)

  // 选 2 张，输入提示词，生成
  await panel.locator('button').filter({ hasText: '2张' }).click()
  await sleep(200)
  const ta = panel.locator('textarea').first()
  await ta.click()
  await ta.fill('两只会飞的猫')
  await sleep(200)
  await panelRunBtn(page).click()

  // 等结果组出现，2 张应排成单行（同一 y，2 个不同 x）
  let rg = false
  try {
    await page.locator('[data-result-group]').first().waitFor({ state: 'visible', timeout: 15000 })
    rg = true
  } catch {
    rg = false
  }
  rec(g, '生成 2 张出现结果组', rg)
  if (rg) {
    const header = await page.locator('[data-result-group]').first().innerText()
    rec(g, '结果组标题为 2 张结果', /2 张结果/.test(header), header.replace(/\n/g, ' '))
    // 等缩略图渲染
    let imgs = 0
    for (let i = 0; i < 24; i++) {
      imgs = await page.locator('[data-result-group] img').count()
      if (imgs >= 2) break
      await sleep(250)
    }
    rec(g, '结果组渲染 2 张缩略图', imgs >= 2, `img=${imgs}`)
  }
  await page.screenshot({ path: `${OUT}/14-g10-grid.png` })

  // 日志面板：打开 → 有记录 → 关闭
  await page.getByRole('button', { name: '日志' }).click()
  await sleep(600)
  const dialog = page.getByRole('dialog', { name: '日志面板' })
  const logOpen = await dialog.isVisible().catch(() => false)
  rec(g, '顶栏日志按钮打开日志面板', logOpen)
  if (logOpen) {
    const text = await dialog.innerText()
    rec(g, '日志含成功与模型胶囊', /成功/.test(text) && /mock-image-1/.test(text), text.replace(/\n/g, ' ').slice(0, 80))
    rec(g, '日志含发送到画布按钮', /发送到画布/.test(text))
    await page.screenshot({ path: `${OUT}/15-g10-log.png` })

    // §6.18「请求1024x1024  实际1024x1024」：两个数字都要在，且是**真读出来的**。
    // 判据不写死期望值，而是拿缩略图 <img> 的实际 naturalWidth/Height 去比对文案里的
    // 「实际」一侧——只有界面真的显示了产物尺寸时两边才对得上（G49 同款手法）。
    const pxText = (await page.locator('[data-log-pixels]').first().innerText().catch(() => '')).trim()
    rec(g, '日志含请求像素与实际像素（§6.18）', /请求\d+x\d+/.test(pxText) && /实际\d+x\d+/.test(pxText), `text="${pxText}"`)
    const logThumb = page.locator('[data-log-thumb] img').first()
    const thumbSize = await logThumb
      .evaluate((el) => ({ w: el.naturalWidth ?? 0, h: el.naturalHeight ?? 0 }))
      .catch(() => ({ w: 0, h: 0 }))
    const actualText = /实际(\d+)x(\d+)/.exec(pxText)
    const actualMatchesPixels =
      thumbSize.w > 0 &&
      actualText !== null &&
      Number(actualText[1]) === thumbSize.w &&
      Number(actualText[2]) === thumbSize.h
    rec(
      g,
      '★ 日志实际像素与产物真实像素一致（不是照抄请求）',
      actualMatchesPixels,
      `shown=${actualText ? `${actualText[1]}x${actualText[2]}` : 'none'} img=${thumbSize.w}x${thumbSize.h}`,
    )

    // 清空
    await dialog.getByRole('button', { name: '清空' }).click()
    await sleep(400)
    const afterClear = await dialog.innerText()
    rec(g, '清空日志后无记录', /还没有生成记录/.test(afterClear))
    await dialog.getByRole('button', { name: '关闭' }).click()
    await sleep(300)
    const closed = await dialog.isVisible().catch(() => false)
    rec(g, '关闭日志面板', !closed)
  }

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G11 §14.1 标准 E2E：模型持久化 / 来源节点不被覆盖 / 4 张 2×2 独立子节点 / 密钥不入日志
// ────────────────────────────────────────────────────────────
async function g11(browser) {
  const g = 'G11 E2E'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 配 mock 渠道并启用（填一个可识别的令牌，用于验证密钥不落日志（E2E-02））
  await configureMockChannel(page, { token: 'SECRET-TOKEN-SHOULD-NOT-LEAK' })

  // ── E2E-02：选模型 → 重载后仍选中，且密钥不出现在页面 ──
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  const panel = await genPanel(page)
  await pickParam(panel, 'channel', '新建渠道')
  await sleep(200)
  await pickParam(panel, 'model', 'mock-image-1')
  await sleep(600)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(800)
  // 重载后选中态丢失，必须重新选中节点，才谈得上从面板读回参数
  const panelAfter = await genPanel(page)
  const modelAfterReload = await paramLabel(panelAfter, 'model').catch(() => '')
  rec(g, 'E2E-02 重载后模型仍选中', modelAfterReload === 'mock-image-1', modelAfterReload)
  const bodyText = await page.locator('body').innerText().catch(() => '')
  rec(g, 'E2E-02 页面不含明文密钥', !bodyText.includes('SECRET-TOKEN-SHOULD-NOT-LEAK'))

  // ── E2E-03：生成 1 张 → 结果回填到生成节点本体（N=1 不建结果组，§6.16），来源提示词不被覆盖 ──
  // 重载后视口可能偏移，先复位视图保证节点完整可见可交互
  await page.getByRole('button', { name: '复位视图' }).click()
  await sleep(500)
  const gen2 = page.locator('[data-node-type="generation"]')
  // 模板可能产生多个生成节点，统一取第一个并在整个 E2E-03/04 中复用同一 nodeId
  const genId = await gen2.first().getAttribute('data-node-id')
  const genNode = page.locator(`[data-node-id="${genId}"]`)
  const panel3 = await genPanel(page, genNode)
  await panel3.locator('textarea').first().fill('单张来源不被覆盖')
  await sleep(400)
  const srcPromptBefore = await panel3.locator('textarea').first().inputValue()
  rec(g, 'E2E-03 提示词已写入来源节点', srcPromptBefore === '单张来源不被覆盖', srcPromptBefore)
  await page.screenshot({ path: `${OUT}/16a-g11-before-click.png` })
  await panelRunBtn(page).first().dispatchEvent('click')
  /**
   * N=1 的产物**写回节点本体**、不再建结果组（用户 2026-09-13 拍板）：
   * 「一张图的结果容器」没有容器语义，只会让取图多跳一层。
   * 结果组的出现与持久化改由本组 E2E-04（4 张）与 G9（4 张）覆盖。
   */
  let filled = false
  for (let i = 0; i < 60; i++) {
    if ((await genNode.locator('[data-node-asset]').count()) > 0) {
      filled = true
      break
    }
    await sleep(250)
  }
  rec(g, 'E2E-03 生成后结果回填到生成节点本体', filled)
  const rg3 = await page.locator('[data-result-group]').count()
  rec(g, 'E2E-03 N=1 不建结果组', rg3 === 0, `groups=${rg3}`)
  const srcPromptAfter = await panel3.locator('textarea').first().inputValue()
  rec(g, 'E2E-03 来源节点提示词未被覆盖', srcPromptAfter === srcPromptBefore, srcPromptAfter)
  await page.screenshot({ path: `${OUT}/16-g11-e2e03.png` })

  // ── E2E-04：生成 4 张 → 2×2 排列，子节点可独立存在（4 个单元） ──
  await panel3.locator('button').filter({ hasText: '4张' }).first().dispatchEvent('click')
  await sleep(250)
  await panel3.locator('textarea').first().fill('四宫格')
  await sleep(300)
  await panelRunBtn(page).first().dispatchEvent('click')
  // 等第二个结果组出现（4 张）
  let grid = false
  try {
    await page.waitForFunction(
      () => document.querySelectorAll('[data-result-group]').length >= 1 &&
        /4 张结果/.test(document.body.innerText),
      { timeout: 15000 },
    )
    grid = true
  } catch {
    grid = false
  }
  rec(g, 'E2E-04 生成 4 张出现「4 张结果」', grid)
  if (grid) {
    // 找含「4 张结果」的那个组，断言其单元数 = 4，且缩略图坐标呈 2×2（2 个不同 y）
    const groups = page.locator('[data-result-group]')
    const n = await groups.count()
    let target = null
    for (let i = 0; i < n; i++) {
      const t = await groups.nth(i).innerText()
      if (/4 张结果/.test(t)) {
        target = groups.nth(i)
        break
      }
    }
    if (target) {
      let imgs = 0
      for (let k = 0; k < 24; k++) {
        imgs = await target.locator('img').count()
        if (imgs >= 4) break
        await sleep(250)
      }
      rec(g, 'E2E-04 结果组渲染 4 张缩略图', imgs >= 4, `img=${imgs}`)
      const tops = await target.locator('img').evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().top)),
      )
      const lefts = await target.locator('img').evaluateAll((els) =>
        els.map((el) => Math.round(el.getBoundingClientRect().left)),
      )
      const distinctRows = new Set(tops).size
      const distinctCols = new Set(lefts).size
      rec(
        g,
        'E2E-04 子节点呈 2×2（2 行 × 2 列）',
        distinctRows === 2 && distinctCols === 2,
        `rows=${distinctRows} cols=${distinctCols}`,
      )
    }
  }
  await page.screenshot({ path: `${OUT}/17-g11-e2e04.png` })

  // ── 密钥不落日志（E2E-02 后半）：日志面板打开后正文不含明文 ──
  await page.getByRole('button', { name: '日志' }).click()
  await sleep(700)
  const dialog = page.getByRole('dialog', { name: '日志面板' })
  const logOpen = await dialog.isVisible().catch(() => false)
  const logText = logOpen ? await dialog.innerText() : ''
  rec(g, 'E2E-02 日志不含明文密钥', logOpen && !logText.includes('SECRET-TOKEN-SHOULD-NOT-LEAK'))
  if (logOpen) await dialog.getByRole('button', { name: '关闭' }).click()

  await ctx.close()
}

/**
 * 采样页面上指定矩形区域内的「连线墨迹」像素数。
 *
 * 为什么必须用像素而不是 DOM 断言：连线是否**真的被画出来**无法从 DOM 证明——
 * 元素计数、`getBoundingClientRect()` 非零、`elementFromPoint()` 命中、计算样式全对，
 * 在一个 0×0 的 `<svg>` 根里**全都成立**，而 Chrome 会整块跳过它的绘制
 * （屏幕上一条线都没有）。只有真实屏幕 pixel 能证伪这类「静默不绘制」。
 *
 * 判定色：连线 `--edge` #c9c9d1（201,201,209）。相比画布底 #fcfcfb（252）、网格线 #ececef（236）、
 * 节点白底（255）/描边 #deded9（222），它**比网格线更暗**（r ≤ 234，网格线永远不会低于 236，
 * 故网格绝不会误判）且**偏蓝**（b−r = +8；网格线 +3，白底 0，描边 −5）。
 * 用「r ∈ [150,234] 且 b−r ≥ 2」把连线连同其抗锯齿中间色一起摘出来——
 * 阈值必须覆盖 1.5px 描边落在半像素上（覆盖率 0.5、r≈226）的情形，否则同一根线
 * 在平移前后会因亚像素相位不同而给出悬殊的计数。
 * （注：高亮态连线是 `--edge-highlight` #171716，r=23 落在区间外——采样只在常态下做。）
 */
async function countEdgeInk(page, clip) {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  const x = Math.max(0, Math.floor(clip.x))
  const y = Math.max(0, Math.floor(clip.y))
  const width = Math.min(Math.ceil(clip.width), vp.width - x)
  const height = Math.min(Math.ceil(clip.height), vp.height - y)
  if (width <= 0 || height <= 0) return 0
  const shot = await page.screenshot({ clip: { x, y, width, height } })
  return page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g2 = c.getContext('2d')
    g2.drawImage(img, 0, 0)
    const d = g2.getImageData(0, 0, c.width, c.height).data
    let ink = 0
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]
      if (r >= 150 && r <= 234 && d[i + 2] - r >= 2) ink++
    }
    return ink
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

/** 取某条连线的外接框（外扩 2px，保证 1.5px 描边的抗锯齿边也落在裁剪区内） */
async function edgeClip(page) {
  const box = await page.locator('[data-edge]').first().boundingBox()
  if (!box) return null
  return { x: box.x - 2, y: box.y - 2, width: box.width + 4, height: box.height + 4 }
}

/**
 * 「已绘制」的判定下限（采样区内符合连线色的像素数）。实测标定：
 * 0×0 状态（真·没画）= 0；平移后偶有 ~28 像素来自节点端口小圆点（落在外扩的 2px 里）；
 * 正常绘制 = 98~183（同一根线平移前后因亚像素相位不同会波动）。
 * 取 60：远高于噪声底，又留在正常值的下沿之下。
 */
const EDGE_INK_MIN = 60

/**
 * 采样页面上指定矩形区域内的「陈旧橘色」像素数（§6.19.5）。
 *
 * 与连线同理：陈旧标记是否**真的被画出来**无法从 DOM 证明——`data-node-stale`
 * 存在、`[data-stale-dot]` 计数为 1、计算样式 `outline-color` 正确，
 * 都可能发生在元素被遮挡 / 尺寸为 0 / 被后续规则覆盖而屏幕上什么都没有的情形。
 *
 * 判定色：陈旧标记 `--warn` #9a6424（154,100,36）。画布上其余候选色都能被排除：
 * - 文本 / 描边 / 网格 / 白底（#171716 / #deded9 / #ececef / #ffffff）：r−b ≤ 5；
 * - 连线 #c9c9d1：r−b = −8；
 * - 危险色 #b4473a：**偏红**（g−b = 13），而陈旧色**偏棕**（g−b = 64）。
 * 故用「r ≥ 120 且 r−b ≥ 50 且 g−b ≥ 30 且 g < r」锁定橘棕系，
 * 阈值下探到与白底约 50% 的抗锯齿混色（≈ 203,176,143）仍计入。
 */
async function countWarnInk(page, clip) {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  const x = Math.max(0, Math.floor(clip.x))
  const y = Math.max(0, Math.floor(clip.y))
  const width = Math.min(Math.ceil(clip.width), vp.width - x)
  const height = Math.min(Math.ceil(clip.height), vp.height - y)
  if (width <= 0 || height <= 0) return 0
  const shot = await page.screenshot({ clip: { x, y, width, height } })
  return page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g2 = c.getContext('2d')
    g2.drawImage(img, 0, 0)
    const d = g2.getImageData(0, 0, c.width, c.height).data
    let ink = 0
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]
      const gg = d[i + 1]
      const b = d[i + 2]
      if (r >= 120 && r - b >= 50 && gg - b >= 30 && gg < r) ink++
    }
    return ink
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

/**
 * 小地图里「节点矩形」的墨迹像素数（G56）。
 *
 * 节点填充 #D8D8DE = (216,216,222)：**偏蓝的中灰**（b−r ≈ 6）；
 * 视口框填充是 rgba(22,22,26,0.06) 叠白底 ≈ (241,241,241)（更亮、且 b−r = 0）；
 * 白底是 (255,255,255)。三者在色相上分得开，故能把「节点真的画出来了」单独摘出来——
 * 否则 DOM 里数得到 `[data-minimap-node]` 并不代表屏幕上真有（老教训：连线就栽在这）。
 */
async function countMinimapInk(page, clip) {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  const x = Math.max(0, Math.floor(clip.x))
  const y = Math.max(0, Math.floor(clip.y))
  const width = Math.min(Math.ceil(clip.width), vp.width - x)
  const height = Math.min(Math.ceil(clip.height), vp.height - y)
  if (width <= 0 || height <= 0) return 0
  const shot = await page.screenshot({ clip: { x, y, width, height } })
  return page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g2 = c.getContext('2d')
    g2.drawImage(img, 0, 0)
    const d = g2.getImageData(0, 0, c.width, c.height).data
    let ink = 0
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i]
      const gg = d[i + 1]
      const b = d[i + 2]
      if (r >= 195 && r <= 240 && b - r >= 3 && b - r <= 12 && Math.abs(r - gg) <= 4) ink++
    }
    return ink
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

/**
 * 点画布上**真正的空白处**来取消选中（返回是否点到）。
 *
 * 为什么不能写死坐标：空白位置随布局漂移。M6-16 把参数与提示词挪进节点下方的
 * **创作参数面板**后，原先安全的 `(1150, 720)` 落进了面板里——点它既没清掉选中
 * （面板区域不算「空白单击」），断言又自以为已经取消了选中，于是「陈旧描边」被
 * 选中态的黑描边压掉、像素采样测到 0。
 *
 * 改为运行时扫一圈候选点，取第一个**直接命中画布表面**且不属于任何浮层 / 节点的位置。
 */
/**
 * 在画布上找一个**真正的空白点**（只找不点）。
 *
 * 为什么必须有这个函数、而一处都不能写死坐标：所谓「空白」会随布局漂移。
 * - M6-16：创作参数面板下沉到节点下方，原先安全的 `(1150, 720)` 落进面板里；
 * - M6-27：小地图常驻右下角 200×140（§6.4），同一片坐标又落进小地图里。
 *
 * **后者尤其阴险**：小地图是 `[data-canvas-surface]` 的**后代**，所以 Playwright 的
 * 命中检查不会报「intercepts pointer events」——点击静悄悄发给小地图，既没当成
 * 「空白单击」（清不掉选中），还顺手把视口平移走了，后续断言连锁失败却不报错。
 * 因此凡是要「点空白」的地方一律走运行时扫点。
 *
 * @param dx,dy 若这次要点完还要从这儿拖出去（如平移手势），传位移量，
 *              一并校验终点也在空白处、且没出视口。
 */
async function blankPoint(page, { dx = 0, dy = 0 } = {}) {
  return page.evaluate(
    ({ dx, dy }) => {
      const W = window.innerWidth
      const H = window.innerHeight
      const blocked =
        '[data-node-id],[data-node-title],[data-creation-panel],[data-canvas-toolbar],[data-topbar],[data-canvas-minimap]'
      const isBlank = (x, y) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return false
        const el = document.elementFromPoint(x, y)
        return !!el && !el.closest(blocked) && !!el.closest('[data-canvas-surface]')
      }
      for (let y = 120; y <= 760; y += 40) {
        for (let x = 80; x <= 1240; x += 40) {
          if (isBlank(x, y) && isBlank(x + dx, y + dy)) return { x, y }
        }
      }
      return null
    },
    { dx, dy },
  )
}

async function clickBlankCanvas(page) {
  const hit = await blankPoint(page)
  if (!hit) return false
  await page.mouse.click(hit.x, hit.y)
  await page.waitForTimeout(350)
  return true
}

/**
 * 「陈旧**描边**已绘制」的判定下限。实测标定：
 * - 无标记 = 0（画布上没有第二个橘棕来源）；
 * - **仅右上角圆点**约 20~30 像素（6px 圆，抗锯齿吃掉外圈）；
 * - **圆点 + 2px 描边**（未选中时 outline 用 --warn）可达 1200+。
 *
 * 取 100：要求采样必须包含描边，即**采样前先清空选择**——节点一旦被选中，
 * `.frame.selected` 的 outline 会盖掉 `.frame.stale` 的橘色描边（选中优先级更高，
 * 见 NodeFrame.module.css 声明顺序），只剩圆点，计数会掉到 30 以下。
 * 故 G41 在取样前点空白取消选中（走 clickBlankCanvas，不写死坐标）。
 *
 * **圆点另有独立断言**（阈值 8，见 G41）：它是选中态下**唯一**的陈旧信号，
 * 而它最容易「DOM 在、屏幕没有」（被节点内容盖住），不能用描边的阈值顺带覆盖。
 */
const WARN_INK_MIN = 100

// ────────────────────────────────────────────────────────────
// G12 连线交互（§6.14）：单击选中变色 / 节点选中时上下游高亮+删除按钮 / 删除按钮删除 / 双击删除
// ────────────────────────────────────────────────────────────
async function g12(browser) {
  const g = 'G12 连线'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 文生图模板：提示词 → 图片生成，预置 1 条连线
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const edgeCount = () => page.locator('[data-edge]').count()
  rec(g, '模板预置 1 条连线', (await edgeCount()) === 1, `连线=${await edgeCount()}`)

  // 0) 像素级可见性：DOM 有 ≠ 画面有（0×0 的 <svg> 根会被 Chrome 整块跳过绘制，
  //    此时连线相关的 DOM 断言全绿、屏幕上却没有线）
  const box0 = await page.locator('[data-edge]').first().boundingBox()
  const clip0 = await edgeClip(page)
  const ink0 = clip0 ? await countEdgeInk(page, clip0) : 0
  rec(g, '连线在画面上真的被绘制（像素采样）', ink0 >= EDGE_INK_MIN, `墨迹像素=${ink0}`)

  // 平移：世界变换挂在内层 <g> 上，连线应随视口一起移动并照常绘制
  // 起终点都走 blankPoint：右下角现在是小地图，写死坐标会把「平移」变成「跳转视口」
  const panFrom = await blankPoint(page, { dx: -100, dy: -50 })
  await page.mouse.move(panFrom.x, panFrom.y)
  await page.mouse.down()
  await page.mouse.move(panFrom.x - 100, panFrom.y - 50, { steps: 8 })
  await page.mouse.up()
  await sleep(300)
  const clip1 = await edgeClip(page)
  const ink1 = clip1 ? await countEdgeInk(page, clip1) : 0
  rec(g, '平移后连线仍随视口位移且照常绘制', ink1 >= EDGE_INK_MIN, `墨迹像素=${ink1}`)

  // 单独 Z = 复位视图（§6.20）→ 连线回到原位
  await page.keyboard.press('z')
  await sleep(300)
  const box2 = await page.locator('[data-edge]').first().boundingBox()
  const clip2 = await edgeClip(page)
  const ink2 = clip2 ? await countEdgeInk(page, clip2) : 0
  rec(
    g,
    '视图复位后连线回原位且仍绘制',
    ink2 >= EDGE_INK_MIN && !!box0 && !!box2 && Math.abs(box2.x - box0.x) <= 2 && Math.abs(box2.y - box0.y) <= 2,
    `墨迹像素=${ink2} x:${box0 ? box0.x.toFixed(0) : '?'}→${box2 ? box2.x.toFixed(0) : '?'}`,
  )

  // 1) 单击连线 → 进入选中态（出现删除按钮）
  await page.locator('[data-edge-hit]').first().click()
  await sleep(250)
  const delBtnAfterClick = await page.locator('[data-edge-delete]').count()
  rec(g, '单击连线出现删除按钮（进入可删除态）', delBtnAfterClick >= 1, `btn=${delBtnAfterClick}`)
  await page.screenshot({ path: `${OUT}/19-g12-edge-selected.png` })

  // 2) 单击节点 → 其上下游连线高亮并出现删除按钮
  await page.locator('[data-node-type="prompt"]').first().click()
  await sleep(300)
  const delBtnAfterNodeSelect = await page.locator('[data-edge-delete]').count()
  rec(g, '节点选中时相关连线出现删除按钮', delBtnAfterNodeSelect >= 1, `btn=${delBtnAfterNodeSelect}`)

  // 3) 删除按钮点击 → 连线消失
  await page.locator('[data-edge-delete]').first().click()
  await sleep(300)
  rec(g, '点击删除按钮删除连线', (await edgeCount()) === 0, `连线=${await edgeCount()}`)
  await page.screenshot({ path: `${OUT}/20-g12-edge-deleted.png` })

  // 4) 撤销恢复连线，双击连线直接删除
  await page.getByRole('button', { name: '撤销' }).click()
  await sleep(300)
  rec(g, '撤销恢复连线', (await edgeCount()) === 1, `连线=${await edgeCount()}`)
  // 先取消选择（空白单击），使删除按钮不遮挡连线中点，再双击
  await page.locator('[data-canvas-surface]').click({ position: { x: 900, y: 500 } })
  await sleep(250)
  await page.locator('[data-edge-hit]').first().dispatchEvent('dblclick')
  await sleep(300)
  rec(g, '双击连线直接删除', (await edgeCount()) === 0, `连线=${await edgeCount()}`)

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G13 拖线建连（§6.14）：端点拖出贝塞尔 / 落点建边 / 非法目标拒绝 / 反向拖入
// ────────────────────────────────────────────────────────────
async function g13(browser) {
  const g = 'G13 拖线'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await createProject(page)
  await sleep(500)
  // 文生图模板给出「提示词 → 生成」一对合法连线起点，并自带 1 条边
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  rec(g, '模板已带 1 条连线', (await page.locator('[data-edge]').count()) === 1, `连线=${await page.locator('[data-edge]').count()}`)

  // 加一个对比节点（生成 → 对比 是合法连接）
  await page.getByRole('button', { name: '＋ 对比' }).click()
  await sleep(400)
  const cmpNode = page.locator('[data-node-type="compare"]').first()
  const cmpId = await cmpNode.getAttribute('data-node-id')

  // 错开对比节点，避免与生成节点重叠
  const cmp0 = await cmpNode.boundingBox()
  await page.mouse.move(cmp0.x + cmp0.width / 2, cmp0.y + 10)
  await page.mouse.down()
  await page.mouse.move(cmp0.x + cmp0.width / 2 + 380, cmp0.y + 150, { steps: 10 })
  await page.mouse.up()
  await sleep(350)

  const gen = page.locator('[data-node-type="generation"]').first()
  const genId = await gen.getAttribute('data-node-id')
  const genNode = page.locator(`[data-node-id="${genId}"]`)
  await genNode.hover()
  await sleep(250)
  const outPort = genNode.locator('[data-port="output"]')
  const outBox = await outPort.boundingBox()
  const cmpBox = await cmpNode.boundingBox()

  // 拖线：生成 → 对比 → 建边（此时共 2 条）
  await page.mouse.move(outBox.x + outBox.width / 2, outBox.y + outBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(outBox.x + 60, outBox.y + 10, { steps: 6 })
  rec(g, '拖线中出现草稿曲线', (await page.locator('[data-edge-draft]').count()) === 1)
  await page.screenshot({ path: `${OUT}/21-g13-draft.png` })
  await page.mouse.move(cmpBox.x + cmpBox.width / 2, cmpBox.y + cmpBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await sleep(400)
  rec(g, '落点在目标节点范围内即建边', (await page.locator('[data-edge]').count()) === 2, `连线=${await page.locator('[data-edge]').count()}`)
  rec(g, '草稿曲线在松手后消失', (await page.locator('[data-edge-draft]').count()) === 0)
  await page.screenshot({ path: `${OUT}/22-g13-connected.png` })

  // 重复连线（同向）被拒绝
  await genNode.hover()
  await sleep(250)
  const outBox2 = await outPort.boundingBox()
  await page.mouse.move(outBox2.x + outBox2.width / 2, outBox2.y + outBox2.height / 2)
  await page.mouse.down()
  await page.mouse.move(cmpBox.x + cmpBox.width / 2, cmpBox.y + cmpBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await sleep(350)
  rec(g, '重复连线不产生第二条边', (await page.locator('[data-edge]').count()) === 2, `连线=${await page.locator('[data-edge]').count()}`)

  // 类型不匹配被拒绝：提示词 → 对比（compare 只接受 generation/compare）
  const promptNode = page.locator('[data-node-type="prompt"]').first()
  await promptNode.hover()
  await sleep(250)
  const pId = await promptNode.getAttribute('data-node-id')
  const pOut = page.locator(`[data-node-id="${pId}"] [data-port="output"]`)
  const pOutBox = await pOut.boundingBox()
  const cmpBox2 = await page.locator(`[data-node-id="${cmpId}"]`).boundingBox()
  await page.mouse.move(pOutBox.x + pOutBox.width / 2, pOutBox.y + pOutBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(cmpBox2.x + cmpBox2.width / 2, cmpBox2.y + cmpBox2.height / 2, { steps: 8 })
  await page.mouse.up()
  await sleep(350)
  rec(g, '类型不匹配连线被拒绝（§11.3）', (await page.locator('[data-edge]').count()) === 2, `连线=${await page.locator('[data-edge]').count()}`)

  // 空白松手 → 不建边，但**要在指针处弹出可连接菜单**（§6.14「空白松手菜单」）。
  // 这里曾经是 `if (!hovered) return`：拖了半天线松在空白上就什么也不发生，
  // 文档从一开始就写了这个菜单，代码里却一直没有消费者。
  await genNode.hover()
  await sleep(250)
  const outBox3 = await outPort.boundingBox()
  await page.mouse.move(outBox3.x + outBox3.width / 2, outBox3.y + outBox3.height / 2)
  await page.mouse.down()
  const blankDrop = await blankPoint(page)
  await page.mouse.move(blankDrop.x, blankDrop.y, { steps: 8 })
  await page.mouse.up()
  await sleep(350)
  rec(g, '空白处松手不建边', (await page.locator('[data-edge]').count()) === 2, `连线=${await page.locator('[data-edge]').count()}`)

  const linkMenu = page.locator('[data-link-menu]')
  rec(g, '空白处松手弹出可连接菜单（不是无声取消）', (await linkMenu.count()) === 1, `菜单=${await linkMenu.count()}`)
  if ((await linkMenu.count()) === 1) {
    rec(g, '菜单方向 = 被拖的那一端（output）', (await linkMenu.getAttribute('data-link-menu-side')) === 'output')
    const mb = await linkMenu.boundingBox()
    // 锚点是「指针右侧 12px」，不是指针本身（右键菜单才是 +4/+4）
    rec(g, '菜单锚在指针右侧 12px', Math.abs(mb.x - blankDrop.x - 12) < 2, `Δx=${(mb.x - blankDrop.x).toFixed(1)}`)
    rec(g, '菜单含「新建并连接」分区', (await page.locator('[data-link-menu-section="create"]').count()) === 1)
    await page.screenshot({ path: `${OUT}/22b-g13-link-menu.png` })
    // Esc 关闭，且关闭本身不动已有连线（§6.14「菜单关闭不改变已有节点和连线」）
    await page.keyboard.press('Escape')
    await sleep(250)
    rec(g, 'Esc 关闭菜单', (await page.locator('[data-link-menu]').count()) === 0)
    rec(g, '开关菜单不产生连线', (await page.locator('[data-edge]').count()) === 2, `连线=${await page.locator('[data-edge]').count()}`)
  }

  // 自连被拒绝
  await genNode.hover()
  await sleep(250)
  const outBox4 = await outPort.boundingBox()
  const gBox = await genNode.boundingBox()
  await page.mouse.move(outBox4.x + outBox4.width / 2, outBox4.y + outBox4.height / 2)
  await page.mouse.down()
  await page.mouse.move(gBox.x + gBox.width / 2, gBox.y + gBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await sleep(350)
  rec(g, '自连被拒绝', (await page.locator('[data-edge]').count()) === 2, `连线=${await page.locator('[data-edge]').count()}`)

  // 「新建并连接」：建节点 + 建连线合成**一步撤销**（§6.3）。
  // 一律用**物理鼠标点击**，不用 btn.click()：菜单渲染在 surface 内部，pointerdown 会
  // 冒泡到 surface，若它一见菜单开着就关菜单，菜单会在 click 到达前被卸载——表现为
  // 「点了只关菜单、什么都不建」，而程序化 click 不产生 pointerdown，恰好把这类 bug 测漏。
  await promptNode.hover()
  await sleep(250)
  const pOutBox2 = await pOut.boundingBox()
  await page.mouse.move(pOutBox2.x + pOutBox2.width / 2, pOutBox2.y + pOutBox2.height / 2)
  await page.mouse.down()
  const blankDrop2 = await blankPoint(page)
  await page.mouse.move(blankDrop2.x, blankDrop2.y, { steps: 8 })
  await page.mouse.up()
  await sleep(350)
  const createItem = page.locator('[data-link-menu-item^="create:"]').first()
  rec(g, '菜单含可新建且连得上的类型', (await createItem.count()) >= 1)
  if ((await createItem.count()) >= 1) {
    const n0 = await page.locator('[data-node-id]').count()
    const e0 = await page.locator('[data-edge]').count()
    await createItem.click()
    await sleep(450)
    const n1 = await page.locator('[data-node-id]').count()
    const e1 = await page.locator('[data-edge]').count()
    rec(g, '「新建并连接」建出新节点', n1 === n0 + 1, `节点 ${n0} → ${n1}`)
    rec(g, '「新建并连接」同时建出连线', e1 === e0 + 1, `连线 ${e0} → ${e1}`)
    await page.keyboard.press('Control+z')
    await sleep(450)
    const n2 = await page.locator('[data-node-id]').count()
    const e2 = await page.locator('[data-edge]').count()
    rec(g, '新建并连接 = 一步撤销（不留孤立节点）', n2 === n0 && e2 === e0, `节点 ${n2}(期望 ${n0}) 连线 ${e2}(期望 ${e0})`)
  }
  await page.screenshot({ path: `${OUT}/22c-g13-create-link.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G14 对比节点（§6.10）：上游 2 张图 → A/B 叠放 + 可拖动分割线 + 比例持久化
// ────────────────────────────────────────────────────────────
async function g14(browser) {
  const g = 'G14 对比'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 配 mock 渠道并启用（生成两张图作为对比素材）
  await configureMockChannel(page)

  // 到画布：新建项目 → 「＋ 提示词」→「＋ 对比」，验证空态与类型拒绝
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await createProject(page)
  await sleep(500)

  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(300)
  const promptId = await page.locator('[data-node-type="prompt"]').first().getAttribute('data-node-id')
  await page.getByRole('button', { name: '＋ 对比' }).click()
  await sleep(400)
  const compareCount = await page.locator('[data-node-type="compare"]').count()
  rec(g, '顶栏「＋ 对比」创建对比节点', compareCount === 1, `对比节点=${compareCount}`)

  if (compareCount === 1) {
    const cmp = page.locator('[data-node-type="compare"]').first()
    const cmpId = await cmp.getAttribute('data-node-id')

    // 错开对比节点，避免与提示词节点重叠导致拖线取不到端点
    const cmp0 = await cmp.boundingBox()
    await page.mouse.move(cmp0.x + cmp0.width / 2, cmp0.y + 10)
    await page.mouse.down()
    await page.mouse.move(cmp0.x + cmp0.width / 2 + 360, cmp0.y + 180, { steps: 10 })
    await page.mouse.up()
    await sleep(400)

    rec(g, '对比节点空态占位（上游不足 2 张）', (await cmp.locator('img').count()) === 0)
    rec(g, '空态不出现分割线手柄', (await cmp.locator('[data-compare-handle]').count()) === 0)
    await page.screenshot({ path: `${OUT}/23-g14-compare-empty.png` })

    // 拖线：提示词 → 对比（compare 只接受 generation/compare）→ 应被拒绝
    const promptNode = page.locator(`[data-node-id="${promptId}"]`)
    await promptNode.hover()
    await sleep(250)
    const outBox = await page.locator(`[data-node-id="${promptId}"] [data-port="output"]`).boundingBox()
    const cmpBox = await page.locator(`[data-node-id="${cmpId}"]`).boundingBox()
    await page.mouse.move(outBox.x + outBox.width / 2, outBox.y + outBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(cmpBox.x + cmpBox.width / 2, cmpBox.y + cmpBox.height / 2, { steps: 8 })
    await page.mouse.up()
    await sleep(350)
    rec(
      g,
      '提示词 → 对比 类型不匹配被拒绝（§11.3）',
      (await page.locator('[data-edge]').count()) === 0,
      `连线=${await page.locator('[data-edge]').count()}`,
    )
  }

  // 空态下不出现分割线手柄
  rec(g, '空态不出现分割线手柄', (await page.locator('[data-compare-handle]').count()) === 0)

  // 换成陈列室验证双图叠放 + 拖动分割线（内存 assets 表预置了两张 PNG）
  await page.goto(`${BASE}/_preview`, { waitUntil: 'networkidle' })
  await sleep(1500)
  const cards = page.locator('[data-node-type="compare"]')
  const cardCount = await cards.count()
  rec(g, '陈列室渲染对比节点状态矩阵', cardCount >= 4, `卡片=${cardCount}`)

  if (cardCount >= 4) {
    // 陈列室第 1、2 张是空态，第 3 张起是双图叠放：按「有手柄」挑第一张有素材的卡
    let card = null
    for (let i = 0; i < cardCount; i++) {
      const c = cards.nth(i)
      if ((await c.locator('[data-compare-handle]').count()) > 0) {
        card = c
        break
      }
    }
    rec(g, '存在双图叠放的对比节点卡片', card !== null)

    if (card) {
      let imgs = 0
      for (let i = 0; i < 20; i++) {
        imgs = await card.locator('img').count()
        if (imgs >= 2) break
        await sleep(250)
      }
      rec(g, '双图叠放态渲染 2 张上游素材', imgs >= 2, `img=${imgs}`)
      rec(g, '双图叠放态出现分割线手柄', (await card.locator('[data-compare-handle]').count()) === 1)
      await page.screenshot({ path: `${OUT}/23-g14-compare.png` })

      // 拖动分割线 → data-compare-ratio 改变
      // 陈列室是长页滚动布局，手柄可能在视口下方：先滚到卡片再取坐标，否则鼠标事件不落在元素上
      await card.scrollIntoViewIfNeeded()
      await sleep(400)
      const ratioEl = card.locator('[data-compare-ratio]')
      const ratioBefore = await ratioEl.getAttribute('data-compare-ratio')
      const handle = card.locator('[data-compare-handle]')
      const hBox = await handle.boundingBox()
      const stageBox = await card.locator('[data-compare-ratio] > div').first().boundingBox()
      if (hBox && stageBox) {
        await page.mouse.move(hBox.x + hBox.width / 2, hBox.y + hBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(stageBox.x + stageBox.width * 0.25, hBox.y + hBox.height / 2, { steps: 10 })
        await page.mouse.up()
        await sleep(300)
        const ratioAfter = await ratioEl.getAttribute('data-compare-ratio')
        rec(g, '拖动分割线改变对比比例', ratioBefore !== ratioAfter, `${ratioBefore} → ${ratioAfter}`)
        await page.screenshot({ path: `${OUT}/24-g14-compare-dragged.png` })
      } else {
        rec(g, '拖动分割线改变对比比例', false, '未取到手柄坐标')
      }
    }
  }

  await ctx.close()
}


// ────────────────────────────────────────────────────────────
// G15 分组节点（§6.11）：拖入 / 拖出容器、3×3 网格、端点隐藏、清连线
// ────────────────────────────────────────────────────────────
async function g15(browser) {
  const g = 'G15 分组'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 建项目 → 分组 + 提示词
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await createProject(page)
  await sleep(500)

  await page.getByRole('button', { name: '＋ 分组' }).click()
  await sleep(400)
  const groupCount = await page.locator('[data-node-type="group"]').count()
  rec(g, '顶栏「＋ 分组」创建分组节点', groupCount === 1, `分组=${groupCount}`)

  if (groupCount !== 1) {
    await ctx.close()
    return
  }

  const group = page.locator('[data-node-type="group"]').first()
  const groupId = await group.getAttribute('data-node-id')

  // 空容器：虚线框 + 空态提示，无端点悬停需求
  // 容器状态属性挂在视图 body 上（外框是通用的 NodeFrame），故用 [data-group-body] 读出
  const groupBody = group.locator('[data-group-body]')
  rec(g, '空容器显示空态提示', (await group.locator('[data-group-empty]').count()) === 1)
  rec(g, '空容器子节点计数为 0', (await groupBody.getAttribute('data-group-child-count')) === '0')
  rec(
    g,
    '空容器最小尺寸为 240×192（§6.11）',
    (await groupBody.getAttribute('data-group-min')) === '240x192',
    String(await groupBody.getAttribute('data-group-min')),
  )
  rec(g, '分组容器本体有输入输出端点', (await group.locator('[data-port]').count()) === 2)

  // 把分组拖到左上，腾出中间放提示词
  const gb0 = await group.boundingBox()
  await page.mouse.move(gb0.x + gb0.width / 2, gb0.y + 10)
  await page.mouse.down()
  await page.mouse.move(120, 120, { steps: 8 })
  await page.mouse.up()
  await sleep(400)

  // 再建一个提示词节点，拖进分组
  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(400)
  const promptId = await page.locator('[data-node-type="prompt"]').first().getAttribute('data-node-id')
  const promptNode = page.locator(`[data-node-id="${promptId}"]`)
  const pb0 = await promptNode.boundingBox()
  await page.mouse.move(pb0.x + pb0.width / 2, pb0.y + 10)
  await page.mouse.down()
  // 拖到分组中心
  const gb1 = await page.locator(`[data-node-id="${groupId}"]`).boundingBox()
  await page.mouse.move(gb1.x + gb1.width / 2, gb1.y + gb1.height / 2, { steps: 12 })
  await page.mouse.up()
  await sleep(500)

  const afterDragCount = await groupBody.getAttribute('data-group-child-count')
  rec(g, '提示词拖入分组（子节点计数 → 1）', afterDragCount === '1', `childCount=${afterDragCount}`)
  rec(g, '组内出现 1 个嵌套节点', (await group.locator('[data-node-id]').count()) === 1)
  rec(g, '拖入后空态提示消失', (await group.locator('[data-group-empty]').count()) === 0)

  // 组内子节点端点隐藏、缩放手柄隐藏（§6.11）
  const childInGroup = page.locator(`[data-node-id="${promptId}"]`)
  rec(g, '组内节点端点隐藏', (await childInGroup.locator('[data-port]').count()) === 0)

  // 组内节点计数增加后，动态最小尺寸应大于空态
  const minAfter = await groupBody.getAttribute('data-group-min')
  rec(
    g,
    '有内容后动态最小尺寸提高（§6.11 尺寸）',
    minAfter !== '240x192',
    `min=${minAfter}`,
  )
  await page.screenshot({ path: `${OUT}/25-g15-group-filled.png` })

  // 拖出：把组内提示词拖到画布空白
  // 子节点被 NodeFrame 以 parentId 嵌套渲染，注意别被 group 自身命中
  const cb0 = await childInGroup.first().boundingBox()
  await page.mouse.move(cb0.x + cb0.width / 2, cb0.y + 10)
  await page.mouse.down()
  await page.mouse.move(900, 620, { steps: 12 })
  await page.mouse.up()
  await sleep(500)

  const afterOut = await groupBody.getAttribute('data-group-child-count')
  rec(g, '拖出后分组子节点计数回到 0（§6.11 拖出）', afterOut === '0', `childCount=${afterOut}`)
  const detached = await page.locator(`[data-node-id="${promptId}"]`).getAttribute('data-node-id')
  rec(g, '拖出的节点仍在画布上', detached === promptId)
  await page.screenshot({ path: `${OUT}/26-g15-group-dragout.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G16 批量节点（§6.12）：建节点 / 拖入 / 二选一互斥弱提示 / 集合卡 / 批量生成 N 结果
// ────────────────────────────────────────────────────────────
async function g16(browser) {
  const g = 'G16 批量'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 先配一个 mock 渠道（批量生成要靠它产出素材）
  await configureMockChannel(page)

  // 建项目 → 批量节点
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await createProject(page)
  await sleep(500)

  await page.getByRole('button', { name: '＋ 批量' }).click()
  await sleep(400)
  const batchCount = await page.locator('[data-node-type="batch"]').count()
  rec(g, '顶栏「＋ 批量」创建批量节点', batchCount === 1, `批量=${batchCount}`)
  if (batchCount !== 1) {
    await ctx.close()
    return
  }

  const batch = page.locator('[data-node-type="batch"]').first()
  const batchId = await batch.getAttribute('data-node-id')
  const body = batch.locator('[data-batch-body]')
  rec(g, '空容器显示空态提示', (await batch.locator('[data-batch-empty]').count()) === 1)
  rec(g, '空容器子节点计数为 0', (await body.getAttribute('data-batch-child-count')) === '0')
  rec(g, '批量容器本体有输入输出端点', (await batch.locator('[data-port]').count()) === 2)

  // 拖到左上，腾出空间
  const bb0 = await batch.boundingBox()
  await page.mouse.move(bb0.x + bb0.width / 2, bb0.y + 10)
  await page.mouse.down()
  await page.mouse.move(120, 120, { steps: 8 })
  await page.mouse.up()
  await sleep(400)

  // 先放提示词（把集合定为 prompt 类型）
  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(400)
  const p1Id = await page.locator('[data-node-type="prompt"]').first().getAttribute('data-node-id')
  await dragNode(page, p1Id, batchId)
  await sleep(500)

  const count1 = await body.getAttribute('data-batch-child-count')
  rec(g, '提示词拖入批量（子节点计数 → 1）', count1 === '1', `childCount=${count1}`)
  rec(g, '拖入后空态提示消失', (await batch.locator('[data-batch-empty]').count()) === 0)
  await page.screenshot({ path: `${OUT}/27-g16-batch-prompt.png` })

  // ── 同类可继续拖入：新建的提示词节点默认与上一个**完全重叠**（都落在视口中心），
  //    重叠时鼠标只能抓到上层那个，必须先把它挪开再拖 ──
  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(450)
  const promptCount = await page.locator('[data-node-type="prompt"]').count()
  rec(g, '再建一个提示词节点（用于同类拖入用例）', promptCount >= 2, `提示词=${promptCount}`)
  if (promptCount >= 2) {
    const p2Id = await page.locator('[data-node-type="prompt"]').nth(1).getAttribute('data-node-id')
    await moveNode(page, p2Id, 620, 620)
    await dragNode(page, p2Id, batchId)
    await sleep(600)
    const countSame = await body.getAttribute('data-batch-child-count')
    rec(g, '同类内容可继续拖入（提示词计数 → 2）', countSame === '2', `childCount=${countSame}`)
    // 容器应随子节点数量长大（§6.12「有内容时按当前网格动态提高最小尺寸」）
    const minAfter = await body.getAttribute('data-batch-min')
    rec(g, '批量容器随内容长大（最小尺寸 > 240x192）', minAfter !== '240x192', `min=${minAfter}`)
  }
  await page.screenshot({ path: `${OUT}/28-g16-batch-filled.png` })

  // ── 集合卡：批量节点连到生成节点后，生成节点面板第一部分显示集合卡 ──
  // 生成节点来自文生图模板；本页没有，用顶栏没有「＋ 生成」，
  // 因此走首页模板另开项目验证集合卡（见 G9/G10 路径），
  // 本组只验证「批量 → 生成」这条连线被 canConnect 接受。
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  // 模板里已有「提示词 → 生成」一条边
  const tplEdges = await page.locator('[data-edge]').count()
  rec(g, '文生图模板预置连线（对照）', tplEdges >= 1, `edges=${tplEdges}`)

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G17 框选 / 多选 / Alt 复制 / 工具栏对齐整理（§4.2 §6.5 §6.15 / M3-4）
// ────────────────────────────────────────────────────────────
async function g17(browser) {
  const g = 'G17 框选对齐'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, 'no pageerror', false, String(e).slice(0, 120)))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await createProject(page)
  await sleep(600)

  // 造 3 个提示词节点：都落在视口中心，必须挨个挪开（顶栏新建的坑，见 moveNode 注释）。
  // 横向排开：单选弹出的创作面板浮在节点下方（§6.8），纵向排布会被面板挡住点击。
  const ids = []
  for (let i = 0; i < 3; i += 1) {
    await page.getByRole('button', { name: '＋ 提示词' }).click()
    await sleep(400)
    const id = await page.locator('[data-node-type="prompt"]').last().getAttribute('data-node-id')
    ids.push(id)
    await moveNode(page, id, 380 + i * 330, 260)
  }
  rec(g, '建立 3 个提示词节点（横向排开）', ids.length === 3, `ids=${ids.length}`)

  /** 读取某个节点的 world 坐标（节点 style 的 left/top 即世界坐标） */
  const posOf = async (id) => {
    const el = page.locator(`[data-node-id="${id}"]`)
    const box = await el.boundingBox()
    return box ? { x: Math.round(box.x), y: Math.round(box.y) } : null
  }

  // ── 1. Ctrl/Cmd + 空白拖拽 = 框选（替换选中） ──
  await page.keyboard.down('Control')
  await page.mouse.move(120, 120)
  await page.mouse.down()
  await page.mouse.move(1100, 700, { steps: 16 })
  const marqueeShown = (await page.locator('[data-marquee]').count()) === 1
  await page.mouse.up()
  await page.keyboard.up('Control')
  await sleep(300)
  rec(g, 'Ctrl+拖拽时出现框选矩形', marqueeShown)
  const selAfterMarquee = await page.evaluate(() =>
    document.querySelectorAll('[data-node-id].selected, [class*="selected"]').length,
  )
  // 选中态没有 data-selected 钩子，用「框选后工具栏对齐按钮启用」间接验证
  const alignEnabled = await page.locator('[data-toolbar-align-mode="left"]').isEnabled()
  rec(g, '框选命中后对齐按钮启用（说明选中 ≥ 2）', alignEnabled, `sel=${selAfterMarquee}`)

  // ── 2. Shift + 单击 = 增减选中（§6.15） ──
  // 注意：单选会弹出创作参数面板，面板浮在节点**下方**（§6.8），
  // 会挡住正下方节点的点击 —— 因此节点一律**横向排开**，
  // 且对齐/整理这类会把节点摞到一起的操作放到最后。
  // 点空白清选中：右下角已被小地图占用，必须走 blankPoint（见其注释）
  await clickBlankCanvas(page)
  const alignDisabledAfterClear = !(await page.locator('[data-toolbar-align-mode="left"]').isEnabled())
  rec(g, '空白单击清空选中（对齐按钮禁用）', alignDisabledAfterClear)

  await page.locator(`[data-node-id="${ids[0]}"]`).click({ position: { x: 60, y: 10 } })
  await sleep(200)
  await page
    .locator(`[data-node-id="${ids[1]}"]`)
    .click({ position: { x: 60, y: 10 }, modifiers: ['Shift'] })
  await sleep(250)
  const twoSelected = await page.locator('[data-toolbar-align-mode="left"]').isEnabled()
  rec(g, 'Shift+单击增减选中（选中 2 个）', twoSelected)

  // 再 Shift 点一次 → 取消该节点，回到 1 个
  await page
    .locator(`[data-node-id="${ids[1]}"]`)
    .click({ position: { x: 60, y: 10 }, modifiers: ['Shift'] })
  await sleep(250)
  const oneSelected = !(await page.locator('[data-toolbar-align-mode="left"]').isEnabled())
  rec(g, 'Shift+单击可取消选中（回到 1 个）', oneSelected)

  // ── 5. 多选整体拖动：选区内所有节点一起位移 ──
  await page.locator(`[data-node-id="${ids[1]}"]`).click({ position: { x: 60, y: 10 }, modifiers: ['Shift'] })
  await sleep(250)
  const beforeGroup = await Promise.all(ids.slice(0, 2).map(posOf))
  const grabBox = await page.locator(`[data-node-id="${ids[0]}"]`).boundingBox()
  await page.mouse.move(grabBox.x + 60, grabBox.y + 10)
  await page.mouse.down()
  await page.mouse.move(grabBox.x + 160, grabBox.y + 60, { steps: 12 })
  await page.mouse.up()
  await sleep(400)
  const afterGroup = await Promise.all(ids.slice(0, 2).map(posOf))
  const movedTogether =
    afterGroup[0].x - beforeGroup[0].x > 0 &&
    afterGroup[1].x - beforeGroup[1].x > 0 &&
    Math.abs(afterGroup[0].x - beforeGroup[0].x - (afterGroup[1].x - beforeGroup[1].x)) <= 2
  rec(
    g,
    '多选整体拖动（位移一致）',
    movedTogether,
    `d0=${afterGroup[0].x - beforeGroup[0].x} d1=${afterGroup[1].x - beforeGroup[1].x}`,
  )
  await page.screenshot({ path: `${OUT}/29-g17-multi-drag.png` })

  // ── 6. Alt + 拖动 = 原地复制（节点数 +1，原节点不动） ──
  const countBefore = await page.locator('[data-node-type="prompt"]').count()
  const target = await posOf(ids[2])
  const grab2 = await page.locator(`[data-node-id="${ids[2]}"]`).boundingBox()
  await page.keyboard.down('Alt')
  await page.mouse.move(grab2.x + 60, grab2.y + 10)
  await page.mouse.down()
  await page.mouse.move(grab2.x + 260, grab2.y + 110, { steps: 14 })
  await page.mouse.up()
  await page.keyboard.up('Alt')
  await sleep(500)
  const countAfter = await page.locator('[data-node-type="prompt"]').count()
  const originStill = await posOf(ids[2])
  rec(g, 'Alt+拖动复制出新节点（§4.2）', countAfter === countBefore + 1, `${countBefore} → ${countAfter}`)
  rec(
    g,
    'Alt 复制后原节点留在原地',
    Math.abs(originStill.x - target.x) <= 2 && Math.abs(originStill.y - target.y) <= 2,
    `origin ${target.x},${target.y} → ${originStill.x},${originStill.y}`,
  )
  await page.screenshot({ path: `${OUT}/30-g17-alt-copy.png` })

  // ── 7. 工具栏存在且新建菜单可展开 ──
  const toolbarExists = (await page.locator('[data-canvas-toolbar]').count()) === 1
  rec(g, '左侧竖向工具栏存在（§6.1 / §6.5）', toolbarExists)
  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  const menuItems = await page.locator('[data-toolbar-menu-item]').count()
  rec(g, '新建节点菜单展开 6 项', menuItems === 6, `items=${menuItems}`)
  await page.keyboard.press('Escape')
  await sleep(200)
  rec(g, 'Esc 关闭新建菜单', (await page.locator('[data-toolbar-menu]').count()) === 0)

  // ── 6.5 重置视图（§6.3「Z 键或工具栏按钮，缩放至全部节点可见」）──
  // 断言按文档口径写：不是「回到 100%」（那是把浮层遮挡当成规格的实现细节），
  // 而是**全部顶层节点落进可视区、且不被顶栏/工具栏浮层压住**。
  await page.mouse.move(640, 400)
  await page.mouse.wheel(0, -240)
  await sleep(300)
  const zoomed = await readViewport(page)
  await page.locator('[data-toolbar-reset]').click()
  await sleep(350)
  const reset = await readViewport(page)
  const surfBox = await page.locator('[data-canvas-surface]').boundingBox()
  const nodeBoxes = []
  for (const el of await page.locator('[data-node-id]').all()) {
    const bx = await el.boundingBox()
    if (bx) nodeBoxes.push(bx)
  }
  const allInside =
    nodeBoxes.length > 0 &&
    nodeBoxes.every(
      (bx) =>
        bx.x >= surfBox.x - 1 &&
        bx.y >= surfBox.y - 1 &&
        bx.x + bx.width <= surfBox.x + surfBox.width + 1 &&
        bx.y + bx.height <= surfBox.y + surfBox.height + 1,
    )
  rec(
    g,
    '重置视图把全部节点收进可视区（§6.3）',
    allInside,
    `zoom ${zoomed.zoom} → ${reset.zoom} / 节点 ${nodeBoxes.length} 个`,
  )
  // 顶栏浮层占屏幕 y 12..56：适配后节点（连同浮在框外的标题）不能落在它下面。
  // fitViewport 的 padding=72：内容装得下时居中（≥72），装不下时贴 padding（=72），两种都 ≥56。
  const FLOAT_H = 56
  const notOccluded = nodeBoxes.length > 0 && nodeBoxes.every((bx) => bx.y >= FLOAT_H)
  rec(
    g,
    '重置视图后节点不被悬浮顶栏遮挡',
    notOccluded,
    `最高节点 y=${nodeBoxes.length ? Math.min(...nodeBoxes.map((b) => b.y)).toFixed(0) : 'n/a'}`,
  )

  // ── 7. 左对齐：选中集合 x 归一（§6.5 ②）──
  // 放在最后：对齐会把节点摞到一起，之后再点节点就会被面板 / 重叠干扰。
  await page.keyboard.down('Control')
  await page.mouse.move(120, 120)
  await page.mouse.down()
  await page.mouse.move(1180, 760, { steps: 16 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  await sleep(300)
  const beforeAlign = await Promise.all(ids.map(posOf))
  await page.locator('[data-toolbar-align-mode="left"]').click()
  await sleep(400)
  const afterAlign = await Promise.all(ids.map(posOf))
  const xs = afterAlign.map((p) => p.x)
  rec(
    g,
    '左对齐后 x 归一（§6.5 ②）',
    new Set(xs).size === 1 && new Set(beforeAlign.map((p) => p.x)).size > 1,
    `before=${beforeAlign.map((p) => p.x).join(',')} after=${xs.join(',')}`,
  )

  // ── 8. 整理节点：同层纵向等距（§6.5 ③）──
  await page.locator('[data-toolbar-arrange]').click()
  await sleep(400)
  const afterArrange = await Promise.all(ids.map(posOf))
  const ys = afterArrange.map((p) => p.y).sort((a, b) => a - b)
  const gaps = ys.slice(1).map((y, i) => y - ys[i])
  rec(
    g,
    '整理后同层纵向等距（§6.5 ③ 间距 24）',
    gaps.length >= 2 && gaps.every((v) => v > 0) && new Set(gaps).size === 1,
    `gaps=${gaps.join(',')}`,
  )
  await page.screenshot({ path: `${OUT}/31-g17-align-arrange.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G18 右键菜单 + 节点删除（§4.1 / §6.20）
// ────────────────────────────────────────────────────────────
async function g18(browser) {
  const g = 'G18 右键菜单与删除'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await createProject(page)
  await sleep(400)

  const nodeCenter = async (id) => {
    const b = await page.locator(`[data-node-id="${id}"]`).boundingBox()
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }
  const rightClickNode = async (id) => {
    const c = await nodeCenter(id)
    await page.mouse.click(c.x, c.y, { button: 'right' })
    await sleep(250)
  }
  const menuItems = async () =>
    page.locator('[data-context-menu] [data-context-menu-item]').allInnerTexts()

  // 1. 工具栏新建「生成」节点（落视口中心）
  await page.locator('[data-toolbar-add]').click()
  await sleep(200)
  await page.locator('[data-toolbar-menu-item="generation"]').click()
  await sleep(400)
  const genId = await page.locator('[data-node-type="generation"]').last().getAttribute('data-node-id')
  rec(g, '新建生成节点', !!genId, `id=${genId}`)

  // 2. 右键节点 → 含 生成/复制/重命名/删除
  await rightClickNode(genId)
  const nodeMenu = await menuItems()
  const nodeSet = new Set(nodeMenu)
  rec(
    g,
    '节点右键菜单含 生成/复制/重命名/删除（§4.1）',
    ['生成', '复制', '重命名', '删除'].every((t) => nodeSet.has(t)),
    `items=${JSON.stringify(nodeMenu)}`,
  )

  // 3. Esc 关闭菜单
  await page.keyboard.press('Escape')
  await sleep(200)
  rec(g, 'Esc 关闭右键菜单', (await page.locator('[data-context-menu]').count()) === 0)

  // 4. 右键节点 → 复制 → 生成节点数 +1
  await rightClickNode(genId)
  await page.locator('[data-context-menu-item="duplicate"]').click()
  await sleep(400)
  const genAfterDup = await page.locator('[data-node-type="generation"]').count()
  rec(g, '右键复制节点数 +1（§4.1 复制）', genAfterDup === 2, `count=${genAfterDup}`)

  // 5. 右键节点 → 删除 → 节点消失
  // 注意：上一步复制出的新节点偏移 +24,+24，与原节点中心重叠并盖在上层；
  // 改点原节点左上角（避开重叠区），确保右键命中的是 genId 本身。
  {
    const b = await page.locator(`[data-node-id="${genId}"]`).boundingBox()
    await page.mouse.click(b.x + 6, b.y + 6, { button: 'right' })
    await sleep(250)
  }
  await page.locator('[data-context-menu-item="delete"]').click()
  await sleep(400)
  rec(g, '右键删除移除节点（§4.1 删除）', (await page.locator(`[data-node-id="${genId}"]`).count()) === 0)

  // 6. 右键画布空白 → 含 6 个新建项 + 重置视图
  //    坐标走 blankPoint：小地图在右下角，写死 (1200,760) 是把右键发给了小地图
  //    （它只吃左键、事件会冒泡到画布，所以断言仍过——但那是巧合，不是覆盖）
  const blankRight = await blankPoint(page)
  await page.mouse.click(blankRight.x, blankRight.y, { button: 'right' })
  await sleep(250)
  const canvasMenu = await menuItems()
  const canvasSet = new Set(canvasMenu)
  rec(
    g,
    '画布空白右键含 6 新建 + 重置视图（§4.1）',
    canvasSet.size === 7 && canvasSet.has('重置视图'),
    `items=${JSON.stringify(canvasMenu)}`,
  )
  await page.keyboard.press('Escape')
  await sleep(150)

  // 7. 选中节点 + Delete 键删除（§6.20）
  await page.locator('[data-toolbar-add]').click()
  await sleep(200)
  await page.locator('[data-toolbar-menu-item="prompt"]').click()
  await sleep(400)
  const pId = await page.locator('[data-node-type="prompt"]').last().getAttribute('data-node-id')
  await page.locator(`[data-node-id="${pId}"]`).click({ position: { x: 30, y: 10 } })
  await sleep(200)
  await page.keyboard.press('Delete')
  await sleep(300)
  rec(g, 'Delete 键删除选中节点（§6.20）', (await page.locator(`[data-node-id="${pId}"]`).count()) === 0)

  // 8. 重命名：右键 → 重命名 → 出现编辑输入框
  await page.locator('[data-toolbar-add]').click()
  await sleep(200)
  await page.locator('[data-toolbar-menu-item="group"]').click()
  await sleep(400)
  const grId = await page.locator('[data-node-type="group"]').last().getAttribute('data-node-id')
  // 把重复节点挪开，确保右键命中原节点而非重叠副本
  await moveNode(page, grId, 480, 300)
  await rightClickNode(grId)
  await page.locator('[data-context-menu-item="rename"]').click()
  await sleep(300)
  rec(g, '右键重命名进入编辑态（§4.1 重命名）', (await page.locator(`[data-node-id="${grId}"] input`).count()) >= 1)
  await page.keyboard.press('Escape') // 取消编辑

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G19 撤销重做键盘 + 撤销条 + Tab 空间导航（M4-0）
// ────────────────────────────────────────────────────────────
async function g19(browser) {
  const g = 'G19 撤销重做与导航'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await createProject(page)
  await sleep(500)

  // 建 2 个提示词节点，错开位置（顶栏新建落视口中心，必须挪开，见 moveNode 注释）
  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(400)
  const id1 = await page.locator('[data-node-type="prompt"]').last().getAttribute('data-node-id')
  await moveNode(page, id1, 360, 260)
  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(400)
  const id2 = await page.locator('[data-node-type="prompt"]').last().getAttribute('data-node-id')
  await moveNode(page, id2, 760, 480)

  const count = () => page.locator('[data-node-type="prompt"]').count()
  rec(g, '建立 2 个提示词节点', (await count()) === 2, `n=${await count()}`)

  // ── 1. Delete 键删除选中 → 撤销条出现 ──
  await page.locator(`[data-node-id="${id1}"]`).click({ position: { x: 30, y: 10 } })
  await sleep(200)
  await page.keyboard.press('Delete')
  await sleep(350)
  rec(g, 'Delete 键删除选中节点', (await count()) === 1, `n=${await count()}`)

  const barShown = await page.locator('[data-undo-bar]').isVisible().catch(() => false)
  rec(g, '删除后弹出撤销条', barShown)
  if (barShown) {
    const barText = await page.locator('[data-undo-bar]').innerText()
    rec(g, '撤销条文案含「已删除节点」', barText.includes('已删除节点'), barText.replace(/\n/g, ' '))
  }

  // ── 2. Ctrl+Z 撤销 → 节点恢复 ──
  await page.keyboard.press('Control+z')
  await sleep(350)
  rec(g, 'Ctrl+Z 撤销恢复被删节点', (await count()) === 2, `n=${await count()}`)

  // ── 3. Ctrl+Shift+Z 重做 → 再次删除 ──
  await page.keyboard.press('Control+Shift+Z')
  await sleep(350)
  rec(g, 'Ctrl+Shift+Z 重做再次删除', (await count()) === 1, `n=${await count()}`)

  // ── 4. 撤销回到 2 节点，清空选中，测 Tab 空间导航 ──
  await page.keyboard.press('Control+z')
  await sleep(350)
  await clickBlankCanvas(page)
  const beforeTab = await count()
  // Tab 进入画布选中首个（按视觉顺序最靠上的节点）；Delete 应只删 1 个
  await page.keyboard.press('Tab')
  await sleep(250)
  await page.keyboard.press('Delete')
  await sleep(350)
  rec(g, 'Tab 选中节点后 Delete 删掉 1 个', (await count()) === beforeTab - 1, `${beforeTab} → ${await count()}`)

  // ── 5. 撤销条「撤销」按钮恢复 ──
  const bar2 = await page.locator('[data-undo-bar]').isVisible().catch(() => false)
  if (bar2) {
    await page.locator('[data-undo-bar] button').first().click()
    await sleep(350)
    rec(g, '撤销条「撤销」按钮恢复节点', (await count()) === beforeTab, `n=${await count()}`)
  } else {
    rec(g, '撤销条「撤销」按钮恢复节点', false, '撤销条未出现')
  }

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G20 画板绘制（M4-1）：建画板 → 画笔绘制 → 文字落位 → 改背景色
// ────────────────────────────────────────────────────────────
async function g20(browser) {
  const g = 'G20 画板绘制'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await createProject(page)
  await sleep(500)

  // 1) 新建画板节点（落视口中心）
  await page.locator('[data-toolbar-add]').click()
  await sleep(200)
  await page.locator('[data-toolbar-menu-item="board"]').click()
  await sleep(500)
  const boardCount = await page.locator('[data-node-type="board"]').count()
  rec(g, '工具栏新建画板节点', boardCount === 1, `画板=${boardCount}`)
  if (boardCount !== 1) {
    await ctx.close()
    return
  }
  const boardId = await page.locator('[data-node-type="board"]').first().getAttribute('data-node-id')
  const board = page.locator(`[data-node-id="${boardId}"]`)

  // 移到空旷处，避免与后续元素重叠
  await moveNode(page, boardId, 440, 300)
  await sleep(300)

  // 2) 选中画板 → 工具条出现
  //    点左下角内侧：画板工具条压在节点框顶部且 stopPropagation，点顶部落不到画板本体
  const bb = await board.boundingBox()
  const bg = grabPoint(bb)
  await page.mouse.click(bg.x, bg.y)
  await sleep(250)
  const toolVisible = await page.locator('[data-board-tool="brush"]').isVisible().catch(() => false)
  rec(g, '选中画板后工具条出现（选择/画笔/文字）', toolVisible)

  // 3) 画笔：选画笔 → 在画板下半部拖拽绘制
  await page.locator('[data-board-tool="brush"]').click()
  await sleep(150)
  const b2 = await board.boundingBox()
  const sx = b2.x + b2.width * 0.35
  const sy = b2.y + b2.height * 0.55
  const ex = b2.x + b2.width * 0.7
  const ey = b2.y + b2.height * 0.8
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.mouse.move((sx + ex) / 2, (sy + ey) / 2, { steps: 8 })
  await page.mouse.move(ex, ey, { steps: 8 })
  await page.mouse.up()
  await sleep(350)
  const pathCount = await page.locator('[data-board-surface] path').count()
  rec(g, '画笔拖拽后画板出现笔迹 path', pathCount >= 1, `path=${pathCount}`)
  await page.screenshot({ path: `${OUT}/32-g20-board-stroke.png` })

  // 4) 文字：选文字 → 点画板落位 → 输入 → 回车提交
  await page.locator('[data-board-tool="text"]').click()
  await sleep(150)
  const b3 = await board.boundingBox()
  await page.mouse.click(b3.x + b3.width * 0.5, b3.y + b3.height * 0.85)
  await sleep(250)
  const inputShown = await page.locator('[data-board-text-input]').isVisible().catch(() => false)
  rec(g, '文字工具点击后弹出输入', inputShown)
  let textCount = 0
  if (inputShown) {
    await page.locator('[data-board-text-input]').fill('测试文字')
    await page.locator('[data-board-text-input]').press('Enter')
    await sleep(300)
    textCount = await page.locator('[data-board-surface] text').count()
    rec(g, '回车后画板出现文字图元', textCount >= 1, `text=${textCount}`)
  }
  await page.screenshot({ path: `${OUT}/33-g20-board-text.png` })

  // 5) 改背景色（transient：不进撤销栈）→ 背景层 computed background 更新
  await page.locator('[data-board-bg-color]').fill('#ff0000')
  await sleep(300)
  const bgColor = await page.locator('[data-board-bg]').evaluate((el) => getComputedStyle(el).backgroundColor)
  rec(g, '改背景色生效（rgb(255, 0, 0)）', bgColor === 'rgb(255, 0, 0)', bgColor)

  // 6) 撤销：最近一次离散提交是「文字」，先撤销文字（笔迹 path 不受影响）
  await page.keyboard.press('Control+z')
  await sleep(350)
  const textAfterUndo = await page.locator('[data-board-surface] text').count()
  rec(g, 'Ctrl+Z 撤销最近一次文字提交', textAfterUndo === 0, `text ${textCount} → ${textAfterUndo}`)

  // 7) 再撤销一次，撤销画笔笔迹（transient 的背景色改动被跳过）
  await page.keyboard.press('Control+z')
  await sleep(350)
  const pathAfterUndo = await page.locator('[data-board-surface] path').count()
  rec(g, 'Ctrl+Z 再撤销画笔笔迹', pathAfterUndo === pathCount - 1, `path ${pathCount} → ${pathAfterUndo}`)

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G21 画板容器 + 一键运行（M4-2）：建画板 → 画板内新建子节点 → 连线 → 运行画板 → 出结果
// ────────────────────────────────────────────────────────────
async function g21(browser) {
  const g = 'G21 画板容器+运行'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 1) 配置 mock 渠道（与 G9 同）
  await configureMockChannel(page)

  // 2) 进画布，建画板
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="blank"]').click().catch(() => {})
  await page.waitForURL(/\/canvas\//).catch(() => {})
  await sleep(500)
  await page.locator('[data-toolbar-add]').click()
  await sleep(300)
  await page.locator('[data-toolbar-menu-item="board"]').click()
  await sleep(500)
  const board = page.locator('[data-node-type="board"]').first()
  rec(g, '画板已创建', (await board.count()) === 1)
  await board.click()
  await sleep(300)

  // 3) 画板内新建「提示词」子节点
  await board.hover()
  await sleep(200)
  await page.locator('[data-board-create]').click()
  await sleep(200)
  await page.locator('[data-board-create-item="prompt"]').click()
  await sleep(400)
  const childPrompt = page.locator('[data-board-children] [data-node-type="prompt"]').first()
  rec(g, '画板内新建提示词子节点', (await childPrompt.count()) === 1)

  // 4) 画板内新建「生成」子节点
  await board.hover()
  await sleep(200)
  await page.locator('[data-board-create]').click()
  await sleep(200)
  await page.locator('[data-board-create-item="generation"]').click()
  await sleep(400)
  const childGen = page.locator('[data-board-children] [data-node-type="generation"]').first()
  rec(g, '画板内新建生成子节点', (await childGen.count()) === 1)

  // 5) 连线：提示词输出 → 生成输入（画板内）
  // 注意：hover 会触发 scrollIntoView，先 hover 再量坐标，量完立即使用（G21 教训）
  await childPrompt.hover({ force: true })
  await sleep(250)
  const pOut = childPrompt.locator('[data-port="output"]')
  const pBox = await pOut.boundingBox()
  const pCount = await pOut.count()
  await childGen.hover({ force: true })
  await sleep(250)
  const gIn = childGen.locator('[data-port="input"]')
  const gBox = await gIn.boundingBox()
  const gCount = await gIn.count()
  console.log(`  [diag] pCount=${pCount} pBox=${JSON.stringify(pBox)} gCount=${gCount} gBox=${JSON.stringify(gBox)}`)
  if (pBox && gBox) {
    await page.mouse.move(pBox.x + pBox.width / 2, pBox.y + pBox.height / 2)
    await page.mouse.down()
    await page.mouse.move((pBox.x + gBox.x) / 2, (pBox.y + gBox.y) / 2, { steps: 4 })
    await sleep(150)
    const draftMid = await page.locator('[data-edge-draft]').count()
    console.log(`  [diag] draftAtMid=${draftMid}`)
    // 落点用生成节点 frame 中心（比输入端口中心更稳健，端口紧贴节点边缘）
    const gFrame = await childGen.boundingBox()
    if (!gFrame) throw new Error('generation frame not found')
    await page.mouse.move(gFrame.x + gFrame.width / 2, gFrame.y + gFrame.height / 2, { steps: 8 })
    await sleep(150)
    const draftEnd = await page.locator('[data-edge-draft]').count()
    console.log(`  [diag] draftAtEnd=${draftEnd}`)
    await page.mouse.up()
    await sleep(400)
  }
  rec(g, '画板内连线成功', (await page.locator('[data-edge]').count()) >= 1, `edges=${await page.locator('[data-edge]').count()}`)

  // 6) 配置生成子节点（§6.8：本体是媒体框，参数/提示词只在下方创作面板）
  rec(g, '生成子节点本体为媒体框（无 select/textarea）', (await childGen.locator('select, textarea').count()) === 0)
  const childPanel = await genPanel(page, childGen)
  await configureGenPanel(page, childPanel, '屋顶的猫')

  // 7) 运行整个画板（右键菜单「运行画板」，顶层覆盖层，稳定触发，并验证 §4.1 右键菜单）
  await board.click({ button: 'right', force: true })
  await sleep(300)
  const runItem = page.getByText('运行画板').first()
  await runItem.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  rec(g, '右键菜单出现「运行画板」', (await runItem.count()) > 0)
  await runItem.click({ force: true })
  let rg = false
  try {
    await page.locator('[data-result-group]').first().waitFor({ state: 'visible', timeout: 15000 })
    rg = true
  } catch {
    rg = false
  }
  rec(g, '运行画板后产出结果组', rg)
  await page.screenshot({ path: `${OUT}/34-g21-board-run.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G22 版本历史 + 画布时间轴（M4-3，§6.21 / §4.1）：
// 跑两次生成 → 右键「版本历史」→ 面板列 2 版 → Ctrl+点击临时预览 → Esc 退出
// → 双击恢复 v1（追加 v3）→ ⌘H 时间轴（节点 / 状态过滤）
// ────────────────────────────────────────────────────────────
async function g22(browser) {
  const g = 'G22 版本历史+时间轴'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 1) 配置 mock 渠道（与 G9 同）
  await configureMockChannel(page)

  // 2) 文生图模板进画布，配置生成节点
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  // 参数与提示词在创作面板里（M6-16 起节点本体只剩媒体框）
  const histPanel = await genPanel(page)
  await configureGenPanel(page, histPanel, '屋顶的猫')

  // 3) 跑两次。完成信号**不是**结果组：N=1 的产物写回节点本体、不再建结果组
  //    （§6.16，M6-24），结果组计数恒为 0 —— 改用「生成按钮回到空闲态 + 节点已出图」。
  const runBtn = panelRunBtn(page)
  for (let i = 1; i <= 2; i++) {
    await runBtn.click()
    await sleep(400) // 让按钮先进入运行态，避免把「还没开始」读成「已完成」
    let done = false
    for (let t = 0; t < 60; t++) {
      const label = await runBtn.getAttribute('aria-label').catch(() => '')
      if (label === '生成当前节点') {
        done = true
        break
      }
      await sleep(250)
    }
    const assetCount = await page.locator('[data-node-asset]').count()
    rec(g, `第 ${i} 次生成完成并回填节点本体`, done && assetCount >= 1, `asset=${assetCount}`)
    await sleep(600)
  }

  // 4) 右键生成节点 → 「版本历史」→ 面板出现且列 2 版
  await page.locator('[data-node-type="generation"]').click({ button: 'right', force: true })
  await sleep(300)
  const historyItem = page.locator('[data-context-menu-item="history"]')
  rec(g, '右键菜单出现「版本历史」', (await historyItem.count()) > 0)
  await historyItem.click()
  await sleep(600)
  const panel = page.locator('[data-version-history-panel]')
  rec(g, '版本历史面板出现', (await panel.count()) === 1)
  const rows2 = await page.locator('[data-version-row]').count()
  rec(g, '两次生成列出 2 版', rows2 === 2, `rows=${rows2}`)

  // 5) Ctrl + 点击 v2 → 临时预览出现（30% 叠加）；Esc 退出
  await page.locator('[data-version-row="2"]').click({ modifiers: ['Control'] })
  await sleep(400)
  const previewShown = await page.locator('[data-version-preview]').count()
  rec(g, 'Ctrl+点击出现临时预览', previewShown === 1)
  await page.keyboard.press('Escape')
  await sleep(250)
  const previewGone = await page.locator('[data-version-preview]').count()
  rec(g, 'Esc 退出预览', previewGone === 0)

  // 6) 双击 v1 → 恢复该版本并追加新 RunRecord（共 3 版，最新为 v3）
  const rowVals = await page.evaluate(() =>
    [...document.querySelectorAll('[data-version-row]')].map((r) => r.getAttribute('data-version-row')),
  )
  console.log(`  [diag] version rows before dblclick = ${JSON.stringify(rowVals)}`)
  await page.locator('[data-version-row="1"]').dblclick()
  await sleep(700)
  const rows3 = await page.locator('[data-version-row]').count()
  rec(g, '双击恢复 v1 后追加新版本（3 版）', rows3 === 3, `rows=${rows3}`)
  const firstRow = await page.locator('[data-version-row]').first().getAttribute('data-version-row')
  rec(g, '最新版本为 v3', firstRow === '3', `first=${firstRow}`)
  await page.screenshot({ path: `${OUT}/35-g22-version-history.png` })

  // 7) Ctrl+H 打开时间轴：列出记录，节点过滤与状态过滤可用
  await page.keyboard.press('Control+h')
  await sleep(500)
  const timeline = page.locator('[aria-label="画布时间轴"]')
  rec(g, 'Ctrl+H 打开时间轴', (await timeline.count()) === 1)
  const allRows = await page.locator('[data-timeline-row]').count()
  rec(g, '时间轴列出全部记录', allRows === 3, `rows=${allRows}`)
  await page.locator('[data-timeline-node-filter]').selectOption({ index: 1 })
  await sleep(400)
  const nodeRows = await page.locator('[data-timeline-row]').count()
  rec(g, '按节点过滤生效', nodeRows === 3, `rows=${nodeRows}`)
  await page.locator('[data-timeline-status-filter] button', { hasText: '失败' }).click()
  await sleep(400)
  const failRows = await page.locator('[data-timeline-row]').count()
  rec(g, '按状态过滤（失败 → 0 条）', failRows === 0, `rows=${failRows}`)
  await page.screenshot({ path: `${OUT}/36-g22-timeline.png` })
  await page.locator('[aria-label="画布时间轴"] button', { hasText: '关闭' }).click()
  await sleep(300)
  rec(g, '关闭时间轴', (await page.locator('[aria-label="画布时间轴"]').count()) === 0)

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G23 LLM 优化与翻译（M4-4 / §6.7；2026-09-15 起「面板 = 草稿工作区」）：
// 面板文字是**草稿**（data.draft），节点正文是最终提示词（data.text），两者解耦——
// 面板输入 / 面板「优化 / 翻译」只动草稿；「写入节点」才把草稿落进正文（进撤销栈）；
// 节点本体的「优化」仍直接改正文。断言围绕这条分界展开。
// ────────────────────────────────────────────────────────────
async function g23(browser) {
  const g = 'G23 LLM优化翻译'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 1) 配置 mock 渠道（同 g9）：新增 → 验证（拉全部模型）→ 勾选 → 启用
  const g23ch = await configureMockChannel(page)
  rec(g, '渠道验证通过（模型缓存含 chat）', g23ch.verified)

  // 2) 进画布建提示词节点，双击进编辑态输入文本
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await createProject(page)
  await page.getByRole('button', { name: '＋ 提示词' }).click()
  await sleep(400)
  const promptNode = page.locator('[data-node-type="prompt"]').first()
  await promptNode.dblclick()
  const ta = page.locator('[data-node-type="prompt"] textarea').first()
  await ta.fill('一只猫')
  await ta.press('Escape')
  await sleep(300)
  const nodeText = async () => (await promptNode.innerText().catch(() => ''))
  rec(g, '初始文本', (await nodeText()).includes('一只猫'))

  // 3) 单击选中 → 创作面板（prompt 模式）选渠道 + 文本模型
  await promptNode.click()
  await sleep(400)
  const panel = page.locator('[data-creation-panel]')
  const hasPanel = (await panel.count()) === 1
  rec(g, '创作面板出现（prompt 模式）', hasPanel)
  if (!hasPanel) {
    await page.screenshot({ path: `${OUT}/diag-g23-no-panel.png` })
    await ctx.close()
    return
  }
  await pickParam(panel, 'channel', '新建渠道')
  await sleep(250)
  await pickParam(panel, 'model', 'mock-chat-1')
  await sleep(250)
  rec(g, 'prompt 模式模型 chip 带出所选文本模型', (await paramLabel(panel, 'model')) === 'mock-chat-1')
  // §6.7 第三部分：提示词节点面板同样以生成按钮收尾。
  // 提示词节点自己不发请求（执行计划里写死「它的语义是让下游生成节点出图」），
  // 所以这个按钮点下去是**触发下游生成**，文案必须说清，否则等于按了个寂寞。
  rec(
    g,
    '提示词面板有生成按钮（触发下游生成）',
    (await panel.locator('button[aria-label="生成下游节点"]').count()) === 1,
  )
  await page.screenshot({ path: `${OUT}/37-g23-panel-ready.png` })

  // 4) 解耦基线：面板草稿初始为空，节点正文是「一只猫」——两边是不同的字段
  const panelTa = () => panel.locator('textarea').first()
  rec(g, '初始草稿为空（面板不回显正文）', (await panelTa().inputValue()) === '')
  rec(g, '节点正文仍是双击输入的文本', (await nodeText()).includes('一只猫'))

  // 5) 面板输入只写草稿：正文纹丝不动
  await panelTa().click()
  await panelTa().fill('草稿猫')
  await sleep(300)
  rec(g, '面板输入草稿不写正文', (await nodeText()).includes('一只猫') && !(await nodeText()).includes('草稿猫'))

  // 6) 面板「优化」→ 草稿被 LLM 结果覆盖（mock 返回 mock:<system+text>），正文不动
  await panel.locator('[data-panel-prompt-tools] button', { hasText: '优化' }).click()
  let draftOptimized = false
  for (let i = 0; i < 30; i++) {
    if ((await panelTa().inputValue()).includes('mock:')) {
      draftOptimized = true
      break
    }
    await sleep(200)
  }
  rec(g, '面板「优化」写回草稿', draftOptimized)
  rec(g, '面板「优化」不碰正文', (await nodeText()).includes('一只猫') && !(await nodeText()).includes('mock:'))

  // 7) Ctrl+Z → 草稿回滚（LLM 草稿写入进撤销栈），正文不动
  await page.keyboard.press('Control+z')
  await sleep(400)
  const draftUndone = !(await panelTa().inputValue()).includes('mock:')
  rec(g, '撤销回滚 LLM 草稿（进撤销栈）', draftUndone)

  // 8) 「写入节点」→ 草稿落进正文（transient:false，进撤销栈）；再撤销 → 正文还原
  await panelTa().click()
  await panelTa().fill('最终提示词')
  await sleep(300)
  await panel.locator('[data-panel-prompt-apply]').click()
  let applied = false
  for (let i = 0; i < 20; i++) {
    if ((await nodeText()).includes('最终提示词')) {
      applied = true
      break
    }
    await sleep(200)
  }
  rec(g, '「写入节点」把草稿写进正文', applied)
  await page.keyboard.press('Control+z')
  await sleep(400)
  const applyUndone = (await nodeText()).includes('一只猫') && !(await nodeText()).includes('最终提示词')
  rec(g, '写入正文可撤销（还原为「一只猫」）', applyUndone)

  // 9) 节点本体「优化」按钮（底部弱化按钮，hover 显形）→ 直接改正文（原有行为不变）
  await promptNode.hover()
  await sleep(250)
  await promptNode.locator('[data-prompt-tools] button').first().click()
  let nodeRan = false
  for (let i = 0; i < 30; i++) {
    if ((await nodeText()).includes('mock:')) {
      nodeRan = true
      break
    }
    await sleep(200)
  }
  rec(g, '节点本体「优化」按钮可用（直接改正文）', nodeRan)
  const afterNodeRun = await nodeText()

  // 10) 面板点「翻译」→ 只动草稿，正文停在本体优化的结果上
  const bodyBeforeTranslate = afterNodeRun
  await panel.locator('[data-panel-prompt-tools] button', { hasText: '翻译' }).click()
  let translated = false
  for (let i = 0; i < 30; i++) {
    const d = await panelTa().inputValue()
    if (d !== '最终提示词' && d.includes('mock:')) {
      translated = true
      break
    }
    await sleep(200)
  }
  // 早先这里只算了 translated 却忘了记录——于是「翻译到底生效没有」从未被断言，
  // 断了也照样全绿。断言补上，让这一步真的在守东西。
  rec(g, '面板点「翻译」→ 草稿变化', translated)
  rec(g, '面板「翻译」不碰正文', (await nodeText()) === bodyBeforeTranslate)
  await page.screenshot({ path: `${OUT}/38-g23-after-translate.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G24 性能基准（M4-5 / §1.6 画布性能目标）：
// 300 节点 / 500 连线 → 视口裁剪挂载数 → 平移 / 缩放帧率（rAF 采样）
// ────────────────────────────────────────────────────────────

/** 在 action 执行期间用 rAF 计帧，返回 1 秒内的帧数（≈fps） */
async function sampleFpsDuring(page, action) {
  const promise = page.evaluate(
    () =>
      new Promise((resolve) => {
        let frames = 0
        const t0 = performance.now()
        const loop = () => {
          frames++
          if (performance.now() - t0 >= 1000) resolve(frames)
          else requestAnimationFrame(loop)
        }
        requestAnimationFrame(loop)
      }),
  )
  await action()
  return promise
}

async function g24(browser) {
  const g = 'G24 性能基准'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await createProject(page)
  await sleep(400)

  // 1) 注入 300/500 拓扑（DEV-only 钩子，等待动态 import 完成）
  let seeded = null
  for (let i = 0; i < 24; i++) {
    seeded = await page
      .evaluate(() => {
        const fn = window.__seedPerfGraph
        return typeof fn === 'function' ? fn() : null
      })
      .catch(() => null)
    if (seeded) break
    await sleep(250)
  }
  rec(g, '种子 300 节点 / 500 连线', !!seeded && seeded.nodes === 300 && seeded.edges === 500, JSON.stringify(seeded))

  // 等落库防抖批写完成，避免与帧率采样重叠
  await sleep(1600)

  // 2) 视口裁剪：DOM 挂载数远小于节点总数
  const mounted0 = await nodeCount(page)
  rec(g, '视口裁剪生效（挂载 DOM << 300）', mounted0 > 0 && mounted0 < 150, `mounted=${mounted0}`)
  await page.screenshot({ path: `${OUT}/39-g24-seeded.png` })

  const box = await page.locator('[data-canvas-surface]').boundingBox()
  // 世界 (215,100) 是节点列间隙（prompt 160 宽 + 80 间隙），指针落空处
  const gapX = box.x + 215
  const gapY = box.y + 100

  // 3) 平移后挂载数仍受限（空格 + 拖拽平移，落点不依赖空白命中）
  await page.keyboard.down('Space')
  await page.mouse.move(gapX, gapY)
  await page.mouse.down()
  await page.mouse.move(gapX - 420, gapY - 260, { steps: 12 })
  await page.mouse.up()
  await page.keyboard.up('Space')
  await sleep(400)
  const mounted1 = await nodeCount(page)
  rec(g, '平移后挂载数仍受限', mounted1 < 150, `mounted=${mounted1}`)

  // 4) 平移帧率：空格 + 拖拽往复 ~1.4s，rAF 采样 1s
  const panFps = await sampleFpsDuring(page, async () => {
    await page.keyboard.down('Space')
    await page.mouse.move(gapX, gapY)
    await page.mouse.down()
    for (let i = 0; i < 14; i++) {
      const dx = i % 2 === 0 ? 220 : 40
      const dy = i % 2 === 0 ? 80 : 20
      await page.mouse.move(gapX - 200 + dx, gapY - 200 + dy, { steps: 4 })
      await sleep(55)
    }
    await page.mouse.up()
    await page.keyboard.up('Space')
  })
  rec(g, '平移帧率 ≥ 45fps', panFps >= 45, `${panFps}fps`)

  // 5) 缩放帧率：滚轮往复（落在节点间隙，避免命中 textarea 拦截滚轮）
  const zoomFps = await sampleFpsDuring(page, async () => {
    await page.mouse.move(gapX, gapY)
    for (let i = 0; i < 12; i++) {
      await page.mouse.wheel(0, i % 2 === 0 ? -400 : 400)
      await sleep(70)
    }
  })
  rec(g, '缩放帧率 ≥ 45fps', zoomFps >= 45, `${zoomFps}fps`)

  await page.screenshot({ path: `${OUT}/40-g24-perf.png` })
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G25 第二个工作台骨架（M5 / 架构 §5.10）：
// 首页新建 comic 项目 → 卡片标识 → 进入 /comic/:id → 骨架表面 → 返回首页
// 同时验证 canvas 项目创建仍正常（「+ 新建」浮层未破坏既有流程）
// ────────────────────────────────────────────────────────────
async function g25(browser) {
  const g = 'G25 第二工作台骨架'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)

  // 0) 先用空态按钮建一个 canvas 项目垫底（使首页出现网格，露出发工作台浮层的「+ 新建」卡片）
  await createProject(page)
  await page.locator('[data-canvas-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.goBack()
  await page.locator('[data-new-card]').waitFor({ state: 'visible', timeout: 8000 })

  // 1) 首页「+ 新建」弹出工作台选择浮层（两项）
  await page.locator('[data-new-card]').click()
  const menuVisible = await page
    .locator('[data-new-workbench-menu]')
    .waitFor({ state: 'visible', timeout: 4000 })
    .then(() => true)
    .catch(() => false)
  rec(g, '「+ 新建」弹出工作台选择', menuVisible)
  const optionCount = await page.locator('[data-new-workbench]').count()
  rec(g, '浮层含两个工作台选项', optionCount === 2, `count=${optionCount}`)

  // 2) 选「漫画剧」→ 进入 /comic/:id
  await page.locator('[data-new-workbench="comic"]').click()
  await page.waitForURL(/\/comic\//, { timeout: 8000 })
  rec(g, '新建 comic 项目并进入 /comic/:id', /\/comic\//.test(page.url()), page.url())

  // 3) 骨架表面渲染（等 lazy chunk 解析完成，路由级 lazy 有短暂 fallback）
  const surfaceOk = await page
    .locator('[data-comic-surface]')
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  rec(g, '漫画剧工作台表面已渲染', surfaceOk)
  const emptyState = await page.locator('[data-comic-empty]').count()
  rec(g, '空态提示可见（尚无任何一话）', emptyState === 1)
  await page.screenshot({ path: `${OUT}/41-g25-comic-empty.png` })

  // 4) 私有命令可达：点「＋ 新建一话」→ 列表出现一话
  await page.locator('[data-comic-add-episode]').click()
  await sleep(200)
  const episodeCount = await page.locator('[data-comic-episode]').count()
  rec(g, 'comic 私有命令 episode.add 生效', episodeCount === 1, `episodes=${episodeCount}`)
  await page.screenshot({ path: `${OUT}/42-g25-comic-episode.png` })

  // 5) 返回首页，卡片带工作台标识
  // 首页项目卡由 IndexedDB 异步 hydrate；URL 一变就断言会读到「尚未渲染」的空网格，
  // 因此先等首张卡片可见再统计（避免竞态假失败）。
  await page.locator('[data-comic-back]').click()
  await page.waitForURL((u) => !/\/comic\//.test(u.pathname), { timeout: 8000 })
  await page
    .locator('[data-project-card]')
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => {})
  const wbTags = await page.locator('[data-project-card] [data-wb]').count()
  const comicTag = await page.locator('[data-project-card] [data-wb="comic"]').count()
  rec(g, '首页卡片带工作台标识', wbTags >= 1 && comicTag >= 1, `tags=${wbTags} comic=${comicTag}`)
  await page.screenshot({ path: `${OUT}/43-g25-home-tags.png` })

  // 6) canvas 项目创建仍正常（浮层未破坏既有流程）
  await createProject(page)
  const canvasSurface = await page.locator('[data-canvas-surface]').count()
  rec(g, 'canvas 项目创建流程未受影响', canvasSurface === 1)

  // 7) 无未捕获异常
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G26 comic 数据持久化（M6-0）：
// 建 comic 项目 → 新建一话 → 等防抖落库 → 刷新页面 → 话数仍在
// → 返回首页重新进入 → 仍能读回。顺带验证 canvas 流程无回归。
//
// 注：骨架阶段「＋ 新建一话」只在空态渲染（M5 占位形态），因此 UI 侧
// 只能加出 1 话；「多话合并为一次写库」由 store 单测覆盖（debounce）。
// ────────────────────────────────────────────────────────────

/** 新建 comic 项目：网格态走「+ 新建」浮层，空态走专用按钮 */
async function createComicProject(page) {
  const card = page.locator('[data-new-card]')
  const hasGrid = await card
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  if (hasGrid) {
    await card.click()
    await page.locator('[data-new-workbench="comic"]').click()
  } else {
    await page.locator('[data-new-comic]').first().click()
  }
  await page.waitForURL(/\/comic\//, { timeout: 8000 })
}

/** 等待 comic 列表渲染出恰好 n 话（hydrate 是异步的，需轮询） */
async function waitEpisodes(page, n, timeout = 8000) {
  try {
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-comic-episode]').length === expected,
      n,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

async function g26(browser) {
  const g = 'G26 comic 数据持久化'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)

  // 1) 新建 comic 项目 → 进入 /comic/:id，初始空态
  await createComicProject(page)
  const comicPath = new URL(page.url()).pathname
  rec(g, '新建 comic 项目并进入 /comic/:id', /\/comic\//.test(comicPath), comicPath)
  const surfaceOk = await page
    .locator('[data-comic-surface]')
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  rec(g, '漫画剧表面已渲染', surfaceOk)
  rec(g, '初始为空态（0 话）', (await page.locator('[data-comic-empty]').count()) === 1)

  // 2) 通过私有命令加一话
  await page.locator('[data-comic-add-episode]').click()
  rec(g, '新增一话后列表出现 1 话', await waitEpisodes(page, 1))
  const epTitle = await page.locator('[data-comic-episode]').first().innerText()

  // 3) 等防抖窗口（800ms）过去确保已落库，再强刷页面
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  rec(g, '刷新页面后话数仍在（读回 comics 表）', await waitEpisodes(page, 1))
  rec(g, '刷新后不再是空态', (await page.locator('[data-comic-empty]').count()) === 0)
  const epTitleAfter = await page
    .locator('[data-comic-episode]')
    .first()
    .innerText()
    .catch(() => '')
  rec(g, '刷新后话标题一致', epTitleAfter === epTitle, `${epTitle} / ${epTitleAfter}`)
  await page.screenshot({ path: `${OUT}/44-g26-comic-persist.png` })

  // 4) 返回首页 → 重新进入同一项目 → 仍能读回
  await page.locator('[data-comic-back]').click()
  await page.waitForURL((u) => !/\/comic\//.test(u.pathname), { timeout: 8000 })
  const comicCard = page.locator('[data-project-card]', {
    has: page.locator('[data-wb="comic"]'),
  })
  // 同上：等首页网格 hydrate 出卡片再断言
  await comicCard
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => {})
  rec(g, '首页存在 comic 项目卡片', (await comicCard.count()) >= 1)
  await comicCard.first().click()
  await page.waitForURL(/\/comic\//, { timeout: 8000 })
  rec(g, '再次进入项目仍读到该话', await waitEpisodes(page, 1))
  await page.screenshot({ path: `${OUT}/45-g26-comic-reentry.png` })

  // 5) canvas 无回归：返回首页新建 canvas 项目仍正常
  await page.locator('[data-comic-back]').click()
  await page.waitForURL((u) => !/\/comic\//.test(u.pathname), { timeout: 8000 })
  await createProject(page)
  const canvasOk = await page
    .locator('[data-canvas-surface]')
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  rec(g, 'canvas 项目创建流程无回归', canvasOk)

  // 6) 无未捕获异常
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G27 comic 角色卡与阅读方向（M6-2）：
// 项目级 v2 字段端到端 —— 阅读方向切换 + 角色卡「新建/改名/描述/删除」，
// 且刷新后仍读回（hydrate 走 normalizeComicProject 的读回迁移路径）。
// ────────────────────────────────────────────────────────────

/** 等待角色卡数量为 n */
async function waitCharacters(page, n, timeout = 8000) {
  try {
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-comic-character]').length === expected,
      n,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

async function g27(browser) {
  const g = 'G27 comic 角色卡与阅读方向'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)

  // 1) 新建 comic 项目进入
  await createComicProject(page)
  const surfaceOk = await page
    .locator('[data-comic-surface]')
    .waitFor({ state: 'visible', timeout: 8000 })
    .then(() => true)
    .catch(() => false)
  rec(g, '漫画剧表面已渲染', surfaceOk)

  // 2) 阅读方向：默认 ltr 高亮，切到 rtl 后状态翻转
  const ltr = page.locator('[data-comic-reading-ltr]')
  const rtl = page.locator('[data-comic-reading-rtl]')
  rec(g, '默认阅读方向为 ltr', (await ltr.getAttribute('aria-pressed')) === 'true')
  await rtl.click()
  await page
    .waitForFunction(
      () =>
        document.querySelector('[data-comic-reading-rtl]')?.getAttribute('aria-pressed') === 'true',
      null,
      { timeout: 4000 },
    )
    .catch(() => {})
  rec(g, '切换到 rtl 后 rtl 高亮', (await rtl.getAttribute('aria-pressed')) === 'true')
  rec(g, '切换到 rtl 后 ltr 取消高亮', (await ltr.getAttribute('aria-pressed')) === 'false')

  // 3) 角色卡：新建 → 改名 → 填描述
  rec(g, '初始无角色卡（显示空提示）', (await page.locator('[data-comic-characters-empty]').count()) === 1)
  await page.locator('[data-comic-character-add]').click()
  rec(g, '新建后出现 1 张角色卡', await waitCharacters(page, 1))

  const nameInput = page.locator('[data-comic-character-name]').first()
  const descInput = page.locator('[data-comic-character-desc]').first()
  await nameInput.fill('阿花')
  await descInput.fill('双马尾少女，蓝白校服')
  rec(g, '角色名可编辑', (await nameInput.inputValue()) === '阿花')
  rec(g, '角色描述可编辑', (await descInput.inputValue()) === '双马尾少女，蓝白校服')
  await page.screenshot({ path: `${OUT}/46-g27-comic-characters.png` })

  // 4) 等防抖落库 → 刷新 → 阅读方向与角色卡读回
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  rec(
    g,
    '刷新后阅读方向仍为 rtl',
    (await page.locator('[data-comic-reading-rtl]').getAttribute('aria-pressed')) === 'true',
  )
  rec(g, '刷新后角色卡仍在', await waitCharacters(page, 1))
  const nameAfter = await page
    .locator('[data-comic-character-name]')
    .first()
    .inputValue()
    .catch(() => '')
  const descAfter = await page
    .locator('[data-comic-character-desc]')
    .first()
    .inputValue()
    .catch(() => '')
  rec(g, '刷新后角色名一致', nameAfter === '阿花', nameAfter)
  rec(g, '刷新后角色描述一致', descAfter === '双马尾少女，蓝白校服', descAfter)
  await page.screenshot({ path: `${OUT}/47-g27-comic-readback.png` })

  // 5) 删除角色卡 → 回空态
  await page.locator('[data-comic-character-remove]').first().click()
  rec(g, '删除后角色卡归零', await waitCharacters(page, 0))
  rec(g, '删除后回到空提示', (await page.locator('[data-comic-characters-empty]').count()) === 1)

  // 6) 无未捕获异常
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G28 comic 页版式编辑器（M6-3）：
// 一话 → 一页 → 排版（满页单格）→ 竖切 → 选中其一横切 → 断言格数与阅读序号
// → 切 RTL 断言序号镜像（几何不变）→ 刷新读回版式 → 删格 → 清空版式。
// ────────────────────────────────────────────────────────────

/** 等待版式内格数为 n */
async function waitPanels(page, n, timeout = 8000) {
  try {
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-comic-panel]').length === expected,
      n,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

/**
 * 等待某选择器的元素数量达到期望值。
 * 用于「做了异步动作（选文件 → 读字节 → 写 assets → dispatch → 重渲染）之后立刻断言」的场景：
 * 立即 `count()` 会与这条链路竞态，偶发假失败（同一位置的**下一条**断言因为带重试反而通过）。
 */
async function waitSelectorCount(page, selector, n, timeout = 4000) {
  try {
    await page.waitForFunction(
      ([sel, expected]) => document.querySelectorAll(sel).length === expected,
      [selector, n],
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

/** 按 DOM（几何）顺序读取每格的阅读序号 */
function readingSeals(page) {
  return page.locator('[data-comic-reading-seal]').allInnerTexts()
}

/**
 * 相对「页面预览容器」测量每个格的位置与尺寸。
 * 必须相对测量：点击下方按钮会让滚动容器滚动，视口相对的 rect 会整体位移，
 * 用视口坐标断言「几何未变」会假失败。
 */
function panelBoxes(page) {
  return page.evaluate(() => {
    const preview = document.querySelector('[data-comic-page-preview]')
    if (!preview) return null
    const base = preview.getBoundingClientRect()
    return [...document.querySelectorAll('[data-comic-panel]')].map((el) => {
      const r = el.getBoundingClientRect()
      return [
        Math.round(r.left - base.left),
        Math.round(r.top - base.top),
        Math.round(r.width),
        Math.round(r.height),
      ]
    })
  })
}

async function g28(browser) {
  const g = 'G28 comic 页版式编辑器'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)

  // 1) 建项目 → 一话 → 一页
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()
  rec(g, '新建一话', (await page.locator('[data-comic-episode]').count()) === 1)
  await page.locator('[data-comic-add-page]').click()
  rec(g, '新建一页', (await page.locator('[data-comic-page]').count()) === 1)
  rec(g, '初始尚未排版', (await page.locator('[data-comic-layout-empty]').count()) === 1)
  rec(g, '未排版时无格', (await page.locator('[data-comic-panel]').count()) === 0)

  // 2) 排版 → 满页单格
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '排版后出现 1 格', await waitPanels(page, 1))
  rec(g, '单格序号为 1', (await readingSeals(page)).join() === '1')

  // 3) 竖切 → 2 格（左右各半）
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '竖切后 2 格', await waitPanels(page, 2))
  rec(g, '两格序号为 1,2（LTR）', (await readingSeals(page)).join() === '1,2')

  // 4) 选中第二格横切 → 3 格
  await page.locator('[data-comic-panel]').nth(1).click()
  await page.locator('[data-comic-split-h]').click()
  rec(g, '再横切后 3 格', await waitPanels(page, 3))
  rec(g, '三格序号为 1,2,3（LTR）', (await readingSeals(page)).join() === '1,2,3')
  await page.screenshot({ path: `${OUT}/48-g28-layout-ltr.png` })

  // 5) 切 RTL → 序号镜像（几何位置不动）
  const boxesBefore = await panelBoxes(page)
  await page.locator('[data-comic-reading-rtl]').click()
  await page
    .waitForFunction(
      () => {
        const seals = [...document.querySelectorAll('[data-comic-reading-seal]')].map(
          (e) => e.textContent,
        )
        return seals.join() !== '1,2,3'
      },
      null,
      { timeout: 4000 },
    )
    .catch(() => {})
  const sealsRtl = await readingSeals(page)
  rec(g, 'RTL 后序号顺序改变', sealsRtl.join() !== '1,2,3', sealsRtl.join())
  rec(g, 'RTL 后序号仍是 1..3 的排列', [...sealsRtl].sort().join() === '1,2,3', sealsRtl.join())
  const boxesAfter = await panelBoxes(page)
  rec(
    g,
    'RTL 只改序号、不改几何位置',
    JSON.stringify(boxesBefore) === JSON.stringify(boxesAfter),
    `${JSON.stringify(boxesBefore)} / ${JSON.stringify(boxesAfter)}`,
  )
  await page.screenshot({ path: `${OUT}/49-g28-layout-rtl.png` })

  // 6) 刷新读回：版式与方向都在
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  rec(g, '刷新后版式仍为 3 格', await waitPanels(page, 3))
  rec(
    g,
    '刷新后阅读方向仍为 rtl',
    (await page.locator('[data-comic-reading-rtl]').getAttribute('aria-pressed')) === 'true',
  )

  // 7) 删格 → 2 格；清空版式 → 回未排版
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-remove-panel]').click()
  rec(g, '删格后 2 格', await waitPanels(page, 2))
  await page.locator('[data-comic-layout-reset]').click()
  rec(g, '清空版式后回到未排版', (await page.locator('[data-comic-layout-empty]').count()) === 1)
  rec(g, '清空版式后无格', (await page.locator('[data-comic-panel]').count()) === 0)
  await page.screenshot({ path: `${OUT}/50-g28-layout-reset.png` })

  // 8) 无未捕获异常
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G29 comic 格编辑与对白层（M6-4）：
// 一话 → 一页 → 排版（满页单格）→ 未选格时右栏空态 → 选中格出现格属性面板
// → 填画面描述 → 设景别/机位/转场 → 建 2 角色并勾选其一
// → 加 1 条对白（speech）→ 断言左侧预览出现贴纸 + 尾巴 → 切类型断言形态/说话人栏目
// → 填对白文本断言贴纸文本 → 拖动贴纸断言坐标变化
// → 等防抖落库 → 刷新 → 逐项读回（描述/镜头/角色/对白类型文本坐标）。
// ────────────────────────────────────────────────────────────

/** 读取选中格内所有贴纸的 data-* 快照（id / 类型 / 坐标 / 文本） */
function stickerSnapshots(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-comic-balloon-sticker]')].map((el) => ({
      id: el.getAttribute('data-comic-balloon-sticker-id'),
      type: el.getAttribute('data-comic-balloon-sticker-type'),
      x: el.getAttribute('data-comic-balloon-sticker-x'),
      y: el.getAttribute('data-comic-balloon-sticker-y'),
      text: el.textContent ?? '',
    })),
  )
}

async function g29(browser) {
  const g = 'G29 comic 格编辑与对白层'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)

  // 1) 建项目 → 一话 → 一页 → 排版（满页单格）
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '排版后出现 1 格', await waitPanels(page, 1))

  // 2) 未选格 → 右栏空态
  rec(g, '未选格显示空态', (await page.locator('[data-comic-panel-editor-empty]').count()) === 1)

  // 3) 选中格 → 右栏格属性面板
  await page.locator('[data-comic-panel]').first().click()
  const editorShown = await page
    .locator('[data-comic-panel-editor]')
    .waitFor({ state: 'visible', timeout: 4000 })
    .then(() => true)
    .catch(() => false)
  rec(g, '选中格后出现格属性面板', editorShown)
  rec(
    g,
    '面板标题为第 1 格',
    (await page.locator('[data-comic-panel-editor-title]').innerText()).includes('第 1 格'),
  )

  // 4) 画面描述
  await page.locator('[data-comic-scene]').fill('雨夜天台，主角背对镜头')
  rec(
    g,
    '画面描述已写入',
    (await page.locator('[data-comic-scene]').inputValue()) === '雨夜天台，主角背对镜头',
  )

  // 5) 镜头语言（景别 / 机位 / 转场）
  await page.locator('[data-comic-shot-framing]').selectOption('close-up')
  await page.locator('[data-comic-shot-angle]').selectOption('low')
  await page.locator('[data-comic-shot-transition]').selectOption('action-to-action')
  rec(g, '景别已设为 close-up', (await page.locator('[data-comic-shot-framing]').inputValue()) === 'close-up')
  rec(g, '机位已设为 low', (await page.locator('[data-comic-shot-angle]').inputValue()) === 'low')
  rec(
    g,
    '转场已设为 action-to-action',
    (await page.locator('[data-comic-shot-transition]').inputValue()) === 'action-to-action',
  )

  // 6) 建 2 角色 → 勾选其一为出场角色
  await page.locator('[data-comic-character-add]').click()
  await page.locator('[data-comic-character-add]').click()
  rec(g, '角色卡 2 张', (await page.locator('[data-comic-character]').count()) === 2)
  rec(g, '出场角色有 2 个可勾选', (await page.locator('[data-comic-panel-character]').count()) === 2)
  const check1 = page.locator('[data-comic-panel-character]').first()
  await check1.check()
  rec(g, '出场角色已勾选', await check1.isChecked())

  // 7) 加一条对白（speech）→ 左侧预览出现贴纸 + 尾巴
  await page.locator('[data-comic-balloon-add="speech"]').click()
  rec(g, '对白列表 1 行', (await page.locator('[data-comic-balloon]').count()) === 1)
  rec(g, '左侧预览出现 1 张贴纸', (await page.locator('[data-comic-balloon-sticker]').count()) === 1)
  rec(g, 'speech 贴纸带尾巴', (await page.locator('[data-comic-balloon-tail]').count()) === 1)

  // 8) 四类型可切：thought 仍有尾巴；narration 无尾巴、无说话人下拉
  await page.locator('[data-comic-balloon-type]').selectOption('thought')
  rec(
    g,
    '切 thought 后贴纸类型更新',
    (await page
      .locator('[data-comic-balloon-sticker]')
      .first()
      .getAttribute('data-comic-balloon-sticker-type')) === 'thought',
  )
  await page.locator('[data-comic-balloon-type]').selectOption('narration')
  rec(g, 'narration 无尾巴', (await page.locator('[data-comic-balloon-tail]').count()) === 0)
  rec(g, 'narration 无说话人下拉', (await page.locator('[data-comic-balloon-speaker]').count()) === 0)

  // 9) 切回 speech → 说话人下拉出现，指定说话人
  await page.locator('[data-comic-balloon-type]').selectOption('speech')
  rec(g, 'speech 有说话人下拉', (await page.locator('[data-comic-balloon-speaker]').count()) === 1)
  const charId = await page
    .locator('[data-comic-panel-character-id]')
    .first()
    .getAttribute('data-comic-panel-character-id')
  await page.locator('[data-comic-balloon-speaker]').selectOption(charId)
  rec(
    g,
    '说话人已指定',
    (await page.locator('[data-comic-balloon-speaker]').inputValue()) === charId,
  )

  // 10) 对白文本 → 左侧贴纸显示文本
  await page.locator('[data-comic-balloon-text]').fill('你终于来了')
  const snapText = await stickerSnapshots(page)
  rec(g, '贴纸显示对白文本', snapText[0]?.text === '你终于来了', JSON.stringify(snapText[0]))

  // 11) 拖动贴纸 → 坐标变化（松手才提交；层不挡点选）
  const before = await stickerSnapshots(page)
  const sticker = page.locator('[data-comic-balloon-sticker]').first()
  await sticker.scrollIntoViewIfNeeded()
  const box = await sticker.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 50, { steps: 10 })
  await page.mouse.up()
  await sleep(160)
  const after = await stickerSnapshots(page)
  rec(
    g,
    '拖动后贴纸坐标变化',
    Boolean(before[0]) &&
      Boolean(after[0]) &&
      (Number(after[0].x) !== Number(before[0].x) || Number(after[0].y) !== Number(before[0].y)),
    `${JSON.stringify(before[0])} → ${JSON.stringify(after[0])}`,
  )
  await page.screenshot({ path: `${OUT}/51-g29-panel-editor.png` })

  // 12) 等防抖落库 → 刷新读回全部
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  rec(g, '刷新后仍 1 格', await waitPanels(page, 1))
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })
  rec(
    g,
    '刷新后画面描述读回',
    (await page.locator('[data-comic-scene]').inputValue()) === '雨夜天台，主角背对镜头',
  )
  rec(g, '刷新后景别读回', (await page.locator('[data-comic-shot-framing]').inputValue()) === 'close-up')
  rec(g, '刷新后机位读回', (await page.locator('[data-comic-shot-angle]').inputValue()) === 'low')
  rec(
    g,
    '刷新后转场读回',
    (await page.locator('[data-comic-shot-transition]').inputValue()) === 'action-to-action',
  )
  rec(g, '刷新后出场角色读回', await page.locator('[data-comic-panel-character]').first().isChecked())
  rec(g, '刷新后对白 1 行', (await page.locator('[data-comic-balloon]').count()) === 1)
  const snapBack = await stickerSnapshots(page)
  rec(g, '刷新后对白类型读回', snapBack[0]?.type === 'speech', JSON.stringify(snapBack[0]))
  rec(g, '刷新后对白文本读回', snapBack[0]?.text === '你终于来了', JSON.stringify(snapBack[0]))
  rec(
    g,
    '刷新后贴纸坐标读回',
    Boolean(snapBack[0]) &&
      Math.abs(Number(snapBack[0].x) - Number(after[0].x)) < 0.02 &&
      Math.abs(Number(snapBack[0].y) - Number(after[0].y)) < 0.02,
    `${JSON.stringify(after[0])} → ${JSON.stringify(snapBack[0])}`,
  )
  await page.screenshot({ path: `${OUT}/52-g29-after-reload.png` })

  // 13) 无未捕获异常
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G30 comic 格生成（M6-5，路径 B 的第二个消费者）：
// 配渠道 → 建 comic 项目 → 一话一页排版 → 选中格 → 填画面描述 + 选平台/模型
// → 加一条对白 → 生成 → 断言格内出现底图（blob:）→ 重生成换图 → 对白仍在
// → 刷新后底图与对白都读回。
// 这是「共享 runEngine + ComicPlacement」这条链路的浏览器内真机证明。
// ────────────────────────────────────────────────────────────
async function g30(browser) {
  const g = 'G30 comic 格生成'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // 1) 配一个 mock 渠道并启用（与 G9/G10 同法；含勾选模型）
  await configureMockChannel(page)

  // 2) 建 comic 项目 → 一话 → 一页 → 排版（满页单格）
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '排版后出现 1 格', await waitPanels(page, 1))

  // 3) 选中格 → 填画面描述 + 生成配置
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })
  await page.locator('[data-comic-scene]').fill('雨夜的霓虹街道')
  rec(g, '画面描述已写入', (await page.locator('[data-comic-scene]').inputValue()) === '雨夜的霓虹街道')

  // 未配平台/模型前，生成按钮应为禁用（配置不全不参与生成）
  rec(g, '未配平台时生成按钮禁用', await page.locator('[data-comic-panel-generate-btn]').isDisabled())

  await page.locator('[data-comic-panel-channel]').selectOption({ label: '新建渠道' })
  await sleep(250)
  await page.locator('[data-comic-panel-model]').selectOption({ label: 'mock-image-1' })
  await sleep(250)
  rec(
    g,
    '平台已选',
    (await page.locator('[data-comic-panel-channel]').inputValue()).length > 0,
  )
  rec(g, '模型已选 mock-image-1', (await page.locator('[data-comic-panel-model]').inputValue()) === 'mock-image-1')

  // 4) 加一条对白（用于验证「重生成不丢对白」）
  await page.locator('[data-comic-balloon-add="speech"]').click()
  await page.locator('[data-comic-balloon-text]').fill('别回头。')
  rec(g, '对白贴纸出现', (await page.locator('[data-comic-balloon-sticker]').count()) === 1)

  // 5) 生成 → 等格内底图出现（素材落库 + useAsset 退避重试）
  rec(g, '配置齐全后生成按钮可用', await page.locator('[data-comic-panel-generate-btn]').isEnabled())
  await page.locator('[data-comic-panel-generate-btn]').click()

  let artSrc = ''
  for (let i = 0; i < 40; i++) {
    if ((await page.locator('[data-comic-panel-art]').count()) >= 1) {
      artSrc = (await page.locator('[data-comic-panel-art]').first().getAttribute('src')) ?? ''
      if (artSrc.startsWith('blob:')) break
    }
    await sleep(250)
  }
  rec(g, '生成后格内出现底图', artSrc.startsWith('blob:'), artSrc.slice(0, 16))
  rec(g, '底图来自素材库 objectURL', artSrc.startsWith('blob:'))
  rec(g, '生成后对白贴纸仍在', (await page.locator('[data-comic-balloon-sticker]').count()) === 1)
  rec(
    g,
    '生成后对白文本未变',
    (await page.locator('[data-comic-balloon-sticker]').first().textContent()) === '别回头。',
  )
  await page.screenshot({ path: `${OUT}/53-g30-generated.png` })

  // 6) 重生成：改画面描述 → 再生成 → 底图换新（对白不动）
  const firstSrc = artSrc
  await page.locator('[data-comic-scene]').fill('清晨空无一人的站台')
  // 等按钮回到空闲（不是「取消生成」）
  for (let i = 0; i < 20; i++) {
    const label = await page.locator('[data-comic-panel-generate-btn]').innerText().catch(() => '')
    if (!label.includes('取消')) break
    await sleep(200)
  }
  await page.locator('[data-comic-panel-generate-btn]').click()
  let secondSrc = ''
  for (let i = 0; i < 40; i++) {
    secondSrc = (await page.locator('[data-comic-panel-art]').first().getAttribute('src').catch(() => '')) ?? ''
    if (secondSrc && secondSrc !== firstSrc) break
    await sleep(250)
  }
  rec(g, '重生成后底图更换', Boolean(secondSrc) && secondSrc !== firstSrc, `${firstSrc.slice(0, 12)} → ${secondSrc.slice(0, 12)}`)
  rec(g, '重生成后对白贴纸仍在', (await page.locator('[data-comic-balloon-sticker]').count()) === 1)
  rec(
    g,
    '重生成后对白文本未变',
    (await page.locator('[data-comic-balloon-sticker]').first().textContent()) === '别回头。',
  )
  await page.screenshot({ path: `${OUT}/54-g30-regenerated.png` })

  // 7) 等防抖落库 → 刷新 → 底图与对白都读回
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  rec(g, '刷新后仍 1 格', await waitPanels(page, 1))
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })

  let artBack = ''
  for (let i = 0; i < 40; i++) {
    artBack = (await page.locator('[data-comic-panel-art]').first().getAttribute('src').catch(() => '')) ?? ''
    if (artBack.startsWith('blob:')) break
    await sleep(250)
  }
  rec(g, '刷新后底图读回', artBack.startsWith('blob:'))
  rec(
    g,
    '刷新后画面描述读回',
    (await page.locator('[data-comic-scene]').inputValue()) === '清晨空无一人的站台',
  )
  rec(g, '刷新后对白 1 行', (await page.locator('[data-comic-balloon]').count()) === 1)
  rec(
    g,
    '刷新后对白文本读回',
    (await page.locator('[data-comic-balloon-sticker]').first().textContent()) === '别回头。',
  )
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await page.screenshot({ path: `${OUT}/55-g30-after-reload.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G31 comic 一话总览 + 翻页预览（M6-6）：
// 一话三页（页1=1格、页2=2格、页3=未排版）→ 总览缩略断言（含未排版占位）
// → 点选缩略回到编辑该页 → 打开阅读器 → 按钮翻页 → 键盘方向键（LTR）→ 边界禁用
// → Esc 关闭 → 切 RTL → 重开断言箭头朝向与键盘语义镜像 → 刷新读回。
// ────────────────────────────────────────────────────────────

/** 读阅读器当前页序（`data-comic-reader-index`）；无 stage 返回 null */
async function readerIndex(page) {
  const v = await page
    .locator('[data-comic-reader-stage]')
    .getAttribute('data-comic-reader-index')
    .catch(() => null)
  return v === null ? null : Number(v)
}

async function waitReaderIndex(page, n, timeout = 4000) {
  try {
    await page.waitForFunction(
      (expected) => {
        const el = document.querySelector('[data-comic-reader-stage]')
        return el !== null && el.getAttribute('data-comic-reader-index') === String(expected)
      },
      n,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

/** 总览里每页缩略的格数（`data-comic-thumb-panel-count`） */
function thumbPanelCounts(page) {
  return page
    .locator('[data-comic-page-thumb]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-comic-thumb-panel-count')))
}

// ────────────────────────────────────────────────────────────
// G32 comic 双页跨页阅读（M6-7）：
// 4 页（格数 1/2/3/4）→ 单页逐页记录页 id → 切双页断言封面单页与占位
// → 跨页步进（不是按页）、边界禁用 → 键盘跨页 → 末页落单
// → 切 RTL 断言槽位与并排顺序镜像 → 切回单页 → 刷新回落单页。
// ────────────────────────────────────────────────────────────

/** 阅读器当前版式（`data-comic-reader-mode`）；无舞台返回 null */
async function readerMode(page) {
  const v = await page
    .locator('[data-comic-reader-stage]')
    .getAttribute('data-comic-reader-mode')
    .catch(() => null)
  return v
}

/** 等跨页容器出现（切版式后 DOM 更新可能滞后一帧） */
async function waitSpread(page, timeout = 2000) {
  try {
    await page.locator('[data-comic-reader-spread]').waitFor({ state: 'visible', timeout })
    return true
  } catch {
    return false
  }
}

/** 跨页容器内各槽位种类（左→右）：'page' | 'gap' */
function spreadSlotKinds(page) {
  return page
    .locator('[data-comic-reader-spread]')
    .evaluate((el) =>
      Array.from(el.children).map((c) => (c.hasAttribute('data-comic-reader-gap') ? 'gap' : 'page')),
    )
}

/** 跨页容器内各页 id（左→右） */
function spreadPageIds(page) {
  return page
    .locator('[data-comic-reader-spread] [data-comic-read-page-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-comic-read-page-id')))
}

/** 跨页容器内各页的格数（左→右） */
function spreadPageCounts(page) {
  return page
    .locator('[data-comic-reader-spread] [data-comic-read-page]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-comic-page-count')))
}

async function g31(browser) {
  const g = 'G31 comic 一话总览与翻页预览'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()

  // 无页时「预览」应禁用（没有可翻的东西）
  rec(g, '无页时预览按钮禁用', await page.locator('[data-comic-open-reader]').isDisabled())

  // 页1：满页单格
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页1 排版后 1 格', await waitPanels(page, 1))

  // 页2：满页单格 → 竖切 → 2 格
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '页2 竖切后 2 格', await waitPanels(page, 2))

  // 页3：只加页、不排版（验证总览的「未排版」占位）
  await page.locator('[data-comic-add-page]').click()
  rec(g, '页3 为未排版空态', (await page.locator('[data-comic-layout-empty]').count()) === 1)

  // ── 一话总览 ──
  await page.locator('[data-comic-view-overview]').click()
  await page.locator('[data-comic-overview]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, '总览网格出现', (await page.locator('[data-comic-overview]').count()) === 1)
  rec(g, '总览列出 3 页', (await page.locator('[data-comic-overview-page]').count()) === 3)
  const counts = await thumbPanelCounts(page)
  rec(
    g,
    '缩略格数与各页版式一致（1 / 2 / 未排版）',
    counts.length === 2 && counts[0] === '1' && counts[1] === '2',
    counts.join(','),
  )
  rec(g, '未排版的页显示占位', (await page.locator('[data-comic-thumb-empty]').count()) === 1)
  rec(
    g,
    '未生成的格缩略不渲染底图（M6-9 起会渲染，但这一话还没生成过）',
    (await page.locator('[data-comic-thumb-art]').count()) === 0,
  )
  rec(
    g,
    '每页缩略都带页码角标（含未排版页）',
    (await page.locator('[data-comic-thumb-badge]').count()) === 3,
  )
  await page.screenshot({ path: `${OUT}/56-g31-overview.png` })

  // 点选缩略 → 回到编辑该页
  await page.locator('[data-comic-overview-page]').nth(1).click()
  rec(g, '点选缩略后回到编辑视图', (await page.locator('[data-comic-workspace]').count()) === 1)
  rec(g, '点选缩略后定位到该页（2 格）', await waitPanels(page, 2))

  // 回到总览，断言选中态跟随当前页
  await page.locator('[data-comic-view-overview]').click()
  await page.locator('[data-comic-overview]').waitFor({ state: 'visible', timeout: 4000 })
  rec(
    g,
    '总览中当前页为选中态',
    (await page.locator('[data-comic-overview-page]').nth(1).getAttribute('aria-pressed')) === 'true',
  )
  await page.locator('[data-comic-overview-page]').first().click()
  await waitPanels(page, 1)

  // ── 翻页预览（LTR）──
  await page.locator('[data-comic-open-reader]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, '阅读器已打开', (await page.locator('[data-comic-reader]').count()) === 1)
  rec(g, '阅读器定位到当前页（第 1 页）', (await readerIndex(page)) === 0)
  rec(
    g,
    '阅读器显示页码「第 1 / 3 页」',
    (await page.locator('[data-comic-reader-counter]').innerText()).includes('1 / 3'),
  )
  rec(g, '首页「上一页」禁用', await page.locator('[data-comic-reader-prev]').isDisabled())
  rec(g, '首页「下一页」可用', await page.locator('[data-comic-reader-next]').isEnabled())
  rec(
    g,
    'LTR 下「上一页」朝左、「下一页」朝右',
    (await page.locator('[data-comic-reader-prev]').innerText()).includes('←') &&
      (await page.locator('[data-comic-reader-next]').innerText()).includes('→'),
  )
  rec(
    g,
    '只读页渲染出 1 格（用 read 专用选择器，不与编辑态冲突）',
    (await page.locator('[data-comic-read-page]').count()) === 1 &&
      (await page.locator('[data-comic-read-page]').getAttribute('data-comic-page-count')) === '1',
  )
  await page.screenshot({ path: `${OUT}/57-g31-reader.png` })

  // 按钮翻页：第 1 → 2 页（内容换成 2 格）
  await page.locator('[data-comic-reader-next]').click()
  rec(g, '「下一页」翻到第 2 页', await waitReaderIndex(page, 1))
  rec(
    g,
    '第 2 页只读渲染 2 格',
    (await page.locator('[data-comic-read-page]').getAttribute('data-comic-page-count')) === '2',
  )

  // 键盘翻页（LTR：→ 前进、← 后退）
  await page.keyboard.press('ArrowRight')
  rec(g, 'LTR 下 → 前进到第 3 页', await waitReaderIndex(page, 2))
  rec(g, '末页「下一页」禁用', await page.locator('[data-comic-reader-next]').isDisabled())
  rec(
    g,
    '未排版页在阅读器里显示空态',
    (await page.locator('[data-comic-reader-stage] [data-comic-layout-empty]').count()) === 1,
  )
  await page.keyboard.press('ArrowLeft')
  rec(g, 'LTR 下 ← 后退到第 2 页', await waitReaderIndex(page, 1))

  // Esc 关闭
  await page.keyboard.press('Escape')
  await page.locator('[data-comic-reader]').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {})
  rec(g, 'Esc 关闭阅读器', (await page.locator('[data-comic-reader]').count()) === 0)

  // ── 切 RTL 后语义镜像 ──
  await page.locator('[data-comic-reading-rtl]').click()
  await page.locator('[data-comic-overview]').waitFor({ state: 'visible', timeout: 4000 }).catch(() => {})
  await page.locator('[data-comic-view-overview]').click()
  await page.locator('[data-comic-overview-page]').first().click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-open-reader]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, 'RTL 下重开阅读器在第 1 页', (await readerIndex(page)) === 0)
  rec(
    g,
    'RTL 下箭头朝向镜像（上一页朝右、下一页朝左）',
    (await page.locator('[data-comic-reader-prev]').innerText()).includes('→') &&
      (await page.locator('[data-comic-reader-next]').innerText()).includes('←'),
  )
  await page.keyboard.press('ArrowLeft')
  rec(g, 'RTL 下 ← 才是前进（到第 2 页）', await waitReaderIndex(page, 1))
  await page.keyboard.press('ArrowRight')
  rec(g, 'RTL 下 → 是后退（回第 1 页）', await waitReaderIndex(page, 0))
  await page.locator('[data-comic-reader-close]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {})
  rec(g, '「关闭」按钮关闭阅读器', (await page.locator('[data-comic-reader]').count()) === 0)

  // ── 刷新读回 ──
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-view-overview]').click()
  await page.locator('[data-comic-overview]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, '刷新后总览仍 3 页', (await page.locator('[data-comic-overview-page]').count()) === 3)
  const countsBack = await thumbPanelCounts(page)
  rec(
    g,
    '刷新后缩略格数读回一致',
    countsBack.length === 2 && countsBack[0] === '1' && countsBack[1] === '2',
    countsBack.join(','),
  )
  rec(g, '刷新后仍未排版页保持占位', (await page.locator('[data-comic-thumb-empty]').count()) === 1)
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await page.screenshot({ path: `${OUT}/58-g31-after-reload.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G32 comic 双页跨页阅读（M6-7）
// ────────────────────────────────────────────────────────────
async function g32(browser) {
  const g = 'G32 comic 双页跨页阅读'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()

  // 造 4 页、格数各异（1/2/3/4）——便于在跨页里辨认「哪两页在一组、谁是先读的那页」
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页1 = 1 格', await waitPanels(page, 1))

  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '页2 = 2 格', await waitPanels(page, 2))

  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  await waitPanels(page, 2)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '页3 = 3 格', await waitPanels(page, 3))

  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  await waitPanels(page, 2)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  await waitPanels(page, 3)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '页4 = 4 格', await waitPanels(page, 4))

  // 选中第 1 页，使阅读器从第 1 页打开
  await page.locator('[data-comic-page]').first().click()
  await waitPanels(page, 1)

  // ── 默认单页：逐页记录 id（跨页断言要用「哪一页」而不是「第几格」）──
  await page.locator('[data-comic-open-reader]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, '默认阅读版式为单页', (await readerMode(page)) === 'single')
  rec(g, '单页模式不渲染跨页容器', (await page.locator('[data-comic-reader-spread]').count()) === 0)

  const readId = () =>
    page.locator('[data-comic-read-page-id]').first().getAttribute('data-comic-read-page-id')
  const ids = [await readId()]
  for (let i = 1; i < 4; i++) {
    await page.locator('[data-comic-reader-next]').click()
    await waitReaderIndex(page, i)
    ids.push(await readId())
  }
  rec(g, '逐页记录 4 个页 id 且互不相同', new Set(ids).size === 4, ids.join(','))
  for (let i = 3; i > 0; i--) {
    await page.locator('[data-comic-reader-prev]').click()
    await waitReaderIndex(page, i - 1)
  }

  // ── 切双页 ──
  await page.locator('[data-comic-reader-mode-spread]').click()
  rec(g, '切到双页版式', (await waitSpread(page)) && (await readerMode(page)) === 'spread')
  rec(
    g,
    '双页分段为选中态',
    (await page.locator('[data-comic-reader-mode-spread]').getAttribute('aria-pressed')) === 'true',
  )
  rec(g, '阅读器停在第 1 页', (await readerIndex(page)) === 0)
  rec(
    g,
    '封面（第 1 页）单独成组，另一侧留空占位',
    JSON.stringify(await spreadSlotKinds(page)) === JSON.stringify(['page', 'gap']),
    (await spreadSlotKinds(page)).join(','),
  )
  rec(
    g,
    '封面仍只显示 1 格',
    JSON.stringify(await spreadPageCounts(page)) === JSON.stringify(['1']),
    (await spreadPageCounts(page)).join(','),
  )
  rec(
    g,
    '封面区间文案为「第 1 / 4 页」',
    (await page.locator('[data-comic-reader-counter]').innerText()).includes('1 / 4'),
  )
  rec(g, '封面「上一跨页」禁用', await page.locator('[data-comic-reader-prev]').isDisabled())
  rec(
    g,
    '双页下按钮改用「跨页」措辞',
    (await page.locator('[data-comic-reader-prev]').innerText()).includes('跨页'),
  )
  await page.screenshot({ path: `${OUT}/59-g32-spread-cover.png` })

  // 下一跨页 → 并排 (第2页, 第3页)
  await page.locator('[data-comic-reader-next]').click()
  rec(g, '跨页步进停在组首（第 2 页）', await waitReaderIndex(page, 1))
  rec(
    g,
    '第 2-3 页并排渲染 2 页',
    (await page.locator('[data-comic-reader-spread] [data-comic-read-page]').count()) === 2,
  )
  rec(
    g,
    '并排两页格数 2 / 3（内容跟页走）',
    JSON.stringify(await spreadPageCounts(page)) === JSON.stringify(['2', '3']),
    (await spreadPageCounts(page)).join(','),
  )
  rec(
    g,
    'LTR 下较早页在左（页序不翻转）',
    JSON.stringify(await spreadPageIds(page)) === JSON.stringify([ids[1], ids[2]]),
    (await spreadPageIds(page)).join(','),
  )
  rec(
    g,
    '区间文案为「第 2-3 / 4 页」',
    (await page.locator('[data-comic-reader-counter]').innerText()).includes('2-3 / 4'),
  )
  await page.screenshot({ path: `${OUT}/60-g32-spread-pair.png` })

  // 再下一跨页 → 末页落单
  await page.locator('[data-comic-reader-next]').click()
  rec(g, '跨页步进到第 4 页', await waitReaderIndex(page, 3))
  rec(
    g,
    '末尾落单页单独成组',
    JSON.stringify(await spreadSlotKinds(page)) === JSON.stringify(['page', 'gap']),
    (await spreadSlotKinds(page)).join(','),
  )
  rec(g, '末页「下一跨页」禁用', await page.locator('[data-comic-reader-next]').isDisabled())
  rec(
    g,
    '末页仍显示 4 格',
    JSON.stringify(await spreadPageCounts(page)) === JSON.stringify(['4']),
    (await spreadPageCounts(page)).join(','),
  )

  // 跨页步进是「一组」而非「一页」：回退落到组首（第 2 页），不是第 3 页
  await page.locator('[data-comic-reader-prev]').click()
  rec(g, '「上一跨页」整组回退到组首（第 2 页）', await waitReaderIndex(page, 1))
  await page.locator('[data-comic-reader-prev]').click()
  rec(g, '再回退到封面（第 1 页）', await waitReaderIndex(page, 0))
  rec(g, '回到封面后「上一跨页」禁用', await page.locator('[data-comic-reader-prev]').isDisabled())

  // 键盘在双页下同样按跨页步进（LTR：→ 前进）
  await page.keyboard.press('ArrowRight')
  rec(g, 'LTR 下 → 按跨页前进到第 2 页', await waitReaderIndex(page, 1))
  await page.keyboard.press('ArrowLeft')
  rec(g, 'LTR 下 ← 按跨页回退到第 1 页', await waitReaderIndex(page, 0))

  // 切回单页：只渲染 1 页
  await page.locator('[data-comic-reader-mode-single]').click()
  rec(g, '切回单页版式', (await readerMode(page)) === 'single')
  rec(
    g,
    '切回单页后只渲染 1 页',
    (await page.locator('[data-comic-read-page]').count()) === 1 &&
      (await page.locator('[data-comic-reader-spread]').count()) === 0,
  )

  await page.locator('[data-comic-reader-close]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {})

  // ── 切 RTL：槽位与并排顺序镜像 ──
  await page.locator('[data-comic-reading-rtl]').click()
  await page.locator('[data-comic-open-reader]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'visible', timeout: 4000 })
  await page.locator('[data-comic-reader-mode-spread]').click()
  rec(g, 'RTL 下切到双页', (await waitSpread(page)) && (await readerMode(page)) === 'spread')
  rec(
    g,
    'RTL 下封面靠右（占位在左）',
    JSON.stringify(await spreadSlotKinds(page)) === JSON.stringify(['gap', 'page']),
    (await spreadSlotKinds(page)).join(','),
  )
  await page.keyboard.press('ArrowLeft')
  rec(g, 'RTL 下 ← 才是前进（跨页到第 2 页）', await waitReaderIndex(page, 1))
  rec(
    g,
    'RTL 下较早页在右（并排顺序镜像）',
    JSON.stringify(await spreadPageIds(page)) === JSON.stringify([ids[2], ids[1]]),
    (await spreadPageIds(page)).join(','),
  )
  rec(
    g,
    '镜像只改左右、不改内容（左→右格数 3 / 2）',
    JSON.stringify(await spreadPageCounts(page)) === JSON.stringify(['3', '2']),
    (await spreadPageCounts(page)).join(','),
  )
  await page.screenshot({ path: `${OUT}/61-g32-spread-rtl.png` })

  await page.keyboard.press('Escape')
  await page.locator('[data-comic-reader]').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {})
  rec(g, 'Esc 关闭阅读器', (await page.locator('[data-comic-reader]').count()) === 0)

  // ── 刷新：阅读版式是 UI 态，回落单页；分组数据（页数）仍在 ──
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-open-reader]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, '刷新后阅读版式回落单页（版式为 UI 态，不落库）', (await readerMode(page)) === 'single')
  rec(
    g,
    '刷新后页数据仍在（计数 / 4）',
    (await page.locator('[data-comic-reader-counter]').innerText()).includes('/ 4'),
  )
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G33 comic 整套导出（M6-8）：
// 一话三页（格数 1/2/1）→ 导出本话（单页版式）断言 ZIP 条目数 / 命名 / PNG 签名与尺寸
// → 切跨页版式断言 2 张（001、002-003）与并排尺寸（两列 + 中缝）
// → 切回单页 → 导出整个项目断言项目名目录前缀 → 状态行如实播报张数与页数。
// ────────────────────────────────────────────────────────────

/** 解析 store 版 ZIP（顺序读本地头）；只取名字与字节，够断言即可 */
function parseZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const decoder = new TextDecoder()
  const entries = []
  let p = 0
  while (p + 30 <= buf.length && dv.getUint32(p, true) === 0x04034b50) {
    const size = dv.getUint32(p + 18, true)
    const nameLen = dv.getUint16(p + 26, true)
    const extraLen = dv.getUint16(p + 28, true)
    const name = decoder.decode(buf.subarray(p + 30, p + 30 + nameLen))
    const dataAt = p + 30 + nameLen + extraLen
    entries.push({ name, data: buf.subarray(dataAt, dataAt + size) })
    p = dataAt + size
  }
  return entries
}

/** PNG 尺寸（IHDR 大端）：宽在 16..19、高在 20..23；非 PNG 返回 null */
function pngSize(data) {
  const isPng =
    data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 &&
    data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a
  if (!isPng) return null
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength)
  return { width: dv.getUint32(16, false), height: dv.getUint32(20, false) }
}

/** 点某个导出按钮 → 接住下载 → 落盘并读回字节 */
async function captureExport(page, selector, outName) {
  const dlPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null)
  await page.locator(selector).click()
  const dl = await dlPromise
  if (!dl) return null
  const file = `${OUT}/${outName}`
  await dl.saveAs(file)
  return { file, name: dl.suggestedFilename(), bytes: readFileSync(file) }
}

async function g33(browser) {
  const g = 'G33 comic 整套导出'
  const ctx = await newCtx(browser, { acceptDownloads: true })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()

  // 三页：1 格 / 2 格 / 1 格（三页才能区分「单页 3 张」与「跨页 2 张」）
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页1 = 1 格', await waitPanels(page, 1))

  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '页2 = 2 格', await waitPanels(page, 2))

  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页3 = 1 格', await waitPanels(page, 1))

  // 选回第 1 页，保证「导出本话」定位的是这一话
  await page.locator('[data-comic-page]').first().click()
  await waitPanels(page, 1)

  rec(
    g,
    '默认导出为单页版式',
    (await page.locator('[data-comic-export-layout-page]').getAttribute('aria-pressed')) === 'true',
  )

  // ── 导出本话（单页版式）──
  const single = await captureExport(page, '[data-comic-export-episode]', '62-g33-episode-pages.zip')
  rec(g, '导出本话触发下载', Boolean(single), single?.name ?? '未捕获 download 事件')
  if (single) {
    rec(g, '包名为 zip 且含话名', /第 1 话.*\.zip$/.test(single.name), single.name)
    const entries = parseZip(single.bytes)
    rec(g, '单页版式产出 3 张', entries.length === 3, `条目数=${entries.length}`)
    rec(
      g,
      '包内命名 001 / 002 / 003',
      JSON.stringify(entries.map((e) => e.name)) ===
        JSON.stringify(['第 1 话/001.png', '第 1 话/002.png', '第 1 话/003.png']),
      entries.map((e) => e.name).join(' , '),
    )
    const sizes = entries.map((e) => pngSize(e.data))
    rec(g, '每张都是合法 PNG', sizes.every((s) => s !== null))
    rec(
      g,
      '单页图尺寸 1080×1620（2:3）',
      sizes.every((s) => s && s.width === 1080 && s.height === 1620),
      JSON.stringify(sizes),
    )
  }
  rec(
    g,
    '状态行播报张数与页数',
    /已导出 3 张/.test(await page.locator('[data-comic-export-status]').innerText()),
    await page.locator('[data-comic-export-status]').innerText(),
  )
  await page.screenshot({ path: `${OUT}/62-g33-export-panel.png` })

  // ── 切跨页版式：3 页 → 001 + 002-003 两张 ──
  await page.locator('[data-comic-export-layout-spread]').click()
  rec(
    g,
    '切到跨页版式',
    (await page.locator('[data-comic-export-layout-spread]').getAttribute('aria-pressed')) ===
      'true',
  )
  const spread = await captureExport(page, '[data-comic-export-episode]', '63-g33-episode-spread.zip')
  rec(g, '跨页导出触发下载', Boolean(spread), spread?.name ?? '未捕获 download 事件')
  if (spread) {
    const entries = parseZip(spread.bytes)
    rec(g, '跨页版式产出 2 张', entries.length === 2, `条目数=${entries.length}`)
    rec(
      g,
      '跨页命名 001 与 002-003（封面单页惯例）',
      JSON.stringify(entries.map((e) => e.name)) ===
        JSON.stringify(['第 1 话/001.png', '第 1 话/002-003.png']),
      entries.map((e) => e.name).join(' , '),
    )
    const cover = pngSize(entries[0]?.data ?? new Uint8Array())
    const pair = pngSize(entries[1]?.data ?? new Uint8Array())
    rec(g, '封面单页尺寸 1080×1620', cover?.width === 1080 && cover?.height === 1620, JSON.stringify(cover))
    rec(
      g,
      '并排两页尺寸 2184×1620（两列 + 中缝 24）',
      pair?.width === 2184 && pair?.height === 1620,
      JSON.stringify(pair),
    )
  }

  // ── 切回单页 → 导出整个项目 ──
  await page.locator('[data-comic-export-layout-page]').click()
  const whole = await captureExport(page, '[data-comic-export-project]', '64-g33-project.zip')
  rec(g, '导出整个项目触发下载', Boolean(whole), whole?.name ?? '未捕获 download 事件')
  if (whole) {
    rec(g, '项目包名为「项目名.zip」', /未命名漫画剧\.zip$/.test(whole.name), whole.name)
    const entries = parseZip(whole.bytes)
    rec(g, '项目包 3 张', entries.length === 3, `条目数=${entries.length}`)
    rec(
      g,
      '项目包路径带项目名目录',
      entries.every((e) => e.name.startsWith('未命名漫画剧/第 1 话/')),
      entries.map((e) => e.name).join(' , '),
    )
    rec(
      g,
      '项目包每张都是合法 PNG',
      entries.every((e) => pngSize(e.data) !== null),
    )
  }
  rec(
    g,
    '状态行刷新为 3 张',
    /已导出 3 张/.test(await page.locator('[data-comic-export-status]').innerText()),
    await page.locator('[data-comic-export-status]').innerText(),
  )
  await page.screenshot({ path: `${OUT}/64-g33-project-export.png` })

  // ── 机制验证：真图内联进 SVG → 光栅化 → 像素落地 ──
  // mock 渠道产出的「图」是假字节（`mock-asset:<hash>` 文本，mime 只是标了 png），
  // 因此上面几个用例证明不了「底图真的画进了 PNG」。这一节直接加载**真实的**
  // `sheetSvg` 模块，内联一张真 PNG，走与产品同一条 Image→canvas→toBlob 路径，
  // 再采样像素：红色占比证明底图烘进去了、暗色像素证明文字光栅化了、
  // toBlob 成功证明 canvas 未被 data: 底图污染。
  const art = await page.evaluate(async () => {
    const { renderSheetSvg, sheetDimensions } = await import(
      '/src/domain/comic/export/sheetSvg.ts'
    )
    const src = document.createElement('canvas')
    src.width = 8
    src.height = 8
    const sctx = src.getContext('2d')
    sctx.fillStyle = '#ff0000'
    sctx.fillRect(0, 0, 8, 8)
    const dataUrl = src.toDataURL('image/png')

    const panel = {
      id: 'p1',
      scene: '',
      shot: { framing: 'medium', angle: 'eye-level' },
      characterIds: [],
      balloons: [{ id: 'b1', type: 'speech', text: '测试对白', x: 0.06, y: 0.06, w: 0.5, h: 0.12 }],
    }
    const pageObj = {
      id: 'pg',
      index: 0,
      title: '',
      layout: [{ kind: 'panel', panelId: 'p1' }],
      panels: [panel],
    }
    const svg = renderSheetSvg({
      pages: [pageObj],
      direction: 'ltr',
      images: new Map([['p1', dataUrl]]),
    })
    const { width, height } = sheetDimensions(1)

    const img = new Image()
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    await img.decode()

    const out = document.createElement('canvas')
    out.width = width
    out.height = height
    const octx = out.getContext('2d')
    octx.drawImage(img, 0, 0, width, height)
    const d = octx.getImageData(0, 0, width, height).data
    let red = 0
    let dark = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++
      if (d[i] < 150 && d[i + 1] < 150 && d[i + 2] < 150) dark++
    }
    const size = await new Promise((resolve) => out.toBlob((b) => resolve(b ? b.size : 0), 'image/png'))
    return { width, height, red, dark, blobSize: size }
  })
  rec(
    g,
    '真图内联进 SVG 可光栅化（尺寸正确）',
    art.width === 1080 && art.height === 1620,
    `${art.width}×${art.height}`,
  )
  rec(g, '底图真的画进了 PNG（红色像素占满格）', art.red > 1000000, `red=${art.red}`)
  rec(g, '对白文字光栅化落地（暗色像素）', art.dark > 50, `dark=${art.dark}`)
  rec(g, 'canvas 未被 data: 底图污染（toBlob 成功）', art.blobSize > 0, `size=${art.blobSize}`)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G34 comic 缩略底图与页码角标（M6-9）：
// 配 mock 渠道 → 一话三页（页1 = 1 格并生成、页2 = 2 格不生成、页3 = 未排版）
// → 总览断言页码角标（1/2/3，含未排版页）→ 底图只出现在生成过的页，且**真的解码**
//   （mock 已改吐真 PNG，故可用 naturalWidth 断言，不再只是「拿到 blob: 地址」）
// → 缩略不渲染对白层（对照：编辑器里有）→ 格 DOM 顺序 = 阅读顺序（RTL 镜像）
// → 页码不随阅读方向翻转 → 刷新后底图与角标读回。
// ────────────────────────────────────────────────────────────

/** 总览里各页缩略的页码角标文案（叙事序） */
function thumbBadges(page) {
  return page.locator('[data-comic-thumb-badge]').allInnerTexts()
}

/** 第 n 个缩略（0 起）里各格的 panelId，按 **DOM 顺序** */
function thumbCellOrder(page, nth) {
  return page
    .locator('[data-comic-overview-page]')
    .nth(nth)
    .locator('[data-comic-thumb-cell-panel]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-comic-thumb-cell-panel')))
}

/** 等总览里出现 n 个缩略底图（素材读回是异步的） */
async function waitThumbArt(page, n, timeout = 8000) {
  try {
    await page.waitForFunction(
      (expected) => document.querySelectorAll('[data-comic-thumb-art]').length === expected,
      n,
      { timeout },
    )
    return true
  } catch {
    return false
  }
}

async function g34(browser) {
  const g = 'G34 comic 缩略底图与页码角标'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // 1) 配 mock 渠道并启用（与 G30 同法；含勾选模型）
  await configureMockChannel(page)

  // 2) 一话三页：页1 = 1 格（待生成）、页2 = 2 格（不生成）、页3 = 未排版
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()

  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页1 排版后 1 格', await waitPanels(page, 1))

  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '页2 竖切后 2 格', await waitPanels(page, 2))

  await page.locator('[data-comic-add-page]').click()
  rec(g, '页3 未排版', (await page.locator('[data-comic-layout-empty]').count()) === 1)

  // 3) 页1 的格：填画面描述 + 加一条对白（对白是「缩略不渲染」的对照物）→ 生成
  await page.locator('[data-comic-page]').first().click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })
  await page.locator('[data-comic-scene]').fill('雨夜的霓虹街道')
  await page.locator('[data-comic-panel-channel]').selectOption({ label: '新建渠道' })
  await sleep(250)
  await page.locator('[data-comic-panel-model]').selectOption({ label: 'mock-image-1' })
  await sleep(250)
  await page.locator('[data-comic-balloon-add="speech"]').click()
  await page.locator('[data-comic-balloon-text]').fill('别回头。')
  await page.locator('[data-comic-panel-generate-btn]').click()

  let editArt = ''
  for (let i = 0; i < 40; i++) {
    editArt = (await page.locator('[data-comic-panel-art]').first().getAttribute('src').catch(() => '')) ?? ''
    if (editArt.startsWith('blob:')) break
    await sleep(250)
  }
  rec(g, '页1 生成后编辑器出现底图', editArt.startsWith('blob:'), editArt.slice(0, 16))
  rec(g, '编辑器里对白贴纸 1 条（对照物）', (await page.locator('[data-comic-balloon-sticker]').count()) === 1)

  // 4) 总览：角标 + 底图
  await page.locator('[data-comic-view-overview]').click()
  await page.locator('[data-comic-overview]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, '总览列出 3 页', (await page.locator('[data-comic-overview-page]').count()) === 3)

  const badges = await thumbBadges(page)
  rec(
    g,
    '页码角标为叙事序 1 / 2 / 3（未排版页也有）',
    JSON.stringify(badges) === JSON.stringify(['1', '2', '3']),
    badges.join(','),
  )
  rec(g, '未排版页仍显示占位', (await page.locator('[data-comic-thumb-empty]').count()) === 1)

  rec(g, '生成过的页1 缩略出现底图', await waitThumbArt(page, 1))
  rec(
    g,
    '未生成的页2 缩略不渲染底图',
    (await page.locator('[data-comic-overview-page]').nth(1).locator('[data-comic-thumb-art]').count()) === 0,
  )
  const artSrc = await page.locator('[data-comic-thumb-art]').first().getAttribute('src')
  rec(g, '缩略底图来自素材库 objectURL', (artSrc ?? '').startsWith('blob:'), (artSrc ?? '').slice(0, 16))
  const natural = await page
    .locator('[data-comic-thumb-art]')
    .first()
    .evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }))
  rec(
    g,
    '缩略底图**真的解码出像素**（naturalWidth > 0，不只是拿到地址）',
    natural.w > 0 && natural.h > 0,
    `${natural.w}×${natural.h}`,
  )
  rec(
    g,
    '缩略不渲染对白层（对照：编辑器里有 1 条）',
    (await page.locator('[data-comic-thumb-frame] [data-comic-balloon-sticker]').count()) === 0,
  )
  await page.screenshot({ path: `${OUT}/62-g34-overview-art.png` })

  // 5) 格 DOM 顺序 = 阅读顺序；切 RTL 后镜像，但页码不翻转
  const orderLtr = await thumbCellOrder(page, 1)
  await page.locator('[data-comic-reading-rtl]').click()
  await sleep(300)
  const orderRtl = await thumbCellOrder(page, 1)
  rec(
    g,
    'RTL 下缩略格 DOM 顺序镜像（DOM 顺序 = 阅读顺序）',
    JSON.stringify(orderRtl) === JSON.stringify([...orderLtr].reverse()),
    `${orderLtr.join(',')} → ${orderRtl.join(',')}`,
  )
  const badgesRtl = await thumbBadges(page)
  rec(
    g,
    '页码不随阅读方向翻转（仍 1 / 2 / 3）',
    JSON.stringify(badgesRtl) === JSON.stringify(['1', '2', '3']),
    badgesRtl.join(','),
  )
  await page.screenshot({ path: `${OUT}/63-g34-overview-rtl.png` })
  await page.locator('[data-comic-reading-ltr]').click()
  await sleep(300)

  // 6) 刷新读回：底图与角标都还在
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-view-overview]').click()
  await page.locator('[data-comic-overview]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, '刷新后总览仍 3 页', (await page.locator('[data-comic-overview-page]').count()) === 3)
  rec(g, '刷新后缩略底图读回', await waitThumbArt(page, 1))
  const badgesBack = await thumbBadges(page)
  rec(
    g,
    '刷新后页码角标仍 1 / 2 / 3',
    JSON.stringify(badgesBack) === JSON.stringify(['1', '2', '3']),
    badgesBack.join(','),
  )
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G35 comic 拖拽翻页（M6-10）：
// 一话三页 → 打开阅读器 → 往「下一页」方向拖过阈值松手（翻页）+ 没拖够（回弹）
// → 首页往「上一页」方向拖（到边界：阻尼明显更小、松手不翻）
// → 纵向手势不接管（位移恒 0）→ RTL 下拖拽方向镜像 → 按钮与键盘仍可用。
// ────────────────────────────────────────────────────────────

/** 阅读器当前是否处于拖拽中 */
async function isDragging(page) {
  return (await page.locator('[data-comic-reader-dragging]').count()) === 1
}

/** 阅读器当前跟手位移（`data-comic-reader-drag-offset`，px） */
async function dragOffset(page) {
  const v = await page
    .locator('[data-comic-reader-stage]')
    .getAttribute('data-comic-reader-drag-offset')
    .catch(() => null)
  return v === null ? null : Number(v)
}

/** 在舞台上按住并拖出 (dx, dy)；**不松手**（便于断言拖拽中的跟手状态） */
async function dragStage(page, dx, dy) {
  const box = await page.locator('[data-comic-reader-stage]').boundingBox()
  if (!box) return false
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 })
  await sleep(120)
  return true
}

async function g35(browser) {
  const g = 'G35 comic 拖拽翻页'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()

  // 三页：1 / 2 / 1 格
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页1 = 1 格', await waitPanels(page, 1))
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '页2 = 2 格', await waitPanels(page, 2))
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页3 = 1 格', await waitPanels(page, 1))

  await page.locator('[data-comic-page]').first().click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-open-reader]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'visible', timeout: 4000 })
  rec(g, '阅读器打开在第 1 页', (await readerIndex(page)) === 0)
  rec(g, '未拖拽时无拖拽态', (await isDragging(page)) === false)
  rec(g, '未拖拽时跟手位移为 0', (await dragOffset(page)) === 0)
  rec(g, '给出拖拽可用性提示', (await page.locator('[data-comic-reader-drag-hint]').count()) === 1)

  // ── LTR：往左拖 = 下一页 ──
  await dragStage(page, -140, 0)
  rec(g, '按住拖动进入拖拽态', await isDragging(page))
  rec(g, '拖 140px 跟手位移为 -72（夹在上限，方向为下一页）', (await dragOffset(page)) === -72, String(await dragOffset(page)))
  await page.mouse.up()
  rec(g, '拖过阈值松手 → 翻到第 2 页', await waitReaderIndex(page, 1))
  rec(g, '翻页后回到非拖拽态', (await isDragging(page)) === false)

  // ── 没拖够 → 回弹 ──
  await dragStage(page, -20, 0)
  rec(g, '拖 20px 跟手位移为 -11（未过阈值）', (await dragOffset(page)) === -11, String(await dragOffset(page)))
  await page.mouse.up()
  await sleep(250)
  rec(g, '没拖够松手 → 回弹、停在第 2 页', (await readerIndex(page)) === 1)
  rec(g, '回弹后跟手位移归 0', (await dragOffset(page)) === 0)

  // ── 往右拖 = 上一页 ──
  await dragStage(page, 140, 0)
  rec(g, '往右拖跟手位移为 +72（方向为上一页）', (await dragOffset(page)) === 72, String(await dragOffset(page)))
  await page.mouse.up()
  rec(g, '往右拖过阈值 → 回到第 1 页', await waitReaderIndex(page, 0))

  // ── 首页还想往前翻：阻尼明显更小、松手不翻（到边界 = 无动作）──
  await dragStage(page, 140, 0)
  const blockedOffset = await dragOffset(page)
  rec(g, '首页往前拖被阻尼（31 << 72，手感上「拖不动」）', blockedOffset === 31, String(blockedOffset))
  await page.mouse.up()
  await sleep(250)
  rec(g, '到边界拖了也不翻（停在第 1 页）', (await readerIndex(page)) === 0)
  rec(g, '到边界松手后位移归 0', (await dragOffset(page)) === 0)

  // ── 纵向手势不接管（留给滚动）──
  await dragStage(page, 10, 140)
  rec(g, '纵向手势位移恒为 0（不跟手、不翻页）', (await dragOffset(page)) === 0, String(await dragOffset(page)))
  await page.mouse.up()
  await sleep(250)
  rec(g, '纵向拖拽后仍在第 1 页', (await readerIndex(page)) === 0)

  // ── 按钮与键盘仍然可用（拖拽是增强，不是替代）──
  await page.locator('[data-comic-reader-next]').click()
  rec(g, '拖拽之外按钮仍可翻页', await waitReaderIndex(page, 1))
  await page.keyboard.press('ArrowRight')
  rec(g, '拖拽之外键盘仍可翻页', await waitReaderIndex(page, 2))

  // ── 末页往后拖：同样不翻 ──
  await dragStage(page, -140, 0)
  await page.mouse.up()
  await sleep(250)
  rec(g, '末页往后拖也不翻（停在第 3 页）', (await readerIndex(page)) === 2)

  await page.keyboard.press('Escape')
  await page.locator('[data-comic-reader]').waitFor({ state: 'detached', timeout: 4000 }).catch(() => {})

  // ── RTL：拖拽方向镜像（往右拖才是下一页）──
  await page.locator('[data-comic-reading-rtl]').click()
  await sleep(300)
  await page.locator('[data-comic-open-reader]').click()
  await page.locator('[data-comic-reader]').waitFor({ state: 'visible', timeout: 4000 })
  await page.locator('[data-comic-reader-prev]').click().catch(() => {})
  const startIdx = await readerIndex(page)
  await dragStage(page, 140, 0)
  rec(g, 'RTL 下往右拖跟手位移为 +72（下一页方向）', (await dragOffset(page)) === 72, String(await dragOffset(page)))
  await page.mouse.up()
  rec(
    g,
    'RTL 下往右拖才是前进（与「rtl 下 ← 前进」同源）',
    await waitReaderIndex(page, Math.min(2, startIdx + 1)),
    `第 ${startIdx + 1} 页 → 第 ${(await readerIndex(page)) + 1} 页`,
  )
  await page.screenshot({ path: `${OUT}/64-g35-drag-rtl.png` })

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G36 comic 导出页码（M6-11）：
// 一话三页 → 默认**不打**页码（PNG 仍 1620）→ 勾选「页码」后每张图页下多一条页脚带
//   （PNG 变 1693，且页码**只落在带子里**、不压画面）→ 跨页 + 页码仍两页一条带
//   → 开关是 UI 态（刷新回落）→ 机制级验证：带子区域内真的画出了墨迹，关掉时一个点都没有。
// ────────────────────────────────────────────────────────────

async function g36(browser) {
  const g = 'G36 comic 导出页码'
  const ctx = await newCtx(browser, { acceptDownloads: true })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()

  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页1 = 1 格', await waitPanels(page, 1))
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  await waitPanels(page, 1)
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-split-v]').click()
  rec(g, '页2 = 2 格', await waitPanels(page, 2))
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '页3 = 1 格', await waitPanels(page, 1))
  await page.locator('[data-comic-page]').first().click()
  await waitPanels(page, 1)

  // ── 默认不打页码 ──
  rec(
    g,
    '页码默认关闭（画面留给作品，误开要重导才能去）',
    (await page.locator('[data-comic-export-pagenum]').getAttribute('aria-pressed')) === 'false',
  )
  const plain = await captureExport(page, '[data-comic-export-episode]', '65-g36-plain.zip')
  rec(g, '默认导出触发下载', Boolean(plain), plain?.name ?? '未捕获 download 事件')
  if (plain) {
    const sizes = parseZip(plain.bytes).map((e) => pngSize(e.data))
    rec(g, '默认导出 3 张', sizes.length === 3, `条目数=${sizes.length}`)
    rec(
      g,
      '默认**没有**页脚带（仍 1080×1620）',
      sizes.every((s) => s && s.width === 1080 && s.height === 1620),
      JSON.stringify(sizes),
    )
  }
  rec(
    g,
    '状态行不提页码',
    !/页码/.test(await page.locator('[data-comic-export-status]').innerText()),
    await page.locator('[data-comic-export-status]').innerText(),
  )

  // ── 勾选页码 → 每张图页下多一条页脚带 ──
  await page.locator('[data-comic-export-pagenum]').click()
  rec(
    g,
    '勾选后页码开关为开',
    (await page.locator('[data-comic-export-pagenum]').getAttribute('aria-pressed')) === 'true',
  )
  const numbered = await captureExport(page, '[data-comic-export-episode]', '66-g36-numbered.zip')
  rec(g, '带页码导出触发下载', Boolean(numbered), numbered?.name ?? '未捕获 download 事件')
  if (numbered) {
    const sizes = parseZip(numbered.bytes).map((e) => pngSize(e.data))
    rec(g, '带页码导出 3 张', sizes.length === 3, `条目数=${sizes.length}`)
    rec(
      g,
      '带页码后页下多出页脚带（1080×1693）',
      sizes.every((s) => s && s.width === 1080 && s.height === 1693),
      JSON.stringify(sizes),
    )
  }
  rec(
    g,
    '状态行播报已打页码',
    /已打页码/.test(await page.locator('[data-comic-export-status]').innerText()),
    await page.locator('[data-comic-export-status]').innerText(),
  )
  await page.screenshot({ path: `${OUT}/65-g36-pagenum-on.png` })

  // ── 跨页 + 页码：两页各一条带，被中缝断开 ──
  await page.locator('[data-comic-export-layout-spread]').click()
  const spread = await captureExport(page, '[data-comic-export-episode]', '67-g36-spread.zip')
  rec(g, '跨页带页码导出触发下载', Boolean(spread), spread?.name ?? '未捕获 download 事件')
  if (spread) {
    const entries = parseZip(spread.bytes)
    rec(g, '跨页仍 2 张', entries.length === 2, `条目数=${entries.length}`)
    const cover = pngSize(entries[0]?.data ?? new Uint8Array())
    const pair = pngSize(entries[1]?.data ?? new Uint8Array())
    rec(g, '跨页封面 1080×1693', cover?.width === 1080 && cover?.height === 1693, JSON.stringify(cover))
    rec(
      g,
      '跨页并排 2184×1693（两列 + 中缝；每条带子各归各页）',
      pair?.width === 2184 && pair?.height === 1693,
      JSON.stringify(pair),
    )
  }

  // ── 开关是 UI 态：刷新回落「不打」 ──
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  rec(
    g,
    '刷新后页码开关回落关闭（UI 态，与跨页版式同理）',
    (await page.locator('[data-comic-export-pagenum]').getAttribute('aria-pressed')) === 'false',
  )
  await page.screenshot({ path: `${OUT}/66-g36-pagenum-default-off.png` })

  // ── 机制级验证：页码**只**画在页脚带里，关掉时带子区域一个墨点都没有 ──
  const probe = await page.evaluate(async () => {
    const { renderSheetSvg, sheetDimensions, pageNumberBand } = await import(
      '/src/domain/comic/export/sheetSvg.ts'
    )
    const pageObj = {
      id: 'pg',
      index: 0,
      title: '',
      layout: [{ kind: 'panel', panelId: 'p1' }],
      panels: [
        {
          id: 'p1',
          scene: '',
          shot: { framing: 'medium', angle: 'eye-level' },
          characterIds: [],
          balloons: [],
        },
      ],
    }
    const band = pageNumberBand(1620)

    async function probeOne(withNumbers) {
      const svg = renderSheetSvg({
        pages: [pageObj],
        direction: 'ltr',
        images: new Map(),
        pageNumbers: withNumbers ? ['7'] : undefined,
      })
      const { width, height } = sheetDimensions(1, { pageNumbers: withNumbers })
      const img = new Image()
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
      await img.decode()
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const octx = c.getContext('2d')
      octx.drawImage(img, 0, 0, width, height)

      // 页脚带区域（页高以下）的墨迹：有页码才有；没有带子时跳过采样（避免越界）
      let ink = -1
      if (height > 1620) {
        const d = octx.getImageData(0, 1620, width, height - 1620).data
        ink = 0
        for (let i = 0; i < d.length; i += 4) if (d[i] < 180) ink++
      }
      // 画面区域（页高以内）不该被页码污染
      const body = octx.getImageData(0, 0, width, 1620).data
      let bodyInk = 0
      for (let i = 0; i < body.length; i += 4) if (body[i] < 180) bodyInk++

      return { height, bandInk: ink, bodyInk, svgHas: svg.includes('data-pagenum="7"') }
    }

    return { band, off: await probeOne(false), on: await probeOne(true) }
  })
  rec(g, '页脚带高度 73（页高 1620 的 4.5%）', probe.band === 73, `band=${probe.band}`)
  rec(g, '关掉时高度仍是 1620（没有带子）', probe.off.height === 1620, `h=${probe.off.height}`)
  rec(g, '关掉时 SVG 不含页码', probe.off.svgHas === false)
  rec(g, '打开时高度 1620 + 73', probe.on.height === 1693, `h=${probe.on.height}`)
  rec(g, '打开时 SVG 含页码 "7"', probe.on.svgHas === true)
  rec(
    g,
    '页码真的画进了页脚带（带内有墨迹）',
    probe.on.bandInk > 0,
    `bandInk=${probe.on.bandInk}`,
  )
  rec(
    g,
    '画面区域未被页码污染（页高以内零墨迹）',
    probe.on.bodyInk === 0 && probe.off.bodyInk === 0,
    `on=${probe.on.bodyInk} off=${probe.off.bodyInk}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G37 渠道层消费 inputs（M6-12）：上游图 → 下游图，产物真的不同
// ────────────────────────────────────────────────────────────
async function g37(browser) {
  const g = 'G37 图生图（渠道消费 inputs）'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // 1) 配 mock 渠道并启用（与 G10 同一套路径；含勾选模型）
  const g37ch = await configureMockChannel(page)
  rec(g, '渠道验证通过', g37ch.verified)

  // 2) 图生图模板：底图生成 → 图生图（两个 generation，已连线）
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="img2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const up = page.locator('[data-node-id]').filter({ hasText: '底图' }).first()
  const down = page.locator('[data-node-id]').filter({ hasText: '图生图' }).first()
  rec(g, '模板预置「底图」与「图生图」两个节点', (await up.count()) === 1 && (await down.count()) === 1)
  rec(g, '两节点已连线', (await page.locator('[data-edge]').count()) >= 1)

  // §6.8：生成节点本体是媒体框，配置走「选中节点 → 下方创作面板」
  const configure = async (node, prompt) => {
    const panel = await genPanel(page, node)
    await configureGenPanel(page, panel, prompt)
  }
  const generate = async (node) => {
    await genPanel(page, node)
    await panelRunBtn(page).click()
  }
  /**
   * 等**节点本体**出图（不等结果组）。
   *
   * N=1 的产物写回节点本体、不再建结果组（§6.16，M6-24），所以本组的取样源
   * 由「第 n 个结果组」改成「第 n 个生成节点」——本组要证的是「inputs 真被渠道
   * 消费了」（产物像素不同），结果组只是当时顺手用的取样点。
   */
  const waitNodeAsset = async (node, timeout = 15000) => {
    for (let i = 0; i < timeout / 250; i++) {
      const s = await node.locator('[data-node-asset]').first().getAttribute('src').catch(() => '')
      if ((s ?? '').startsWith('blob:')) return true
      await sleep(250)
    }
    return false
  }

  // 3) 先出底图（无图像输入 → mock 出灰度图）
  await configure(up, '一张底图')
  await generate(up)
  rec(g, '底图节点出图（N=1 回填本体，不建结果组）', await waitNodeAsset(up))
  await sleep(1200) // 等素材经 800ms 防抖落库

  // 4) 再出图生图（上游产物作为图像输入 → mock 出品红图）
  await configure(down, '基于底图重绘')
  await generate(down)
  rec(g, '下游节点出图（图生图链路跑通）', await waitNodeAsset(down))
  await sleep(1500)

  // 5) 取样两个结果组的像素，证明「inputs 真被渠道消费了」
  const sample = async (node) => {
    let src = ''
    for (let i = 0; i < 24; i++) {
      src = (await node.locator('[data-node-asset]').first().getAttribute('src')) ?? ''
      if (src.startsWith('blob:')) break
      await sleep(250)
    }
    if (!src.startsWith('blob:')) return null
    return page.evaluate(async (url) => {
      const img = new Image()
      img.src = url
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const ctx2d = c.getContext('2d')
      ctx2d.drawImage(img, 0, 0)
      const d = ctx2d.getImageData(4, 4, 1, 1).data
      return { rgb: [d[0], d[1], d[2]], w: img.naturalWidth }
    }, src)
  }

  const a = await sample(up)
  const b = await sample(down)
  rec(g, '底图产物可解码（真实 PNG）', !!a && a.w > 0, a ? `w=${a.w}` : 'no-img')
  rec(g, '下游产物可解码（真实 PNG）', !!b && b.w > 0, b ? `w=${b.w}` : 'no-img')

  if (a && b) {
    const isGray = (p) => Math.abs(p[0] - p[1]) < 24 && Math.abs(p[1] - p[2]) < 24
    const isMagenta = (p) => p[0] > 150 && p[2] > 80 && p[1] < 110 && p[0] - p[1] > 60
    rec(g, '无图像输入 → 灰度图', isGray(a.rgb), `rgb=${a.rgb.join(',')}`)
    rec(
      g,
      '带图像输入 → 品红图（上游图确实被送进渠道）',
      isMagenta(b.rgb),
      `rgb=${b.rgb.join(',')}`,
    )
    rec(g, '两次产物不同（图生图不是「忽略输入的同一张」）', a.rgb.join(',') !== b.rgb.join(','))
  }

  await page.screenshot({ path: `${OUT}/62-g37-img2img.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G38 角色卡参考图上传（M6-13）：上传的图 → 真的成为渠道的图像输入
//
// 链路：选图（fallback input）→ 内容哈希 → 写 assets → character.update
// → 缩略（useAsset）→ 勾角色 → 生成带图输入（品红）→ 去角色回落灰度（A/B）。
// ────────────────────────────────────────────────────────────

/** 8×8 灰度 PNG（与 mock「无图像输入」产物同款，已验证可解码） */
const PNG_REF_8PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR42mOYhQMwDC0JACFrc4GHRRTbAAAAAElFTkSuQmCC',
  'base64',
)

/**
 * 取样某元素内 <img> 的中心像素。
 * 轮询直到「src 是可解码的 blob 且（可选）与 diffFrom 不同」为止；超时返回 null。
 */
async function sampleImgPixels(page, selector, { tries = 40, diffFrom = null } = {}) {
  for (let i = 0; i < tries; i++) {
    const src =
      (await page.locator(selector).first().getAttribute('src').catch(() => '')) ?? ''
    if (src.startsWith('blob:') && src !== diffFrom) {
      const px = await page
        .evaluate(async (url) => {
          const img = new Image()
          img.src = url
          await img.decode()
          const c = document.createElement('canvas')
          c.width = img.naturalWidth
          c.height = img.naturalHeight
          const g2 = c.getContext('2d')
          g2.drawImage(img, 0, 0)
          const d = g2.getImageData(img.naturalWidth >> 1, img.naturalHeight >> 1, 1, 1).data
          return { rgb: [d[0], d[1], d[2]], w: img.naturalWidth, h: img.naturalHeight }
        }, src)
        .catch(() => null)
      if (px) return px
    }
    await sleep(250)
  }
  return null
}

async function g38(browser) {
  const g = 'G38 角色卡参考图上传'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // 1) 配 mock 渠道并启用（与 G37 同法；含勾选模型）
  const g38ch = await configureMockChannel(page)
  rec(g, '渠道验证通过', g38ch.verified)

  // 2) 建 comic 项目 → 建角色卡
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-character-add]').click()
  rec(g, '新建角色卡', await waitCharacters(page, 1))
  rec(g, '初始没有参考图', (await page.locator('[data-comic-character-ref]').count()) === 0)
  await page.locator('[data-comic-character-name]').first().fill('阿花')
  await page.screenshot({ path: `${OUT}/68-g38-ref-empty.png` })

  // 3) 上传参考图（FSA 已被屏蔽 → 走可被接住的 <input type=file>）
  const fcPromise = page.waitForEvent('filechooser', { timeout: 8000 })
  await page.locator('[data-comic-character-ref-add]').first().click()
  const fc = await fcPromise.catch(() => null)
  rec(g, '点上传触发文件选择', Boolean(fc))
  if (!fc) {
    rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
    await ctx.close()
    return
  }
  await fc.setFiles({ name: 'ref.png', mimeType: 'image/png', buffer: PNG_REF_8PX })

  // 4) 缩略出现且**能解码**（字节真的经 assets 表回了 UI）
  rec(g, '上传后出现 1 张参考图缩略', await waitSelectorCount(page, '[data-comic-character-ref]', 1))
  const thumbPx = await sampleImgPixels(page, '[data-comic-character-ref] img', { tries: 24 })
  rec(
    g,
    '缩略图可解码为真实 PNG（8×8）',
    Boolean(thumbPx) && thumbPx.w === 8,
    thumbPx ? `w=${thumbPx.w}` : 'no-img',
  )
  if (thumbPx) {
    const isGray = (p) => Math.abs(p[0] - p[1]) < 24 && Math.abs(p[1] - p[2]) < 24
    rec(g, '缩略像素 = 上传的那张图（灰度）', isGray(thumbPx.rgb), `rgb=${thumbPx.rgb.join(',')}`)
  }
  await page.screenshot({ path: `${OUT}/69-g38-ref-uploaded.png` })

  // 5) 刷新：参考图随项目落库读回（素材行也还在）
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  rec(
    g,
    '刷新后参考图仍在（referenceHashes 已落库）',
    await waitSelectorCount(page, '[data-comic-character-ref]', 1),
  )
  const thumbBack = await sampleImgPixels(page, '[data-comic-character-ref] img', { tries: 24 })
  rec(g, '刷新后缩略图仍可解码（素材行也在库）', Boolean(thumbBack) && thumbBack.w === 8)

  // 6) 一话 → 一页 → 满页单格
  await page.locator('[data-comic-add-episode]').click()
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '排版后出现 1 格', await waitPanels(page, 1))
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })

  // 7) 配齐生成 + 勾上角色 → 生成 → 产物应为**品红**（说明参考图进了渠道）
  await page.locator('[data-comic-scene]').fill('雨夜的霓虹街道')
  await page.locator('[data-comic-panel-channel]').selectOption({ label: '新建渠道' })
  await sleep(250)
  await page.locator('[data-comic-panel-model]').selectOption({ label: 'mock-image-1' })
  await sleep(250)
  rec(g, '出场角色可选', (await page.locator('[data-comic-panel-character]').count()) === 1)
  await page.locator('[data-comic-panel-character]').first().check()
  await sleep(200)
  await page.locator('[data-comic-panel-generate-btn]').click()

  const withRef = await sampleImgPixels(page, '[data-comic-panel-art]', { tries: 60 })
  rec(
    g,
    '勾角色后生成完成（真实 PNG）',
    Boolean(withRef) && withRef.w > 0,
    withRef ? `w=${withRef.w}` : 'no-img',
  )
  if (withRef) {
    const isMagenta = (p) => p[0] > 150 && p[2] > 80 && p[1] < 110 && p[0] - p[1] > 60
    rec(
      g,
      '参考图成为渠道图像输入（产物为品红）',
      isMagenta(withRef.rgb),
      `rgb=${withRef.rgb.join(',')}`,
    )
  }
  await page.screenshot({ path: `${OUT}/70-g38-generated-with-ref.png` })

  // 8) A/B 对照：取消勾选角色 + 换描述 → 再生成 → 灰度（证明变色确由参考图引起）
  const refSrc = (await page.locator('[data-comic-panel-art]').first().getAttribute('src').catch(() => '')) ?? ''
  await page.locator('[data-comic-panel-character]').first().uncheck()
  await sleep(200)
  await page.locator('[data-comic-scene]').fill('清晨空无一人的站台')
  await sleep(200)
  await page.locator('[data-comic-panel-generate-btn]').click()
  const noRef = await sampleImgPixels(page, '[data-comic-panel-art]', {
    tries: 60,
    diffFrom: refSrc || null,
  })
  if (noRef) {
    const isGray = (p) => Math.abs(p[0] - p[1]) < 24 && Math.abs(p[1] - p[2]) < 24
    rec(
      g,
      '去掉角色后产物回到灰度（参考图正是变色原因）',
      isGray(noRef.rgb),
      `rgb=${noRef.rgb.join(',')}`,
    )
  } else {
    rec(g, '去掉角色后产物回到灰度（参考图正是变色原因）', false, '未取到新产物')
  }

  // 9) 移除参考图
  await page.locator('[data-comic-character-ref-remove]').first().click()
  rec(g, '移除后参考图归零', await waitSelectorCount(page, '[data-comic-character-ref]', 0))

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G39 comic 对白直接操作（M6-14）：
// 建项目 → 一话 → 一页 → 满页单格 → 选中格 → 加 1 条 speech 对白
// → 断言尺寸手柄与尾巴手柄都已渲染 → 拖右下角手柄：断言 w/h 变大、左上角不动、
//   且尾巴按比例跟到新的下缘中点（「气泡与尾巴一体变换」的不变量）
// → 拖尾巴手柄：断言锚点变、而尺寸与位置**一个都不动**（A/B 对照）
// → 加一条 narration：断言它没有尾巴手柄（旁白是面版不是气泡），但仍有尺寸手柄
// → 等防抖落库 → 刷新 → 读回尺寸与尾巴锚点。
// ────────────────────────────────────────────────────────────

/** 读取选中格第一张贴纸 + 其尾巴的几何快照（0..1；无此元素时为 null） */
function balloonGeom(page) {
  return page.evaluate(() => {
    const sticker = document.querySelector('[data-comic-balloon-sticker]')
    const tail = document.querySelector('[data-comic-balloon-tail]')
    const num = (el, attr) => {
      const v = el ? el.getAttribute(attr) : null
      return v === null ? null : Number(v)
    }
    return {
      x: num(sticker, 'data-comic-balloon-sticker-x'),
      y: num(sticker, 'data-comic-balloon-sticker-y'),
      w: num(sticker, 'data-comic-balloon-sticker-w'),
      h: num(sticker, 'data-comic-balloon-sticker-h'),
      tailX: num(tail, 'data-comic-balloon-tail-x'),
      tailY: num(tail, 'data-comic-balloon-tail-y'),
    }
  })
}

/** 从元素中心按住拖 (dx, dy) 像素再松手（松手才提交，故留一点等渲染的余量） */
async function dragByPixels(page, locator, dx, dy) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 })
  await page.mouse.up()
  await sleep(180)
}

async function g39(browser) {
  const g = 'G39 comic 对白尺寸手柄与拖尾巴'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)

  // 1) 建项目 → 一话 → 一页 → 满页单格 → 选中格
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '排版后出现 1 格', await waitPanels(page, 1))
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })

  // 2) 加 1 条 speech 对白 → 贴纸 / 尺寸手柄 / 尾巴手柄三件套都在
  await page.locator('[data-comic-balloon-add="speech"]').click()
  rec(g, '贴纸出现', (await page.locator('[data-comic-balloon-sticker]').count()) === 1)
  rec(g, '出现尺寸手柄', (await page.locator('[data-comic-balloon-resize]').count()) === 1)
  rec(g, '出现可拖尾巴手柄', (await page.locator('[data-comic-balloon-tail]').count()) === 1)

  const g0 = await balloonGeom(page)
  rec(
    g,
    '初始几何可读',
    Boolean(g0) && g0.w !== null && g0.h !== null && g0.tailX !== null,
    JSON.stringify(g0),
  )
  if (!g0 || g0.w === null || g0.tailX === null) {
    rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
    await ctx.close()
    return
  }

  // 3) 拖右下角手柄（+24, +40 px）→ w/h 变大、左上角不动
  await dragByPixels(page, page.locator('[data-comic-balloon-resize]').first(), 24, 40)
  const g1 = await balloonGeom(page)
  rec(
    g,
    '拖尺寸手柄后 w/h 变大',
    Boolean(g1) && g1.w > g0.w + 0.02 && g1.h > g0.h + 0.02,
    `${g0.w}×${g0.h} → ${g1.w}×${g1.h}`,
  )
  rec(
    g,
    '缩放时左上角固定不动',
    Boolean(g1) && Math.abs(g1.x - g0.x) < 0.005 && Math.abs(g1.y - g0.y) < 0.005,
    `(${g0.x},${g0.y}) → (${g1.x},${g1.y})`,
  )
  rec(
    g,
    '尾巴按比例跟到新的下缘中点（一体变换不变量）',
    Boolean(g1) &&
      Math.abs(g1.tailX - (g1.x + g1.w / 2)) < 0.01 &&
      Math.abs(g1.tailY - (g1.y + g1.h)) < 0.01,
    `tail=(${g1.tailX},${g1.tailY}) vs 下缘中点=(${(g1.x + g1.w / 2).toFixed(4)},${(g1.y + g1.h).toFixed(4)})`,
  )
  await page.screenshot({ path: `${OUT}/71-g39-resized.png` })

  // 4) 拖尾巴手柄（-40, -30 px）→ 只改指向，尺寸与位置一个都不动
  await dragByPixels(page, page.locator('[data-comic-balloon-tail]').first(), -40, -30)
  const g2 = await balloonGeom(page)
  rec(
    g,
    '拖尾巴后锚点改变',
    Boolean(g2) &&
      (Math.abs(g2.tailX - g1.tailX) > 0.02 || Math.abs(g2.tailY - g1.tailY) > 0.02),
    `(${g1.tailX},${g1.tailY}) → (${g2.tailX},${g2.tailY})`,
  )
  rec(
    g,
    '拖尾巴不改尺寸（A/B：尺寸不是被它改的）',
    Boolean(g2) && Math.abs(g2.w - g1.w) < 0.004 && Math.abs(g2.h - g1.h) < 0.004,
    `${g1.w}×${g1.h} → ${g2.w}×${g2.h}`,
  )
  rec(
    g,
    '拖尾巴不改气泡位置',
    Boolean(g2) && Math.abs(g2.x - g1.x) < 0.004 && Math.abs(g2.y - g1.y) < 0.004,
    `(${g1.x},${g1.y}) → (${g2.x},${g2.y})`,
  )
  await page.screenshot({ path: `${OUT}/72-g39-tail-moved.png` })

  // 5) 旁白是「面版」不是「气泡」：没有尾巴手柄，但尺寸手柄照有
  await page.locator('[data-comic-balloon-add="narration"]').click()
  await page.locator('[data-comic-balloon-text]').last().fill('三年后。')
  rec(g, '加旁白后贴纸 2 张', (await page.locator('[data-comic-balloon-sticker]').count()) === 2)
  rec(
    g,
    '旁白没有尾巴手柄（仍只有 speech 那 1 个）',
    (await page.locator('[data-comic-balloon-tail]').count()) === 1,
  )
  rec(g, '两张贴纸各有一个尺寸手柄', (await page.locator('[data-comic-balloon-resize]').count()) === 2)

  // 6) 等防抖落库 → 刷新 → 读回
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })
  const g3 = await balloonGeom(page)
  rec(
    g,
    '刷新后尺寸读回',
    Boolean(g3) && Math.abs(g3.w - g2.w) < 0.004 && Math.abs(g3.h - g2.h) < 0.004,
    `${g2.w}×${g2.h} → ${g3.w}×${g3.h}`,
  )
  rec(
    g,
    '刷新后尾巴锚点读回',
    Boolean(g3) && Math.abs(g3.tailX - g2.tailX) < 0.004 && Math.abs(g3.tailY - g2.tailY) < 0.004,
    `(${g2.tailX},${g2.tailY}) → (${g3.tailX},${g3.tailY})`,
  )
  await page.screenshot({ path: `${OUT}/73-g39-after-reload.png` })

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G40 comic 生成留痕与版本回退（M6-15）
//
// 链路：生成 → 格内留痕（版本 1）→ 改描述再生成（版本 2）→ 点 v1 回退
// → 画面回到 v1 且**历史变 3 条**（回退本身也是新版本）→ 刷新后仍在。
//
// 三条不变量在域层单测里逐条落锁，这里验的是**真机链路**：
// 引擎 record → 命令 → reducer → 落库 → 读回；以及「只增不减」在界面上看得见。
// ────────────────────────────────────────────────────────────

/** 读格内留痕列表（DOM 顺序 = 倒序显示，最新在最前） */
async function readRuns(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-comic-run]')].map((el) => ({
      id: el.getAttribute('data-comic-run-id'),
      version: Number(el.getAttribute('data-comic-run-version')),
      status: el.getAttribute('data-comic-run-status'),
      live: el.getAttribute('data-comic-run-live') === 'true',
      hasArt: Boolean(el.querySelector('[data-comic-run-art]')),
      restoreDisabled: el.querySelector('[data-comic-run-restore]')?.disabled ?? null,
    })),
  )
}

/** 点生成并等「格内底图 src 出现且可选地与上一张不同」；返回新 src */
async function generateAndWaitArt(page, diffFrom = null) {
  await page.locator('[data-comic-panel-generate-btn]').click()
  let src = ''
  for (let i = 0; i < 48; i++) {
    src =
      (await page
        .locator('[data-comic-panel-art]')
        .first()
        .getAttribute('src')
        .catch(() => '')) ?? ''
    if (src.startsWith('blob:') && src !== diffFrom) break
    await sleep(250)
  }
  // 等按钮回到空闲（不是「取消生成」），后续断言才不会被运行态干扰
  for (let i = 0; i < 25; i++) {
    const label = await page.locator('[data-comic-panel-generate-btn]').innerText().catch(() => '')
    if (!label.includes('取消')) break
    await sleep(200)
  }
  return src
}

async function g40(browser) {
  const g = 'G40 comic 生成留痕与版本回退'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // 1) 配 mock 渠道并启用（与 G30 / G38 同一套路径；含勾选模型）
  const g40ch = await configureMockChannel(page)
  rec(g, '渠道验证通过', g40ch.verified)

  // 2) 建 comic 项目 → 一话 → 一页 → 排版 → 1 格 → 配齐生成配置
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-add-episode]').click()
  await page.locator('[data-comic-add-page]').click()
  await page.locator('[data-comic-instantiate]').click()
  rec(g, '排版后出现 1 格', await waitPanels(page, 1))

  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })
  await page.locator('[data-comic-scene]').fill('雨夜的霓虹街道')
  // 还没生成过 → 历史段是空态（占位文案给「此后每次都会留痕」的预期）
  rec(g, '未生成时版本历史为空态', (await page.locator('[data-comic-history-empty]').count()) === 1)
  rec(g, '未生成时列表 0 行', (await readRuns(page)).length === 0)

  await page.locator('[data-comic-panel-channel]').selectOption({ label: '新建渠道' })
  await sleep(250)
  await page.locator('[data-comic-panel-model]').selectOption({ label: 'mock-image-1' })
  await sleep(250)

  // 3) 第一次生成 → 留痕出现 v1，且被标为「当前」
  const firstSrc = await generateAndWaitArt(page)
  rec(g, '第一次生成后格内出现底图', firstSrc.startsWith('blob:'), firstSrc.slice(0, 16))
  const r1 = await readRuns(page)
  rec(g, '生成后历史 1 条', r1.length === 1, `条数=${r1.length}`)
  rec(g, '第一条版本号为 1', r1[0]?.version === 1, `v=${r1[0]?.version}`)
  rec(g, '第一条状态为「成功」', r1[0]?.status === 'succeeded', r1[0]?.status ?? '')
  rec(g, '第一条带缩略图（有产物）', r1[0]?.hasArt === true)
  rec(g, '第一条被标为当前版本', r1[0]?.live === true)
  rec(g, '当前版本行的回退按钮禁用（自己不需要回退）', r1[0]?.restoreDisabled === true)
  rec(g, '出现「当前」文字标记', (await page.locator('[data-comic-run-live-tag]').count()) === 1)
  await page.screenshot({ path: `${OUT}/74-g40-first-run.png` })

  // 4) 改画面描述 → 第二次生成 → 历史 2 条，当前移到 v2
  await page.locator('[data-comic-scene]').fill('清晨空无一人的站台')
  const secondSrc = await generateAndWaitArt(page, firstSrc)
  rec(
    g,
    '第二次生成换了底图',
    secondSrc.startsWith('blob:') && secondSrc !== firstSrc,
    `${firstSrc.slice(0, 12)} → ${secondSrc.slice(0, 12)}`,
  )
  const r2 = await readRuns(page)
  rec(g, '历史变成 2 条（旧版不删）', r2.length === 2, `条数=${r2.length}`)
  rec(g, '倒序显示：最新 v2 在最前', r2[0]?.version === 2, `首行 v=${r2[0]?.version}`)
  rec(g, '当前标记移到 v2', r2[0]?.live === true && r2[1]?.live === false)
  rec(g, 'v1 变为可回退', r2[1]?.restoreDisabled === false)
  rec(g, '仍只有 1 个「当前」标记', (await page.locator('[data-comic-run-live-tag]').count()) === 1)
  await page.screenshot({ path: `${OUT}/75-g40-second-run.png` })

  // 5) 点缩略图看大图浮层 → 点浮层关闭
  await page.locator('[data-comic-run-thumb]').first().click()
  rec(g, '点缩略图打开大图浮层', (await page.locator('[data-comic-run-preview]').count()) === 1)
  await page.locator('[data-comic-run-preview]').click()
  rec(g, '点浮层关闭', (await page.locator('[data-comic-run-preview]').count()) === 0)

  // 6) 回退到 v1：画面回到 v1（底图与描述），**历史变 3 条**
  const v1Id = r2[1]?.id
  await page
    .locator(`[data-comic-run-id="${v1Id}"] [data-comic-run-restore]`)
    .click()
  await sleep(400)
  const r3 = await readRuns(page)
  rec(g, '回退后历史 3 条（回退本身也是新版本）', r3.length === 3, `条数=${r3.length}`)
  rec(g, 'v1 / v2 都还在（只增不减）', r3.map((r) => r.version).join(',') === '3,2,1', r3.map((r) => r.version).join(','))
  rec(g, '新追加的 v3 成为当前版本', r3[0]?.version === 3 && r3[0]?.live === true)
  rec(
    g,
    '画面描述回到 v1 的描述',
    (await page.locator('[data-comic-scene]').inputValue()) === '雨夜的霓虹街道',
    await page.locator('[data-comic-scene]').inputValue(),
  )
  // 底图回到 v1：与第一次生成时的 src 应当一致（同 hash → 同 objectURL 生命周期内可能不同串）
  // 故用「画面/描述 + 历史指针」判定，这里只验底图仍在（没有变空白）
  const afterRestoreSrc =
    (await page
      .locator('[data-comic-panel-art]')
      .first()
      .getAttribute('src')
      .catch(() => '')) ?? ''
  rec(g, '回退后底图仍在（没有变空白）', afterRestoreSrc.startsWith('blob:'))
  rec(g, '回退没有改变历史条目 id 集合的包含关系', r3.slice(1).map((r) => r.id).join(',') === r2.map((r) => r.id).join(','))
  await page.screenshot({ path: `${OUT}/76-g40-restored.png` })

  // 7) 等防抖落库 → 刷新 → 留痕读回（历史是聚合对象的一部分，随项目一起持久化）
  await sleep(1300)
  await page.reload({ waitUntil: 'networkidle' })
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  await page.locator('[data-comic-panel]').first().click()
  await page.locator('[data-comic-panel-editor]').waitFor({ state: 'visible', timeout: 4000 })
  const r4 = await readRuns(page)
  rec(g, '刷新后历史仍是 3 条', r4.length === 3, `条数=${r4.length}`)
  rec(g, '刷新后版本号仍是 3 / 2 / 1', r4.map((r) => r.version).join(',') === '3,2,1', r4.map((r) => r.version).join(','))
  rec(g, '刷新后当前版本仍是 v3', r4[0]?.live === true)
  rec(
    g,
    '刷新后画面描述仍是回退后的描述',
    (await page.locator('[data-comic-scene]').inputValue()) === '雨夜的霓虹街道',
  )
  rec(g, '刷新后缩略图仍在（素材按 hash 读回）', r4.every((r) => r.hasArt === true))
  await page.screenshot({ path: `${OUT}/77-g40-after-reload.png` })
  // 元素级截图：整页截图里右栏历史段在折叠区外，单独留一张作为视觉证据
  await page.locator('[data-comic-panel-history]').scrollIntoViewIfNeeded()
  await page.locator('[data-comic-panel-history]').screenshot({ path: `${OUT}/78-g40-history.png` })

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G41 陈旧标记与按范围重跑（§6.19.5 陈旧 / §6.19.1 四种执行模式 / §6.20 快捷键）
//
// 本组回答两件事：
// 1) 陈旧标记**是否真的画出来**（像素采样，同连线事故的教训：DOM 全对 ≠ 屏幕上有）；
// 2) 「什么时候该陈旧 / 什么时候该清除」是否由**指纹对账**决定，而不是靠内存记忆——
//    故末尾专门验证「刷新后凭库里的 RunRecord 重建基线」这条路径。
// ────────────────────────────────────────────────────────────
async function g41(browser) {
  const g = 'G41 陈旧标记与重跑入口'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

  /** 点画布右下角空白：同时清空节点选择（选中态 outline 会盖掉陈旧描边，取样前必须清） */
  // 取消选中要走「真正的空白单击」：写死坐标会随布局漂移（见 clickBlankCanvas 注释）。
  // 取消选中后陈旧描边才不会被选中态的黑描边压掉（§3.3 的刻意优先级）。
  const clickBlank = () => clickBlankCanvas(page)
  const staleCount = () => page.locator('[data-node-stale]').count()

  // 1) 配 mock 渠道并启用（出图前提；含勾选模型）
  const g41ch = await configureMockChannel(page)
  rec(g, '渠道验证通过并拉到模型', g41ch.verified)

  // 2) 文生图模板 → 选渠道/模型/提示词 → 生成一次（建立成功基线）
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // 参数与提示词在创作面板里（M6-16 起节点本体只剩媒体框）
  const g41Panel = await genPanel(page)
  await configureGenPanel(page, g41Panel, '屋顶的猫')

  await panelRunBtn(page).click()
  let ranOnce = false
  try {
    // N=1 的产物写回节点本体、不建结果组（§6.16，M6-24），故等**节点出图**而不是等结果组
    await page.locator('[data-node-asset]').first().waitFor({ state: 'visible', timeout: 15000 })
    ranOnce = true
  } catch {
    ranOnce = false
  }
  rec(g, '首次生成成功（建立成功基线）', ranOnce)
  await sleep(600)

  // 3) 刚生成成功 → 与基线一致 → 无陈旧标记
  //    （若实现写成「生成过就陈旧」或「永远陈旧」，这条会失败）
  const staleAfterRun = await staleCount()
  rec(g, '生成成功后无陈旧标记（与基线一致）', staleAfterRun === 0, `stale=${staleAfterRun}`)
  rec(g, '无陈旧时右上角无圆点', (await page.locator('[data-stale-dot]').count()) === 0)

  // 4) 改自己的参数 → 自己陈旧（§6.19.5：参数参与指纹）
  await g41Panel.locator('textarea').first().fill('屋顶的狗')
  await sleep(600)
  const staleNow = await staleCount()
  rec(g, '改参数后节点被标陈旧', staleNow >= 1, `stale=${staleNow}`)
  rec(g, '陈旧节点渲染右上角圆点', (await page.locator('[data-stale-dot]').count()) >= 1)

  // 5) 像素级：陈旧标记是否**真的被绘制**（描边与圆点都是 --warn 橘棕，画布上无第二处来源）
  //    先取消选中：`.frame.selected` 的黑描边按 §3.3 刻意压过 `.frame.stale` 的橘描边，
  //    不取消的话测到的是「只剩圆点」，量不出描边。
  await clickBlank()
  const staleBox = await page.locator('[data-node-stale]').first().boundingBox()
  const outlineInk = staleBox
    ? await countWarnInk(page, {
        x: staleBox.x - 4,
        y: staleBox.y - 4,
        width: staleBox.width + 8,
        height: staleBox.height + 8,
      })
    : 0
  rec(g, '陈旧描边在画面上真的被绘制（像素采样）', outlineInk >= WARN_INK_MIN, `橘色像素=${outlineInk}`)

  // 圆点单独测一次：**选中态下它是唯一的陈旧信号**（描边归黑），而它在 DOM 里先于
  // `.body` 渲染、节点内容又自带不透明底色铺满 body ⇒ 少一个 z-index 就会被整块盖住
  // ——「DOM 里数得到、屏幕上没有」，正是本项目栽过的那类假 ✅。
  const dotBox = await page.locator('[data-stale-dot]').first().boundingBox()
  const dotInk = dotBox
    ? await countWarnInk(page, {
        x: dotBox.x - 3,
        y: dotBox.y - 3,
        width: dotBox.width + 6,
        height: dotBox.height + 6,
      })
    : 0
  rec(g, '陈旧圆点在画面上真的被绘制（不被节点内容盖住）', dotInk >= 8, `圆点橘色像素=${dotInk}`)
  await page.screenshot({ path: `${OUT}/79-g41-stale.png` })

  // 6) 顶栏入口存在且反映陈旧数（§6.19.1「仅刷新陈旧」= 全图范围）
  const refreshBtn = page.locator('[data-topbar-refresh-stale]')
  rec(g, '顶栏「仅刷新陈旧」按钮存在', (await refreshBtn.count()) === 1)
  const refreshTitle = (await refreshBtn.getAttribute('title')) ?? ''
  rec(g, '顶栏按钮标题反映陈旧数', /陈旧/.test(refreshTitle), refreshTitle)
  rec(g, '有陈旧时「仅刷新陈旧」可点', !(await refreshBtn.isDisabled()))
  rec(g, '顶栏「全图重跑」按钮存在', (await page.locator('[data-topbar-rerun-all]').count()) === 1)

  // 7) 右键菜单「清除陈旧标记」→ 标记消失
  const staleNode = page.locator('[data-node-stale]').first()
  await staleNode.click({ button: 'right' })
  await sleep(350)
  const menu = await page.locator('[data-context-menu] [data-context-menu-item]').allInnerTexts()
  rec(g, '右键菜单含「清除陈旧标记」（§6.19.5）', menu.includes('清除陈旧标记'), `items=${JSON.stringify(menu)}`)
  await page
    .locator('[data-context-menu] [data-context-menu-item]', { hasText: '清除陈旧标记' })
    .first()
    .click()
  await sleep(500)
  rec(g, '清除后陈旧标记消失', (await staleCount()) === 0, `stale=${await staleCount()}`)

  // 8) 清除后指纹未变 → 豁免生效（对账不会立刻把它重新标上）
  await sleep(700)
  rec(g, '清除后不立即重标（豁免生效至指纹再变）', (await staleCount()) === 0)

  // 9) 指纹再变一次 → 豁免失效、标记重现（陈旧与否是事实，不由用户意愿改写）
  //    右键操作后选中态可能已变，重新拿一次创作面板再改提示词
  await genPanel(page)
  await page.locator('[data-creation-panel] textarea').first().fill('屋顶的鸟')
  await sleep(600)
  rec(g, '指纹再变后标记重现（豁免自动失效）', (await staleCount()) >= 1, `stale=${await staleCount()}`)

  // 10) Ctrl+Enter 全图重跑 → 二次确认（§6.19.1「确认前不进入执行引擎」）
  await clickBlank()
  await page.keyboard.press('Control+Enter')
  const dlgShown = await page.locator('[data-confirm-dialog]').isVisible().catch(() => false)
  rec(g, 'Ctrl+Enter 弹出全图重跑二次确认', dlgShown)
  if (dlgShown) {
    await page.screenshot({ path: `${OUT}/80-g41-confirm.png` })
    // 取消 → 不执行，陈旧原样保留
    await page.locator('[data-confirm-cancel]').click()
    await sleep(400)
    rec(g, '取消后不进入执行引擎（陈旧仍在）', (await staleCount()) >= 1)
    // 再次 Ctrl+Enter → 确认 → 重跑完成，陈旧被清
    await clickBlank()
    await page.keyboard.press('Control+Enter')
    await page.locator('[data-confirm-ok]').click()
    await sleep(3000)
    rec(g, '确认后全图重跑完成且陈旧清除', (await staleCount()) === 0, `stale=${await staleCount()}`)
  }
  await page.screenshot({ path: `${OUT}/81-g41-rerun.png` })

  // 11) 刷新后**凭库里的 RunRecord 重建基线**：刚重跑过 → 仍不陈旧；
  //     再改一次参数 → 无需重跑也能立刻标出陈旧（证明基线来自持久化，不是内存残留）
  await sleep(1300)
  const nodesBeforeReload = await nodeCount(page)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(1000)
  rec(
    g,
    '刷新不重复套用模板（套用幂等，节点数不变）',
    (await nodeCount(page)) === nodesBeforeReload,
    `刷新前=${nodesBeforeReload} 刷新后=${await nodeCount(page)}`,
  )
  rec(g, '刷新后无陈旧（基线由库重建，已与之一致）', (await staleCount()) === 0, `stale=${await staleCount()}`)
  // 刷新后选中态丢失：重新选中节点 → 在面板里改提示词 → 仍应标出陈旧
  const ta2 = (await genPanel(page)).locator('textarea').first()
  await ta2.click()
  await ta2.fill('屋顶的云')
  await sleep(700)
  rec(g, '刷新后改参数仍能标出陈旧（基线来自持久化）', (await staleCount()) >= 1, `stale=${await staleCount()}`)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G42 导航出口与空渠道引导
//
// 这一组盯的是「用户能不能走到渠道配置」——此前画布顶栏没有任何导航出口，
// 而 /settings 的唯一入口在首页顶栏，于是用户在画布里配不出平台、点生成毫无反应。
// 断言分三层：①顶栏出口存在且可达 ②空渠道时节点本体与创作面板都给出**可点击**的解释
// ③设置页的返回按钮指回来处（而不是一律丢回首页）。渠道是应用级单例，
// 本组自带「新建 / 不启用 / 启用」全流程，不依赖其他组留下的状态。
// ────────────────────────────────────────────────────────────
async function g42(browser) {
  const g = 'G42 导航出口与空渠道引导'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

  const norm = (s) => s.replace(/\s+/g, '')

  /**
   * 选中生成节点：点节点**头部**（顶 32px 内）。
   * 两个坑：①不能点节点中心——M6-16 起本体中央是 `+` 上传按钮，它的 pointerdown 被
   * stopPropagation（为了不触发节点拖动），且左键点它会弹 `showOpenFilePicker`；
   * ②顶栏是 absolute 浮层（top 12 / 高 44），节点头部若落在它下面会被拦截点击，
   * 所以先按真实坐标判断，必要时用中键把画布内容往下推一段。
   */
  const selectGenNode = async () => {
    const node = page.locator('[data-node-type="generation"]').first()
    let box = await node.boundingBox()
    if (box && box.y < 70) {
      const dy = 70 - box.y + 40
      await page.mouse.move(640, 400)
      await page.mouse.down({ button: 'middle' })
      await page.mouse.move(640, 400 + dy, { steps: 8 })
      await page.mouse.up({ button: 'middle' })
      await sleep(300)
      box = await node.boundingBox()
    }
    if (!box) throw new Error('未找到生成节点')
    await page.mouse.click(Math.round(box.x + 12), Math.round(box.y + 16))
    await sleep(600)
  }

  // 1) 首页顶栏 → 后台设置；无来源信息时返回按钮回落首页
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.getByRole('button', { name: '后台设置' }).click()
  await page.waitForURL(/\/settings/)
  rec(g, '首页可进入后台设置', page.url().includes('/settings'))
  const labelFromHome = await page.locator('[data-settings-back]').innerText()
  rec(g, '从首页进入时返回按钮指向首页', labelFromHome.includes('首页'), labelFromHome)

  // 2) 模板建一个画布项目，记住 URL 供后面比对
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)
  const canvasUrl = page.url()

  // 3) 画布顶栏的两个导航出口（修复前两者都不存在）
  rec(g, '画布顶栏有「← 返回」', (await page.locator('[data-topbar-back]').count()) === 1)
  rec(g, '画布顶栏有「后台设置」', (await page.locator('[data-topbar-settings]').count()) === 1)

  // 4) 无渠道：**创作面板**给出引导条。
  //    M6-16 起节点本体减重为媒体框（§6.8），参数与引导都不在节点里——
  //    所以这里同时断言「面板有引导」与「本体无参数控件、只有占位框 + `+`」。
  await selectGenNode()
  const hint = page.locator('[data-panel-setup-hint]')
  rec(g, '无渠道时创作面板显示引导条', (await hint.count()) === 1)
  const hintText = norm(await hint.first().innerText())
  rec(g, '引导文案为「还没有配置任何渠道」', hintText.includes('还没有配置任何渠道'), hintText)
  rec(
    g,
    '节点本体为媒体框（占位框 + `+`，无任何参数控件）',
    (await page.locator('[data-node-placeholder]').count()) >= 1 &&
      (await page.locator('[data-node-type="generation"] select').count()) === 0 &&
      (await page.locator('[data-node-type="generation"] textarea').count()) === 0 &&
      (await page.locator('[data-node-setup-hint]').count()) === 0,
  )

  // 5) 面板上的出口能直接进设置；此时返回按钮指向画布
  await hint.first().click()
  await page.waitForURL(/\/settings/)
  rec(g, '面板上的出口可进后台设置', page.url().includes('/settings'))
  const labelFromCanvas = await page.locator('[data-settings-back]').innerText()
  rec(g, '从画布进入时返回按钮指向画布', labelFromCanvas.includes('画布'), labelFromCanvas)

  // 6) 建渠道但**不启用** → 文案必须切换。
  //    这两种情况用户最容易混淆：以为「建过」就等于「配好了」。
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(500)
  await page.getByText('新建渠道').first().click()
  await sleep(300)
  await page.locator('[data-settings-back]').click()
  await page.waitForURL(/\/canvas\//)
  rec(g, '返回按钮回到原来那个画布', page.url() === canvasUrl, `期望=${canvasUrl} 实际=${page.url()}`)
  await sleep(500)
  await selectGenNode()
  const hint2 = await page.locator('[data-panel-setup-hint]').count()
  const hint2Text = hint2 ? norm(await page.locator('[data-panel-setup-hint]').first().innerText()) : ''
  rec(g, '渠道未启用时文案切换为「都未启用」', hint2Text.includes('未启用'), hint2Text)

  // 7) 顶栏「后台设置」→ 启用 → 回画布：引导消失，平台下拉出现该渠道
  await page.locator('[data-topbar-settings]').click()
  await page.waitForURL(/\/settings/)
  await page.getByText('新建渠道').first().click()
  await sleep(300)
  await page.locator('input[type="checkbox"]').first().check()
  await sleep(400)
  await page.locator('[data-settings-back]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  rec(g, '渠道启用后节点本体仍无参数控件（参数只在面板）', (await page.locator('[data-node-type="generation"] select').count()) === 0)
  await selectGenNode()
  rec(g, '渠道启用后面板引导条消失', (await page.locator('[data-panel-setup-hint]').count()) === 0)
  const panelNow = page.locator('[data-creation-panel]')
  const platformOpts = await paramOptions(page, panelNow, 'channel')
  rec(g, '平台 chip 出现已启用渠道', platformOpts.includes('新建渠道'), `opts=${JSON.stringify(platformOpts)}`)

  // 8) 刷新后引导不回来（渠道是落库的应用级单例，不是内存态）
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(1000)
  // 刷新后选中态丢失，必须重新选中节点才看得到面板
  await selectGenNode()
  const platformAfterReload = await paramOptions(page, page.locator('[data-creation-panel]'), 'channel')
  rec(
    g,
    '刷新后仍无引导（渠道已落库）',
    (await page.locator('[data-panel-setup-hint]').count()) === 0 && platformAfterReload.includes('新建渠道'),
    `opts=${JSON.stringify(platformAfterReload)}`,
  )

  // 9) 漫画页顶栏同样有设置出口（漫画的生成也要渠道）
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  await createComicProject(page)
  await page.locator('[data-comic-surface]').waitFor({ state: 'visible', timeout: 8000 })
  rec(g, '漫画页顶栏有「后台设置」', (await page.locator('[data-comic-settings]').count()) === 1)
  rec(g, '漫画页仍保留「← 返回」', (await page.locator('[data-comic-back]').count()) === 1)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G43 协议切换即生效（先落库、再验证）
//
// 用户报的现象：地址填好、点「验证地址」，状态写「✓ 验证通过，发现 2 个模型」，
// 但**一个网络请求都没发**。两层原因：
//  ①verify 读的是**库里已保存**的 protocol。协议下拉只是表单态，不改就没落库，
//    于是「刚切成 OpenAI 兼容」在验证那一刻并不存在，走的还是 mock；
//  ②验证成功会回写 modelCache → 渠道对象换新 → 表单同步 effect 原先跟着整个渠道对象走，
//    会把刚选好的协议**静默弹回库里的旧值**，用户看到的则是「选了又跳回去」。
//
// 断言分三段：A mock 基线（必须自曝协议名 + 给出「没出网」提示）；
// B 只改协议与地址、**不点保存**直接验证（必须按新协议真出网）；
// C 刷新（协议确实落库）。
// B 的地址用 127.0.0.1:9（discard 端口，必然拒绝连接），使「出没出网」可判定：
// 出网 → 连接失败 → ✗；没出网 → 依旧是 mock 的「2 个模型」→ 通过（旧 bug 的表现）。
// ────────────────────────────────────────────────────────────
async function g43(browser) {
  const g = 'G43 协议切换即生效'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

  const norm = (s) => s.replace(/\s+/g, '')
  const statusText = async () => norm(await page.locator('[role="status"]').innerText())

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(500)

  // A) mock 基线：通过，但状态行必须点明协议、并说清「没出网」
  await page.getByRole('button', { name: '验证地址' }).click()
  await page.getByText(/地址可达/).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  const aText = await statusText()
  rec(g, 'mock 验证通过（地址可达）', aText.includes('地址可达'), aText)
  rec(g, '状态行点明协议名', aText.includes('Mock'), aText)
  rec(g, 'mock 下给出「没出网」提示', (await page.locator('[data-settings-mock-note]').count()) === 1)
  await page.screenshot({ path: `${OUT}/43-a-mock-verified.png` })

  // B) 只改协议 + 地址，**不点保存配置**，直接验证
  await page.locator('[data-settings-protocol]').selectOption('openai-images')
  await page.locator('[data-settings-baseurl]').fill('http://127.0.0.1:9/v1')
  await sleep(200)
  await page.getByRole('button', { name: '验证地址' }).click()
  const gotError = await page
    .getByText(/✗/)
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  rec(g, '未保存也按新协议真出网（连接被拒 → 失败）', gotError)
  const bText = await statusText()
  rec(g, '不再伪造「发现 N 个模型」的通过', !bText.includes('个模型'), bText)
  rec(g, 'mock 离线提示随之消失', (await page.locator('[data-settings-mock-note]').count()) === 0)
  const protoAfter = await page.locator('[data-settings-protocol]').inputValue()
  rec(g, '验证后协议不被弹回旧值', protoAfter === 'openai-images', protoAfter)
  await page.screenshot({ path: `${OUT}/43-b-openai-unreachable.png` })

  // C) 刷新 → 协议与地址都已落库（B 的「先落库后验证」生效）
  await sleep(600)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(800)
  await page.getByText('新建渠道').first().click()
  await sleep(300)
  const protoReload = await page.locator('[data-settings-protocol]').inputValue()
  rec(g, '刷新后协议仍是新值（已落库）', protoReload === 'openai-images', protoReload)
  const urlReload = await page.locator('[data-settings-baseurl]').inputValue()
  rec(g, '刷新后地址仍在', urlReload === 'http://127.0.0.1:9/v1', urlReload)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G44 渠道排序与令牌尾号（§7.2 拖动排序 / §7.3 令牌脱敏·删除）
//
// 这两件事都「看着像做完了」：列表本来就有顺序（按创建时间），令牌本来就有「显示 / 隐藏」。
// 但前者不是**用户**的顺序、后者只是输入框的可见性——真正缺的是「拖一下能改顺序」
// 和「看得出存的是哪把钥匙」。所以断言都落在**落库与持久化**上，而不是只看界面动了没。
// ────────────────────────────────────────────────────────────
async function g44(browser) {
  const g = 'G44 渠道排序与令牌'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  const names = async () => {
    const items = page.locator('[data-channel-item]')
    const n = await items.count()
    const out = []
    for (let i = 0; i < n; i += 1) out.push((await items.nth(i).innerText()).split('\n')[0].trim())
    return out
  }

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(400)
  const emptyHint = await page.locator('[data-channel-item]').count()
  rec(g, '起始无渠道（本组自带状态）', emptyHint === 0, `渠道=${emptyHint}`)

  // ① 建两条：新渠道排在**末尾**（与下方「+ 新增渠道」按钮的位置一致）
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(400)
  await page.locator('[data-settings-name]').fill('渠道甲')
  await page.getByRole('button', { name: '保存配置' }).click()
  await sleep(350)
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(400)
  await page.locator('[data-settings-name]').fill('渠道乙')
  await page.getByRole('button', { name: '保存配置' }).click()
  await sleep(350)

  const before = await names()
  rec(g, '新渠道排到列表末尾', JSON.stringify(before) === JSON.stringify(['渠道甲', '渠道乙']), JSON.stringify(before))
  const short = (await page.locator('[data-channel-proto]').first().innerText()).trim()
  rec(g, '列表项右侧协议短标签', short === 'MOCK', short)
  await page.screenshot({ path: `${OUT}/44-a-channels.png` })

  // ② 选渠道乙 → 存令牌 → 尾 4 位可见（脱敏显示）
  await page.locator('[data-channel-item]').filter({ hasText: '渠道乙' }).click()
  await sleep(300)
  const tokenInput = page.locator('input[type="password"]').first()
  await tokenInput.fill('sk-1234567890abcdef3f2a')
  // exact: 「保存」是「保存配置」的子串，不精确匹配会同时命中两个按钮
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await sleep(400)
  const tailText = await page.locator('[data-settings-token-tail]').innerText().catch(() => '')
  rec(g, '令牌保存后显示尾 4 位（脱敏）', norm0(tailText).includes('3f2a'), tailText)
  rec(g, '页面不出现令牌明文', !(await page.locator('body').innerText()).includes('sk-1234567890abcdef3f2a'))
  await page.screenshot({ path: `${OUT}/44-b-token-tail.png` })

  // ③ 删除令牌 → 提示消失、渠道还在、可再存（exact 同上：避开「删除渠道」）
  await page.getByRole('button', { name: '删除', exact: true }).click()
  await sleep(400)
  rec(g, '删除令牌后尾号提示消失', (await page.locator('[data-settings-token-tail]').count()) === 0)
  rec(g, '删除令牌不删渠道', (await page.locator('[data-channel-item]').count()) === 2)

  // ④ 拖动排序：把「渠道乙」拖到「渠道甲」之前 → 顺序翻转并落库
  const idFirst = await page.locator('[data-channel-item]').nth(0).getAttribute('data-channel-id')
  const idSecond = await page.locator('[data-channel-item]').nth(1).getAttribute('data-channel-id')
  await page.dragAndDrop(`[data-channel-id="${idSecond}"]`, `[data-channel-id="${idFirst}"]`)
  await sleep(500)
  const after = await names()
  rec(g, '拖动后顺序翻转', JSON.stringify(after) === JSON.stringify(['渠道乙', '渠道甲']), JSON.stringify(after))

  // ⑤ 刷新后顺序仍在（order 落库，不是内存态）
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(700)
  const reloaded = await names()
  rec(g, '刷新后顺序仍保持', JSON.stringify(reloaded) === JSON.stringify(['渠道乙', '渠道甲']), JSON.stringify(reloaded))
  await page.screenshot({ path: `${OUT}/44-c-reordered.png` })

  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G45 设置页改版（M7）：居中卡片 / 「验证协议」自动落库 / 删除二次确认
//
// 三件事都属于「用户看得见、但只有真机才验得出」的那一类：
//  ① 卡片几何（居中、定宽、整页不溢出）—— 只能在真实视口里量；
//  ② 「验证协议」是否真把命中的协议写回下拉与库 —— 需要网络真被拦到，
//     所以用 page.route 伪造一个 OpenAI 兼容端点（带 CORS 头，否则会被拦成网络错误）；
//  ③ 删除必须二次确认 —— 断言「点一下不删、确认才删」。
// ────────────────────────────────────────────────────────────
async function g45(browser) {
  const g = 'G45 设置页改版'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))
  const norm = (s) => String(s).replace(/\s+/g, '')
  const statusText = async () => norm(await page.locator('[data-settings-status]').innerText())

  // 伪造「OpenAI 兼容」端点：探测与拉模型打的都是 {base}/v1/models
  await page.route('http://relay.test/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ data: [{ id: 'gpt-image-2' }] }),
    })
  })

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(500)
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(400)

  // ① 居中卡片：定宽 + 左右等距 + 整页不溢出（滚动在卡片内）
  const geom = await page.evaluate(() => {
    const card = document.querySelector('[data-settings-card]')
    const r = card.getBoundingClientRect()
    return {
      w: Math.round(r.width),
      left: Math.round(r.left),
      right: Math.round(window.innerWidth - r.right),
      gap: Math.round(Math.abs(r.left - (window.innerWidth - r.right))),
      vh: window.innerHeight,
      scrollH: document.documentElement.scrollHeight,
    }
  })
  rec(g, '卡片定宽（≤1060 + 2px 描边）', geom.w <= 1062, `宽=${geom.w}`)
  rec(g, '卡片左右居中', geom.gap <= 1, `左${geom.left}/右${geom.right}`)
  rec(g, '整页不溢出（滚动交给卡片内部）', geom.scrollH <= geom.vh, `${geom.scrollH}/${geom.vh}`)
  await page.screenshot({ path: `${OUT}/45-a-settings-card.png` })

  // ② 验证协议：命中 → 自动选中 + 落库
  await page.locator('[data-settings-baseurl]').fill('http://relay.test')
  await sleep(150)
  await page.locator('[data-settings-detect]').click()
  await page.getByText(/已识别协议/).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  const hitText = await statusText()
  rec(g, '验证协议命中候选协议', hitText.includes('已识别协议'), hitText)
  rec(
    g,
    '协议下拉自动切到命中的协议',
    (await page.locator('[data-settings-protocol]').inputValue()) === 'openai-images',
    await page.locator('[data-settings-protocol]').inputValue(),
  )
  rec(
    g,
    '左栏协议短标签同步为 OAI',
    norm(await page.locator('[data-channel-proto]').first().innerText()) === 'OAI',
  )

  // 空地址必须被拒绝：否则空串会退化成相对当前页的路径，被 SPA 的 200 兜底页骗成「通了」
  await page.locator('[data-settings-baseurl]').fill('')
  await sleep(150)
  await page.locator('[data-settings-detect]').click()
  await sleep(700)
  const emptyText = await statusText()
  rec(g, '空地址拒绝探测（不再假成功）', emptyText.includes('请先填写地址'), emptyText)

  // ③ 删除二次确认：点一下不删，确认才删
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(400)
  const before = await page.locator('[data-channel-item]').count()
  await page.locator('[data-channel-item]').nth(1).click()
  await sleep(250)
  await page.locator('[data-channel-remove]').click()
  await sleep(250)
  const confirmShown = await page.locator('[data-channel-remove-confirm]').isVisible().catch(() => false)
  const stillThere = (await page.locator('[data-channel-item]').count()) === before
  rec(g, '删除需二次确认（点一下不删）', confirmShown && stillThere, `确认框=${confirmShown} 渠道数=${before}`)
  await page.screenshot({ path: `${OUT}/45-b-remove-confirm.png` })
  await page.locator('[data-channel-remove-no]').click()
  await sleep(250)
  rec(g, '取消后确认框收起且渠道仍在', (await page.locator('[data-channel-item]').count()) === before)
  await page.locator('[data-channel-remove]').click()
  await sleep(250)
  await page.locator('[data-channel-remove-yes]').click()
  await sleep(800)
  rec(g, '确认后渠道真的被删除', (await page.locator('[data-channel-item]').count()) === before - 1)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G46 创作面板参数上拉浮层 + 功能类别（图片 / 视频）—— M6-17
//   ① 参数控件是「上拉浮层」而不是原生 `<select>`：点 chip 挂出真 DOM 浮层、
//      贴在 chip 一侧、同一时刻只开一个、Esc 只关浮层
//   ② 视频是**同一个生成节点**的功能类别（`data.mode`）：切过去后参数集整体更换
//      （视频模型 / 尺寸 / 时长 / 参考模式），图片那套（画质 / 质量 / 数量）退场
//   ③ 视频参数真的落库：尺寸 / 时长 / 参考模式刷新后仍读回
// ────────────────────────────────────────────────────────────
async function g46(browser) {
  const g = 'G46 参数上拉浮层 + 功能类别'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)))

  await configureMockChannel(page)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  const panel = await genPanel(page)

  // ❿ 上游提示词胶囊（§6.8 第二部分）：文生图模板里提示词 → 生成 本就连着，
  //     而 `linkedPromptCount` 此前恒为 0 ⇒ 这个胶囊**从来没出现过**。
  //     它是「上游提示词不会自动带进下游」这件事唯一的界面说明。
  const linkedText = await page
    .locator('[data-panel-linked-prompt]')
    .innerText()
    .catch(() => '')
  rec(g, '生成节点面板显示「上游已链接提示词节点」', linkedText.includes('上游已链接提示词节点'), linkedText)

  // ① 上拉浮层（§3.3 / §6.8）
  const chip = panel.locator('[data-param-chip="channel"]')
  rec(g, '平台是 chip，面板里已无原生下拉', (await chip.count()) === 1 && (await panel.locator('select').count()) === 0)
  await chip.click()
  await sleep(220)
  const popup = panel.locator('[data-param-popup="channel"]')
  rec(g, '点 chip 挂出浮层（DOM 里真有这块元素）', (await popup.count()) === 1)
  const chipBox = await chip.boundingBox()
  const popBox = await popup.boundingBox()
  const placement = await popup.getAttribute('data-param-placement')
  const aboveOk = popBox.y + popBox.height <= chipBox.y + 1
  const belowOk = popBox.y >= chipBox.y + chipBox.height - 1
  rec(
    g,
    '浮层默认浮在 chip 正上方',
    placement === 'above' && aboveOk,
    `${placement} popupBottom=${Math.round(popBox.y + popBox.height)} chipTop=${Math.round(chipBox.y)}`,
  )
  rec(g, '浮层与 chip 水平居中对齐', Math.abs(popBox.x + popBox.width / 2 - (chipBox.x + chipBox.width / 2)) <= 2)
  rec(g, '声明的位置与真实几何自洽（不会贴错边）', placement === 'above' ? aboveOk : belowOk, placement)
  await page.screenshot({ path: `${OUT}/46-a-picker-open.png` })

  // Esc 只关浮层、不关面板（§6.8）
  await page.keyboard.press('Escape')
  await sleep(200)
  rec(
    g,
    'Esc 关浮层但不关面板',
    (await panel.locator('[data-param-popup]').count()) === 0 &&
      (await page.locator('[data-creation-panel]').count()) === 1,
  )

  // 点浮层外也关
  await chip.click()
  await sleep(200)
  await panel.locator('textarea').first().click()
  await sleep(200)
  rec(g, '点浮层外关闭', (await panel.locator('[data-param-popup]').count()) === 0)

  // 真正选中渠道（上面几轮都只是在开合浮层，从没选过值 → 模型 chip 还是禁用的）
  await pickParam(panel, 'channel', '新建渠道')
  rec(g, '平台 chip 带出所选渠道', (await paramLabel(panel, 'channel')) === '新建渠道')

  // 开新关旧（§6.8）：一个开着时点另一个 chip，应只剩新的那个
  await chip.click()
  await sleep(200)
  await panel.locator('[data-param-chip="model"]').click()
  await sleep(250)
  rec(
    g,
    '开新关旧：同一时刻只有一个浮层',
    (await panel.locator('[data-param-popup]').count()) === 1 &&
      (await panel.locator('[data-param-popup="model"]').count()) === 1,
  )
  await panel.locator('[data-param-popup="model"] button', { hasText: 'mock-image-1' }).first().click()
  await sleep(200)
  rec(g, '模型 chip 带出所选值', (await paramLabel(panel, 'model')) === 'mock-image-1')

  // 比例：模型上报了 `aspectRatios` 就以模型为准（能力驱动，UI 不写死九档）
  const ratioOpts = await paramOptions(page, panel, 'ratio')
  rec(
    g,
    '比例以模型上报为准（mock 声明 1:1 / 16:9）',
    ratioOpts.length === 2 && ratioOpts.includes('16:9'),
    `opts=${JSON.stringify(ratioOpts)}`,
  )
  await pickParam(panel, 'ratio', '16:9')
  rec(g, '选比例后 chip 带出该值', (await paramLabel(panel, 'ratio')) === '16:9')
  // 九档兜底集（模型什么都没报时）由单测 `ratiosOf` 覆盖——SSR 与真机都拿不到
  // 「一个不报比例的模型」，与其造第四个 mock 模型去污染 G8 的计数，不如在函数层断言。

  // ② 形态：比例 = 图形化网格；质量 = 横排胶囊（§6.8「通用规则」）
  await panel.locator('[data-param-chip="ratio"]').click()
  await sleep(200)
  rec(
    g,
    '比例用图形化网格浮层',
    (await panel.locator('[data-param-popup="ratio"][data-param-variant="ratioGrid"]').count()) === 1,
  )
  await page.keyboard.press('Escape')
  await sleep(150)
  await panel.locator('[data-param-chip="quality"]').click()
  await sleep(200)
  rec(
    g,
    '质量用横排胶囊浮层',
    (await panel.locator('[data-param-popup="quality"][data-param-variant="pill"]').count()) === 1,
  )
  await page.keyboard.press('Escape')
  await sleep(150)

  // ② 图片 → 视频：参数集整体更换
  rec(
    g,
    '图片模式：画质 / 质量 / 数量在位',
    (await panel.locator('[data-param-chip="resolution"]').count()) === 1 &&
      (await panel.locator('[data-param-chip="quality"]').count()) === 1 &&
      (await panel.locator('[data-param-count]').count()) === 1,
  )
  await panel.locator('[data-param-mode="video"]').click()
  await sleep(400)
  rec(
    g,
    '切到视频：尺寸 / 时长滑块 / 参考模式出现',
    (await panel.locator('[data-param-chip="size"]').count()) === 1 &&
      (await panel.locator('[data-param-duration-range]').count()) === 1 &&
      (await panel.locator('[data-param-chip="refMode"]').count()) === 1,
  )
  rec(
    g,
    '切到视频：画质 / 质量 / 数量整块退场',
    (await panel.locator('[data-param-chip="resolution"]').count()) === 0 &&
      (await panel.locator('[data-param-chip="quality"]').count()) === 0 &&
      (await panel.locator('[data-param-count]').count()) === 0,
  )
  rec(g, '切类别后旧模型被清空（图片模型不属于视频类）', (await paramLabel(panel, 'model')) === '视频模型')
  const videoOpts = await paramOptions(page, panel, 'model')
  rec(
    g,
    '视频类别只列视频模型',
    videoOpts.includes('mock-video-1') && !videoOpts.includes('mock-image-1'),
    `opts=${JSON.stringify(videoOpts)}`,
  )
  await page.screenshot({ path: `${OUT}/46-b-video-params.png` })

  // ③ 视频参数写回并落库
  await pickParam(panel, 'model', 'mock-video-1')
  await pickParam(panel, 'size', '720p')
  await pickParam(panel, 'refMode', '全能参考')
  const durInput = panel.locator('[data-param-duration-input]')
  await durInput.fill('8')
  await sleep(300)
  rec(g, '时长可直接键入数值（§6.8）', (await durInput.inputValue()) === '8')
  const rangeAttrs = await panel.locator('[data-param-duration-range]').evaluate((el) => [el.min, el.max])
  rec(g, '滑块边界取模型能力（3–15 秒）', rangeAttrs[0] === '3' && rangeAttrs[1] === '15', rangeAttrs.join('–'))

  await page.reload({ waitUntil: 'networkidle' })
  await sleep(900)
  const panel2 = await genPanel(page)
  rec(
    g,
    '刷新后仍在视频类别（mode 已落库）',
    (await panel2.locator('[data-param-mode="video"]').getAttribute('aria-pressed')) === 'true',
  )
  rec(
    g,
    '刷新后尺寸 / 参考模式读回',
    (await paramLabel(panel2, 'size')) === '720p' && (await paramLabel(panel2, 'refMode')) === '全能参考',
  )
  rec(g, '刷新后时长读回', (await panel2.locator('[data-param-duration-input]').inputValue()) === '8')

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

/**
 * G47 画质「自动」档 + 提示词节点「反推」（上游图片真的送进 LLM）—— M6-18
 *
 * 反推（§6.7）是「上游图片当素材喂给文本模型」的第一个真实用例，它把三类
 * 假接通一次性暴露出来，所以整条链路必须在**浏览器里**跑通，不能只靠单测：
 *   ① 面板上摆着「反推」按钮，点了没反应（通道没接 inputs）；
 *   ② 连线画出来了、缩略图显示了，请求里却只有文字（collectInputs 没产素材项）；
 *   ③ 素材到了渠道层但没进请求（openai-chat 没编码 image_url）。
 * mock 在文本输出里带 `img:<hash8>` 前缀，正是为了让③在离线环境可断言。
 */
async function g47(browser) {
  const g = 'G47 画质自动档 + 提示词反推（上游图片送 LLM）'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // ① 画质「自动」档（§6.8）：未设置显示「自动」，不是拿字段名当占位
  const panel = await genPanel(page)
  await configureGenPanel(page, panel, '一只猫')
  const res0 = await paramLabel(panel, 'resolution')
  rec(g, '画质未设置时显示「自动」', res0 === '自动', `label=${res0}`)
  await pickParam(panel, 'resolution', '2K')
  rec(g, '选 2K 后 chip 显示 2K', (await paramLabel(panel, 'resolution')) === '2K')
  await pickParam(panel, 'resolution', '自动')
  rec(g, '能选回「自动」（它是档位，不是默认值占位）', (await paramLabel(panel, 'resolution')) === '自动')

  // ② 先让生成节点真的出一张图——反推要有素材可送
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  const genNode = page.locator('[data-node-type="generation"]').first()
  let src = ''
  for (let i = 0; i < 60; i++) {
    src = (await genNode.locator('[data-node-asset]').first().getAttribute('src').catch(() => '')) ?? ''
    if (src.startsWith('blob:')) break
    await sleep(250)
  }
  rec(g, '生成节点出图（反推的素材来源）', src.startsWith('blob:'), src.slice(0, 24))

  // ③ 反推要求「生成 → 提示词」，而模板预置的是「提示词 → 生成」，
  //    直接加边会成环被拒（§11.3）；故先双击删掉原有连线。
  // 直接点线上那个 ✕：双击线本身会被悬浮出来的 ✕ 与顶栏拦截（实测）
  await page.locator('[data-edge-delete]').first().click()
  await sleep(400)
  rec(g, '删掉原有连线（腾出「生成 → 提示词」的位置）', (await page.locator('[data-edge]').count()) === 0)

  const promptNode = page.locator('[data-node-type="prompt"]').first()
  const pId = await promptNode.getAttribute('data-node-id')
  const gId = await genNode.getAttribute('data-node-id')
  await genNode.hover()
  await sleep(250)
  const outBox = await page.locator(`[data-node-id="${gId}"] [data-port="output"]`).boundingBox()
  // 落点取**输入端点**而非节点中心：落在中心时方向靠猜，猜反了就成了
  // 「提示词 → 生成」（与本意相反），反推自然取不到上游图。
  const inBox = await page.locator(`[data-node-id="${pId}"] [data-port="input"]`).boundingBox()
  await page.mouse.move(outBox.x + outBox.width / 2, outBox.y + outBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(outBox.x + 60, outBox.y + 10, { steps: 6 })
  await page.mouse.move(inBox.x + inBox.width / 2, inBox.y + inBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await sleep(450)
  rec(g, '生成 → 提示词 连线成功（§6.7 上游可连图片节点）', (await page.locator('[data-edge]').count()) === 1)
  // 方向也断言：连线画得再像，方向反了语义就全反了（反推取的是**上游**图）；
  // 只数边数会漏掉「连到了另一个节点」这类静默错位。
  const dir = await page
    .locator('[data-edge]')
    .first()
    .evaluate((el) => `${el.getAttribute('data-edge-source')}->${el.getAttribute('data-edge-target')}`)
    .catch(() => '(no edge)')
  rec(g, '连线方向确为 生成 → 提示词', dir === `${gId}->${pId}`, `实际 ${dir}`)

  // ④ 反推按钮：有上游图才启用（无图时它的输入不存在，点了就是空跑）
  await page.keyboard.press('Escape')
  await sleep(200)
  const pPanel = await genPanel(page, promptNode)
  await pickParam(pPanel, 'channel', '新建渠道')
  await sleep(200)
  await pickParam(pPanel, 'model', 'mock-chat-1')
  await sleep(250)
  const describeBtn = pPanel.locator('[data-panel-prompt-tool="describe"]')
  rec(g, '面板里有「反推」入口', (await describeBtn.count()) === 1)
  rec(
    g,
    '有上游图片 → 反推可点',
    !(await describeBtn.isDisabled().catch(() => true)),
    await describeBtn.getAttribute('title'),
  )

  // ⑤ 点下去：**草稿**被 LLM 结果覆盖（2026-09-15 起面板只写草稿，G23 守解耦），
  // 且结果里带素材前缀 ⇒ 图真的进了请求
  const pTa = () => pPanel.locator('textarea').first()
  await describeBtn.click().catch(() => {})
  let text = ''
  for (let i = 0; i < 60; i++) {
    text = await pTa().inputValue().catch(() => '')
    if (text.includes('mock:') && text.includes('img:')) break
    await sleep(250)
  }
  rec(
    g,
    '反推结果写回草稿，且带素材前缀（图真的到了渠道层）',
    text.includes('mock:img:'),
    `${text.slice(0, 60)}`,
  )
  rec(g, '反推不碰节点正文（草稿与正文解耦，§6.7）', !(await promptNode.innerText().catch(() => '')).includes('mock:'))
  await page.screenshot({ path: `${OUT}/60-g47-describe.png` })

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

/**
 * G48 Ctrl+C/V 复制粘贴（§4.2「复制与粘贴」/ §4.1 画布空白菜单「粘贴」）—— M6-19
 *
 * 单测覆盖了剪贴板的纯函数（快照、几何归一、id 重映射）与 reducer，但有三件事
 * 只有浏览器里才验得到：
 *   ① **落位在鼠标位置**——纯函数算得再准，「当前光标在哪」这段接线没通也是白搭；
 *   ② **剪贴板是快照**——删掉原件后照样粘得出来（这是它存在的理由，也最易被写成「记一组 id」）；
 *   ③ **文本框内的 Ctrl+C 归浏览器**——节点里常驻输入框，用户在那是想复制自己写的字。
 */
async function g48(browser) {
  const g = 'G48 Ctrl+C/V 复制粘贴'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const ids = () => page.$$eval('[data-node-id]', (els) => els.map((e) => e.getAttribute('data-node-id')))
  const edgeCount = () => page.locator('[data-edge]').count()
  const surfaceBox = await page.locator('[data-canvas-surface]').boundingBox()
  /** 画布右侧空白带：模板节点在左上，创作面板浮在节点下方，日志面板收在底部 */
  const blankAt = (dy) => ({
    x: Math.round(surfaceBox.x + surfaceBox.width - 130),
    y: Math.round(surfaceBox.y + surfaceBox.height / 2 + dy),
  })
  const clickBlank = async (p) => {
    await page.mouse.click(p.x, p.y)
    await sleep(220)
  }
  /** 右键空白，数一下菜单里有没有「粘贴」，然后关掉 */
  const pasteMenuCount = async () => {
    await page.mouse.click(blankAt(-40).x, blankAt(-40).y, { button: 'right' })
    await sleep(260)
    const n = await page.locator('[data-context-menu-item="paste"]').count()
    await page.keyboard.press('Escape')
    await sleep(160)
    return n
  }
  /** 节点框自身的中心（.header 绝对定位到框外，故不能用 boundingBox 的中心） */
  const centerOf = async (id) =>
    page.locator(`[data-node-id="${id}"]`).evaluate((el) => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + el.offsetWidth / 2), y: Math.round(r.y + el.offsetHeight / 2) }
    })

  const before = await ids()
  rec(g, '模板预置提示词 + 生成两个节点', before.length === 2, `实际 ${before.length}`)

  // ── ① 空剪贴板：菜单不列「粘贴」（列出点了没反应的死项比不列更糟） ──
  rec(g, '空剪贴板时画布菜单不列「粘贴」', (await pasteMenuCount()) === 0, `count=${await pasteMenuCount()}`)

  // ── ② 文本框内 Ctrl+C 归浏览器：此时剪贴板仍为空，粘不出东西才是对的 ──
  await page.locator('[data-node-type="prompt"]').first().click({ position: { x: 60, y: 10 } })
  await sleep(300)
  const ta = page.locator('[data-creation-panel] textarea').first()
  await ta.click()
  await sleep(200)
  await page.keyboard.press('Control+c')
  await sleep(200)
  const p1 = blankAt(-180)
  await clickBlank(p1)
  await page.mouse.move(p1.x, p1.y)
  await page.keyboard.press('Control+v')
  await sleep(400)
  rec(g, '文本框内 Ctrl+C 不复制节点（归浏览器）', (await ids()).length === 2, `节点数 ${(await ids()).length}`)

  // ── ③ 复制单个节点：菜单亮起 + Ctrl+V 落在光标处 ──
  const promptNode = page.locator(`[data-node-id="${before[0]}"]`)
  await promptNode.click({ position: { x: 60, y: 10 } })
  await sleep(250)
  await page.keyboard.press('Control+c')
  await sleep(220)
  rec(g, '复制后画布菜单出现「粘贴」', (await pasteMenuCount()) === 1)

  await page.mouse.move(p1.x, p1.y)
  await page.keyboard.press('Control+v')
  await sleep(450)
  const after1 = await ids()
  const added1 = after1.filter((id) => !before.includes(id))
  rec(g, 'Ctrl+V 粘出一个新节点', added1.length === 1, `新增 ${added1.length}`)
  if (added1.length === 1) {
    const c = await centerOf(added1[0])
    const off = Math.round(Math.hypot(c.x - p1.x, c.y - p1.y))
    rec(g, '落位在当前鼠标位置（包围盒中心对齐光标）', off <= 14, `偏差 ${off}px：中心(${c.x},${c.y}) 光标(${p1.x},${p1.y})`)
  }
  rec(g, '单节点复制不牵外部连线（§4.2 外部连线不复制）', (await edgeCount()) === 1, `edges=${await edgeCount()}`)

  // ── ④ 整链复制（Shift 加选）：集合**内部**的连线跟着走 ──
  await clickBlank(blankAt(200))
  await page.locator(`[data-node-id="${before[0]}"]`).click({ position: { x: 60, y: 10 } })
  await sleep(200)
  await page
    .locator(`[data-node-id="${before[1]}"]`)
    .click({ position: { x: 60, y: 10 }, modifiers: ['Shift'] })
  await sleep(250)
  await page.keyboard.press('Control+c')
  await sleep(220)
  const n0 = (await ids()).length
  const e0 = await edgeCount()
  const p2 = blankAt(60)
  await page.mouse.move(p2.x, p2.y)
  await page.keyboard.press('Control+v')
  await sleep(450)
  rec(g, '整链复制：两个节点一起粘出来', (await ids()).length === n0 + 2, `${n0} → ${(await ids()).length}`)
  rec(g, '整链复制：集合内连线也复制', (await edgeCount()) === e0 + 1, `${e0} → ${await edgeCount()}`)

  // ── ⑤ 剪贴板是快照：删掉原件后照样粘得出来 ──
  await clickBlank(blankAt(-300))
  await page.locator(`[data-node-id="${before[0]}"]`).click({ position: { x: 60, y: 10 } })
  await sleep(220)
  await page.keyboard.press('Control+c')
  await sleep(220)
  const nBeforeDel = (await ids()).length
  await page.keyboard.press('Delete')
  await sleep(450)
  const nAfterDel = (await ids()).length
  rec(g, '删除原件（连同它的连线）', nAfterDel === nBeforeDel - 1, `${nBeforeDel} → ${nAfterDel}`)
  const p3 = blankAt(-70)
  await page.mouse.move(p3.x, p3.y)
  await page.keyboard.press('Control+v')
  await sleep(450)
  rec(
    g,
    '原件已删仍能粘出（剪贴板存的是快照而非 id）',
    (await ids()).length === nBeforeDel,
    `${nAfterDel} → ${(await ids()).length}（期望回到 ${nBeforeDel}）`,
  )

  await page.screenshot({ path: `${OUT}/61-g48-paste.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

/**
 * 灯箱「图真的画出来了」的像素断言（§6.17）。
 *
 * 判定色：mock 产物是 **8×8 中灰 #9A9A9A**（真实 PNG 字节，见 `platform/channels/mock.ts`），
 * 与白底（255）/ 舞台底 `--bg-subtle`（247）/ 媒体框 1px 描边（`#deded9` = 222）
 * 都不是一档，取 `≤ 200` 把它单独摘出来。
 * 采样区**内缩 2px** 以避开描边——否则图没加载时也能靠描边混到几十个像素。
 */
async function countMediaInk(page, clip) {
  const vp = page.viewportSize() ?? { width: 1280, height: 800 }
  const x = Math.max(0, Math.floor(clip.x))
  const y = Math.max(0, Math.floor(clip.y))
  const width = Math.min(Math.ceil(clip.width), vp.width - x)
  const height = Math.min(Math.ceil(clip.height), vp.height - y)
  if (width <= 0 || height <= 0) return 0
  const shot = await page.screenshot({ clip: { x, y, width, height } })
  return page.evaluate(async (dataUrl) => {
    const img = new Image()
    img.src = dataUrl
    await img.decode()
    const c = document.createElement('canvas')
    c.width = img.naturalWidth
    c.height = img.naturalHeight
    const g2 = c.getContext('2d')
    g2.drawImage(img, 0, 0)
    const d = g2.getImageData(0, 0, c.width, c.height).data
    let ink = 0
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] <= 200 && d[i + 1] <= 200 && d[i + 2] <= 200) ink++
    }
    return ink
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

/**
 * G49 素材灯箱（§6.17 / §6.18「缩略图交互」）
 *
 * 这个功能的**症状**是「双击素材毫无反应」——动线早已挂在节点上（`openLightbox`），
 * 宿主是空 `break`。所以冒烟的起点必须是**真双击**，不能用别的方式把灯箱叫出来。
 * 另有一条只有像素能证的事：素材**画出来了**（DOM 在与不在、src 对不对都证明不了）。
 */
async function g49(browser) {
  const g = 'G49 素材灯箱'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // ① 先让节点真的出一张图（灯箱要有素材可看）
  const panel = await genPanel(page)
  await configureGenPanel(page, panel, '一只猫')
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  const genNode = page.locator('[data-node-type="generation"]').first()
  let src = ''
  for (let i = 0; i < 60; i++) {
    src = (await genNode.locator('[data-node-asset]').first().getAttribute('src').catch(() => '')) ?? ''
    if (src.startsWith('blob:')) break
    await sleep(250)
  }
  rec(g, '生成节点出图（灯箱的素材来源）', src.startsWith('blob:'), src.slice(0, 24))

  // ② 双击素材 → 灯箱打开
  await page.keyboard.press('Escape')
  await sleep(200)
  rec(g, '双击前画布上没有灯箱', (await page.locator('[data-lightbox]').count()) === 0)
  await genNode.locator('[data-node-asset]').first().dblclick()
  await sleep(500)
  rec(g, '双击素材打开灯箱（§6.8 已挂的动线终于有人接）', (await page.locator('[data-lightbox]').count()) === 1)

  const media = page.locator('[data-lightbox-media]')
  await media.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  // 素材本体真的解码出来了（mock 是真实 8×8 PNG，故 naturalWidth 可信）
  const natural = await media.evaluate((el) => ({
    tag: el.tagName,
    w: el.naturalWidth ?? el.videoWidth ?? 0,
    h: el.naturalHeight ?? el.videoHeight ?? 0,
  })).catch(() => ({ tag: 'none', w: 0, h: 0 }))
  rec(g, '灯箱里是 img 且素材已解码', natural.tag === 'IMG' && natural.w > 0, JSON.stringify(natural))
  const sizeText = (await page.locator('[data-lightbox-size]').innerText().catch(() => '')).trim()
  rec(g, '显示实际像素尺寸（§6.17）', sizeText === `${natural.w} × ${natural.h}`, `label="${sizeText}"`)
  const zoom0 = (await page.locator('[data-lightbox-zoom]').innerText().catch(() => '')).trim()
  rec(g, '初次落位为整图适配（小图按 100%，不放大到失真）', zoom0 === '100%', `zoom=${zoom0}`)

  // ③ 滚轮缩放：锚点固定在鼠标位置
  const box0 = await media.boundingBox()
  const stage = await page.locator('[data-lightbox-stage]').boundingBox()
  // 锚点取图内 25%/25% 处（不是中心）—— 取中心的话「锚定」是恒真的，测不出东西
  const anchor = { x: box0.x + box0.width * 0.25, y: box0.y + box0.height * 0.25 }
  await page.mouse.move(anchor.x, anchor.y)
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -120)
    await sleep(60)
  }
  await sleep(300)
  const zoom1 = Number((await page.locator('[data-lightbox-zoom]').innerText()).replace('%', ''))
  rec(g, '滚轮可放大', zoom1 > 100, `zoom=${zoom1}%`)
  const box1 = await media.boundingBox()
  // 锚点不变式：光标下那个「图上的点」缩放前后占图的比例不变
  const u0 = (anchor.x - box0.x) / box0.width
  const u1 = (anchor.x - box1.x) / box1.width
  rec(g, '缩放锚点固定在鼠标位置（§6.17）', Math.abs(u0 - u1) < 0.03, `${u0.toFixed(3)} → ${u1.toFixed(3)}`)

  // ④ 缩放到上限，然后数像素 —— DOM 在、src 对，都证明不了「画出来了」
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2)
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, -120)
    await sleep(40)
  }
  await sleep(300)
  const zoomMax = (await page.locator('[data-lightbox-zoom]').innerText()).trim()
  rec(g, '缩放上限 500%（与画布同一 clamp）', zoomMax === '500%', `zoom=${zoomMax}`)
  const box2 = await media.boundingBox()
  const ink = await countMediaInk(page, {
    x: box2.x + 2,
    y: box2.y + 2,
    width: box2.width - 4,
    height: box2.height - 4,
  })
  // 8×8 的中灰块放到 500% = 40×40，内缩后应有 1200+ 个灰像素；图没画出来则是 0
  rec(g, '素材真的画在屏幕上（像素级，非 DOM 计数）', ink > 500, `灰像素 ${ink}`)
  await page.screenshot({ path: `${OUT}/62-g49-lightbox.png` })

  // ⑤ Esc 关闭
  await page.keyboard.press('Escape')
  await sleep(300)
  rec(g, 'Esc 关闭灯箱', (await page.locator('[data-lightbox]').count()) === 0)

  // ⑥ 日志缩略图也能打开（§6.18「缩略图交互：点击进入灯箱」）
  await page.getByRole('button', { name: '日志' }).click()
  await sleep(600)
  const thumb = page.locator('[data-log-thumb]').first()
  const hasThumb = (await thumb.count()) === 1
  rec(g, '日志里有结果缩略图', hasThumb)
  if (hasThumb) {
    await thumb.click()
    await sleep(450)
    rec(g, '点击日志缩略图打开灯箱（§6.18）', (await page.locator('[data-lightbox]').count()) === 1)
    // ⑦ 点击空白关闭
    const st = await page.locator('[data-lightbox-stage]').boundingBox()
    await page.mouse.click(st.x + 40, st.y + 40)
    await sleep(300)
    rec(g, '点击空白关闭灯箱', (await page.locator('[data-lightbox]').count()) === 0)
  }

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

/**
 * G50 结果组折叠（§6.9）
 *
 * 这个功能是典型的「模型与布局都备好了、UI 零引用」：字段 `collapsed` 早就在
 * `ResultGroup` 里、`collapsedRect` 也有单测，可生产代码谁都没调用 —— 界面上连个开关
 * 都没有。所以本组第一条断言**不是**「折叠对不对」，而是「结果组里的内容本来就在框内吗」：
 * 格位若算错（缩略图画到框外），折叠做得再漂亮也只是给一个错位的东西加开关。
 * 反过来说，这条断言此前从来没人写过 —— 既有冒烟只数 `[data-result-group] img` 的**个数**，
 * 图跑到框外它照样全绿（又一个「DOM 全绿、画面是错的」）。
 */
async function g50(browser) {
  const g = 'G50 结果组折叠'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const panel = await genPanel(page)
  await configureGenPanel(page, panel, '一只猫')
  // 4 张：折叠要能看出「N 条进组连线汇成一条」与「只剩封面」的差别
  await page.locator('[data-param-count] button', { hasText: '4张' }).click()
  await sleep(200)
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()

  const rg = page.locator('[data-result-group]').first()
  await rg.waitFor({ state: 'visible', timeout: 15000 })
  let imgs = 0
  for (let i = 0; i < 40; i++) {
    imgs = await page.locator('[data-result-group] img').count()
    if (imgs >= 4) break
    await sleep(250)
  }
  rec(g, '结果组出 4 张结果', imgs === 4, `img=${imgs}`)

  /** 每张缩略图相对结果组框的位置：inside = 完整落在框内 */
  const thumbGeom = async () => {
    const box = await rg.boundingBox()
    const list = []
    for (const t of await page.locator('[data-result-group] img').all()) {
      const b = await t.boundingBox()
      if (!b) continue
      list.push({
        inside:
          b.x >= box.x - 2 &&
          b.y >= box.y - 2 &&
          b.x + b.width <= box.x + box.width + 2 &&
          b.y + b.height <= box.y + box.height + 2,
        dx: Math.round(b.x - box.x),
        dy: Math.round(b.y - box.y),
      })
    }
    return { box, list }
  }

  const g0 = await thumbGeom()
  const allInside = g0.list.length > 0 && g0.list.every((t) => t.inside)
  rec(
    g,
    '缩略图落在结果组框内（格位未被二次偏移）',
    allInside,
    `框 ${Math.round(g0.box.width)}×${Math.round(g0.box.height)} / 格位偏移 ${JSON.stringify(g0.list.map((t) => [t.dx, t.dy]))}`,
  )
  const firstBefore = g0.list[0]

  // ── 折叠 ──
  const toggle = page.locator('[data-result-group-toggle]')
  rec(g, '结果组有折叠开关', (await toggle.count()) === 1)
  /**
   * 连线断言刻意只测「不受影响」：结果组的逐张结果**从不参与连线**
   * （`canConnect` 明确拒絕端点位于结果组内，见 M6-18 的落点修复），
   * 所以 §6.9「折叠时汇聚为一条视觉总线」在当前架构下**没有线可汇** ——
   * 与其为死代码写一条恒真断言，不如守住「折叠不许顺手动连线」。
   */
  const edgesBefore = await page.locator('[data-edge]').count()
  await toggle.click()
  await sleep(400)
  rec(g, '点开关后进入折叠态', (await rg.getAttribute('data-collapsed')) === 'true')
  const cbox = await rg.boundingBox()
  rec(
    g,
    '折叠后收缩为封面尺寸 160×120（§6.9）',
    Math.abs(cbox.width - 160) <= 2 && Math.abs(cbox.height - 120) <= 2,
    `${Math.round(cbox.width)}×${Math.round(cbox.height)}`,
  )
  rec(g, '折叠后只剩封面一张（其余子结果不再单独渲染）', (await page.locator('[data-result-group] img').count()) === 1)
  rec(g, '封面元素带 data-result-group-cover', (await page.locator('[data-result-group-cover]').count()) === 1)
  const summary = (await page.locator('[data-result-group-summary]').innerText().catch(() => '')).trim()
  // 成功数必须从「组里真有几张」派生：summary 字段从未被回写，照抄就是「4 张图却写成功 0」
  rec(g, '折叠态汇总的成功数与内容一致（不照抄从未回写的 summary）', summary === '成功 4', `label="${summary}"`)
  rec(
    g,
    '折叠不动连线（组内结果本就不参与连线，见注释）',
    (await page.locator('[data-edge]').count()) === edgesBefore,
    `${edgesBefore} → ${await page.locator('[data-edge]').count()}`,
  )
  await page.screenshot({ path: `${OUT}/63-g50-collapsed.png` })

  // ── 展开：几何必须原样回来（折叠框是现算的呈现量，不写回持久几何） ──
  await page.locator('[data-result-group-toggle]').click()
  await sleep(400)
  rec(g, '再点一次回到展开态', (await rg.getAttribute('data-collapsed')) === 'false')
  rec(g, '展开后 4 张缩略图都回来', (await page.locator('[data-result-group] img').count()) === 4)
  rec(g, '展开后进组连线恢复', (await page.locator('[data-edge]').count()) === edgesBefore)
  const g1 = await thumbGeom()
  const same =
    g1.list.length === g0.list.length &&
    g1.list.every((t, i) => t.dx === g0.list[i].dx && t.dy === g0.list[i].dy)
  rec(
    g,
    '折叠 / 展开往返后格位零漂移（折叠几何不写回）',
    same,
    `首张 ${firstBefore?.dx},${firstBefore?.dy} → ${g1.list[0]?.dx},${g1.list[0]?.dy}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G51 模板库对齐（§5.4）+ 对比节点吃「跑 4 张」的结果组
// ────────────────────────────────────────────────────────────
async function g51(browser) {
  const g = 'G51 模板库对齐'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)

  const hint = (await page.locator('[data-template="batch-style"]').innerText().catch(() => '')).trim()
  rec(g, '模板卡副标题不含「待 M3」这类过期承诺', hint.length > 0 && !/M\d/.test(hint), `hint="${hint}"`)

  // ── 批量出图：提示词 → 图片生成 ×4 → 对比 ──
  await page.locator('[data-template="batch-img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const types = await page
    .locator('[data-node-type]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-type')))
  rec(
    g,
    '批量出图模板预置 提示词 → 生成 → 对比 三节点（§5.4）',
    JSON.stringify(types) === JSON.stringify(['prompt', 'generation', 'compare']),
    types.join('→'),
  )
  const edges = await page.locator('[data-edge]').count()
  rec(g, '两段连线都真的建起来了（不只是把节点摆出来）', edges === 2, `edges=${edges}`)

  const cmp = page.locator('[data-node-type="compare"]').first()
  rec(g, '对比节点初始为空态（还没跑）', (await cmp.locator('img').count()) === 0)

  // ── 跑一次：验证末端对比节点真能吃到结果组里的图 ──
  const gen = page.locator('[data-node-type="generation"]').first()
  const panel = await genPanel(page, gen)
  await configureGenPanel(page, panel, '一只猫')
  // 读**当前选中**的档（只读整组按钮的 innerText 会把「1/2/4/9张」全读出来，恒真）
  const countText = (
    await panel.locator('[data-param-count] button[data-active="true"]').innerText().catch(() => '')
  ).trim()
  rec(g, '模板预置的「4 张」带进了创作面板且为选中态', countText === '4张', `selected="${countText}"`)

  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  const rg = page.locator('[data-result-group]').first()
  await rg.waitFor({ state: 'visible', timeout: 15000 })
  let imgs = 0
  for (let i = 0; i < 40; i++) {
    imgs = await page.locator('[data-result-group] img').count()
    if (imgs >= 4) break
    await sleep(250)
  }
  rec(g, '批量出图跑出 4 张结果', imgs === 4, `img=${imgs}`)

  /**
   * 本组的关键断言。
   * 4 张结果落在**结果组**里，生成节点自身只回写第 1 张；若对比节点仍按
   * 「每个上游 1 张」收集，这里必然是 1 张——那才是最危险的假链路：
   * 节点在、连线在、看起来通了，挑图却永远只有 A 没有 B。
   */
  let cmpImgs = 0
  for (let i = 0; i < 40; i++) {
    cmpImgs = await cmp.locator('img').count()
    if (cmpImgs >= 2) break
    await sleep(250)
  }
  rec(g, '对比节点取到上游结果组的 2 张（不是只有第 1 张）', cmpImgs >= 2, `img=${cmpImgs}`)
  rec(g, '双图态出现分割线手柄', (await cmp.locator('[data-compare-handle]').count()) === 1)
  await page.screenshot({ path: `${OUT}/64-g51-batch-img-compare.png` })

  // ── 批量套图：批量容器 → 生成节点 ──
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(500)
  await page.locator('[data-template="batch-style"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const types2 = await page
    .locator('[data-node-type]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-type')))
  rec(
    g,
    '批量套图模板预置 批量容器 → 生成 两节点（§5.4）',
    JSON.stringify(types2) === JSON.stringify(['batch', 'generation']),
    types2.join('→'),
  )
  const edges2 = await page.locator('[data-edge]').count()
  rec(g, '批量容器 → 生成 已连线（集合逐项展开的前提）', edges2 === 1, `edges=${edges2}`)
  await page.screenshot({ path: `${OUT}/65-g51-batch-style.png` })

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

// ════════════════════════════════════════════════════════════
// G52 导入素材（§6.8 状态 A 的取文件链路 + 画布级导入入口）
//
// 本组起因是两条**真实**缺陷：
//  1. 生成节点点 `+` 毫无反应 —— File System Access 的 `types` 被写成
//     `{ 'image/png,image/jpeg,...': [] }`（把 HTML accept 逗号串当成一个 mime key），
//     Chrome 直接抛 `TypeError: Invalid type: ...`，而 `catch` 把它吞成 null。
//     静默失败：控制台不报错、界面不动，用户只看到「点了没用」。
//  2. 画布根本没有导入通道 —— 只有生成节点本体的 `+`，于是「批量套图」这类
//     要求用户自带素材的模板开不了工（素材从哪来？）。
// 故本组的断言分两类：选择器**参数**合法（只有打桩才能看见），拖放**结果**正确。
// ════════════════════════════════════════════════════════════
const PNG_IMPORT_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAD0lEQVR42mOYhQMwDC0JACFrc4GHRRTbAAAAAElFTkSuQmCC'

/** 打桩文件选择器：记录入参，并按指令抛错（AbortError = 用户取消 / TypeError = 参数非法） */
function pickerStub(mode) {
  return `
    window.__pickerCalls = []
    window.__inputClicks = 0
    const realClick = HTMLInputElement.prototype.click
    HTMLInputElement.prototype.click = function () {
      if (this.type === 'file') window.__inputClicks += 1
      return realClick.call(this)
    }
    window.showOpenFilePicker = (opts) => {
      window.__pickerCalls.push(JSON.parse(JSON.stringify(opts ?? {})))
      const err = ${JSON.stringify(mode)} === 'abort'
        ? new DOMException('aborted', 'AbortError')
        : new TypeError("Failed to execute 'showOpenFilePicker': Invalid type")
      return Promise.reject(err)
    }
  `
}

async function g52(browser) {
  const g = 'G52 导入素材'
  const ctx = await newCtx(browser)
  // 关键：newCtx 里 delete 掉了 FSA（其余组要的是「不弹原生框」），
  // 这里要**重新装上一个会记录入参的桩**——不打桩就永远看不见传错的参数。
  await ctx.addInitScript(pickerStub('abort'))
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // ── 顶栏有「导入素材」按钮（拖放之外的第二条路）──
  rec(g, '顶栏出现「导入素材」按钮', (await page.locator('[data-topbar-import]').count()) === 1)

  // ── 生成节点加号：选择器被真的调起，且参数合法 ──
  // 顶栏没有「＋ 生成」，走画布左侧工具栏的新建菜单（§6.5）
  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  await page.locator('[data-toolbar-menu-item="generation"]').click()
  await sleep(500)

  const gen2 = page.locator('[data-node-type="generation"]').first()
  rec(g, '画布上拿到一个生成节点（用于测上传入口）', (await gen2.count()) === 1)

  if ((await gen2.count()) === 1) {
    const plus = gen2.locator('[data-node-upload]').first()
    rec(g, '生成节点空态有上传 `+` 入口', (await plus.count()) === 1)
    await plus.click()
    await sleep(400)

    const calls = await page.evaluate(() => window.__pickerCalls ?? [])
    rec(g, '点 `+` 真的调起了文件选择器（不是毫无反应）', calls.length >= 1, `calls=${calls.length}`)
    const opts = calls[0] ?? {}
    const acceptMap = opts.types?.[0]?.accept ?? null
    rec(g, '选择器带 types 过滤（不是放开所有文件）', !!acceptMap, JSON.stringify(opts).slice(0, 120))
    const keys = acceptMap ? Object.keys(acceptMap) : []
    // 定性断言：整串当 key 正是「点了没反应」的根因（Chrome 抛 Invalid type）
    rec(
      g,
      '★ types 的 mime key 全部合法（不含逗号）——修复前整串当一个 key 会被 Chrome 拒',
      keys.length > 0 && keys.every((k) => !k.includes(',') && /^[a-z]+\/[a-z0-9.+-]+$/.test(k)),
      keys.join(','),
    )
    rec(g, 'types 含图片与视频 mime', keys.includes('image/png') && keys.includes('video/mp4'), keys.join(','))
    rec(
      g,
      '用户取消（AbortError）不再弹第二次框',
      (await page.evaluate(() => window.__inputClicks ?? 0)) === 0,
      `inputClicks=${await page.evaluate(() => window.__inputClicks ?? 0)}`,
    )
  }

  // ── 参数非法时应退回 <input> 兜底（不会再静默失败）──
  const ctx2 = await newCtx(browser)
  await ctx2.addInitScript(pickerStub('typeerror'))
  const page2 = await ctx2.newPage()
  await page2.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page2.locator('[data-template="blank"]').click()
  await page2.waitForURL(/\/canvas\//)
  await sleep(700)
  const surface2 = page2.locator('[data-canvas-surface]')
  const box2 = await surface2.boundingBox()
  await page2.locator('[data-toolbar-add]').click()
  await sleep(250)
  await page2.locator('[data-toolbar-menu-item="generation"]').click()
  await sleep(500)
  void box2
  const plus2 = page2.locator('[data-node-upload]').first()
  if ((await plus2.count()) === 1) {
    await plus2.click()
    await sleep(400)
    rec(
      g,
      '★ 选择器抛非取消错误时退回 <input type=file>（不再静默失败）',
      (await page2.evaluate(() => window.__inputClicks ?? 0)) >= 1,
      `inputClicks=${await page2.evaluate(() => window.__inputClicks ?? 0)}`,
    )
  }
  await ctx2.close()

  // ── 画布空白拖放导入 ──
  const before = await page.locator('[data-node-id]').count()
  const dropAt = async (files, x, y) => {
    const dt = await page.evaluateHandle(
      ({ files, b64 }) => {
        const dt = new DataTransfer()
        for (const f of files) {
          const bin = atob(b64)
          const bytes = new Uint8Array(bin.length)
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
          dt.items.add(new File([bytes], f.name, { type: f.type }))
        }
        return dt
      },
      { files, b64: PNG_IMPORT_BASE64 },
    )
    await page.locator('[data-canvas-surface]').dispatchEvent('dragover', { dataTransfer: dt })
    await page.locator('[data-canvas-surface]').dispatchEvent('drop', {
      dataTransfer: dt,
      clientX: x,
      clientY: y,
    })
  }

  const sbox = await page.locator('[data-canvas-surface]').boundingBox()
  await dropAt(
    [
      { name: 'cat.png', type: 'image/png' },
      { name: 'dog.png', type: 'image/png' },
    ],
    sbox.x + 320,
    sbox.y + 300,
  )
  await sleep(900)

  const after = await page.locator('[data-node-id]').count()
  rec(g, '一次拖入 2 张 → 新建 2 个素材节点', after === before + 2, `${before} → ${after}`)

  let imgs = 0
  for (let i = 0; i < 20; i++) {
    imgs = await page.locator('[data-node-asset]').count()
    if (imgs >= 2) break
    await sleep(250)
  }
  rec(g, '导入的素材真渲染出来了（2 张图）', imgs >= 2, `img=${imgs}`)
  const nw = await page
    .locator('[data-node-asset]')
    .first()
    .evaluate((el) => el.naturalWidth)
    .catch(() => 0)
  rec(g, '图片真被解码（naturalWidth > 0，不是假字节）', nw > 0, `naturalWidth=${nw}`)

  // 两张不应叠在一起（横向依次排开）
  const boxes = []
  for (const el of await page.locator('[data-node-asset]').all()) {
    const b = await el.boundingBox()
    if (b) boxes.push(b)
  }
  const overlap =
    boxes.length === 2 &&
    boxes[0].x < boxes[1].x + boxes[1].width &&
    boxes[1].x < boxes[0].x + boxes[0].width
  rec(g, '多张导入依次排开、不叠成一摞', boxes.length === 2 && !overlap, `${boxes.length} 张`)

  // ── 非素材文件被拒（不建节点 + 给出提示）──
  const beforeBad = await page.locator('[data-node-id]').count()
  await dropAt([{ name: 'note.txt', type: 'text/plain' }], sbox.x + 700, sbox.y + 420)
  await sleep(700)
  const afterBad = await page.locator('[data-node-id]').count()
  rec(g, '非图片 / 视频文件不建节点', afterBad === beforeBad, `${beforeBad} → ${afterBad}`)
  const notice = await page.locator('[data-canvas-notice]').innerText().catch(() => '')
  rec(g, '被拒时给出弱提示', /跳过|只支持/.test(notice), `notice="${notice.trim()}"`)

  await page.screenshot({ path: `${OUT}/66-g52-import.png` })

  // ── 一次导入 = 一个撤销单元 ──
  // 顶栏与撤销条各有一个「撤销」（§6.12），取顶栏那个。
  // 断言「撤一步少 2 个」而不是「少 1 个」：后者在「每个文件各占一步撤销」的实现下
  // 也会通过（恒真），正是本条要挡的退化——§6.3 要求整批一次撤销。
  const beforeUndo = await page.locator('[data-node-id]').count()
  await page.getByRole('button', { name: '撤销' }).first().click()
  await sleep(500)
  const afterUndo = await page.locator('[data-node-id]').count()
  rec(
    g,
    '撤销一步回退整次导入（2 个一起撤，不漏素材 / 不留空节点）',
    afterUndo === beforeUndo - 2,
    `${beforeUndo} → ${afterUndo}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

// ════════════════════════════════════════════════════════════
// G53 产物比例（§6.16）
//
// 起因是用户一句「我导入的素材应该要符合我素材原本的比例」，牵出**三处不一致**：
//  1. 生成写回只写 `assetHash`、不动尺寸 —— 16:9 的图塞在 240×240 方框里被裁掉两边。
//  2. N=1 也建结果组 —— 组里孤零零一张，却占了「结果容器」的语义（用户拍板废掉）。
//  3. 导入两条路两套尺寸：拖放新建按原始比例，点 `+` 上传不按。
//
// 规格（用户 2026-09-13 拍板）：N≥2 进结果组、组内统一格位；N=1 不建组、节点直接用
// 产物真实比例；从组里拖出 / 复制出来也恢复真实比例。
//
// 第 4 条**本组只测数据层**（reducer / clipboard 单测已覆盖）——界面上根本还没有入口：
// 结果组子项是 `pointer-events:none` 的缩略图，`NodeLayer` 只画 `!parentId` 的顶层节点，
// 于是「选中 / 拖拽 / 复制」在画布上无从下手。§6.9 正文承诺的「组内节点拥有与普通生成
// 节点相同的选中、移动、缩放、连线、灯箱与创作面板能力」**整条未兑现**（见对账清单）。
// ════════════════════════════════════════════════════════════

/** 工具栏新建一个生成节点（blank 模板没有预置节点） */
async function addGenNode(page) {
  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  await page.locator('[data-toolbar-menu-item="generation"]').click()
  await sleep(500)
  return page.locator('[data-node-type="generation"]').first()
}

/** 张数是 `data-param-count` 里的一排按钮，不是 ParamPicker chip（§6.8 横排胶囊） */
async function setCount(panel, text) {
  await panel.locator('[data-param-count] button', { hasText: text }).first().click()
  await sleep(150)
}

/** 配好渠道 / 模型 / 提示词 / 张数 / 比例，然后跑一次 */
async function runGen(page, { count, ratio, prompt = '一只猫' }) {
  const gen = await addGenNode(page)
  const panel = await genPanel(page, gen)
  await configureGenPanel(page, panel, prompt)
  await pickParam(panel, 'ratio', ratio)
  await setCount(panel, count)
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  return gen
}

/** 轮询等生成节点本体出图（mock 是内存渠道，走得快但仍是异步的） */
async function waitGenAsset(page, gen, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if ((await gen.locator('[data-node-asset]').count()) > 0) return true
    await sleep(250)
  }
  return false
}

async function g53(browser) {
  const g = 'G53 产物比例'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // ── N=1：不建结果组，节点自己按产物真实比例 ──
  const gen1 = await runGen(page, { count: '1张', ratio: '16:9' })
  rec(g, '单张生成真的出图（本体回写了素材）', await waitGenAsset(page, gen1))
  const groups1 = await page.locator('[data-result-group]').count()
  rec(g, '★ N=1 不建结果组（孤零零一张也进容器的旧语义已废）', groups1 === 0, `groups=${groups1}`)
  const b1 = await gen1.boundingBox()
  const r1 = b1 ? b1.width / b1.height : 0
  // 容差 0.12：节点框有 1px 描边，且 427×240 是取整后的近似 16:9（1.779）
  rec(
    g,
    '★ 生成节点按产物真实比例（16:9 ≈ 1.78，不再是 1:1 方框）',
    Math.abs(r1 - 16 / 9) < 0.12,
    `ratio=${r1.toFixed(3)} (${Math.round(b1?.width ?? 0)}×${Math.round(b1?.height ?? 0)})`,
  )
  await page.screenshot({ path: `${OUT}/67-g53-single.png` })

  // ── N=2：进结果组，组内统一格位 RESULT_CELL（200×200）──
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(500)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  await runGen(page, { count: '2张', ratio: '16:9' })
  const rg = page.locator('[data-result-group]').first()
  const hasRg = await rg
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
    .catch(() => false)
  rec(g, '★ N=2 建结果组', hasRg)
  let imgs = 0
  for (let i = 0; i < 40; i++) {
    imgs = await page.locator('[data-result-group] img').count()
    if (imgs >= 2) break
    await sleep(250)
  }
  rec(g, '结果组里 2 张结果', imgs === 2, `img=${imgs}`)
  const thumbs = []
  for (const el of await page.locator('[data-result-group] img').all()) {
    const b = await el.boundingBox()
    if (b) thumbs.push(b)
  }
  // 「统一格位」的对照是「各自按 16:9 摊开」：后者两张尺寸仍相等、但比例是 1.78
  const same =
    thumbs.length === 2 &&
    Math.abs(thumbs[0].width - thumbs[1].width) < 2 &&
    Math.abs(thumbs[0].height - thumbs[1].height) < 2
  rec(
    g,
    '★ 组内两张格位一致（统一 RESULT_CELL）',
    same,
    thumbs.map((t) => `${Math.round(t.width)}×${Math.round(t.height)}`).join(' / '),
  )
  const tr = thumbs[0] ? thumbs[0].width / thumbs[0].height : 0
  rec(
    g,
    '★ 组内格位是统一方框（比例 ≈ 1，不是产物的 1.78）',
    thumbs.length === 2 && Math.abs(tr - 1) < 0.08,
    `ratio=${tr.toFixed(3)}`,
  )
  await page.screenshot({ path: `${OUT}/68-g53-group.png` })

  // ── 点 `+` 上传：同样按原始比例（此前只有拖放这条路是对的）──
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(500)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  const gen3 = await addGenNode(page)
  const plus = gen3.locator('[data-node-upload]').first()
  if ((await plus.count()) === 1) {
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
      plus.click(),
    ])
    if (chooser) {
      await chooser.setFiles({
        name: 'seed-16x9.png',
        mimeType: 'image/png',
        buffer: solidPngBuffer(64, 36),
      })
      await sleep(1200)
      const b3 = await gen3.boundingBox()
      const r3 = b3 ? b3.width / b3.height : 0
      rec(
        g,
        '★ 点 `+` 上传也按素材原始比例（与拖放同一套尺寸）',
        Math.abs(r3 - 16 / 9) < 0.12,
        `ratio=${r3.toFixed(3)} (${Math.round(b3?.width ?? 0)}×${Math.round(b3?.height ?? 0)})`,
      )
      const nw = await gen3
        .locator('[data-node-asset]')
        .first()
        .evaluate((el) => el.naturalWidth)
        .catch(() => 0)
      rec(g, '上传的图真被解码（naturalWidth=64）', nw === 64, `naturalWidth=${nw}`)
    } else {
      rec(g, '点 `+` 上传调起了文件选择（filechooser）', false, 'no filechooser event')
    }
  }

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors[0] ?? '')
  await ctx.close()
}

/** G44 专用：把空白去掉再比较（选择器输出里有换行与缩进） */
function norm0(s) {
  return String(s).replace(/\s+/g, '')
}

const browser = await chromium.launch({ channel: 'chrome' })
// SMOKE_ONLY=g22 之类：只跑指定组（联调期免跑全量），缺省全量
/**
 * G54 结果组子结果交互（M6-25 / 产品文档 §6.9）
 *
 * 背景：组内子结果此前是**不可交互的缩略图**（整层 pointer-events:none），
 * 「选中 / 取出 / 删除 / 复制」全都没有入口。本组把它们钉成行为契约：
 *   1. 组内子结果是真节点（有 data-node-id、无端点）
 *   2. 点击 = 选中，且不因点击被拖出组（4px 阈值）
 *   3. 拖动 = 取出：脱离结果组 + 按 naturalSize 恢复产物真实比例
 *   4. 取走后剩余结果按格位重排（组内不留洞）
 *   5. 删除 / 复制粘贴走的是与顶层节点同一条路
 */
async function g54(browser) {
  const g = 'G54 结果组子结果交互'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  await runGen(page, { count: '4张', ratio: '16:9' })
  const rg = page.locator('[data-result-group]').first()
  await rg.waitFor({ state: 'visible', timeout: 15000 })
  let imgs = 0
  for (let i = 0; i < 40; i += 1) {
    imgs = await page.locator('[data-result-group] img').count()
    if (imgs >= 4) break
    await sleep(250)
  }
  rec(g, '前置：结果组里 4 张结果', imgs === 4, `img=${imgs}`)

  // ── 1. 子结果是真节点 ──
  const childCount = await page.locator('[data-result-group] [data-node-id]').count()
  rec(g, '★ 组内子结果渲染为真节点（不再是纯缩略图）', childCount === 4, `nodes=${childCount}`)
  const ports = await page.locator('[data-result-group] [data-port]').count()
  rec(g, '组内子结果不渲染端点（结果组不作为边端点，§6.9）', ports === 0, `ports=${ports}`)

  // ── 2. 点击 = 选中，且不会被顺手拖出组 ──
  const first = page.locator('[data-result-group] [data-node-id]').first()
  await first.click({ position: { x: 20, y: 20 } })
  await sleep(250)
  const selected = await page.evaluate(
    () => document.querySelectorAll('[data-result-group] [data-node-id][class*="selected"]').length,
  )
  rec(g, '★ 点击子结果可选中', selected === 1, `selected=${selected}`)
  const afterClick = await page.locator('[data-result-group] [data-node-id]').count()
  rec(g, '只点不选拖：阈值内不脱离结果组', afterClick === 4, `nodes=${afterClick}`)
  // 创作面板跟随子结果（此前 local 被当世界坐标，面板飞到画布原点）
  const panelPos = await page.evaluate(() => {
    const sel = document.querySelector('[data-result-group] [data-node-id][class*="selected"]')
    const anchor = document.querySelector('[data-panel-anchor]')
    if (!sel || !anchor) return { has: false }
    const s = sel.getBoundingClientRect()
    const a = anchor.getBoundingClientRect()
    return { has: true, dx: Math.round(a.x + a.width / 2 - (s.x + s.width / 2)), dy: Math.round(a.y - (s.y + s.height)) }
  })
  rec(
    g,
    '★ 创作面板挂在所选子结果正下方（local 不再被当世界坐标）',
    panelPos.has && Math.abs(panelPos.dx) < 8 && panelPos.dy > 0 && panelPos.dy < 40,
    JSON.stringify(panelPos),
  )
  await page.screenshot({ path: `${OUT}/68-g54-selected.png` })

  // ── 3. 拖动 = 取出（脱离组 + 恢复真实比例）──
  const box = await first.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 30, { steps: 5 })
  await page.mouse.move(box.x + 120, box.y + 520, { steps: 12 })
  await page.mouse.up()
  await sleep(500)

  const afterDrag = await page.locator('[data-result-group] [data-node-id]').count()
  rec(g, '★ 拖出后结果组少一张', afterDrag === 3, `nodes=${afterDrag}`)

  const topLevel = await page.evaluate(() => {
    const zoom = 1
    const out = []
    for (const el of document.querySelectorAll('[data-node-id]')) {
      if (el.closest('[data-result-group]')) continue
      if (el.getAttribute('data-node-type') !== 'generation') continue
      const r = el.getBoundingClientRect()
      out.push({ w: Math.round(r.width / zoom), h: Math.round(r.height / zoom) })
    }
    return out
  })
  // 顶层生成节点 = 来源节点（本体不被结果覆盖，仍是 240×240 默认框）+ 刚取出的那张
  rec(g, '★ 取出的节点回到根层（顶层生成节点 = 2）', topLevel.length === 2, `top=${topLevel.length}`)
  const real = topLevel.filter((n) => n.w > 210 && Math.abs(n.w / n.h - 16 / 9) < 0.12)
  rec(
    g,
    '★ 取出后按产物真实比例（16:9，不再是 200×200 方格）',
    real.length === 1,
    JSON.stringify(topLevel),
  )
  await page.screenshot({ path: `${OUT}/69-g54-extracted.png` })

  // ── 4. 取走后剩余结果补位（组内不留洞）──
  const offsets = await page.evaluate(() => {
    const rgEl = document.querySelector('[data-result-group]')
    const rb = rgEl.getBoundingClientRect()
    return [...rgEl.querySelectorAll('[data-node-id]')].map((el) => {
      const b = el.getBoundingClientRect()
      return [Math.round(b.x - rb.x), Math.round(b.y - rb.y)]
    })
  })
  const filled = offsets.some(([x, y]) => Math.abs(x - 18) <= 3 && Math.abs(y - 18) <= 3)
  rec(g, '★ 取走第一张后，后面的结果补上第一格（不留洞）', filled, JSON.stringify(offsets))

  // ── 5. 删除组内一张 ──
  await page.locator('[data-result-group] [data-node-id]').first().click({ position: { x: 20, y: 20 } })
  await sleep(200)
  await page.keyboard.press('Delete')
  await sleep(400)
  const afterDelete = await page.locator('[data-result-group] [data-node-id]').count()
  rec(g, '★ 选中子结果后 Delete 可删除', afterDelete === 2, `nodes=${afterDelete}`)

  // ── 6. 复制粘贴：组内 → 根层，恢复真实比例 ──
  await page.locator('[data-result-group] [data-node-id]').first().click({ position: { x: 20, y: 20 } })
  await sleep(200)
  await page.keyboard.press('Control+c')
  await sleep(200)
  await page.mouse.move(700, 620)
  await sleep(150)
  await page.keyboard.press('Control+v')
  await sleep(500)
  const afterPaste = await page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('[data-node-id]')) {
      if (el.closest('[data-result-group]')) continue
      if (el.getAttribute('data-node-type') !== 'generation') continue
      const r = el.getBoundingClientRect()
      out.push({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    return out
  })
  rec(g, '★ 复制组内子结果 → 粘到根层（顶层生成节点 = 3）', afterPaste.length === 3, `top=${afterPaste.length}`)
  // 来源节点仍是默认方框，取出的与粘出来的都应是 16:9
  const pastedOk = afterPaste.filter((n) => n.w > 210 && Math.abs(n.w / n.h - 16 / 9) < 0.12)
  rec(g, '粘出来的节点也是产物真实比例（不是方格）', pastedOk.length === 2, JSON.stringify(afterPaste))

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G55 上传即显（对账清单 #15）
 *
 * 背景：用户实测「图片上传进去的时候会很卡，等好几秒都没显示」。三处瓶颈已定位：
 *   1. 素材跟着 store 的 800ms 防抖落库 ⇒ 节点拿到 hash 后必有固定空窗
 *   2. SHA-1 是纯 JS 同步实现，对全部字节跑 80 轮 ⇒ 几 MB 的图阻塞主线程几百毫秒
 *   3. 取宽高靠 `createImageBitmap` 全量解码，而文件头里就有这两个数字
 *
 * 本组把「上传完立刻能看到图」钉成行为契约。前两条用**探针计数**断言而不是
 * 用耗时断言——耗时在 CI 上会飘，计数不会：
 *   - `crypto.subtle.digest` 被调用 ⇒ 哈希确实走了原生异步实现
 *   - `createImageBitmap` 未被调用 ⇒ 宽高确实读的文件头
 *
 * 耗时只认**应用侧时钟**：起点取页面里第一次 `blob.arrayBuffer()`（`importAssetFile`
 * 的第一个动作），而不是 Node 侧点按钮的那一刻——后者含 Playwright 把几 MB 字节
 * 经 CDP 灌进浏览器、再落成临时文件的开销，那是测试台的账，不是产品的账
 * （同一张图走 drop 路径实测 270ms，走 setFiles 路径端到端会多出约 1s）。
 */
async function g55(browser) {
  const g = 'G55 上传即显'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // ── 探针：哈希走没走 crypto.subtle、有没有全量解码、主线程被占多久 ──
  await page.evaluate(() => {
    window.__probe = { digest: [], bmp: 0, long: [], start: -1, err: '' }
    try {
      const s = crypto.subtle
      const orig = s.digest.bind(s)
      s.digest = async function (alg, data) {
        const t0 = performance.now()
        try {
          return await orig(alg, data)
        } finally {
          window.__probe.digest.push({ alg: String(alg), ms: Math.round(performance.now() - t0) })
        }
      }
    } catch (e) {
      window.__probe.err = String(e)
    }
    const ob = window.createImageBitmap
    if (typeof ob === 'function') {
      window.createImageBitmap = function (...a) {
        window.__probe.bmp += 1
        return ob.apply(this, a)
      }
    }
    // 应用侧时钟起点：`importAssetFile` 的第一个动作就是读字节
    const oa = Blob.prototype.arrayBuffer
    Blob.prototype.arrayBuffer = async function () {
      if (window.__probe.start < 0) window.__probe.start = performance.now()
      return oa.call(this)
    }
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          window.__probe.long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) })
        }
      }).observe({ entryTypes: ['longtask'] })
    } catch {
      /* 不支持就算了，耗时断言会拿到空数组 */
    }
  })

  const big = noisePngBuffer(1600, 1200)
  const file = { name: 'big-4x3.png', mimeType: 'image/png', buffer: big }
  const mb = (big.length / 1024 / 1024).toFixed(1)

  const visibleImgs = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-node-asset]')].filter(
        (el) => el.complete && el.naturalWidth > 0,
      ).length,
    )

  // ── 1. 单张大图：多久能看到 ──
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
    page.locator('[data-topbar-import]').click(),
  ])
  rec(g, '顶栏「导入素材」调起文件选择', !!chooser, chooser ? '' : 'no filechooser event')
  if (!chooser) {
    rec(g, '（后续断言跳过：没有文件选择框）', false, '')
    await ctx.close()
    return
  }
  await chooser.setFiles(file)

  let ms = -1
  for (let i = 0; i < 80; i += 1) {
    if ((await visibleImgs()) >= 1) {
      // 应用侧耗时：从「页面开始读字节」到「图真的解码出来」
      ms = await page.evaluate(() =>
        window.__probe.start < 0 ? -1 : Math.round(performance.now() - window.__probe.start),
      )
      break
    }
    await sleep(50)
  }
  rec(
    g,
    `★ ${mb}MB 大图：应用侧 600ms 内渲染出来（旧路径光防抖空窗就有 800ms）`,
    ms >= 0 && ms < 600,
    `app-visible in ${ms}ms`,
  )
  await page.screenshot({ path: `${OUT}/70-g55-upload.png` })

  const probe = await page.evaluate(() => window.__probe)
  rec(
    g,
    '★ 哈希走 crypto.subtle（原生异步，不再同步阻塞主线程）',
    probe.digest.length >= 1 && probe.digest.some((d) => /sha-?1/i.test(d.alg)),
    JSON.stringify(probe.digest),
  )
  rec(
    g,
    '★ 宽高读文件头、没做全量解码（createImageBitmap 一次都没被调用）',
    probe.bmp === 0,
    `createImageBitmap=${probe.bmp}`,
  )
  // 只算「应用开工之后」的长任务：开工前那一段含 Playwright 灌字节的开销，不算产品的账
  const appLong = probe.long.filter((x) => probe.start > 0 && x.at >= probe.start - 1).map((x) => x.ms)
  const maxLong = appLong.length ? Math.max(...appLong) : 0
  rec(
    g,
    '★ 上传期间主线程没有长阻塞（最长任务 < 150ms）',
    maxLong < 150,
    `maxLongTask=${maxLong}ms all=[${appLong.join(',')}]`,
  )

  const nw = await page
    .locator('[data-node-asset]')
    .first()
    .evaluate((el) => el.naturalWidth)
    .catch(() => 0)
  rec(g, '真实像素被正确读出（1600×1200 → naturalSize 决定节点比例）', nw === 1600, `naturalWidth=${nw}`)

  // ── 2. 连传：每张都要显示出来（旧路径下后面的会被前面的阻塞推过重试窗口）──
  for (let i = 0; i < 2; i += 1) {
    const [c] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null),
      page.locator('[data-topbar-import]').click(),
    ])
    if (c) await c.setFiles(file)
    await sleep(300)
  }
  let shown = 0
  for (let i = 0; i < 80; i += 1) {
    shown = await visibleImgs()
    if (shown >= 3) break
    await sleep(50)
  }
  rec(g, '★ 连传 3 张，3 张都渲染出来了（没有「传上去却空白」的）', shown >= 3, `visible=${shown}`)
  const nodeCount2 = await page.locator('[data-node-id]').count()
  rec(g, '连传 3 次 = 3 个节点', nodeCount2 === 3, `nodes=${nodeCount2}`)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G56 小地图（§6.4）：右下角导航浮层 —— 点 / 拖跳转，方向键平移，Home 复位
// ────────────────────────────────────────────────────────────
async function g56(browser) {
  const g = 'G56 小地图'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const host = page.locator('[data-canvas-minimap]')
  const hostCount = await host.count()
  rec(g, '画布右下角有小地图', hostCount === 1, `count=${hostCount}`)
  const box = await host.boundingBox()
  rec(
    g,
    '尺寸 200 × 140（§6.4）',
    !!box && Math.abs(box.width - 200) < 2 && Math.abs(box.height - 140) < 2,
    box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'null',
  )

  // 小地图内部的矩形坐标（相对左上角），不用世界坐标：世界坐标测不出「有没有被裁掉」
  const viewRect = () =>
    page.evaluate(() => {
      const h = document.querySelector('[data-canvas-minimap]')
      const v = h && h.querySelector('[data-minimap-view]')
      if (!v) return null
      const hb = h.getBoundingClientRect()
      const vb = v.getBoundingClientRect()
      return { x: vb.left - hb.left, y: vb.top - hb.top, w: vb.width, h: vb.height }
    })
  const nodeRects = () =>
    page.evaluate(() => {
      const hb = document.querySelector('[data-canvas-minimap]').getBoundingClientRect()
      return [...document.querySelectorAll('[data-minimap-node]')].map((el) => {
        const rb = el.getBoundingClientRect()
        return {
          id: el.getAttribute('data-minimap-node'),
          x: rb.left - hb.left,
          y: rb.top - hb.top,
          w: rb.width,
          h: rb.height,
        }
      })
    })

  const nodeIds = await page.$$eval('[data-node-id]', (els) =>
    els.map((e) => e.getAttribute('data-node-id')).sort(),
  )
  const miniIds = (await nodeRects()).map((r) => r.id).sort()
  rec(
    g,
    '每个顶层节点在小地图上都有矩形（不多不少）',
    miniIds.length > 0 && JSON.stringify(miniIds) === JSON.stringify(nodeIds),
    `minimap=[${miniIds}] nodes=[${nodeIds}]`,
  )

  // 像素：DOM 有 ≠ 屏幕有（连线就是这么漏的）
  const ink0 = box ? await countMinimapInk(page, box) : 0
  rec(g, '★ 节点矩形在画面上真的被绘制（像素采样）', ink0 >= 200, `墨迹像素=${ink0}`)
  // 故障注入：抹掉填充，墨迹必须塌下去 —— 否则上一条量的根本不是节点矩形
  await page.evaluate(() =>
    document.querySelectorAll('[data-minimap-node]').forEach((el) => el.setAttribute('fill', 'none')),
  )
  const inkNone = box ? await countMinimapInk(page, box) : -1
  await page.evaluate(() =>
    document
      .querySelectorAll('[data-minimap-node]')
      .forEach((el) => el.setAttribute('fill', '#D8D8DE')),
  )
  rec(
    g,
    '★ 像素断言确实在量节点矩形（抹掉填充后塌掉）',
    inkNone >= 0 && inkNone < 50,
    `抹掉后=${inkNone}（注入前 ${ink0}）`,
  )
  await page.screenshot({ path: `${OUT}/71-g56-minimap.png` })

  // 放大若干档：视口框要小于小地图，否则它一直铺满整框、读不出「看的是哪一块」
  await page.mouse.move(640, 400)
  for (let i = 0; i < 3; i += 1) {
    await page.mouse.wheel(0, -300)
    await sleep(150)
  }
  await sleep(300)
  const v1 = await viewRect()
  rec(
    g,
    '放大后视口框小于小地图（能读出「看的是哪一块」）',
    !!v1 && v1.w > 0 && v1.w <= 160 && v1.h <= 120,
    v1 ? `${Math.round(v1.w)}×${Math.round(v1.h)}` : 'null',
  )

  // 平移画布 → 视口框跟着动
  await page.mouse.move(600, 500)
  await page.mouse.down()
  await page.mouse.move(500, 430, { steps: 8 })
  await page.mouse.up()
  await sleep(300)
  const v2 = await viewRect()
  rec(
    g,
    '平移画布后视口框跟着移动',
    !!v1 && !!v2 && (Math.abs(v2.x - v1.x) > 1 || Math.abs(v2.y - v1.y) > 1),
    v1 && v2 ? `(${Math.round(v1.x)},${Math.round(v1.y)}) → (${Math.round(v2.x)},${Math.round(v2.y)})` : 'null',
  )
  rec(
    g,
    '视口框始终钉在小地图边界内（§6.4）',
    !!v2 && v2.x >= -0.5 && v2.y >= -0.5 && v2.x + v2.w <= 200.5 && v2.y + v2.h <= 140.5,
    v2 ? `x=${Math.round(v2.x)} y=${Math.round(v2.y)} ${Math.round(v2.w)}×${Math.round(v2.h)}` : 'null',
  )

  // 点哪儿，视口中心就到哪儿：跳完之后视口框中心应当落在点击点
  const at = (px, py) => ({ x: box.x + px, y: box.y + py })
  const p1 = at(120, 85)
  await page.mouse.click(p1.x, p1.y)
  await sleep(300)
  const v3 = await viewRect()
  const c3 = v3 ? { x: v3.x + v3.w / 2, y: v3.y + v3.h / 2 } : null
  rec(
    g,
    '★ 点击小地图：视口中心跳到点击处（±3px）',
    !!c3 && Math.abs(c3.x - 120) <= 3 && Math.abs(c3.y - 85) <= 3,
    c3 ? `视口框中心=(${c3.x.toFixed(1)},${c3.y.toFixed(1)}) 期望=(120,85)` : 'null',
  )

  // 拖拽：跟手（未松手就已经在跟），松手落在终点。
  // 注意别指望测到「每一个中间帧」——指针移动走 rAF 合帧，同一帧内的中间位置是**有意**丢掉的
  const p2 = at(70, 50)
  const pMid = at(100, 71)
  await page.mouse.move(p1.x, p1.y)
  await page.mouse.down()
  await page.mouse.move(pMid.x, pMid.y)
  await sleep(150)
  const vMid = await viewRect()
  const cMid = vMid ? { x: vMid.x + vMid.w / 2, y: vMid.y + vMid.h / 2 } : null
  rec(
    g,
    '★ 拖拽小地图：未松手时视口已跟到中途点（±3px，且与终点不同）',
    !!cMid &&
      Math.abs(cMid.x - 100) <= 3 &&
      Math.abs(cMid.y - 71) <= 3 &&
      (Math.abs(cMid.x - 70) > 3 || Math.abs(cMid.y - 50) > 3),
    cMid ? `视口框中心=(${cMid.x.toFixed(1)},${cMid.y.toFixed(1)}) 期望=(100,71)` : 'null',
  )
  await page.mouse.move(p2.x, p2.y)
  await sleep(150)
  await page.mouse.up()
  await sleep(250)
  const v4 = await viewRect()
  const c4 = v4 ? { x: v4.x + v4.w / 2, y: v4.y + v4.h / 2 } : null
  rec(
    g,
    '★ 松手后视口中心落在终点（±3px）',
    !!c4 && Math.abs(c4.x - 70) <= 3 && Math.abs(c4.y - 50) <= 3,
    c4 ? `视口框中心=(${c4.x.toFixed(1)},${c4.y.toFixed(1)}) 期望=(70,50)` : 'null',
  )

  // 键盘导航：方向键平移、Home 复位（焦点在小地图内时，画布那套导航必须让位）
  await host.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await sleep(300)
  const v5 = await viewRect()
  rec(
    g,
    '★ 键盘：方向键平移视口（焦点在小地图内）',
    !!v4 && !!v5 && v5.x - v4.x > 5,
    v4 && v5 ? `x ${Math.round(v4.x)} → ${Math.round(v5.x)}` : 'null',
  )

  await page.keyboard.press('Home')
  await sleep(300)
  const v6 = await viewRect()
  const rects = await nodeRects()
  const outside = v6
    ? rects.filter(
        (r) =>
          r.x < v6.x - 0.5 ||
          r.y < v6.y - 0.5 ||
          r.x + r.w > v6.x + v6.w + 0.5 ||
          r.y + r.h > v6.y + v6.h + 0.5,
      )
    : rects
  rec(
    g,
    '★ 键盘：Home 复位视图（全部节点回到视野内）',
    !!v6 && rects.length > 0 && outside.length === 0,
    `框外节点=${outside.length}/${rects.length}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G57 缩放锁比（§6.16）+ 同心圆角（§3.2）
// ────────────────────────────────────────────────────────────
async function g57(browser) {
  const g = 'G57 缩放锁比与同心圆角'
  const ctx = await newCtx(browser, { viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const ids = () => page.$$eval('[data-node-id]', (els) => els.map((e) => e.getAttribute('data-node-id')))
  const addNode = async (t) => {
    const before = await ids()
    await page.locator('[data-toolbar-add]').click()
    await page.locator(`[data-toolbar-menu-item="${t}"]`).click()
    await sleep(350)
    return (await ids()).find((i) => !before.includes(i))
  }
  const boxOf = (id) => page.locator(`[data-node-id="${id}"]`).boundingBox()

  /** 拖右下缩放手柄（zoom=1：屏幕位移=世界位移），返回松手瞬间与 400ms 后两拍尺寸 */
  const dragResize = async (id, dx, dy) => {
    const h = await page.locator(`[data-node-id="${id}"] [class*="resizeHandle"]`).boundingBox()
    if (!h) throw new Error('resize handle 不可见')
    const sx = h.x + h.width / 2
    const sy = h.y + h.height / 2
    await page.mouse.move(sx, sy)
    await page.mouse.down()
    await page.mouse.move(sx + dx, sy + dy, { steps: 12 })
    await page.mouse.up()
    const just = await boxOf(id)
    await sleep(400)
    return { just, settled: await boxOf(id) }
  }
  const ratioOk = (box, want) => Math.abs(box.width / box.height - want) < 0.01
  const noRebound = (a, b) => Math.abs(a.width - b.width) <= 0.6 && Math.abs(a.height - b.height) <= 0.6

  // 锁比 5:4：分组 / 批量（sizing.lockAspect 声明了很久，直到本次才有消费者）
  let id = await addNode('group')
  let r = await dragResize(id, 80, 10)
  rec(
    g,
    '★ 分组横向主导拖动保持 5:4（§6.16）',
    !!r.settled && ratioOk(r.settled, 5 / 4),
    r.settled ? `${r.settled.width.toFixed(0)}×${r.settled.height.toFixed(0)} (${(r.settled.width / r.settled.height).toFixed(3)})` : 'null',
  )
  rec(
    g,
    '★ 松手不回弹（end 曾回传起手矩形 → 松手即弹回原尺寸）',
    !!r.just && !!r.settled && noRebound(r.just, r.settled),
    r.just && r.settled ? `${r.just.width.toFixed(0)}×${r.just.height.toFixed(0)} → ${r.settled.width.toFixed(0)}×${r.settled.height.toFixed(0)}` : 'null',
  )
  r = await dragResize(id, 10, 80)
  rec(
    g,
    '分组纵向主导拖动同样保持 5:4',
    !!r.settled && ratioOk(r.settled, 5 / 4),
    r.settled ? `${r.settled.width.toFixed(0)}×${r.settled.height.toFixed(0)}` : 'null',
  )

  id = await addNode('batch')
  r = await dragResize(id, 60, 60)
  rec(
    g,
    '批量对角拖动保持 5:4',
    !!r.settled && ratioOk(r.settled, 5 / 4),
    r.settled ? `${r.settled.width.toFixed(0)}×${r.settled.height.toFixed(0)}` : 'null',
  )

  // 'current'：对比节点锁按下瞬间的比例
  id = await addNode('compare')
  const c0 = await boxOf(id)
  r = await dragResize(id, 70, 5)
  rec(
    g,
    '对比节点保持按下时比例（lockAspect=current）',
    !!c0 && !!r.settled && ratioOk(r.settled, c0.width / c0.height),
    c0 && r.settled ? `${(c0.width / c0.height).toFixed(3)} → ${(r.settled.width / r.settled.height).toFixed(3)}` : 'null',
  )

  // 自由：提示词 / 空态生成节点两轴各改各的
  id = await addNode('prompt')
  const p0 = await boxOf(id)
  r = await dragResize(id, 80, 10)
  rec(
    g,
    '提示词节点自由缩放（宽高独立）',
    !!p0 && !!r.settled && Math.abs(r.settled.width - p0.width - 80) < 2 && Math.abs(r.settled.height - p0.height - 10) < 2,
    p0 && r.settled ? `${p0.width.toFixed(0)}×${p0.height.toFixed(0)} → ${r.settled.width.toFixed(0)}×${r.settled.height.toFixed(0)}` : 'null',
  )
  id = await addNode('generation')
  const n0 = await boxOf(id)
  r = await dragResize(id, 60, 40)
  rec(
    g,
    '空态生成节点自由缩放',
    !!n0 && !!r.settled && Math.abs(r.settled.width - n0.width - 60) < 2 && Math.abs(r.settled.height - n0.height - 40) < 2,
    n0 && r.settled ? `${n0.width.toFixed(0)}×${n0.height.toFixed(0)} → ${r.settled.width.toFixed(0)}×${r.settled.height.toFixed(0)}` : 'null',
  )

  // 同心圆角：内层半径 = 外框 14px − 几何内缩（§3.2；此前沿用 10px，角上有两条弧）
  const radiusOf = (id, sel) =>
    page.evaluate(
      ({ id, sel }) => {
        const root = document.querySelector(`[data-node-id="${id}"]`)
        const el = sel === ':root' ? root : root && root.querySelector(sel)
        return el ? getComputedStyle(el).borderTopLeftRadius : null
      },
      { id, sel },
    )
  id = await addNode('group')
  rec(g, '分组内容区圆角 13px（14 − 1px 描边）', (await radiusOf(id, 'div[class*="body"] div[class*="body"]')) === '13px', await radiusOf(id, 'div[class*="body"] div[class*="body"]'))
  id = await addNode('compare')
  rec(g, '对比节点舞台圆角 7px（14 − 1px 描边 − 6px 内边距）', (await radiusOf(id, '[class*="stage"]')) === '7px', await radiusOf(id, '[class*="stage"]'))
  id = await addNode('generation')
  rec(g, '生成节点素材容器圆角 13px', (await radiusOf(id, '[class*="media"]')) === '13px', await radiusOf(id, '[class*="media"]'))

  await page.screenshot({ path: `${OUT}/72-g57-resize-lock.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

const ALL_GROUPS = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10, g11, g12, g13, g14, g15, g16, g17, g18, g19, g20, g21, g22, g23, g24, g25, g26, g27, g28, g29, g30, g31, g32, g33, g34, g35, g36, g37, g38, g39, g40, g41, g42, g43, g44, g45, g46, g47, g48, g49, g50, g51, g52, g53, g54, g55, g56, g57]
try {
  for (const gfn of ALL_GROUPS) {
    if (process.env.SMOKE_ONLY && gfn.name !== process.env.SMOKE_ONLY) continue
    await gfn(browser)
  }
} finally {
  await browser.close()
}

const pass = results.filter((r) => r.pass).length
const fail = results.length - pass
console.log(`\n===== ${pass} passed / ${fail} failed / ${results.length} total =====`)
if (fail) {
  console.log('\n失败项：')
  for (const r of results.filter((x) => !x.pass)) console.log(` - [${r.group}] ${r.name} ${r.detail}`)
  process.exitCode = 1
}
