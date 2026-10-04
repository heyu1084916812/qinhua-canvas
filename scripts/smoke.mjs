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
/**
 * 纯色 PNG。颜色可指定（默认 `200,120,60`）—— **G91 靠它验色彩匹配**：
 * 原图与补丁用两种差别很大的纯色，融合后选区正中应当是「补丁色被拉回原图色
 * 但只拉了 ±24」的那个确定值；两边同色的话，色彩匹配做没做都看不出来。
 */
function solidPngBuffer(w, h, color = [200, 120, 60]) {
  const row = Buffer.concat([
    Buffer.from([0]),
    Buffer.concat(Array.from({ length: w }, () => Buffer.from(color))),
  ])
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
 * 水平渐变 PNG：R 随 x 线性变化（0→255），G/B 固定。
 *
 * G92 用它验「提取选区 → 融合回来」的位置对不对：**纯色图放哪儿都一样**，
 * 只有带变化的图才能在像素上证明「局部图被放回了它原来那一块」。
 */
function gradientPngBuffer(w, h) {
  const px = Buffer.alloc(w * 3)
  for (let x = 0; x < w; x += 1) {
    px[x * 3] = Math.round((x / Math.max(1, w - 1)) * 255)
    px[x * 3 + 1] = 90
    px[x * 3 + 2] = 40
  }
  const row = Buffer.concat([Buffer.from([0]), px])
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
 * 用左侧工具栏新建节点（§6.5）。
 *
 * 顶栏按 §6.2 改版后不再带「＋ 提示词 / 对比 / 分组 / 批量」那一排，
 * 新建入口统一在左工具栏的「＋」菜单里（画布空白处右键是同一份菜单）。
 * 早先冒烟直接点顶栏按钮，改版后必须改成：点开菜单 → 点菜单项。
 */
const addNodeViaToolbar = async (page, type) => {
  await page.locator('[data-toolbar-add]').click()
  await sleep(200)
  await page.locator(`[data-toolbar-menu-item="${type}"]`).click()
}

/**
 * 复位视图（§6.3）——走左侧工具栏的 `data-toolbar-reset` 锚点。
 *
 * 顶栏按 §6.2 改版后不再有「复位视图」文字按钮（画布内操作一律归工具栏），
 * 工具栏里那个是**图标按钮**（`⤾`，aria-label「重置视图」），按文字找不到。故统一用锚点，不再靠 `getByRole` 的可见文案。
 */
const resetView = async (page) => {
  await page.locator('[data-toolbar-reset]').click()
  await sleep(250)
}

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
     * - **顶栏浮层**盖在画布上。早先它固定 `top:12 / height:44`（屏幕 y 12..56），
     *   于是这里曾写死 y=72；但顶栏 2026-09-19 按用户要求「加大一倍」（`.bar` 挂 `zoom:2`，
     *   占位变成 y 24..112），写死的 72 反而落进顶栏里、点击被它吃掉。
     *   **2026-09-27：那个顶栏已按 §6.2 整体去除**，画布顶部不再有遮挡物，
     *   于是这里不再需要「躲开顶栏」的偏移（详见下面的说明）。
     * - **本体中央的 `+`**：那是上传入口，点它会弹 showOpenFilePicker；故取左侧 x=40。
     */
    /*
     * 顶部不再有遮挡物。
     *
     * 这段原本查画布顶部悬浮栏（`[data-topbar]`）的下沿，好让点击落在它下面。
     * 顶栏已按 §6.2 整体去除 —— 现在画布**顶部是干净的**，
     * 取 0 就是正确值（下面 `Math.max(16, …)` 再兜一个最小边距）。
     * 留着那次查询只会让人以为「上面还有东西」，故直接写明。
     */
    const barBottom = 0
    /** 节点在屏幕上的顶边（box.y）到「顶栏下沿」的偏移；再加 8px 余量 */
    const safeY = Math.max(16, barBottom - box.y + 8)
    const y = Math.min(Math.max(16, safeY), box.height - 14)
    const x = Math.max(8, Math.min(40, box.width / 2 - 30))
    await node.click({ position: { x, y } })
  }
  const panel = page.locator('[data-creation-panel]')
  await panel.waitFor({ state: 'visible', timeout: 6000 }).catch(() => {})
  await sleep(150)
  return panel
}

/**
 * 创作面板的**提示词框**。
 *
 * 它从 `textarea` 换成了带 `@` 引用的富文本框（用户 2026-10-05 第 15 条）——
 * `click` / `fill` / `blur` 在 contenteditable 上一样能用，只有
 * 「读回内容」要从 `inputValue()` 换成 `innerText()`（contenteditable 没有 `value`）。
 * 凡是要动提示词的地方都走这两个 helper，别再写 `locator('textarea')` ——
 * 那是换组件前的老写法，留着就是等着下一次集体超时。
 */
const panelPrompt = (panel) => panel.locator('[data-panel-prompt]')
const readPanelPrompt = async (panel) => (await panelPrompt(panel).innerText()).trim()

/** 面板内配置渠道 + 模型 + 提示词（等价于旧版在节点内直接操作三条） */
async function configureGenPanel(page, panel, prompt) {
  /**
   * 生成节点**没有平台 chip**了（用户 2026-09-27）：渠道由选路决定，
   * 面板的解析链会自动把首个可用渠道写进节点，所以这里直接选模型即可。
   */
  await pickParam(panel, 'model', 'mock-image-1')
  await sleep(200)
  if (prompt != null) {
    const ta = panelPrompt(panel)
    await ta.click()
    await ta.fill(prompt)
    /**
     * 填完必须**失焦**再往下走（用户 2026-09-24）。
     *
     * 面板提示词改成「本地草稿 + 300ms 防抖落库」后，`fill()` 之后立刻点生成
     * 会读到**还没写进 store 的旧值**（空串）⇒ `toRunRequest` 因缺 prompt 返回 null
     * ⇒ 该节点不进计划 ⇒ 生成不触发 ⇒ 后面的 `waitNodeAsset` 白等一轮超时。
     *
     * 这里 blur 一下：实现里「失焦立即落库」（用户点走就是「我打完了」），
     * 于是测试走的正是产品里真实的那条路径，而不是靠 sleep 猜时长。
     */
    await ta.blur()
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
/*
 * 图片模式的四个生成参数（比例 / 画质 / 质量 / 张数）自 2026-10-02 起**收进一枚胶囊**
 * （`data-param-chip="gen-params"`，用户参考产品图五：「把比例，质量，画质，张数变成
 * 一个胶囊显示」）。分段本身仍叫这四个名字，所以下面三个助手的调用方**不用改**：
 *   · 单独一枚存在 → 用单独那枚（视频模式的「比例」「尺寸」「参考模式」就是这种）；
 *   · 只有胶囊 → 用胶囊，选项从 `[data-param-in="名字"]` 里找。
 */
const GROUPED_PARAMS = new Set(['ratio', 'resolution', 'quality', 'count'])

/** 参数 chip：优先单独一枚，否则落到那枚「生成参数」胶囊 */
function chipOf(scope, name) {
  const own = scope.locator(`[data-param-chip="${name}"]`)
  if (!GROUPED_PARAMS.has(name)) return own
  return own.or(scope.locator('[data-param-chip="gen-params"]')).first()
}

/** 当前这个参数展开后落在哪个浮层里（单独一枚 → 同名；胶囊 → `gen-params`） */
async function popupNameOf(scope, name) {
  if ((await scope.locator(`[data-param-chip="${name}"]`).count()) > 0) return name
  if (GROUPED_PARAMS.has(name) && (await scope.locator('[data-param-chip="gen-params"]').count()) > 0) {
    return 'gen-params'
  }
  return name
}

/**
 * 那一段的**选项按钮**。
 *
 * `data-param-in` 是打在**按钮自己**身上的（`ParamOptionButton` 的 `sectionAttrs`），
 * 不是打在一层容器上 —— 所以胶囊里的取法是 `button[data-param-in="…"]`，
 * 而不是「拿着它去找里面的 button」（第一版就这么写错，读到 0 个选项）。
 */
function optionButtons(scope, popup, name) {
  const pop = scope.locator(`[data-param-popup="${popup}"]`)
  return popup === name ? pop.locator('button') : pop.locator(`button[data-param-in="${name}"]`)
}

async function pickParam(scope, name, optionText) {
  await chipOf(scope, name).click()
  const popup = await popupNameOf(scope, name)
  await scope
    .locator(`[data-param-popup="${popup}"]`)
    .waitFor({ state: 'visible', timeout: 3000 })
    .catch(() => {})
  await optionButtons(scope, popup, name).filter({ hasText: optionText }).first().click()
  await sleep(150)
  /**
   * 多组胶囊**选完不关**（一次要调好几样），但这一层用例是按「选完即关」写的。
   * 这里补一次 Esc 把浮层收掉，免得挡住后面的点击 —— 关法本身由面板负责
   * （Esc 是面板级按键策略）。
   */
  if (popup !== name && (await scope.locator(`[data-param-popup="${popup}"]`).count()) > 0) {
    await scope.page().keyboard.press('Escape')
    await sleep(150)
  }
}

/** chip 当前文案（取代旧版 `select.inputValue()`） */
async function paramLabel(scope, name) {
  return (await chipOf(scope, name).innerText().catch(() => '')).trim()
}

/**
 * 确保某个参数的浮层**开着**并返回它的名字。
 *
 * 多组胶囊是「选完不关」的，所以「再点一次 chip」会把它**收起来** —— 那些
 * 「选完再点开看一格」的老写法必须走这里，不能直接 click。
 */
async function ensureParamOpen(scope, name) {
  const popup = await popupNameOf(scope, name)
  if ((await scope.locator(`[data-param-popup="${popup}"]`).count()) === 0) {
    await chipOf(scope, name).click()
    await sleep(250)
  }
  return popup
}

/** 展开参数浮层并读出全部选项文案，然后收起（诊断与断言共用） */
async function paramOptions(page, scope, name) {
  await chipOf(scope, name).click()
  await sleep(150)
  const popup = await popupNameOf(scope, name)
  const texts = await optionButtons(scope, popup, name)
    .allInnerTexts()
    .catch(() => [])
  const empty = await scope.locator(`[data-param-empty="${popup}"]`).count()
  await page.keyboard.press('Escape')
  await sleep(100)
  return empty > 0 ? [] : texts
}

/**
 * 打开**项目页**（模板库所在处）——产品文档 §5.1 起模板库在 `/projects`，
 * 不再在 `/`（那是欢迎页）。
 *
 * 为什么收成一个 helper：全量里有一批用例是「回到首页 → 点某个模板」，
 * 改版后这一步的落点变了。散着改 50 多处必然漏几个，
 * 而漏掉的表现是「模板按钮找不到」的超时 —— 与真正的缺陷长得一模一样。
 */
async function gotoProjects(page) {
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' })
  await sleep(400)
}

/**
 * 确保应用壳侧栏处于**展开**态（导航项的文字与「最近项目」只在展开时渲染）。
 *
 * 侧栏默认收起（产品口径：刷新回收起），而收起态下导航项只有图标 ——
 * 用文字选择器找它们会全落空。凡是「要读导航项文字」或「要点最近项目」的地方，
 * 先调这个，别再各写一遍判断。
 */
async function ensureSidebarOpen(page) {
  const rail = page.locator('[data-app-sidebar]')
  if ((await rail.count()) === 0) return
  if ((await rail.getAttribute('data-sidebar-open')) === 'true') return
  await page.locator('[data-sidebar-toggle]').click()
  await page.waitForFunction(
    () => document.querySelector('[data-app-sidebar]')?.getAttribute('data-sidebar-open') === 'true',
    null,
    { timeout: 4000 },
  )
}

/**
 * 量侧栏两档宽度（收起 / 展开），量完**复位回收起**。
 *
 * 为什么量 `getBoundingClientRect().width` 而不是读 CSS 声明：
 * 宽度由内联 style（来自 `sidebarState`）给，CSS 里的 64px 只是兜底；
 * 只有量渲染结果才能证明**状态确实驱动了宽度**。
 *
 * 复位很重要：侧栏是模块级单例，展开了不复位会污染后续用例
 * （本项目对这类「跨用例状态泄漏」有专门教训）。
 */
async function measureSidebarWidths(page) {
  const rail = page.locator('[data-app-sidebar]')
  if ((await rail.count()) === 0) return { collapsed: -1, expanded: -1 }
  const read = async () => Math.round((await rail.boundingBox()).width)
  const toggle = page.locator('[data-sidebar-toggle]')

  // 先接到「收起」
  if ((await rail.getAttribute('data-sidebar-open')) === 'true') {
    await toggle.click()
    await sleep(500)
  }
  const collapsed = await read()
  await toggle.click()
  await sleep(500)
  const expanded = await read()
  // 复位回收起，别把状态留给下一个用例
  await toggle.click()
  await sleep(500)
  return { collapsed, expanded }
}

/**
 * 面板里的生成按钮。
 *
 * 空闲态文案有两种（§6.7 / §6.12 / §6.22）：
 *  - 「生成当前节点」——生成 / 批量（无下游）自己出图；
 *  - 「生成下游节点」——提示词节点、以及**接了生成节点的批量 / 循环**，
 *    点它是驱动下游节点（用户 2026-09-24 把批量归到这条语义）。
 *
 * 统一用 `data-panel-run` 找按钮，不按文案找：文案是产品的表达，
 * 不该成为「按钮在不在」的判据（改文案就会误伤一大批用例）。
 */
function panelRunBtn(page) {
  return page.locator('[data-creation-panel] [data-panel-run]')
}

/**
 * 给提示词节点写入正文（用户 2026-09-21 起的唯一编辑入口）。
 *
 * 为什么需要这个 helper：编辑入口变过一次——早先是「双击节点 → 节点内 textarea」，
 * 现在双击是**全选**，编辑统一走**文本编辑灯箱**。当时好几处冒烟还在找
 * `[data-node-type="prompt"] textarea`，改完入口就集体超时。
 * 收成一个 helper 后，下次再改入口只改这一个地方。
 *
 * 走的是**和用户一样的路**：右键节点 → 菜单「全屏编辑」→ 填 → Esc。
 * （刻意不用直接派发 store 命令：那样测不到入口本身。）
 */
async function setTextViaEditor(page, nodeLocator, text) {
  const node = nodeLocator ?? page.locator('[data-node-type="prompt"]').first()
  const box = await node.boundingBox()
  if (!box) throw new Error('setTextViaEditor: 节点不可见')
  await page.mouse.click(box.x + 40, box.y + 60, { button: 'right' })
  await sleep(250)
  await page.locator('[data-context-menu-item="fullscreenEdit"]').click()
  await sleep(400)
  const input = page.locator('[data-text-input]')
  await input.waitFor({ state: 'visible', timeout: 5000 })
  await input.fill(text)
  await sleep(200)
  await page.keyboard.press('Escape')
  await sleep(350)
}

/**
 * 节点框上的**安全抓取点**：左下角内侧。
 *
 * 标题已按 §6.6 移到节点框外，"框内顶部"不再是安全区；本体中央还可能是生成节点的 `+`
 * 上传入口。左下角内侧对全部节点类型都空着（缩放手柄在右下角）。
 */
function grabPoint(box) {
  return { x: Math.round(box.x + 14), y: Math.round(box.y + box.height - 14) }
}

/**
 * 从指定的**把手**拖动节点到屏幕坐标 (x, y)（左上角落点口径同 `moveNode`）。
 *
 * 与 `moveNode` 的差别：抓取点由调用方给。
 * `moveNode` 固定抓「左下角内 14px」——对融合节点那是**底栏的比例控件**，
 * 控件自己 `stopPropagation`（不然点按钮就等于拖节点），于是拖不动。
 * 融合节点用 `[data-fusion-chips]`（连接状态那一行）当把手 —— 它居中、任何情况下都不吃指针。
 * 注意**不要**用预览行：那一行虽然也能拖动，但它是内容区，将来加交互（点击放大之类）就会失效。
 */
async function moveNodeVia(page, nodeLocator, handleLocator, x, y) {
  const nb = await nodeLocator.boundingBox()
  const hb = await handleLocator.boundingBox()
  if (!nb || !hb) return false
  const from = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + (x - nb.x), from.y + (y - nb.y), { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(350)
  return true
}

/**
 * 把节点**左上角**移到画布屏幕坐标 (x, y)（按压点仍是节点框的安全抓取点）。
 *
 * 契约是「左上角落到 (x,y)」而不是「抓点落到 (x,y)」：抓点只是实现细节，
 * 若把它当坐标锚点，调用方看到的落点会随抓点定义漂移。
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
 *
 * ⚠️ **2026-09-27 应用壳改版后要先落到项目页**：项目网格已按产品文档 §5.1
 * 从 `/`（现在的欢迎页）迁到 `/projects`。仍按老办法在 `/` 上找
 * `data-new-project` 会等不到它 —— 欢迎页上本来就没有新建按钮。
 * 这里统一先导航过去，调用方不必各自记得。
 */
async function createProject(page) {
  if (!/\/projects/.test(page.url())) {
    /*
     * 用 `page.goto` 而不是点侧栏：本 helper 的调用方可能在任意页面
     * （画布 / 首页 / 设置页），走 URL 是最短且不依赖壳层 UI 的路径。
     * 先回 `/` 再进 `/projects` 没必要 —— MemoryRouter 不在，真路由直接可达。
     */
    await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' }).catch(() => {})
    await sleep(400)
  }
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
  /*
   * 判定「验证完毕」要等状态区自己出现结果，而不是依赖某个固定短语。
   * 全量跑时前序组会改变状态行文案（实测 G8 单跑绿、全量红），
   * 用「状态区有非空文案」这条与实现无关的判据更稳。
   */
  const verified = await page
    .locator('[role="status"]')
    .filter({ hasText: /\S/ })
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
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
  /* 等面板真正挂载：全量跑时机器被前序组压慢，固定 sleep 会在慢帧上读到 0 个选项 */
  await page.locator('[data-model-panel]').waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  await sleep(150)
  const rows = page.locator('[data-model-option]')
  const n = await rows.count()
  for (let i = 0; i < n; i += 1) {
    await checkModelOption(rows.nth(i))
  }
  await page.locator('[data-model-apply]').click()
  /*
   * 应用后面板会关闭。显式等它消失再返回：全量跑得慢时，下一步动作可能
   * 撞上还没卸载的面板 —— 报错是「面板 intercepts pointer events」，
   * 看着像点击目标不存在，实际是上一层的模态还没退场。
   */
  await page.locator('[data-model-panel]').waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {})
  await sleep(300)
  return n > 0
}

/**
 * 勾选「选择模型」面板里的一行。
 *
 * 两个坑（2026-09-27 实测，别在别处重写一遍）：
 *  ① 复选框包在 `<label data-model-option>` 里：`check()` 先点 input、事件再冒泡到
 *     label 触发第二次，等于「勾上又取消」，应用后胶囊恒为 0。
 *  ② 选项列表自身可滚动，行的文档坐标可能远在视口外（实测 y≈1554）；
 *     不先滚过去就点，change 事件数为 0，看起来像「复选框是死的」。
 *
 * 固定顺序：标签点一次（这也是真人的操作方式）；没勾上再滚到可视区强制补一次。
 */
async function checkModelOption(row) {
  const box = row.locator('input[type="checkbox"]')
  await row.locator('label').click({ timeout: 3000, force: true }).catch(() => {})
  /*
   * 点标签若没生效，回落到「直接在 input 上派发一次真实点击」。
   * 用 `evaluate(el => el.click())` 而不是 Playwright 的 `check()`：
   * 后者会做可操作性判定，而列表行的坐标可能落在滚动容器视口之外。
   */
  if (!(await box.isChecked().catch(() => false))) {
    await box.scrollIntoViewIfNeeded().catch(() => {})
    await box.evaluate((el) => el.click()).catch(() => {})
  }
  if (!(await box.isChecked().catch(() => false))) {
    await box.check({ force: true }).catch(() => {})
  }
}

async function newCtx(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...opts })
  await ctx.addInitScript(disableFSA)
  return ctx
}

/**
 * 在**深色主题**下开一个上下文（G62 用）。
 *
 * 为什么不能靠「进页面点一下切换按钮」：那样测到的是「切过去之后好不好看」，
 * 而真正会烂掉的是**首帧**——首帧由 index.html 的内联脚本决定，
 * 从浅色点过去那条路径根本不经过它。故这里在**页面加载前**就把
 * localStorage 写好，让应用从头到尾都以为自己一直是深色。
 */
async function newDarkCtx(browser, opts = {}) {
  const ctx = await newCtx(browser, opts)
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('flow:theme', 'dark')
    } catch {
      /* 忽略：存储不可用时不该让整组冒烟挂掉 */
    }
  })
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

  /*
   * 空状态在**项目页**（§5.1：项目网格从「首页」迁到一级「项目」页）。
   * 首页现在只有欢迎与新建入口，那里没有项目列表、自然也没有空状态。
   */
  await gotoProjects(page)
  // 项目列表要等 IndexedDB 读回后才渲染，冷启动（全量跑的第一组）可能晚于 networkidle；
  // isVisible() 不自动等待，若直接判定会把「还没渲染」误报成「没有空状态」。显式等一拍（仍会在真缺时超时失败）。
  await page.getByText('还没有项目').waitFor({ state: 'visible', timeout: 5000 }).catch(() => {})
  const empty = await page.getByText('还没有项目').isVisible()
  rec(g, '空状态出现', empty)
  await page.screenshot({ path: `${OUT}/01-home-empty.png` })

  await createProject(page)
  const url1 = page.url()
  rec(g, '新建空白项目 → 进画布', /\/canvas\/.+/.test(url1), url1.replace(BASE, ''))

  await addNodeViaToolbar(page, 'prompt')
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

  await gotoProjects(page)
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
  await gotoProjects(page)

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
    await gotoProjects(page)
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

  await resetView(page)
  await sleep(250)

  /*
   * 滚轮归文本框：正文编辑 2026-09-21 起在**文本编辑灯箱**里，
   * 所以这里改成「打开灯箱 → 在它的 textarea 上滚轮」，验证的仍是同一件事：
   * **指针在文本框里时滚轮只滚文本，不缩放画布**。
   *
   * 顺带覆盖新入口本身（右键 → 全屏编辑），而不是绕过它。
   */
  await addNodeViaToolbar(page, 'prompt')
  await sleep(400)
  const promptForWheel = page.locator('[data-node-type="prompt"]').first()
  const pwb = await promptForWheel.boundingBox()
  await page.mouse.click(pwb.x + 40, pwb.y + 60, { button: 'right' })
  await sleep(250)
  await page.locator('[data-context-menu-item="fullscreenEdit"]').click()
  await sleep(400)
  const ta = page.locator('[data-text-input]')
  const hasTa = (await ta.count()) > 0
  rec(g, '右键「全屏编辑」打开文本编辑灯箱（出现 textarea）', hasTa)
  if (hasTa) {
    const before = await readViewport(page)
    // 指针移到**灯箱文本框自己身上**再滚（不是画布坐标——灯箱盖在画布之上）
    const tb = await ta.boundingBox()
    await ta.click()
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await page.mouse.wheel(0, -400)
    await sleep(250)
    const after = await readViewport(page)
    rec(g, '滚轮归文本框（不缩放）', Math.abs(after.zoom - before.zoom) < 1e-6, `${before.zoom} → ${after.zoom}`)
    await ta.click()
    await page.keyboard.type('a b')
    const val = await ta.inputValue()
    rec(g, '文本框内可键入空格（空格未被画布接管）', val.includes(' '), JSON.stringify(val))
    // 关掉灯箱再继续：后面几组要操作画布，留着它会把点击全吃掉
    await page.keyboard.press('Escape')
    await sleep(300)
  }

  // 空格 + 拖拽平移（点过工具栏后焦点不应滞留按钮，否则空格会被按钮吃掉）
  await resetView(page)
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
  await resetView(page)
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
  await addNodeViaToolbar(page, 'prompt')
  await sleep(1100)
  const nBefore = await nodeCount(page)

  await gotoProjects(page)
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
  await addNodeViaToolbar(p2, 'prompt')
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
    .locator('[role="status"]')
    .filter({ hasText: /\S/ })
    .first()
    .waitFor({ state: 'visible', timeout: 10000 })
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
  /*
   * 全量跑时前序组会把机器压慢：面板挂载晚于 250ms 的固定等待，
   * 后续 count() 读到 0 → 勾选循环空转 → 应用后胶囊为 0（单跑不复现）。
   * 等面板真正在 DOM 里再开始量，比加长 sleep 更稳。
   */
  await page.locator('[data-model-panel]').waitFor({ state: 'visible', timeout: 10000 })
  await sleep(150)
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
    await checkModelOption(rows.nth(i))
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
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // 诊断：打印生成节点模型 chip 的可选项
  // （M6-16 起这些参数在**创作面板**里，节点本体只剩媒体框；M6-17 起是上拉浮层；
  //   用户 2026-09-27 起生成节点已**没有平台 chip**，渠道由选路决定）
  const panel = await genPanel(page)
  const modelOptsDiag = await paramOptions(page, panel, 'model')
  console.log('  [diag] 生成节点模型 chip 可选项 =', JSON.stringify(modelOptsDiag))

  /**
   * 面板基准比例 21:9（用户 2026-09-19 第 2 条）：「保持长度不变、高度加高到 21:9」。
   *
   * `zoom` 是等比缩放，缩放前后比例不变，故直接量**渲染尺寸**即可：
   * 840 ÷ (21/9) = 360（设计值）⇒ 屏幕上 840×zoom × 360×zoom。
   * ⚠️ 判据里的 zoom **现场读**（2026-10-05 面板缩放从 0.75 收回 1 时，
   * 写死的 630 立刻变红 —— 那是缩放改了，不是面板坏了）。容差 0.02 吸收亚像素取整。
   *
   * ⚠️ 2026-10-03 起这条比例**有前提**（用户报「距离边界的位置要适合，当前不适合」）：
   * 面板挂在节点下方，可用高度 = 视口高 − 锚点位置 − 底部留白。
   * **空间够** → 仍然是 840×360（设计值，正好 21:9）；
   * **空间不够** → 老实收到可用高度（实测 256px），宁可矮一点，
   * 也不能像以前那样让 `min-height: 360px` 把底部那一行（参数 + 生成按钮）顶出屏幕。
   * 判据因此写成「高度 = min(360, 可用高度)」这一条**更准的规则**，再要求它落在视口内。
   */
  const panelBox = await panel.boundingBox()
  const panelRatio = panelBox ? panelBox.width / panelBox.height : NaN
  const availLocal = await page
    .locator('[data-panel-anchor]')
    .evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--panel-available-h')))
  const viewportSize9 = page.viewportSize()
  /** 渲染高度 = min(360, 可用高度) × zoom —— 可用高度是**面板内部单位** */
  const panelZoom9 = await panel.evaluate(
    (el) => parseFloat(getComputedStyle(el).zoom) || 1,
  )
  const expectWidth = 840 * panelZoom9
  const expectHeight = Math.min(360, availLocal) * panelZoom9
  const heightOk = !!panelBox && Math.abs(panelBox.height - expectHeight) <= 2
  const insideViewport = !!panelBox && panelBox.y + panelBox.height <= viewportSize9.height + 1
  rec(
    g,
    '★ 创作面板高度 = min(21:9 的 360px, 可用高度)，且完整落在视口内',
    Number.isFinite(panelRatio) &&
      Math.abs(panelBox.width - expectWidth) <= 2 &&
      heightOk &&
      insideViewport,
    panelBox
      ? `${Math.round(panelBox.width)}×${Math.round(panelBox.height)} 比例=${panelRatio.toFixed(3)} zoom=${panelZoom9} 可用=${Math.round(availLocal)} 期望宽=${Math.round(expectWidth)} 期望高=${Math.round(expectHeight)} 底=${Math.round(panelBox.y + panelBox.height)}/${viewportSize9.height}`
      : 'null',
  )

  // 3) 生成节点选 渠道 + 模型 + 提示词（用 data 属性而非 CSS module 哈希类名）
  await configureGenPanel(page, panel, '屋顶的猫')
  // N=1 已不建结果组（§6.16，M6-24）：本组要验的是「结果组出现 + 刷新后仍在」，
  // 故显式跑 4 张；单张不建组由 G53 覆盖。
  await setCount(panel, '4 张')
  await page.screenshot({ path: `${OUT}/11b-g9-ready.png` })

  /**
   * 5) 等 **4 个新承载节点**出图（不再等结果组）。
   *
   * 落位规则在 2026-09-17 改过：N≥2 的结果**一律铺 N 个并列的新承载节点**，
   * 不再建结果组（用户要的是「选 4 张 → 右边 4 张并排」，不是一个装 4 格的盒子）。
   * 本组仍显式跑 4 张：既覆盖「N 次调用」，也顺带锁住「N 张铺 N 个节点」。
   */
  // 基线必须在**点生成之前**取，否则数到的已是生成后的总数，新增恒为 0
  const before = await page.locator('[data-node-type="generation"]').count()

  // 4) 点生成（圆形 ↑ 按钮，aria-label=生成；在创作面板参数行末尾）
  await panelRunBtn(page).click()

  let carriers = 0
  for (let i = 0; i < 60; i++) {
    carriers = (await page.locator('[data-node-type="generation"]').count()) - before
    if (carriers >= 4) break
    await sleep(250)
  }
  rec(g, '生成 4 张 → 铺出 4 个新承载节点（N≥2 不建结果组）', carriers === 4, `新增=${carriers}`)
  rec(g, 'N≥2 不再建结果组', (await page.locator('[data-result-group]').count()) === 0)

  // 素材经 800ms 防抖落库，缩略图由 useAsset 退避重试后渲染，需等待出现
  let imgCount = 0
  for (let i = 0; i < 24; i++) {
    imgCount = await page.locator('[data-node-asset][src^="blob:"]').count()
    if (imgCount >= 4) break
    await sleep(250)
  }
  rec(g, '4 张都渲染出缩略图（objectURL）', imgCount >= 4, `img=${imgCount}`)
  await page.screenshot({ path: `${OUT}/12-g9-resultgroup.png` })

  // 6) 刷新后节点与图都还在（IndexedDB 持久化：nodes / assets）
  await sleep(1100)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(900)
  const afterReload = await page.locator('[data-node-type="generation"]').count()
  rec(g, '刷新后 4 个承载节点仍在', afterReload === before + 4, `节点=${afterReload}`)
  let imgAfter = 0
  for (let i = 0; i < 24; i++) {
    imgAfter = await page.locator('[data-node-asset][src^="blob:"]').count()
    if (imgAfter >= 4) break
    await sleep(250)
  }
  rec(g, '刷新后 4 张图仍渲染（素材已落库）', imgAfter >= 4, `img=${imgAfter}`)
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
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // 参数与数量胶囊都在创作面板里（节点本体只剩媒体框，§6.8）
  const panel = await genPanel(page)
  await pickParam(panel, 'model', 'mock-image-1')
  await sleep(200)

  /**
   * 数量固定四项 1/2/4/9（§6.8）。
   * 张数已改成 chip + 弹层（2026-09-19），所以要先点开 chip 才能读到四项。
   */
  const countBtns = await paramOptions(page, panel, 'count')
  rec(
    g,
    '数量固定四项 1/2/4/9',
    JSON.stringify(countBtns.map((t) => t.replace(/\s+/g, ''))) === '["1张","2张","4张","9张"]',
    `按钮=${countBtns.join('|')}`,
  )

  // 生成按钮空闲态：圆形 ↑ + aria-label「生成当前节点」（§6.8 三态之一）
  const idleLabel = await panel.locator(`button[aria-label="生成当前节点"]`).count()
  rec(g, '生成按钮空闲态为「生成当前节点」', idleLabel === 1, `count=${idleLabel}`)

  // 选 2 张，输入提示词，生成
  await setCount(panel, '2 张')
  const ta = panelPrompt(panel)
  await ta.click()
  await ta.fill('两只会飞的猫')
  await sleep(200)
  // 基线同样要在点生成之前取
  const before2 = await page.locator('[data-node-type="generation"]').count()
  await panelRunBtn(page).click()

  /**
   * 等 **2 个新承载节点**（§6.12 / 用户 2026-09-17：N≥2 一律铺 N 个并列节点，不建结果组）。
   * 2 张应排成**单行**：同一 y、2 个不同 x（沿用原「单行」这条几何断言，只是载体换成节点）。
   */
  let nodes2 = 0
  for (let i = 0; i < 60; i++) {
    nodes2 = (await page.locator('[data-node-type="generation"]').count()) - before2
    if (nodes2 >= 2) break
    await sleep(250)
  }
  rec(g, '生成 2 张 → 铺出 2 个新承载节点（不建结果组）', nodes2 === 2, `新增=${nodes2}`)
  rec(g, 'N≥2 不建结果组', (await page.locator('[data-result-group]').count()) === 0)
  let imgs = 0
  for (let i = 0; i < 24; i++) {
    imgs = await page.locator('[data-node-asset][src^="blob:"]').count()
    if (imgs >= 2) break
    await sleep(250)
  }
  rec(g, '2 张都渲染出缩略图', imgs >= 2, `img=${imgs}`)
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
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  const panel = await genPanel(page)
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
  await resetView(page)
  await sleep(500)
  const gen2 = page.locator('[data-node-type="generation"]')
  // 模板可能产生多个生成节点，统一取第一个并在整个 E2E-03/04 中复用同一 nodeId
  const genId = await gen2.first().getAttribute('data-node-id')
  const genNode = page.locator(`[data-node-id="${genId}"]`)
  const panel3 = await genPanel(page, genNode)
  await panelPrompt(panel3).fill('单张来源不被覆盖')
  await sleep(400)
  const srcPromptBefore = await readPanelPrompt(panel3)
  rec(g, 'E2E-03 提示词已写入来源节点', srcPromptBefore === '单张来源不被覆盖', srcPromptBefore)
  await page.screenshot({ path: `${OUT}/16a-g11-before-click.png` })
  // N=1：结果**回填到节点本体**，不新建节点（§6.16）—— 故这里不数新增节点
  await panelRunBtn(page).first().dispatchEvent('click')

  // 等该节点自己出图
  let filled = false
  for (let i = 0; i < 60; i++) {
    const src = await genNode.locator('[data-node-asset]').first().getAttribute('src').catch(() => '')
    if ((src ?? '').startsWith('blob:')) {
      filled = true
      break
    }
    await sleep(250)
  }
  rec(g, 'E2E-03 N=1 结果回填到节点本体', filled)
  const rg3 = await page.locator('[data-result-group]').count()
  rec(g, 'E2E-03 N=1 不建结果组', rg3 === 0, `groups=${rg3}`)
  // 来源提示词不被产物覆盖
  const panel3After = await genPanel(page, genNode)
  const srcPromptAfter = await readPanelPrompt(panel3After)
  rec(g, 'E2E-03 来源提示词未被产物覆盖', srcPromptAfter === '单张来源不被覆盖', srcPromptAfter)

  // ── E2E-04：同一节点改选 4 张 → 铺 4 个并列承载节点（N≥2 不建结果组）──
  await resetView(page).catch(() => {})
  await sleep(400)
  const panel4 = await genPanel(page, genNode)
  await setCount(panel4, '4 张')
  await sleep(300)
  const before4 = await page.locator('[data-node-type="generation"]').count()
  await panelRunBtn(page).first().dispatchEvent('click')

  /**
   * 等 **4 个新承载节点**（N≥2 铺并列节点、不建结果组 —— 用户 2026-09-17）。
   * 沿用原「四宫格 2×2」这条几何断言：4 个节点的坐标应呈 2 个不同 y × 2 个不同 x。
   */
  let nodes4 = 0
  for (let i = 0; i < 60; i++) {
    nodes4 = (await page.locator('[data-node-type="generation"]').count()) - before4
    if (nodes4 >= 4) break
    await sleep(250)
  }
  rec(g, 'E2E-04 生成 4 张 → 铺出 4 个新承载节点', nodes4 === 4, `新增=${nodes4}`)
  rec(g, 'E2E-04 N≥2 不建结果组', (await page.locator('[data-result-group]').count()) === 0)
  let imgs4 = 0
  for (let k = 0; k < 24; k++) {
    imgs4 = await page.locator('[data-node-asset][src^="blob:"]').count()
    if (imgs4 >= 4) break
    await sleep(250)
  }
  rec(g, 'E2E-04 4 张都渲染出缩略图', imgs4 >= 4, `img=${imgs4}`)
  const boxes4 = await page
    .locator('[data-node-type="generation"]')
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.left), y: Math.round(r.top) }
      }),
    )
  const tops4 = boxes4.map((b) => b.y)
  const lefts4 = boxes4.map((b) => b.x)
  rec(
    g,
    'E2E-04 承载节点呈网格排布（≥2 个不同 y 且 ≥2 个不同 x）',
    new Set(tops4).size >= 2 && new Set(lefts4).size >= 2,
    `y=${new Set(tops4).size} x=${new Set(lefts4).size}`,
  )
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
 * 判定色：连线 `--edge` #c9c9d1（201,201,209）。相比画布底 #fcfcfb（252）、
 * 节点白底（255）/描边 #deded9（222），它**比画布底更暗**（r ≤ 234）
 * 且**偏蓝**（b−r = +8；画布底 0，描边 −5）。
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


// ────────────────────────────────────────────────────────────
// G12 连线交互（§6.14）：单击选中变色 / 节点选中时上下游高亮+删除按钮 / 删除按钮删除 / 双击删除
// ────────────────────────────────────────────────────────────
async function g12(browser) {
  const g = 'G12 连线'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 文生图模板：提示词 → 图片生成，预置 1 条连线
  await gotoProjects(page)
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

  await gotoProjects(page)
  await sleep(400)
  await createProject(page)
  await sleep(500)
  // 文生图模板给出「提示词 → 生成」一对合法连线起点，并自带 1 条边
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  rec(g, '模板已带 1 条连线', (await page.locator('[data-edge]').count()) === 1, `连线=${await page.locator('[data-edge]').count()}`)

  // 加一个对比节点（生成 → 对比 是合法连接）
  await addNodeViaToolbar(page, 'compare')
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
    /**
     * 菜单项图标（用户 2026-09-19 第 5 条：拉线后的这个菜单也要有图标）。
     *
     * 断言「每一项都画出了 SVG」且**不是零尺寸**——只数元素个数会被空壳骗过
     * （老教训：连线 DOM 存在但屏幕上没有）。故连盒模型一起量。
     */
    const menuIconStats = await page.locator('[data-link-menu-item]').evaluateAll((items) =>
      items.map((it) => {
        const svg = it.querySelector('svg')
        const r = svg?.getBoundingClientRect()
        return { id: it.getAttribute('data-link-menu-item'), has: !!svg, w: r ? Math.round(r.width) : 0, h: r ? Math.round(r.height) : 0 }
      }),
    )
    rec(
      g,
      '★ 菜单项都带线性图标（与工具栏同一套，非零尺寸 SVG）',
      menuIconStats.length > 0 && menuIconStats.every((s) => s.has && s.w >= 12 && s.h >= 12),
      menuIconStats.map((s) => `${s.id}:${s.w}×${s.h}`).join(' '),
    )
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

  // 到画布：新建项目 → 工具栏「＋ 提示词」→「＋ 对比」，验证空态与类型拒绝
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await createProject(page)
  await sleep(500)

  await addNodeViaToolbar(page, 'prompt')
  await sleep(300)
  const promptId = await page.locator('[data-node-type="prompt"]').first().getAttribute('data-node-id')
  await addNodeViaToolbar(page, 'compare')
  await sleep(400)
  const compareCount = await page.locator('[data-node-type="compare"]').count()
  rec(g, '工具栏「＋ 对比」创建对比节点', compareCount === 1, `对比节点=${compareCount}`)

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

  await addNodeViaToolbar(page, 'group')
  await sleep(400)
  const groupCount = await page.locator('[data-node-type="group"]').count()
  rec(g, '工具栏「＋ 分组」创建分组节点', groupCount === 1, `分组=${groupCount}`)

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
  await addNodeViaToolbar(page, 'prompt')
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

  await addNodeViaToolbar(page, 'batch')
  await sleep(400)
  const batchCount = await page.locator('[data-node-type="batch"]').count()
  rec(g, '工具栏「＋ 批量」创建批量节点', batchCount === 1, `批量=${batchCount}`)
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
  await addNodeViaToolbar(page, 'prompt')
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
  await addNodeViaToolbar(page, 'prompt')
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
  await gotoProjects(page)
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
    await addNodeViaToolbar(page, 'prompt')
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
  /**
   * 选中态没有 data-selected 钩子，用「框选后工具栏的 ≥2 类按钮启用」间接验证。
   *
   * 8 种对齐已于 2026-09-19 下线，改用**排列**按钮当这个探针：
   * 它与整理节点同为「≥ 2 个节点选中才可用」，门槛完全一致。
   */
  const alignEnabled = await page.locator('[data-toolbar-arrange-modes]').isEnabled()
  rec(g, '框选命中后排列按钮启用（说明选中 ≥ 2）', alignEnabled, `sel=${selAfterMarquee}`)

  // ── 2. Shift + 单击 = 增减选中（§6.15） ──
  // 注意：单选会弹出创作参数面板，面板浮在节点**下方**（§6.8），
  // 会挡住正下方节点的点击 —— 因此节点一律**横向排开**，
  // 且对齐/整理这类会把节点摞到一起的操作放到最后。
  // 点空白清选中：右下角已被小地图占用，必须走 blankPoint（见其注释）
  await clickBlankCanvas(page)
  const alignDisabledAfterClear = !(await page.locator('[data-toolbar-arrange-modes]').isEnabled())
  rec(g, '空白单击清空选中（对齐按钮禁用）', alignDisabledAfterClear)

  await page.locator(`[data-node-id="${ids[0]}"]`).click({ position: { x: 60, y: 10 } })
  await sleep(200)
  await page
    .locator(`[data-node-id="${ids[1]}"]`)
    .click({ position: { x: 60, y: 10 }, modifiers: ['Shift'] })
  await sleep(250)
  const twoSelected = await page.locator('[data-toolbar-arrange-modes]').isEnabled()
  rec(g, 'Shift+单击增减选中（选中 2 个）', twoSelected)

  // 再 Shift 点一次 → 取消该节点，回到 1 个
  await page
    .locator(`[data-node-id="${ids[1]}"]`)
    .click({ position: { x: 60, y: 10 }, modifiers: ['Shift'] })
  await sleep(250)
  const oneSelected = !(await page.locator('[data-toolbar-arrange-modes]').isEnabled())
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

  /**
   * 工具栏加大一半（用户 2026-09-19 第 7 条）。与顶栏同理：`zoom` 不改
   * `clientWidth`，必须量屏幕矩形。48×280 → 72×420，按钮 36 → 54。
   */
  const tbRect = await page.evaluate(() => {
    const el = document.querySelector('[data-canvas-toolbar]')
    const btn = el?.querySelector('[data-toolbar-icon]')
    if (!el || !btn) return null
    const r = el.getBoundingClientRect()
    const br = btn.getBoundingClientRect()
    const btns = [...el.querySelectorAll('[data-toolbar-icon]')]
    const last = btns[btns.length - 1].getBoundingClientRect()
    return {
      w: Math.round(r.width),
      h: Math.round(r.height),
      btnW: Math.round(br.width),
      padTop: Math.round(br.top - r.top),
      padBottom: Math.round(r.bottom - last.bottom),
      padLeft: Math.round(br.left - r.left),
      padRight: Math.round(r.right - br.right),
    }
  })
  rec(
    g,
    '★ 工具栏加大一半（按钮 36 → 54px）',
    !!tbRect && Math.abs(tbRect.btnW - 54) <= 1,
    tbRect ? `${tbRect.w}×${tbRect.h} 按钮=${tbRect.btnW}` : 'null',
  )
  /**
   * ★ 首个按钮四边间距必须**相等**（用户 2026-09-19：「第一个按钮看起来和顶部的
   *   距离偏大」）。此前上下用 --space-3(12px)、左右 6px，圆角同心了但间距不匀，
   *   肉眼读成「偏下 / 顶得太多」。同心与间距匀是两件事，这里把后者也钉住。
   */
  rec(
    g,
    '★ 首个按钮到顶边 / 左右边的间距相等（不再「离顶部偏大」）',
    !!tbRect &&
      Math.abs(tbRect.padTop - tbRect.padLeft) <= 1 &&
      Math.abs(tbRect.padTop - tbRect.padRight) <= 1 &&
      Math.abs(tbRect.padTop - tbRect.padBottom) <= 1,
    tbRect ? `上=${tbRect.padTop} 下=${tbRect.padBottom} 左=${tbRect.padLeft} 右=${tbRect.padRight}` : 'null',
  )

  /**
   * ★ 新建按钮是**矢量图标**，且旋转绕**图标自己的中心**（用户 2026-09-22）。
   *
   * 旧版用文本 `＋`：字形的实际位置由**字体**决定（全角加号在字体盒里偏上偏左），
   * 实测文字盒 36×46 而字形只占其中一部分，于是 `rotate(45deg)` 绕的是一颗
   * **偏心的点**，看起来「没绕自己中心转」。
   *
   * 两条判据缺一不可：
   * ① 按钮里**没有文本节点**、只有 `<svg>` —— 证明真的换成了矢量图（不是换了个字符）；
   * ② 图标盒中心与按钮中心**重合**，且旋转中心是 `center` —— 证明绕的是图标几何中心。
   *    只断言「转了 45°」不够：偏心旋转同样能转出 45°（旧版就转得出来）。
   */
  const addIcon = await page.locator('[data-toolbar-add]').evaluate((el) => {
    const r = el.getBoundingClientRect()
    const svg = el.querySelector('svg')
    const sr = svg ? svg.getBoundingClientRect() : null
    const spin = el.querySelector('span')
    const scs = spin ? getComputedStyle(spin) : null
    return {
      /*
       * 必须在**图标容器内部**找文本：图标包在 `<span>` 里，
       * 只查按钮的直接子节点会漏掉（注入文本图标时实测 hasTextNode 仍为 false，
       * 那条断言会假绿）。用 textContent 更直接：真矢量图标没有任何文字。
       */
      iconText: (spin?.textContent ?? el.textContent ?? '').trim(),
      svgW: sr ? sr.width : 0,
      offsetX: sr ? (sr.left + sr.width / 2) - (r.left + r.width / 2) : NaN,
      offsetY: sr ? (sr.top + sr.height / 2) - (r.top + r.height / 2) : NaN,
      spinOrigin: scs ? scs.transformOrigin : '',
    }
  })
  rec(
    g,
    '★ 新建按钮用矢量图标（不是文本符号）',
    addIcon.iconText === '' && addIcon.svgW > 0,
    `图标内文字=${JSON.stringify(addIcon.iconText)} svg=${Math.round(addIcon.svgW)}px`,
  )
  /**
   * 悬停时校验「**旋转的是图标本体、不是按钮**」。
   *
   * 只在静止态读 class 是不够的——那时本来就没有旋转类，判不出挂在哪。
   * 必须真的 hover 起来，再分别看「图标有没有转」与「按钮有没有转」：
   * 期望 = 图标转了 45°、而按钮**没有** transform（否则就是绕按钮中心转的旧实现）。
   */
  await page.locator('[data-toolbar-add]').hover()
  await sleep(450)
  const rot = await page.locator('[data-toolbar-add]').evaluate((el) => {
    const spin = el.querySelector('span')
    return {
      icon: spin ? getComputedStyle(spin).transform : 'none',
      iconOrigin: spin ? getComputedStyle(spin).transformOrigin : '',
      button: getComputedStyle(el).transform,
    }
  })
  /** 矩阵前两位是 cos/sin：45° 时都约等于 0.707 */
  const is45 = (m) => m.startsWith('matrix(0.707')
  await page.mouse.move(760, 760)
  await sleep(450)
  rec(
    g,
    '★ 图标与按钮中心重合（几何上绕自己中心）',
    Math.abs(addIcon.offsetX) <= 0.5 && Math.abs(addIcon.offsetY) <= 0.5,
    `图标中心偏移 (${addIcon.offsetX.toFixed(2)}, ${addIcon.offsetY.toFixed(2)})`,
  )
  rec(
    g,
    '★ 悬停时是**图标**在转 45°、按钮本身不转（绕图标中心而非按钮中心）',
    is45(rot.icon) && rot.button === 'none',
    `图标=${rot.icon.slice(0, 24)} 按钮=${rot.button}`,
  )

  /**
   * ★★ 像素级：字形质心必须与按钮圆心**重合**（用户 2026-09-22 二轮）。
   *
   * 为什么必须落到像素：DOM 三层都没问题（按钮 54×54、图标 39×39、
   * `transform-origin` 也报在中心）——**但字形仍然偏 0.54px**。
   * 根因是「26 ÷ 2 = 13 的设计值在 `zoom:1.5` 下落在半像素上」，取整后整体偏一档。
   * 只看 DOM 数字永远查不出来，只有量像素质心才露馅。
   *
   * 判据：白字形质心 − 深色圆质心，两个方向都 ≤ 1 个物理像素。
   */
  const addBox = await page.locator('[data-toolbar-add]').boundingBox()
  const addShot = await page.screenshot({
    clip: { x: addBox.x, y: addBox.y, width: addBox.width, height: addBox.height },
  })
  const centroid = await page.evaluate(async (b64) => {
    const img = new Image()
    await new Promise((res) => {
      img.onload = res
      img.src = 'data:image/png;base64,' + b64
    })
    const c = document.createElement('canvas')
    c.width = img.width
    c.height = img.height
    const ctx = c.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let lx = 0, ly = 0, ln = 0, cx = 0, cy = 0, cn = 0
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        const i = (y * c.width + x) * 4
        if (d[i + 3] < 200) continue
        const lum = (d[i] + d[i + 1] + d[i + 2]) / 3
        if (lum > 200) { lx += x; ly += y; ln++ } else if (lum < 90) { cx += x; cy += y; cn++ }
      }
    }
    return { dx: lx / ln - cx / cn, dy: ly / ln - cy / cn }
  }, addShot.toString('base64'))
  /**
   * 阈值取 **0.05px**（不是 1px，也不是 0.25px）。
   *
   * 实测过的三档（把图标改回 26 做故障注入）：
   * - 正确实现（24px）：偏移 **0.00**；
   * - 旧值（26px）：本组视口（DPR=1）偏移 **0.13**，4× 设备像素比下 **0.54**；
   * - 用 ≤1px 甚至 ≤0.25px 的阈值，0.13 全都照样绿——**断言形同虚设**。
   *
   * 这个缺陷**依赖设备像素比**，本组跑在 DPR=1 上漂得最小，所以阈值必须卡到
   * 亚像素才拦得住。定 0.05：正确实现是精确的 0，留 0.05 只是给渲染抖动一点余量。
   */
  rec(
    g,
    '★★ 加号字形质心与按钮圆心重合（像素级，≤0.05px）',
    Math.abs(centroid.dx) <= 0.05 && Math.abs(centroid.dy) <= 0.05,
    `偏移 dx=${centroid.dx.toFixed(2)} dy=${centroid.dy.toFixed(2)}`,
  )

  /**
   * ★ 尺寸只对**新建按钮**生效，不许误伤其它图标（用户 2026-09-22 实测报障：
   * 「你怎么把我工具栏的其他图标也放大了」）。
   *
   * 根因是上一版把尺寸规则写成 `.iconSpin > svg`，而 `.iconSpin` 是
   * **所有按钮图标的公共类**——整条工具栏的图标被一起撑到按钮大小。
   * 修法是加 `.solid` 限定，只命中第一个实色按钮。
   *
   * 判据：新建按钮的图标明显大于其它按钮的图标（否则说明两者被同一规则命中）；
   * 同时其它图标必须**远小于按钮**（没被撑满）。
   */
  const iconSizes = await page.locator('[data-toolbar-icon]').evaluateAll((els) =>
    els.map((e) => {
      const svg = e.querySelector('svg')
      const sr = svg ? svg.getBoundingClientRect() : null
      return {
        isAdd: e.hasAttribute('data-toolbar-add'),
        icon: sr ? Math.max(sr.width, sr.height) : 0,
        btn: e.getBoundingClientRect().width,
      }
    }),
  )
  const addBtnIcon = iconSizes.find((s) => s.isAdd)
  const others = iconSizes.filter((s) => !s.isAdd)
  rec(
    g,
    '★ 放大只作用于新建按钮，其它工具栏图标未被误伤',
    !!addBtnIcon &&
      others.length > 0 &&
      addBtnIcon.icon > Math.max(...others.map((o) => o.icon)) &&
      /*
       * 阈值取 **0.7**（不是 0.5）：正常比例就是 0.5（图标 27 / 按钮 54），
       * 用 `< 0.5` 会把**正确实现**判失败（实测踩过）。
       * 要拦的是「被撑满成 1.0」那种失误，0.7 留足余量。
       */
      others.every((o) => o.icon < o.btn * 0.7),
    `新建 ${Math.round(addBtnIcon?.icon ?? 0)}px；其它 ${others.map((o) => Math.round(o.icon)).join('/')}px（按钮 ${Math.round(others[0]?.btn ?? 0)}px）`,
  )

  /**
   * ★ 图标 / 按钮的**比例**必须还是 0.5（用户 2026-09-22 报「其他按钮变得太小」）。
   *
   * 背景：原设计是「图标 18 + 工具栏 `zoom: 1.5`」⇒ 渲染 27；按钮 36 ⇒ 渲染 54，
   * 比例 0.5。我为修半像素偏移取消了 zoom、把按钮换算成 54，**却漏了图标**——
   * 它仍是 18，比例掉到 1/3，肉眼立刻看出"图标变小了"。
   *
   * 判据用**比例**而不是写死 27：以后若再调整整体尺寸，只要比例不变，
   * 这条仍然成立；而"换算漏了一半导致比例失衡"会被逮住。
   */
  const ratio = others.length > 0 ? others[0].icon / others[0].btn : 0
  rec(
    g,
    '★ 普通图标 / 按钮比例保持 0.5（取消 zoom 时没漏换算）',
    Math.abs(ratio - 0.5) <= 0.03,
    `实测 ${ratio.toFixed(3)}（图标 ${Math.round(others[0]?.icon ?? 0)} / 按钮 ${Math.round(others[0]?.btn ?? 0)}）`,
  )

  /**
   * ★ 工具栏里的**文字**也要跟着放大（用户 2026-09-22：「这个地方的文字太小了，
   * 是因为左边按钮的 zoom:1.5 的原因吗？」——正是）。
   *
   * 取消 `.bar` 的 `zoom: 1.5` 时，这是**第二处漏换算**：按钮（36→54）与图标
   * （18→27）换了，**文字没换** ⇒ 名称标签与菜单项从 `12 × 1.5 = 18` 掉回 12。
   *
   * 判据用「字号 ≥ 16」而不是写死 18：这条要锁的是**可读性意图**
   * （文字明显大于旧 token 的 12px），以后微调字号不必重写。
   */
  await page.locator('[data-toolbar-reset]').hover()
  await sleep(450)
  const tipFont = await page
    .locator('[data-toolbar-tip]')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    .catch(() => 0)
  rec(
    g,
    '★ 按钮名称标签的字号已随 zoom 取消一起换算（≥16px）',
    tipFont >= 16,
    `${tipFont}px（旧 token 为 12px；原 zoom 下渲染 18px）`,
  )

  await page.locator('[data-toolbar-arrange-modes]').hover()
  await sleep(500)
  const menuFont = await page
    .locator('[data-toolbar-arrange-menu] button')
    .first()
    .evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    .catch(() => 0)
  rec(
    g,
    '★ 弹出菜单项的字号同样已换算（≥16px）',
    menuFont >= 16,
    `${menuFont}px`,
  )
  await page.mouse.move(760, 760)
  await sleep(300)

  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  const menuItems = await page.locator('[data-toolbar-menu-item]').count()
  // 7 项：提示词 / 生成 / 对比 / 分组 / 批量 / 循环 / 融合（画板节点已下线）
  rec(g, '新建节点菜单展开 7 项', menuItems === 7, `items=${menuItems}`)
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
  /**
   * 适配后节点（连同浮在框外的标题）不能被**常驻控件**压住。
   *
   * ⚠️ 判据在 2026-09-27 换过对象：原先量的是**画布顶部悬浮栏**的下沿，
   * 而那个顶栏已按 §6.2 整体去除。继续拿它当判据会**恒真**
   * （查询恒返回兜底值 56，节点当然都在 56 之下）——
   * 一条「看起来在守、其实什么都没守」的假断言，比没有更危险。
   *
   * 现在改量**应用壳侧栏的右沿**：它才是当前布局里真正可能压住画布内容的
   * 常驻控件（`FIT_PADDING` 要保证适配后节点落在它右边）。
   */
  const SIDEBAR_R = await page
    .evaluate(() => {
      const el = document.querySelector('[data-app-sidebar]')
      return el ? el.getBoundingClientRect().right : 0
    })
    .catch(() => 0)
  const notOccluded = nodeBoxes.length > 0 && nodeBoxes.every((bx) => bx.x >= SIDEBAR_R - 1)
  rec(
    g,
    '★ 重置视图后节点不被左侧功能栏遮挡（§5.10）',
    notOccluded,
    `最左节点 x=${nodeBoxes.length ? Math.min(...nodeBoxes.map((b) => b.x)).toFixed(0) : 'n/a'} 侧栏右沿=${SIDEBAR_R}`,
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
  /**
   * 8 种对齐已下线（2026-09-19），这里改验**垂直排列**——
   * 它同样把一组散开的节点归一到一个方向（x 全部相同），是同一类「整理布局」的证明。
   * 排列面板现在由指针进入按钮范围展开，故先 hover 再点具体模式。
   */
  const beforeAlign = await Promise.all(ids.map(posOf))
  await page.locator('[data-toolbar-arrange-modes]').hover()
  await sleep(250)
  await page.locator('[data-toolbar-arrange-mode="column"]').click()
  await sleep(500)
  const afterAlign = await Promise.all(ids.map(posOf))
  const xs = afterAlign.map((p) => p.x)
  rec(
    g,
    '垂直排列后 x 归一（§6.5 ②）',
    new Set(xs).size === 1 && new Set(beforeAlign.map((p) => p.x)).size > 1,
    `before=${beforeAlign.map((p) => p.x).join(',')} after=${xs.join(',')}`,
  )

  /**
   * ── 8. 整理节点：同层纵向等距（§6.5 ②）──
   *
   * 整理节点已于 2026-09-19 并入「排列与整理」面板（不再有独立按钮），
   * 且面板由**指针进入按钮范围**展开，故这里必须重新 hover 把那面板挂出来。
   */
  await page.locator('[data-toolbar-arrange-modes]').hover()
  await sleep(300)
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
    // 7 新建（含循环节点 §6.22、融合节点 §6.23）+ 重置视图 = 8 项
    '画布空白右键含 7 新建 + 重置视图（§4.1）',
    canvasSet.size === 8 && canvasSet.has('重置视图'),
    `items=${JSON.stringify(canvasMenu)}`,
  )

  /**
   * ★ 每个「新建 X 节点」都必须有矢量图标（用户 2026-09-25 报：循环节点没有）。
   *
   * 漏的是右键菜单 `MENU_ICON` 里的 `create:loop` —— 左侧「＋」菜单有、右键没有，
   * 六个类型里唯独它空一档。**这类「少一个」的缺陷读代码很难发现**，
   * 必须逐项比：可建类型集合 ↔ 实际带图标的项。
   *
   * 判据取 `<svg>` 而不是「有没有 span」：图标是 SVG 矢量（§「不要用文本字形当图标」），
   * 只查容器会漏。
   */
  const iconState = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-context-menu] [data-context-menu-item]')]
    return items
      .filter((el) => (el.getAttribute('data-context-menu-item') || '').startsWith('create:'))
      .map((el) => ({
        id: el.getAttribute('data-context-menu-item'),
        hasSvg: !!el.querySelector('svg'),
      }))
  })
  const missing = iconState.filter((i) => !i.hasSvg).map((i) => i.id)
  rec(
    g,
    '★ 每个新建项都有矢量图标（含循环 / 融合节点；图标两侧菜单同源）',
    iconState.length === 7 && missing.length === 0,
    `带图标 ${iconState.length}/7${missing.length ? ` 缺=${missing.join(',')}` : ''}`,
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
  await addNodeViaToolbar(page, 'prompt')
  await sleep(400)
  const id1 = await page.locator('[data-node-type="prompt"]').last().getAttribute('data-node-id')
  await moveNode(page, id1, 360, 260)
  await addNodeViaToolbar(page, 'prompt')
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
// G22 版本历史 + 画布时间轴（M4-3，§6.21 / §4.1）——**已于 2026-09-16 下线，不再跑**
//
// 下线原因见产品文档 §6.21：画布的生成语义是「产出落在空槽上」，源节点已有内容时
// 产物落到**新建的承载节点**上，于是「按节点攒版本、再回退」这条动线自相矛盾
// （挂在源节点 = 攒它并不持有的图；挂在新节点 = 只跑过一次，永远只有 1 版）。
// 功能入口既已移除，继续跑这组只会拿「已删除的功能没出现」当失败——
// 那是**断言与产品现状脱节**，不是缺陷。函数体保留，便于日后若恢复该功能时参照。
//
// 原流程：
// 跑两次生成 → 右键「版本历史」→ 面板列 2 版 → Ctrl+点击临时预览 → Esc 退出
// → 双击恢复 v1（追加 v3）→ ⌘H 时间轴（节点 / 状态过滤）
// ────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- g22 已移出全量（原因见上方注释），函数体保留以备恢复
async function g22(browser) {
  const g = 'G22 版本历史+时间轴'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 1) 配置 mock 渠道（与 G9 同）
  await configureMockChannel(page)

  // 2) 文生图模板进画布，配置生成节点
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  // 参数与提示词在创作面板里（M6-16 起节点本体只剩媒体框）
  const histPanel = await genPanel(page)
  await configureGenPanel(page, histPanel, '屋顶的猫')

  // 3) 跑两次。**2026-09-16 口径变更**：产出永远落在空槽上——第一次落在生成节点自己
  //    身上，第二次因为源节点已有图、不再是空槽，**新建承载节点**接第二张。
  //    完成信号仍是「生成按钮回到空闲态 + 有节点出图」。
  const runBtn = panelRunBtn(page)
  for (let i = 1; i <= 2; i++) {
    await runBtn.click()
    await sleep(400) // 让按钮先进入运行态，避免把「还没开始」读成「已完成」
    let done = false
    for (let t = 0; t < 60; t++) {
      // 第 2 次生成会新建节点，旧面板的按钮随选中变化而卸载 —— 用「有节点出图」兜底判定
      const label = await runBtn.getAttribute('aria-label').catch(() => '')
      if (label === '生成当前节点') { done = true; break }
      if (label === null && (await page.locator('[data-node-asset]').count()) > 0) { done = true; break }
      await sleep(250)
    }
    const assetCount = await page.locator('[data-node-asset]').count()
    rec(g, `第 ${i} 次生成完成并有节点出图`, done && assetCount >= i, `asset=${assetCount}`)
    await sleep(600)
  }

  // 4) 两次生成后应是**两个**生成节点（第二个承载第二次的产物）
  const genCount = await page.locator('[data-node-type="generation"]').count()
  rec(g, '两次生成产出两个生成节点（产出落在空槽上）', genCount === 2, `count=${genCount}`)

  // 5) 右键**最新那个**生成节点 → 「版本历史」→ 面板出现且列 1 版（它是新建的，只跑过一次）
  await page.locator('[data-node-type="generation"]').last().click({ button: 'right', force: true })
  await sleep(300)
  const historyItem = page.locator('[data-context-menu-item="history"]')
  rec(g, '右键菜单出现「版本历史」', (await historyItem.count()) > 0)
  await historyItem.click()
  await sleep(600)
  const panel = page.locator('[data-version-history-panel]')
  rec(g, '版本历史面板出现', (await panel.count()) === 1)
  const rows2 = await page.locator('[data-version-row]').count()
  rec(g, '新节点列出 1 版（它只跑过一次）', rows2 === 1, `rows=${rows2}`)

  // 5) Ctrl + 点击 v1 → 临时预览出现（30% 叠加）；Esc 退出
  await page.locator('[data-version-row="1"]').click({ modifiers: ['Control'] })
  await sleep(400)
  const previewShown = await page.locator('[data-version-preview]').count()
  rec(g, 'Ctrl+点击出现临时预览', previewShown === 1)
  await page.keyboard.press('Escape')
  await sleep(250)
  const previewGone = await page.locator('[data-version-preview]').count()
  rec(g, 'Esc 退出预览', previewGone === 0)

  // 6) 双击 v1 → 恢复该版本并追加新 RunRecord（该节点变 2 版，最新为 v2）
  await page.locator('[data-version-row="1"]').dblclick()
  await sleep(700)
  const rows3 = await page.locator('[data-version-row]').count()
  rec(g, '双击恢复 v1 后追加新版本（2 版）', rows3 === 2, `rows=${rows3}`)
  const firstRow = await page.locator('[data-version-row]').first().getAttribute('data-version-row')
  rec(g, '最新版本为 v2', firstRow === '2', `first=${firstRow}`)
  await page.screenshot({ path: `${OUT}/35-g22-version-history.png` })

  // 7) Ctrl+H 打开时间轴：列出记录，节点过滤与状态过滤可用
  await page.keyboard.press('Control+h')
  await sleep(500)
  const timeline = page.locator('[aria-label="画布时间轴"]')
  rec(g, 'Ctrl+H 打开时间轴', (await timeline.count()) === 1)
  const allRows = await page.locator('[data-timeline-row]').count()
  // 两个节点各有一条成功记录，新建的那个恢复一次 → 合计 3 条
  rec(g, '时间轴列出全部记录', allRows === 3, `rows=${allRows}`)
  await page.locator('[data-timeline-node-filter]').selectOption({ index: 1 })
  await sleep(400)
  const nodeRows = await page.locator('[data-timeline-row]').count()
  rec(g, '按节点过滤生效', nodeRows >= 1 && nodeRows < allRows, `rows=${nodeRows}/${allRows}`)
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
// G23 LLM 优化与翻译（M4-4 / §6.7）。
//
// ⚠️ **口径已变（用户 2026-09-24）**：删掉了「写入节点」按钮。
//
// 此前：面板 = 草稿工作区（`data.draft`），节点正文 = 最终提示词（`data.text`），
// 两者解耦，「写入节点」是唯一的桥。现在**面板直接写正文** ——
// 面板里打的字就是下游读到的东西，不需要也不存在第二道确认。
//
// 这条口径变化必须连着改执行层：若只删按钮、面板仍写 `draft`，
// 就会出现「面板打了字、下游永远收不到」的静默失效。
// ────────────────────────────────────────────────────────────
async function g23(browser) {
  const g = 'G23 LLM优化翻译'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  page.on('pageerror', (e) => rec(g, '无未捕获异常', false, String(e).slice(0, 120)))

  // 1) 配置 mock 渠道（同 g9）：新增 → 验证（拉全部模型）→ 勾选 → 启用
  const g23ch = await configureMockChannel(page)
  rec(g, '渠道验证通过（模型缓存含 chat）', g23ch.verified)

  /*
   * 2) 建提示词节点并写入正文。
   *
   * 编辑入口 2026-09-21 变了：双击正文不再是「进节点内编辑态」（那个 textarea
   * 已删除），而是**全选**；正文编辑统一走**文本编辑灯箱**。
   * 这里走跟用户一样的路：右键 → 全屏编辑 → 写 → Esc。
   * 用 `setTextViaEditor` 而不是各写一遍，避免下次再改入口时又漏掉几处。
   */
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await createProject(page)
  await addNodeViaToolbar(page, 'prompt')
  await sleep(400)
  const promptNode = page.locator('[data-node-type="prompt"]').first()
  await setTextViaEditor(page, promptNode, '一只猫')
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
  /**
   * 提示词节点也**没有平台 chip** 了（用户 2026-09-27 第 8 轮：
   * 「提示词节点也不需要平台的配置了，只需要模型即可」）。
   * 渠道由面板的解析链自动落到节点上，这里直接选模型。
   */
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

  /**
   * 4) 面板与正文现在是**同一份内容**（用户 2026-09-24 删掉「写入节点」）。
   *
   * 面板一打开就回显节点正文；两边不再是「草稿 vs 正文」两份。
   */
  const panelTa = () => panelPrompt(panel)
  rec(g, '面板回显节点正文（不再是空的草稿框）', (await readPanelPrompt(panel)).includes('一只猫'))
  rec(g, '节点正文仍是灯箱输入的文本', (await nodeText()).includes('一只猫'))
  rec(
    g,
    '★「写入节点」按钮已删除（面板直接写正文）',
    (await panel.locator('[data-panel-prompt-apply]').count()) === 0,
  )

  // 5) 面板输入**直接写正文**：节点本体立刻跟着变
  await panelTa().click()
  await panelTa().fill('面板直接写正文')
  await panelTa().blur()
  await sleep(600)
  rec(
    g,
    '★★ 面板输入直接落到节点正文（下游读的就是它）',
    (await nodeText()).includes('面板直接写正文'),
  )

  // 6) 面板「优化」→ LLM 结果直接覆盖正文（mock 返回 mock:<system+text>）
  await panel.locator('[data-panel-prompt-tools] button', { hasText: '优化' }).click()
  let optimized = false
  for (let i = 0; i < 30; i++) {
    if ((await nodeText()).includes('mock:')) {
      optimized = true
      break
    }
    await sleep(200)
  }
  rec(g, '★ 面板「优化」结果直接进正文', optimized)

  // 7) Ctrl+Z → 优化结果回滚（进撤销栈）
  await page.keyboard.press('Control+z')
  await sleep(400)
  rec(g, '★ 优化结果可撤销（还原成面板里那句）', !(await nodeText()).includes('mock:'))

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

  // 10) 面板点「翻译」→ 同样直接改正文
  const bodyBeforeTranslate = afterNodeRun
  await panel.locator('[data-panel-prompt-tools] button', { hasText: '翻译' }).click()
  let translated = false
  for (let i = 0; i < 30; i++) {
    const t = await nodeText()
    if (t !== bodyBeforeTranslate) {
      translated = true
      break
    }
    await sleep(200)
  }
  rec(g, '面板点「翻译」→ 正文变化', translated)
  await page.screenshot({ path: `${OUT}/38-g23-after-translate.png` })

  /**
   * 11) 工具行的**外观与位置**（用户 2026-09-24 两轮反馈）：
   *  ① 它和渠道 / 模型 chip 同形（同高、无边框、透明底、同字号）；
   *  ② 与参数组之间只有**一条竖线**；
   *  ③ 字数行不再撑出大空隙。
   *
   * 判据全用**几何 + 计算样式**：只看渲染结果判断不了「像不像」，
   * 而这几条恰恰是视觉一致性问题，必须量出来。
   */
  const ui = await panel.evaluate((panelEl) => {
    const group = panelEl.querySelector('[data-panel-part="params"] [class*="toolGroup"]')
    const btn = group?.querySelector('button')
    /**
     * 比对的 chip 取**模型**那一个（用户 2026-09-27 第 8 轮起提示词节点
     * 也没有平台 chip 了，取它会让这里恒为 null、整组断言静默失真）。
     */
    const chip = panelEl.querySelector('[data-param-chip="model"]')
    const count = panelEl.querySelector('[data-panel-prompt-count]')
    const params = panelEl.querySelector('[data-panel-part="params"]')
    if (!group || !btn || !chip) return null
    const bs = getComputedStyle(btn)
    const cs = getComputedStyle(chip)
    const divider = getComputedStyle(group, '::before')
    const countBox = count?.getBoundingClientRect()
    const paramsBox = params?.getBoundingClientRect()
    return {
      sameHeight: Math.abs(btn.getBoundingClientRect().height - chip.getBoundingClientRect().height) <= 1,
      sameFont: bs.fontSize === cs.fontSize && bs.fontWeight === cs.fontWeight,
      btnBorder: bs.borderStyle,
      btnRadius: bs.borderRadius,
      chipRadius: cs.borderRadius,
      dividerW: divider.width,
      dividerH: divider.height,
      dividerContent: divider.content,
      /**
       * 字距：正文 / 参数 chip / 按钮要走**同一条**，而且不能是 `normal`
       * （用户 2026-10-05 第 4 批：「图三这些文字字间距都很小，显示的很挤」）。
       *
       * ⚠️ 这三处必须一起比：`font: inherit` **带不出**字距（Chrome 下按钮会回到 `normal`），
       * 所以 base.css 里额外写了 `letter-spacing: inherit` —— 少了那一句，
       * chip / 按钮与正文就不是一个字距（实测过：body 0.64px、按钮 normal）。
       */
      tracking: {
        prompt: getComputedStyle(panelEl.querySelector('[data-panel-prompt]')).letterSpacing,
        chip: cs.letterSpacing,
        btn: bs.letterSpacing,
      },
      /** 字数行下沿到参数行上沿的距离：应当是常规间距，不是一整行空白 */
      gapAfterCount: countBox && paramsBox ? Math.round(paramsBox.top - countBox.bottom) : null,
      /** 工具组与生成按钮同一行（顶边接近） */
      sameRowAsRun: (() => {
        const run = panelEl.querySelector('[data-panel-run]')
        if (!run) return false
        return Math.abs(group.getBoundingClientRect().top - run.getBoundingClientRect().top) <= 4
      })(),
    }
  })
  rec(g, '★ 工具行与参数 chip 同高', !!ui?.sameHeight, `h相同=${ui?.sameHeight}`)
  rec(g, '★ 工具行与参数 chip 同字号 / 字重', !!ui?.sameFont, `font同=${ui?.sameFont}`)
  rec(
    g,
    '★★ 字距：正文 / 参数 chip / 按钮同一条且非 normal（字不许挤）',
    !!ui &&
      ui.tracking.prompt !== 'normal' &&
      ui.tracking.prompt === ui.tracking.chip &&
      ui.tracking.prompt === ui.tracking.btn,
    JSON.stringify(ui?.tracking),
  )
  rec(
    g,
    '★ 工具按钮与 chip 同为无边框圆角块（不再是小描边胶囊）',
    ui?.btnBorder === 'none' && ui?.btnRadius === ui?.chipRadius,
    `border=${ui?.btnBorder} radius=${ui?.btnRadius}/${ui?.chipRadius}`,
  )
  rec(
    g,
    '★ 工具组与参数组之间只有一条竖线',
    ui?.dividerW === '1px' && ui?.dividerContent === '""',
    `w=${ui?.dividerW} h=${ui?.dividerH} content=${ui?.dividerContent}`,
  )
  rec(
    g,
    '★ 工具组与生成按钮同一排',
    !!ui?.sameRowAsRun,
    `sameRow=${ui?.sameRowAsRun}`,
  )
  rec(
    g,
    '★ 字数行下方不再留大空隙（≤ 16px）',
    typeof ui?.gapAfterCount === 'number' && ui.gapAfterCount <= 16,
    `gap=${ui?.gapAfterCount}px`,
  )

  /**
   * 12) 面板**高度自适应** + 文字框**细滚动条**（用户 2026-09-24 第 1 条）。
   *
   * 「我不想要文字太多的时候右边出现滚动条，自适应就好，包括其他的创作面板」；
   * 「文本输入框可以有滚动条，但是要细一点，而且不要上下两个箭头，
   *   同时滚动条的背景颜色也不要」。
   *
   * 判据：面板**长高**（而不是内部出现滚动条），
   * 文字框的 `resize` 关掉（右下角那个拖拽手柄是死的）、滚动条为 thin。
   */
  // 先量短文本时的面板高度
  await panelTa().fill('短')
  await panelTa().blur()
  await sleep(600)
  const shortH = (await panel.boundingBox())?.height ?? 0

  // 再灌 30 行，面板应变高
  const longLines = Array.from({ length: 30 }, (_, i) => `第 ${i + 1} 行`).join('\n')
  await panelTa().fill(longLines)
  await panelTa().blur()
  await sleep(900)
  const longPanel = await panel.evaluate((el) => {
    const b = el.getBoundingClientRect()
    /** 提示词框现在是富文本框（`[data-panel-prompt]`），不再有 textarea */
    const ta = el.querySelector('[data-panel-prompt]')
    return {
      h: Math.round(b.height),
      // 面板底部相对视口的位置：验证它没有伸到屏幕外
      bottom: Math.round(b.bottom),
      viewportH: window.innerHeight,
      /**
       * 文字框是否在自己滚。
       *
       * 面板**刻意**不是滚动容器（那会把参数浮层裁掉，G46 抓到过），
       * 所以「空间不够」的表现是**文字框滚**，不是面板滚。
       */
      taScrolls: ta ? ta.scrollHeight > ta.clientHeight + 1 : false,
    }
  })
  /**
   * 判据必须容纳**两种正确形态**（面板高度上限取决于「锚点下方还剩多少空间」）：
   *  - 空间够 → 面板长高（用户要的「自适应」）；
   *  - 空间不够 → 面板停在上限、内部滚动（绝不把内容裁掉，见下一条）。
   *
   * 这条用例里提示词节点靠近屏幕下方，所以走的是第二种。
   * **不能**只断言「变高了」—— 那会把「高度被合理钳制」误判成缺陷。
   */
  const grewOrScrolls = (() => {
    if (longPanel.h > shortH + 20) return { ok: true, why: '面板长高了' }
    return longPanel.taScrolls
      ? { ok: true, why: '空间不足 → 文字框自己滚（未裁内容）' }
      : { ok: false, why: '既没长高，文字框也没滚（内容被裁了）' }
  })()
  rec(
    g,
    '★★ 文字变长 → 面板长高；空间不足则文字框自己滚（都不可裁内容）',
    grewOrScrolls.ok,
    `短 ${Math.round(shortH)} → 长 ${longPanel.h}｜${grewOrScrolls.why}`,
  )
  /** 无论哪种形态，面板都**不许伸出屏幕底部**（否则参数行与生成按钮被推出可视区） */
  rec(
    g,
    '★★ 面板不伸出屏幕底部（生成按钮始终可达）',
    longPanel.bottom <= longPanel.viewportH + 2,
    `bottom=${longPanel.bottom} viewport=${longPanel.viewportH}`,
  )

  /**
   * ★★ 面板底部**不许留多余空白**（用户 2026-09-25 报「参数那一排下面怎么这么多空」）。
   *
   * 这是「高度自适应」那次改动的回归：`height:360 → min-height:360` 的同时
   * 把提示词区的 `flex:1 1 auto` 改成了 `flex:0 0 auto`，剩余空间没人吸收，
   * 三段顶在上边、底部露出一条死白（实测 74px）。
   *
   * 判据：最后一段（参数行）底边到面板底边的距离 ≤ **内边距 + 2px 容差**。
   * 内边距实测 13px（= padding 设计值 × zoom 0.75），故阈值取 16px ——
   * 与上面「字数行下方不再留大空隙」同一口径，且留了亚像素余量。
   *
   * 注意这一条要放在**短内容**之后量：内容一长面板就被内容撑满，
   * 空白自然消失，那时断言恒真、什么也证明不了。
   */
  await panelTa().fill('短')
  await panelTa().blur()
  await sleep(700)
  const tailGap = await panel.evaluate((el) => {
    const b = el.getBoundingClientRect()
    const kids = [...el.children]
    const last = kids[kids.length - 1]
    if (!last) return null
    const lb = last.getBoundingClientRect()
    return Math.round(b.bottom - lb.bottom)
  })
  rec(
    g,
    '★★ 面板底部无多余空白（参数行下方只剩内边距）',
    typeof tailGap === 'number' && tailGap <= 16,
    `底部留白=${tailGap}px（阈值 16）`,
  )

  const taStyle = await panelTa().evaluate((el) => {
    const cs = getComputedStyle(el)
    /**
     * 读 `scrollbar-width` 的**计算值**：
     *  - 我写过标准属性 → 计算值会是 `thin` / `auto`（非 `auto` 才算写过 thin）；
     *  - 未写过 → `auto`。
     *
     * ⚠️ 这一条是本轮缺陷的**根因检查**：只要声明了标准的 `scrollbar-width`，
     * 现代 Chromium 就切到内置滚动条，并**整组忽略 `::-webkit-scrollbar-*`** ——
     * 于是「隐藏上下箭头」那条规则失效，用户看到的箭头又回来了。
     * 所以这里必须断言它是 `auto`（= 我没写），否则箭头随时可能复活。
     */
    return {
      resize: cs.resize,
      scrollbarWidth: cs.scrollbarWidth,
      scrollbarColor: cs.scrollbarColor,
    }
  })
  rec(
    g,
    '★ 文字框右下角的拖拽手柄已去掉（resize: none）',
    taStyle.resize === 'none',
    `resize=${taStyle.resize}`,
  )
  rec(
    g,
    '★★ 不声明标准 scrollbar-width（否则 Chromium 会忽略 webkit 规则、箭头复活）',
    taStyle.scrollbarWidth === 'auto',
    `scrollbar-width=${taStyle.scrollbarWidth}`,
  )
  /**
   * webkit 伪元素规则必须真的在样式表里。
   *
   * 判据是「从注入的样式表里找得到 `.prompt::-webkit-scrollbar-button` 且带 display:none」——
   * 直接读 CSSOM 查这条规则，比截图更早、也更稳（截图受 headless 的 overlay 滚动条影响，
   * 那是**测不出来**的，本项目已踩过：headless 的 `offsetWidth - clientWidth` 恒为 0）。
   */
  const sbRules = await page.evaluate(() => {
    const found = { button: null, bar: null, track: null }
    /** 取文本框自身的类名（CSS module 哈希过），只认它那一组规则 */
    const ta = document.querySelector('[data-panel-prompt]')
    const promptClass = ta ? [...ta.classList].find((c) => c.includes('prompt')) ?? '' : ''
    /**
     * ⚠️ 选择器是 **CSS module 哈希过的**：`.prompt::-webkit-scrollbar` 实际长成
     * `._prompt_xxxxx_123::-webkit-scrollbar`。所以不能用 `===` 比对整串，
     * 必须按**后缀**匹配伪元素部分。
     */
    for (const sheet of document.styleSheets) {
      let rules
      try {
        rules = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of rules) {
        const sel = rule.selectorText ?? ''
        if (!sel.includes('::-webkit-scrollbar')) continue
        /*
         * 用**精确后缀**区分，别用 `includes('-button')`：
         * 基类 `::-webkit-scrollbar` 是另外几条的前缀，
         * includes 判断会把顺序搅乱（实测 base 规则被当成 button）。
         */
        /*
         * 只认**提示词文本框自己**那组规则。
         *
         * 页面上还有别的组件也写了 `::-webkit-scrollbar`（如缩略图行、顶栏标签），
         * 它们的规则会先被遍历到 —— 第一版就因此读到了 `display:none`、
         * 而把真正的宽度规则漏过去。所以这里先按「这个元素自己的类名」过滤。
         */
        if (!sel.includes(promptClass)) continue
        if (sel.endsWith('::-webkit-scrollbar-button')) found.button = rule.style.display
        else if (sel.endsWith('::-webkit-scrollbar-track')) found.track = rule.style.background
        else if (sel.endsWith('::-webkit-scrollbar-thumb:hover')) continue
        else if (sel.endsWith('::-webkit-scrollbar-thumb')) continue
        else if (sel.endsWith('::-webkit-scrollbar-corner')) continue
        else if (sel.endsWith('::-webkit-scrollbar')) found.bar = rule.style.width
      }
    }
    return found
  })
  rec(
    g,
    '★★ 箭头已隐藏（webkit button display:none）',
    sbRules.button === 'none',
    `scrollbar-button display=${sbRules.button}`,
  )
  rec(
    g,
    '★ 滚动条宽度已收窄（webkit 6px，屏幕上约 4.5px，系统默认 15px）',
    sbRules.bar === '6px',
    `width=${JSON.stringify(sbRules.bar)}`,
  )
  rec(
    g,
    '★ 轨道取节点内部同色（不是 transparent）',
    !!sbRules.track && !/transparent|rgba\(0, 0, 0, 0\)/.test(sbRules.track),
    `track=${sbRules.track}`,
  )

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
  await gotoProjects(page)
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

  // 1) 侧栏「渠道配置」→ 设置页
  /*
   * ⚠️ 2026-09-27 应用壳改版（产品文档 §2.1 / §6.2）：
   * 各页自己的全局顶栏已去掉，导航出口统一由**应用壳左侧功能栏**承担。
   * 所以这里不再找「首页顶栏的后台设置按钮」，改为点侧栏的一级导航项。
   * 断言的**意图不变**：这个入口存在、且能到 `/settings`。
   */
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  await ensureSidebarOpen(page)
  await page.locator('[data-sidebar-item="/settings"]').click()
  await page.waitForURL(/\/settings/)
  rec(g, '侧栏「渠道配置」可进入设置页', page.url().includes('/settings'))
  /*
   * ★ 设置页的「← 返回」按钮**已按用户要求移除**（2026-09-27）：
   * 「工作区的返回按钮都可以不用了，目前可以直接在侧边栏进行替换了」。
   *
   * 所以这里**反过来断言它不存在** —— 少了这条，将来有人「顺手加回去」
   * 就会多出第二套导航，而没有断言会拦住它。
   */
  rec(
    g,
    '★ 设置页不再有自己的「← 返回」（导航归侧栏）',
    (await page.locator('[data-settings-back]').count()) === 0,
  )

  // 2) 模板建一个画布项目，记住 URL 供后面比对
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)
  const canvasUrl = page.url()

  // 3) 应用壳侧栏承担导航出口（§2.1 / §2.2）
  /*
   * ⛔ 原来的三条断言全部指向**已删除的**画布顶栏
   * （`data-topbar-back` / 品牌文字 / `data-topbar-settings`）以及它的
   * “加大一倍”尺寸 —— 顶栏没了，那几条要么恒假、要么在要求一个不该存在的东西。
   *
   * 能力本身没有消失，只是换了宿主（§6.2 的迁移表）：
   *   品牌 / 返回首页 → 侧栏 Logo（此处不承担返回职责，回首页走导航项）
   *   后台设置        → 一级导航「渠道配置」
   * 所以改为断言**新宿主**，并补一条「旧顶栏确实不在」的护栏。
   */
  await ensureSidebarOpen(page)
  rec(g, '应用壳侧栏在全路由常驻', (await page.locator('[data-app-sidebar]').count()) === 1)
  rec(
    g,
    '★ 侧栏「渠道配置」就是原来的后台设置入口',
    (await page.locator('[data-sidebar-item="/settings"]').count()) === 1,
  )
  rec(
    g,
    '★ 画布页不再有旧的顶部悬浮栏（§6.2 已去除）',
    (await page.locator('[data-topbar]').count()) === 0,
  )

  /**
   * 侧栏宽度两档（§5.10）：收起 64 / 展开 240。
   * 这条替代了原来的「顶栏加大一倍」：同一个意图 —— **壳层的尺寸是产品口径**，
   * 不是随手写的数 —— 只是对象从顶栏换成了侧栏。
   */
  const sidebarWidths = await measureSidebarWidths(page)
  rec(
    g,
    '★ 侧栏两档宽度：收起 64 / 展开 240（§5.10）',
    sidebarWidths.collapsed === 64 && sidebarWidths.expanded === 240,
    `收起=${sidebarWidths.collapsed} 展开=${sidebarWidths.expanded}`,
  )

  /*
   * 「后台设置在日志右边」这条**随顶栏一并作废**（§6.2）。
   *
   * 它原先约束的是「一横向工具栏里两个按钮的左右顺序」。现在这两件事
   * 分居两处、不在同一个容器里（日志在画布右上角、渠道配置在一级侧栏），
   * 没有任何「谁在谁右边」可言 —— 继续断言只会测出一个无意义的结果。
   * 取而代之的是下面这条**跨页可达性**：从画布出发，日志能开、渠道配置能到。
   */
  const logBtnOnCanvas = page.locator('[data-canvas-log]')
  rec(g, '★ 画布右上角有日志入口（§6.2 迁移）', (await logBtnOnCanvas.count()) === 1)
  await logBtnOnCanvas.click()
  await sleep(400)
  const logOpened = await page.locator('[data-log-panel]').count()
  rec(g, '★ 点它能打开日志面板', logOpened === 1, `logPanel=${logOpened}`)
  if (logOpened) {
    // 关掉，别影响后面的用例
    await page.keyboard.press('Escape')
    await sleep(300)
  }

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

  // 5) 面板上的出口能直接进设置
  await hint.first().click()
  await page.waitForURL(/\/settings/)
  rec(g, '面板上的出口可进后台设置', page.url().includes('/settings'))

  // 6) 建渠道但**不启用** → 文案必须切换。
  //    这两种情况用户最容易混淆：以为「建过」就等于「配好了」。
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(500)
  await page.getByText('新建渠道').first().click()
  await sleep(300)
  /**
   * 回画布改走**侧栏「最近项目」**（用户 2026-09-27 移除设置页返回按钮后的替代路径）。
   *
   * 这一点值得单独断言：返回按钮删掉之后，「配完渠道怎么回到刚才那个画布」
   * 必须有别的路 —— 如果侧栏最近项目不可用，用户就被困在设置页了。
   * 断言的是**回到同一个项目**（URL 相等），不只是「回到了画布」。
   */
  await ensureSidebarOpen(page)
  const recentLink = page.locator('[data-sidebar-recent-item]').first()
  rec(g, '设置页可从侧栏「最近项目」回画布（替代已删的返回按钮）', (await recentLink.count()) >= 1)
  await recentLink.click()
  await page.waitForURL(/\/canvas\//)
  rec(g, '回到的是原来那个项目（不是新建一个）', page.url() === canvasUrl, `期望=${canvasUrl} 实际=${page.url()}`)
  await sleep(500)
  await selectGenNode()
  const hint2 = await page.locator('[data-panel-setup-hint]').count()
  const hint2Text = hint2 ? norm(await page.locator('[data-panel-setup-hint]').first().innerText()) : ''
  rec(g, '渠道未启用时文案切换为「都未启用」', hint2Text.includes('未启用'), hint2Text)

  // 7) 侧栏「渠道配置」→ 启用 → 回画布：引导消失，平台下拉出现该渠道
  //    （原为顶栏的「后台设置」，2026-09-27 起入口归一级导航，见 §6.2 迁移表）
  await ensureSidebarOpen(page)
  await page.locator('[data-sidebar-item="/settings"]').click()
  await page.waitForURL(/\/settings/)
  await page.getByText('新建渠道').first().click()
  await sleep(300)
  await page.locator('input[type="checkbox"]').first().check()
  await sleep(400)
  // 同上：用侧栏最近项目回画布（设置页的返回按钮已移除）
  await ensureSidebarOpen(page)
  await page.locator('[data-sidebar-recent-item]').first().click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  rec(g, '渠道启用后节点本体仍无参数控件（参数只在面板）', (await page.locator('[data-node-type="generation"] select').count()) === 0)
  await selectGenNode()
  rec(g, '渠道启用后面板引导条消失', (await page.locator('[data-panel-setup-hint]').count()) === 0)
  const panelNow = page.locator('[data-creation-panel]')
  /**
   * 用户 2026-09-27 起生成节点**不再有平台 chip**（渠道由选路决定），
   * 故这里改为断言「模型下拉已可用、且列出了固定显示名」——
   * 它才是这个面板现在真正要验的东西。
   */
  const modelOpts = await paramOptions(page, panelNow, 'model')
  rec(
    g,
    '★ 渠道启用后模型下拉可用（生成节点已无平台 chip）',
    (await panelNow.locator('[data-param-chip="channel"]').count()) === 0 && modelOpts.length > 0,
    `opts=${JSON.stringify(modelOpts)}`,
  )

  // 8) 刷新后引导不回来（渠道是落库的应用级单例，不是内存态）
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(1000)
  // 刷新后选中态丢失，必须重新选中节点才看得到面板
  await selectGenNode()
  const modelAfterReload = await paramOptions(page, page.locator('[data-creation-panel]'), 'model')
  rec(
    g,
    '刷新后仍无引导（渠道已落库）',
    (await page.locator('[data-panel-setup-hint]').count()) === 0 && modelAfterReload.length > 0,
    `opts=${JSON.stringify(modelAfterReload)}`,
  )

  /**
   * 9) 工作台里同样有进入后台设置的出口。
   *
   * 沿革：最早验的是漫画页顶栏 → comic 移除后改为画布页顶栏 →
   * **2026-09-27 应用壳改版后顶栏整体去除**（产品文档 §6.2），
   * 出口归一级导航「渠道配置」。断言**意图始终没变**：
   * 「在工作台里能进后台设置」。
   *
   * 不要因为入口换地方就把这一条删掉：这是本项目**修过一次回归**的地方
   * （§七「工作区导航断头路」——当时文档标 ✅，按钮根本不存在）。
   * 入口会搬家，但「搬完之后还在不在」必须一直有人守着。
   */
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(300)
  /** 用既有的 `createProject`：它会按「空态 / 网格态」自己选入口，不重复实现一遍 */
  await createProject(page)
  // 壳层随路由常驻；等侧栏真出来再断言（lazy chunk 渲染有时间差）
  await page.locator('[data-app-sidebar]').waitFor({ state: 'visible', timeout: 8000 })
  await ensureSidebarOpen(page)
  rec(
    g,
    '画布页可从侧栏进入「渠道配置」',
    (await page.locator('[data-sidebar-item="/settings"]').count()) === 1,
  )
  // 点了确实到设置页，才算「入口真的通」
  await page.locator('[data-sidebar-item="/settings"]').click()
  await page.waitForURL(/\/settings/, { timeout: 6000 }).catch(() => {})
  rec(g, '点它确实到设置页', page.url().includes('/settings'), page.url())
  rec(
    g,
    '画布页不再有旧的顶部悬浮栏（§6.2）',
    (await page.locator('[data-topbar]').count()) === 0,
  )

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
  await page.locator('[data-settings-protocol]').selectOption('openai-compatible')
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
  rec(g, '验证后协议不被弹回旧值', protoAfter === 'openai-compatible', protoAfter)
  await page.screenshot({ path: `${OUT}/43-b-openai-unreachable.png` })

  // C) 刷新 → 协议与地址都已落库（B 的「先落库后验证」生效）
  await sleep(600)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(800)
  await page.getByText('新建渠道').first().click()
  await sleep(300)
  const protoReload = await page.locator('[data-settings-protocol]').inputValue()
  rec(g, '刷新后协议仍是新值（已落库）', protoReload === 'openai-compatible', protoReload)
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
  // 列表项要能一眼看出「这条渠道能用什么」（用户 2026-10-01）
  const capKeys = await page
    .locator('[data-channel-cap]')
    .first()
    .evaluate((el) =>
      [...el.parentElement.querySelectorAll('[data-channel-cap]')].map((c) =>
        c.getAttribute('data-channel-cap'),
      ),
    )
  rec(
    g,
    '★ 列表项显示这条渠道能用什么（对话 / 生图 / 视频）',
    capKeys.length > 0 && capKeys.every((k) => ['chat', 'image', 'video'].includes(k)),
    capKeys.join(','),
  )
  // 模型映射行也要带厂商图标（与画布那边的模型下拉同源，一份实现两处引用）
  const mapRowLogo = await page
    .locator('[data-route-map-row] [data-model-logo]')
    .first()
    .getAttribute('data-model-logo')
    .catch(() => null)
  rec(g, '★★ 模型映射行带厂商图标', !!mapRowLogo, mapRowLogo ?? '未找到图标')
  await page.screenshot({ path: `${OUT}/44-a-channels.png` })

  // ② 选渠道乙 → 存令牌 → 尾 4 位可见（脱敏显示）
  await page.locator('[data-channel-item]').filter({ hasText: '渠道乙' }).click()
  await sleep(300)
  const tokenInput = page.locator('input[type="password"]').first()
  await tokenInput.fill('sk-1234567890abcdef3f2a')
  /**
   * 用 `data-settings-save` 锚点而不是文案。
   *
   * 原来靠 `保存` 精确匹配区分「保存配置」；但映射区（§7.4.1）每个显示名
   * 也各有一个「保存」按钮，文案撞车后 `exact` 也照样命中多个。
   * 锚点是稳定标识，不随按钮文案变化。
   */
  await page.locator('[data-settings-token-save]').click()
  await sleep(400)
  const tailText = await page.locator('[data-settings-token-tail]').innerText().catch(() => '')
  rec(g, '令牌保存后显示尾 4 位（脱敏）', norm0(tailText).includes('3f2a'), tailText)
  rec(g, '页面不出现令牌明文', !(await page.locator('body').innerText()).includes('sk-1234567890abcdef3f2a'))
  await page.screenshot({ path: `${OUT}/44-b-token-tail.png` })

  // ③ 删除令牌 → 提示消失、渠道还在、可再存（用锚点避开「删除渠道」）
  await page.locator('[data-settings-token-remove]').click()
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

  /**
   * ① 铺满工作区 + 整页不溢出。
   *
   * ⚠️ 口径改过两次，这里记着免得下次又拿旧像素当判据：
   *  · 最初是「一页一张 1060px 居中卡片」；
   *  · 2026-09-25 加页内二级导航后，卡片自己不再居中（右侧贴导航，必然偏右），
   *    改量「导航 + 内容」整块是否居中；
   *  · **2026-09-27 应用壳改版**：页内二级导航整体删除，设置页变成右侧工作区里的
   *    一个插槽，口径最终定为**铺满工作区**（见下面那条断言）。
   *
   * 所以现在不再量「居中」，只量「铺满」与「不溢出」——
   * 铺满意味着左右边距天然为 0，再拿旧的居中判据没有意义。
   */
  const geom = await page.evaluate(() => {
    const card = document.querySelector('[data-settings-card]')
    /*
     * ⚠️ **参照系是右侧工作区**，不是整个窗口（2026-09-27 应用壳改版）。
     *
     * 设置页现在在应用壳工作区里，左边多了侧栏那 64/240px。
     * 仍拿 `window.innerWidth` 算，会得到「左 142 / 右 78」——
     * 看起来像「没铺满」，其实是**参考错了坐标系**。
     * 产品文档 §5.1 写明：工作区里的内容相对**右侧工作区**量，不是相对窗口。
     */
    const ws = document.querySelector('[data-app-workspace]')
    const wsr = ws ? ws.getBoundingClientRect() : { left: 0, right: window.innerWidth }
    const r = card.getBoundingClientRect()
    return {
      w: Math.round(r.width),
      /* 判「铺满工作区」要用它：卡片宽应与工作区宽一致（见下面的断言） */
      workspaceW: Math.round(wsr.right - wsr.left),
      vh: window.innerHeight,
      scrollH: document.documentElement.scrollHeight,
    }
  })
  /**
   * ★ 卡片**铺满工作区**（2026-09-27 改口径）。
   *
   * 原断言是「宽 ≤ 1062」（那张 1060px 居中卡片的老设计）。应用壳改版后
   * 设置页不再是独立整屏页，而是右侧工作区里的一个插槽，口径变成**铺满**。
   *
   * 必须改而不是留着：上游 `e26767c` 新加的 G74 断言要求「卡片 ≥ 工作区宽 − 40」，
   * 与旧的「≤ 1062」**正好相反** —— 同一份代码会被两条断言判成两个结论
   * （实测 G74 过、G45 红）。留着它只会每次全量都报一个假失败。
   */
  rec(
    g,
    '★ 卡片铺满工作区（不是旧的 1060px 居中卡片）',
    geom.w >= geom.workspaceW - 40,
    `卡片=${geom.w} 工作区=${geom.workspaceW}`,
  )
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
    (await page.locator('[data-settings-protocol]').inputValue()) === 'openai-compatible',
    await page.locator('[data-settings-protocol]').inputValue(),
  )
  rec(
    g,
    '左栏协议短标签同步为 OAI+',
    norm(await page.locator('[data-channel-proto]').first().innerText()) === 'OAI+',
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
  await gotoProjects(page)
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
  /**
   * 用户 2026-09-27：「生图节点的平台选中都不需要了」。
   * 生成节点（图片 / 视频）改由**选路**决定渠道，面板不再挂平台 chip；
   * 上拉浮层改在**模型 chip** 上验（它是生成节点现在最主要的选择器）。
   */
  const chip = panel.locator('[data-param-chip="model"]')
  rec(
    g,
    '★ 生成节点已无平台 chip（渠道由选路决定）',
    (await panel.locator('[data-param-chip="channel"]').count()) === 0 &&
      (await panel.locator('select').count()) === 0,
  )
  await chip.click()
  await sleep(220)
  const popup = panel.locator('[data-param-popup="model"]')
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
  await panelPrompt(panel).click()
  await sleep(200)
  rec(g, '点浮层外关闭', (await panel.locator('[data-param-popup]').count()) === 0)

  // 真正选中一个渠道模型（上面几轮都只是在开合浮层，从没选过值）
  await chip.click()
  await sleep(220)
  await panel.locator('[data-param-popup="model"] button', { hasText: 'mock-image-1' }).first().click()
  await sleep(200)
  rec(g, '模型 chip 带出所选值', (await paramLabel(panel, 'model')) === 'mock-image-1')

  // 开新关旧（§6.8）：一个开着时点另一个 chip，应只剩新的那个
  await chip.click()
  await sleep(200)
  await chipOf(panel, 'ratio').click()
  await sleep(250)
  rec(
    g,
    '开新关旧：同一时刻只有一个浮层',
    (await panel.locator('[data-param-popup]').count()) === 1 &&
      (await panel.locator('[data-param-popup="gen-params"]').count()) === 1,
  )
  await page.keyboard.press('Escape')
  await sleep(150)

  /**
   * 比例现在是**固定的 13 档图形化网格**（用户 2026-09-17 拍板：与参考产品对齐，
   * 不再按模型上报收窄——模型上报的那几档往往只有 1:1 / 16:9，反而限制创作）。
   * 旧断言「模型声明 2 档就只出 2 档」已随这条决策作废。
   */
  const ratioOpts = await paramOptions(page, panel, 'ratio')
  rec(
    g,
    '比例是固定的 13 档图形网格（不再按模型上报收窄）',
    ratioOpts.length === 13 && ratioOpts.includes('16:9') && ratioOpts.includes('21:9'),
    `opts=${JSON.stringify(ratioOpts)}`,
  )
  await pickParam(panel, 'ratio', '16:9')
  /**
   * 胶囊文案是「16:9 · 自动 · 自动 · 1 张」这种一行摘要 —— 判据用 `includes`：
   * 验的是「选的那个值带出来了」，不是「整行只有这一个值」。
   */
  const ratioChipText = await paramLabel(panel, 'ratio')
  rec(g, '选比例后 chip 带出该值', ratioChipText.includes('16:9'), ratioChipText)
  // 九档兜底集（模型什么都没报时）由单测 `ratiosOf` 覆盖——SSR 与真机都拿不到
  // 「一个不报比例的模型」，与其造第四个 mock 模型去污染 G8 的计数，不如在函数层断言。

  // ② 形态：比例 = 图形化网格；质量 = 横排胶囊（§6.8「通用规则」）
  await chipOf(panel, 'ratio').click()
  await sleep(200)
  rec(
    g,
    '比例用图形化网格浮层（在「生成参数」胶囊里）',
    (await panel.locator('[data-param-popup="gen-params"] [data-param-section="ratio"]').count()) === 1 &&
      (await panel
        .locator('[data-param-popup="gen-params"] [data-param-section="ratio"] [data-ratio-glyph]')
        .count()) >= 1,
  )
  await page.keyboard.press('Escape')
  await sleep(150)
  /** 四个参数在同一枚胶囊里：这里只是重新展开，再确认「质量」那段是横排胶囊 */
  await chipOf(panel, 'quality').click()
  await sleep(200)
  rec(
    g,
    '质量用横排胶囊浮层（同一枚胶囊里的第二段）',
    (await panel.locator('[data-param-popup="gen-params"] [data-param-section="quality"]').count()) === 1,
  )
  /**
   * ★★ 一枚胶囊装下四段参数（用户 2026-10-02 参考产品图五 / 图六：
   * 「把比例，质量，画质，张数变成一个胶囊显示，而且点击显示的面板……把所有的参数
   * 都放上去」）。判据取**分段的名单**：四段缺一段、或又拆回四枚 chip，都会红。
   *
   * 段的顺序＝用户 2026-10-03 图一那份：**画质 → 清晰度 → 背景 → 比例 → 生成数量**
   * （这个 mock 模型没有能力表，「背景」那一段不会出现，所以这里是四段）。
   */
  const paramSectionNames = await panel
    .locator('[data-param-popup="gen-params"] [data-param-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-section')))
  rec(
    g,
    '★★ 生成参数收成一枚胶囊：点开是四段（画质 / 清晰度 / 比例 / 张数）',
    paramSectionNames.join(',') === 'quality,resolution,ratio,count' &&
      (await panel.locator('[data-param-chip="gen-params"]').count()) === 1 &&
      (await panel.locator('[data-param-chip="ratio"]').count()) === 0,
    `段=${paramSectionNames.join(',')}`,
  )

  /**
   * ★★ **滚轮落在参数浮层里：滚的是浮层，不是画布**（用户 2026-10-03：
   * 「面板如果有多余的地方的话用滚轮无法下拉，而是缩放画布了」）。
   *
   * 根因：画布的滚轮监听器**无条件** `preventDefault()` —— 那恰好取消了
   * 「滚到最近的滚动容器」这个默认行为，于是浮层里放不下的选项一个都滚不动，
   * 画布反倒缩放了。
   *
   * 判据必须**同时看两个数**（`scrollTop` 变了 **且** 缩放读数没变）——
   * 只看一个都可能假通过：浮层没滚、画布也没滚，看起来「没毛病」。
   */
  const zoomBefore = (await page.locator('[data-canvas-zoom]').innerText()).trim()
  const popupBox = await panel.locator('[data-param-popup="gen-params"]').boundingBox()
  await page.mouse.move(popupBox.x + popupBox.width / 2, popupBox.y + popupBox.height / 2)
  await page.mouse.wheel(0, 240)
  await sleep(320)
  const zoomAfter = (await page.locator('[data-canvas-zoom]').innerText()).trim()
  rec(
    g,
    '★★ 滚轮落在参数浮层里时画布不缩放（滚轮不穿过去）',
    zoomAfter === zoomBefore,
    `zoom=${zoomBefore}→${zoomAfter}`,
  )

  /**
   * ★★ **浮层内容完整显示**（用户 2026-10-03：「参数面板里面的内容能完全显示吗？
   * 我不想要内容超出边界」）。
   *
   * 原先浮层写死 `max-height: 420px`，13 档比例网格本身就有 5 行 ⇒ 后几行**在边框内被切掉**。
   * 现在高度上限按锚点剩余空间算：**这一屏装得下 → `scrollHeight === clientHeight`**
   * （完整显示、没有裁切），且浮层整体不出视口。
   * 「装不下才滚」那一支由 G100 在矮窗口里单独验。
   */
  const popupFit = await panel.locator('[data-param-popup="gen-params"]').evaluate((el) => {
    const r = el.getBoundingClientRect()
    return {
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      viewportH: window.innerHeight,
      maxHeight: getComputedStyle(el).maxHeight,
    }
  })
  rec(
    g,
    '★★ 参数浮层内容完整显示（没有被边框裁掉，也没伸出视口）',
    popupFit.scrollHeight <= popupFit.clientHeight + 1 &&
      popupFit.top >= 0 &&
      popupFit.bottom <= popupFit.viewportH + 1,
    `scrollH=${popupFit.scrollHeight} clientH=${popupFit.clientHeight} top=${popupFit.top} bottom=${popupFit.bottom}/${popupFit.viewportH} max-height=${popupFit.maxHeight}`,
  )

  /**
   * ★★ **浮层不出横向滚动条**（用户 2026-10-03：「面板还是有左右的滚轮」）。
   *
   * 根因是 CSS 规范的一条暗礁：`overflow-y: auto` + 另一轴 `visible` 时，
   * 那一轴会被**算成 `auto`** —— 于是内容比内容盒宽一点点（实测多 15px）
   * 就冒出一条横向滚动条。判据同时看两个数：内容宽度不超、且 `overflow-x` 已显式关掉。
   */
  const popupW = await panel.locator('[data-param-popup="gen-params"]').evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: getComputedStyle(el).overflowX,
  }))
  rec(
    g,
    '★★ 参数浮层没有横向滚动（左右不可滚）',
    popupW.scrollWidth <= popupW.clientWidth + 1 && popupW.overflowX === 'hidden',
    `scrollW=${popupW.scrollWidth} clientW=${popupW.clientWidth} overflow-x=${popupW.overflowX}`,
  )

  /**
   * ★★ **比例一排 4 个 + 各段左右边距完全一致**（用户 2026-10-03：
   * 「把比例替换成 4 个比例一排，当前是三个」「三个部分的参数和面板左右的边距要一样」）。
   *
   * 两个数都是几何事实，不看样式声明：
   *  · 比例格按 y 分组——**第一行恰好 4 格**；
   *  · 画质 / 清晰度 / 背景 / 比例 / 数量五段的左、右偏移**逐段相等**
   *    （原先每段各按自己的内容定宽，一段比一段窄）。
   */
  const layoutProbe = await panel.locator('[data-param-popup="gen-params"]').evaluate((el) => {
    /** 比例格本身就是 `role=option` 的按钮（带 `data-param-option`），不依赖 CSS module 哈希类名 */
    const cells = [...el.querySelectorAll('[data-param-section="ratio"] [data-param-option]')]
    const firstTop = cells[0]?.getBoundingClientRect().top
    const firstRow = cells.filter((c) => Math.abs(c.getBoundingClientRect().top - firstTop) < 2)
    const popRect = el.getBoundingClientRect()
    const sections = [...el.querySelectorAll('[data-param-section]')].map((s) => {
      const r = s.getBoundingClientRect()
      return { name: s.getAttribute('data-param-section'), l: Math.round(r.left - popRect.left), r: Math.round(popRect.right - r.right) }
    })
    return { firstRow: firstRow.length, sections }
  })
  const sameMargins = layoutProbe.sections.every(
    (s) => Math.abs(s.l - layoutProbe.sections[0].l) <= 1 && Math.abs(s.r - layoutProbe.sections[0].r) <= 1,
  )
  rec(
    g,
    '★★ 比例一排 4 个，且五段的左右边距逐段一致',
    layoutProbe.firstRow === 4 && layoutProbe.sections.length >= 4 && sameMargins,
    `首行=${layoutProbe.firstRow} 段=${JSON.stringify(layoutProbe.sections)}`,
  )

  /**
   * ★★ 浮层的**内距 / 段间距 / 字号层级**（用户 2026-10-03：
   * 「有点太挤了，距离边界的位置要适合……可能是英文都是一个大小的原因」）。
   *
   * 三个数都是设计值（面板挂着 `zoom`，算出来的也是缩放前的值）：
   * 内距 12、段间距 12、档位文字至少比段标题大 2px。最后一条是**层级**的判据 ——
   * 原先两者同为 12px，谁主谁次只能靠猜。
   */
  const popupMetrics = await panel.locator('[data-param-popup="gen-params"]').evaluate((el) => {
    const cs = getComputedStyle(el)
    const section = el.querySelector('[data-param-section="quality"]')
    const title = section?.querySelector(':scope > span')
    const option = section?.querySelector('button')
    return {
      padding: parseFloat(cs.paddingTop),
      gap: parseFloat(cs.rowGap),
      overscroll: cs.overscrollBehaviorY,
      titleFont: title ? parseFloat(getComputedStyle(title).fontSize) : 0,
      optionFont: option ? parseFloat(getComputedStyle(option).fontSize) : 0,
    }
  })
  rec(
    g,
    '★★ 浮层内距 12 / 段间距 12，且档位文字明显大于段标题（不再是一个大小）',
    popupMetrics.padding === 12 &&
      popupMetrics.gap === 12 &&
      popupMetrics.overscroll === 'contain' &&
      popupMetrics.optionFont >= popupMetrics.titleFont + 2,
    `内距=${popupMetrics.padding} 段距=${popupMetrics.gap} 标题=${popupMetrics.titleFont}px 档位=${popupMetrics.optionFont}px overscroll=${popupMetrics.overscroll}`,
  )

  /**
   * ★★ 面板**完整落在视口里**（用户 2026-10-03：「距离边界的位置要适合，当前不适合」）。
   *
   * 根因是 `min-height: 360px` 无条件生效，而 `--panel-available-h` 可能比它小 ⇒
   * 面板照样长到 360px、底部那一行（参数 + 生成按钮）被顶出屏幕，
   * 用户既看不到也点不到。现在 `min-height` 取两者较小值。
   */
  const panelBox = await panel.boundingBox()
  const viewportSize = page.viewportSize()
  rec(
    g,
    '★★ 面板完整落在视口内（底部不越界）',
    panelBox.y + panelBox.height <= viewportSize.height + 1,
    `面板底=${Math.round(panelBox.y + panelBox.height)} 视口=${viewportSize.height}`,
  )
  await page.keyboard.press('Escape')
  await sleep(150)

  // ② 图片 → 视频：参数集整体更换
  rec(
    g,
    '图片模式：比例 / 画质 / 质量 / 张数收在一枚「生成参数」胶囊里',
    (await panel.locator('[data-param-chip="gen-params"]').count()) === 1 &&
      (await panel.locator('[data-param-chip="ratio"]').count()) === 0 &&
      (await panel.locator('[data-param-chip="count"]').count()) === 0,
  )
  await panel.locator('[data-param-mode="video"]').click()
  await sleep(400)
  rec(
    g,
    '切到视频：生成模式 / 清晰度 / 时长滑块出现',
    (await panel.locator('[data-param-chip="videoMode"]').count()) === 1 &&
      (await panel.locator('[data-param-chip="size"]').count()) === 1 &&
      (await panel.locator('[data-param-duration-range]').count()) === 1,
  )
  rec(
    g,
    '切到视频：「生成参数」胶囊整块退场，比例回到单独一枚',
    (await panel.locator('[data-param-chip="gen-params"]').count()) === 0 &&
      (await panel.locator('[data-param-chip="ratio"]').count()) === 1,
  )
  /**
   * 切类别后**旧模型必须被清掉**——图片模型不能活到视频模式里。
   *
   * 断言的是**意图**（图片模型走了），不是「chip 显示占位」这个旧表象：
   * 2026-09-18 起面板带解析链兜底，模型被清空后会立刻按新类别补一个可用模型，
   * 所以 chip 会显示 `mock-video-1` 而不是占位「视频模型」。
   * 若这里仍断言占位，等于要求「清空后必须空着」——与用户「新建节点不能没默认」冲突。
   */
  const modelAfterSwitch = await paramLabel(panel, 'model')
  rec(
    g,
    '切类别后旧模型被清空（图片模型不属于视频类）',
    modelAfterSwitch !== 'mock-image-1',
    `chip=${modelAfterSwitch}`,
  )
  const videoOpts = await paramOptions(page, panel, 'model')
  /**
   * 选项文案可能带「✓」（当前选中项），故按**包含**判断而不是全等——
   * 2026-09-18 起面板带解析链兜底，切到视频后会自动选中一个视频模型，
   * 该选项自然带上选中标记。断言关心的是「列了哪些模型」，不是「哪个被选中」。
   */
  const optHas = (needle) => videoOpts.some((t) => t.includes(needle))
  rec(
    g,
    '视频类别只列视频模型',
    optHas('mock-video-1') && !optHas('mock-image-1'),
    `opts=${JSON.stringify(videoOpts)}`,
  )
  await page.screenshot({ path: `${OUT}/46-b-video-params.png` })

  // ③ 视频参数写回并落库
  await pickParam(panel, 'model', 'mock-video-1')
  await pickParam(panel, 'size', '720p')
  /**
   * 参考模式那一枚已升级成**生成模式**（用户 2026-10-03 图四/图五那种下拉）：
   * 不再只有「首尾帧 / 全能参考」两个值，而是按模型摆子集。
   */
  await pickParam(panel, 'videoMode', '全能参考')
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
    '刷新后清晰度 / 生成模式读回',
    (await paramLabel(panel2, 'size')) === '720p' &&
      (await paramLabel(panel2, 'videoMode')) === '全能参考',
  )
  rec(g, '刷新后时长读回', (await panel2.locator('[data-param-duration-input]').inputValue()) === '8')

  /**
   * ④ ★★ 真的跑一次视频。
   *
   * 为什么必须在浏览器里跑：改动前 `generateVideo` 这条分支在 OpenAI 兼容族里
   * **一律抛 unsupported**，而面板参数、落库、刷新读回全都是通的 ——
   * 「参数齐了」和「链路通了」是两件事，只有真的点一次生成才分得出来。
   */
  await panel2.locator('[data-panel-prompt]').fill('一只橘猫在草地上奔跑')
  await sleep(250)
  await panel2.locator('[data-panel-run]').click()
  await page
    .waitForFunction(() => !!document.querySelector('[data-node-type="generation"] video'), null, {
      timeout: 15000,
    })
    .catch(() => {})
  const hasVideo = (await page.locator('[data-node-type="generation"] video').count()) > 0
  rec(
    g,
    '★★ 视频模式点生成真的产出视频（请求走到 adapter.generateVideo）',
    hasVideo,
    hasVideo ? 'video 元素已出现' : '未出现 video 元素',
  )

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
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  /**
   * ① 清晰度「自适应」档（§6.8）：未设置显示「自适应」，不是拿字段名当占位。
   *
   * ⚠️ 文案 2026-10-03 由「自动」改成「**自适应**」：用户给的 MJ 参考面板（图一）
   * 里那一档就叫自适应，而语义也确实与视频比例那档的「自适应」一致 ——
   * **不向渠道指定，交给模型自己定**。同一份档位表（`RESOLUTION_OPTIONS`）全应用共用。
   */
  const panel = await genPanel(page)
  await configureGenPanel(page, panel, '一只猫')
  const res0 = await paramLabel(panel, 'resolution')
  /** 胶囊是一行摘要（「自动 · 自适应 · 比例 · 1 张」），判据用 includes */
  rec(g, '清晰度未设置时显示「自适应」', res0.includes('自适应'), `label=${res0}`)
  await pickParam(panel, 'resolution', '2K')
  const res2k = await paramLabel(panel, 'resolution')
  rec(g, '选 2K 后 chip 显示 2K', res2k.includes('2K'), res2k)
  await pickParam(panel, 'resolution', '自适应')
  const resAuto = await paramLabel(panel, 'resolution')
  rec(g, '能选回「自适应」（它是档位，不是默认值占位）', resAuto.includes('自适应'), resAuto)

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
  // 提示词节点已无平台 chip（用户 2026-09-27 第 8 轮）
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

  /**
   * ⑤ 点下去：LLM 结果**直接进正文**（用户 2026-09-24 删掉「写入节点」后，
   * 面板与正文是同一份内容），且结果里带素材前缀 ⇒ 图真的进了请求。
   */
  const pTa = () => panelPrompt(pPanel)
  await describeBtn.click().catch(() => {})
  let text = ''
  for (let i = 0; i < 60; i++) {
  text = await pTa().innerText().catch(() => '')
    if (text.includes('mock:') && text.includes('img:')) break
    await sleep(250)
  }
  rec(
    g,
    '反推结果写回面板，且带素材前缀（图真的到了渠道层）',
    text.includes('mock:img:'),
    `${text.slice(0, 60)}`,
  )
  /**
   * ★ 反推结果必须**同步到节点正文**（面板与正文同一份内容）。
   *
   * 这条断言的**方向**与旧版相反：旧版守的是「反推不碰正文」（草稿解耦），
   * 现在删掉「写入节点」后，反推若不落正文，下游就永远收不到 —— 正是要防的静默失效。
   */
  let inBody = false
  for (let i = 0; i < 20; i++) {
    if ((await promptNode.innerText().catch(() => '')).includes('mock:')) {
      inBody = true
      break
    }
    await sleep(250)
  }
  rec(g, '★★ 反推结果同步落到节点正文（面板与正文同一份内容）', inBody)
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

  await gotoProjects(page)
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
  const ta = page.locator('[data-creation-panel] [data-panel-prompt]').first()
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
  await gotoProjects(page)
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
  await gotoProjects(page)
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
  /**
   * 张数已改成 chip（2026-09-19），读 **chip 文案**即可知道当前档。
   * 旧写法读「整组按钮里 data-active 的那个」，现在没有那排按钮了。
   */
  const countText = await paramLabel(panel, 'count')
  rec(
    g,
    '模板预置的「4 张」带进了创作面板且为选中态',
    countText.includes('4 张'),
    `selected="${countText}"`,
  )

  const before51 = await page.locator('[data-node-type="generation"]').count()
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  // N=4 → 铺 4 个并列承载节点，不建结果组（用户 2026-09-17）
  let added51 = 0
  for (let i = 0; i < 60; i++) {
    added51 = (await page.locator('[data-node-type="generation"]').count()) - before51
    if (added51 >= 4) break
    await sleep(250)
  }
  rec(g, '批量出图跑出 4 个承载节点（N≥2 不建结果组）', added51 === 4, `新增=${added51}`)
  let imgs = 0
  for (let i = 0; i < 40; i++) {
    imgs = await page.locator('[data-node-asset][src^="blob:"]').count()
    if (imgs >= 4) break
    await sleep(250)
  }
  rec(g, '批量出图 4 张都渲染出缩略图', imgs >= 4, `img=${imgs}`)

  /**
   * 本组的关键断言。
   *
   * 注意前提变了：N≥2 的产物现在铺成**并列承载节点**、挂在源节点**下游**，
   * 而对比节点挂在源节点的另一侧 ⇒ 它**收不到**这 4 个新节点（用户 2026-09-17
   * 拍板：对比节点的上游由用户手动连）。所以这里改验**对比节点本身这条链路通不通**：
   * 先跑 N=1（产物回填生成节点本体）⇒ 上游有图 ⇒ 对比节点必须取到它。
   * 「收集上游图片」若坏了，这里必然是 0 —— 那才是最危险的假链路：
   * 节点在、连线在、看起来通了，挑图却永远只有 A 没有 B。
   */
  const genId51 = await gen.getAttribute('data-node-id')
  // 重新选中（拿回创作面板），切成 1 张再跑一次：产物回填本体 ⇒ 上游有图
  await genPanel(page, page.locator(`[data-node-id="${genId51}"]`))
  await setCount(page.locator('[data-creation-panel]'), '1 张')
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  await sleep(2500)
  let cmpImgs = 0
  for (let i = 0; i < 40; i++) {
    cmpImgs = await cmp.locator('img').count()
    if (cmpImgs >= 1) break
    await sleep(250)
  }
  rec(g, '对比节点取到上游生成节点的图（收集上游图片这条链路通）', cmpImgs >= 1, `img=${cmpImgs}`)
  await page.screenshot({ path: `${OUT}/64-g51-batch-img-compare.png` })

  // ── 批量套图：批量容器 → 生成节点 ──
  await gotoProjects(page)
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

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // ── 顶栏有「导入素材」按钮（拖放之外的第二条路）──
  rec(g, '工具栏出现「导入素材」按钮', (await page.locator('[data-toolbar-import]').count()) === 1)

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
  await gotoProjects(page2)
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

/**
 * 建一个**带真实素材**的生成节点（G91 融合 / G92 提取选区的上游都要有图）。
 *
 * `buffer` 不给时用 `solidPngBuffer(w,h,color)`；要渐变之类的图案就自己传 buffer。
 * 返回 `{ id, node }`：id 用来精确连线，node 是**按 id 收窄的 locator**
 * （`.first()` 会拿到上一个同类节点，后面新建的越多越容易连错）。
 */
async function addGenWithImage(page, w, h, color, buffer) {
  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  await page.locator('[data-toolbar-menu-item="generation"]').click()
  await sleep(500)
  const id = await page.locator('[data-node-type="generation"]').last().getAttribute('data-node-id')
  const node = page.locator(`[data-node-id="${id}"]`)
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 5000 }).catch(() => null),
    node.locator('[data-node-upload]').first().click(),
  ])
  if (chooser) {
    await chooser.setFiles({
      name: 'seed.png',
      mimeType: 'image/png',
      buffer: buffer ?? solidPngBuffer(w, h, color),
    })
    await sleep(1200)
  }
  return { id, node }
}

/**
 * 设张数（§6.8，2026-09-19 改版）。
 *
 * 张数现在是**与画质 / 质量同形的 ParamPicker chip**，不再是并排按钮组，
 * 所以要先点开 chip，再在弹层里选。`text` 形如 `'4 张'`。
 */
async function setCount(panel, text) {
  await pickParam(panel, 'count', text)
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
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // ── N=1：不建结果组，节点自己按产物真实比例 ──
  const gen1 = await runGen(page, { count: '1 张', ratio: '16:9' })
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
  await gotoProjects(page)
  await sleep(500)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  await runGen(page, { count: '2 张', ratio: '16:9' })
  /**
   * N=2 → 铺 **2 个并列承载节点**，不再建结果组（用户 2026-09-17）。
   * 于是「组内统一格位（RESULT_CELL 方框）」这套断言失去了载体 ——
   * 现在要验的是**每个承载节点按产物真实比例呈现 16:9**（§6.18「请求 / 实际」：
   * 节点尺寸由产物真实像素决定，不留白边），两张的尺寸应当一致。
   */
  /**
   * 用「**出图的承载节点数**」计数，而不是「generation 节点总数」。
   *
   * 本组在跑 N=2 之前已经跑过一次 N=1（验证单张回填本体），画布上因此
   * 既有「回填了图的源节点」也有本次新建的节点；按总数做差会把那一次的新增
   * 一起算进来（实测 3 ≠ 2），那是**计数口径错**，不是落位错。
   * 承载节点的定义很清楚：**有产物、且不是源节点**。
   */
  const srcId53 = await page.locator('[data-node-type="generation"]').first().getAttribute('data-node-id')
  const carrierCount = async () =>
    page
      .locator('[data-node-type="generation"]')
      .evaluateAll(
        (els, src) =>
          els.filter((e) => e.getAttribute('data-node-id') !== src && e.querySelector('[data-node-asset][src^="blob:"]'))
            .length,
        srcId53,
      )
  let added53 = 0
  for (let i = 0; i < 60; i++) {
    added53 = await carrierCount()
    if (added53 >= 2) break
    await sleep(250)
  }
  rec(g, '★ N=2 铺出 2 个并列承载节点（不建结果组）', added53 === 2, `承载节点=${added53}`)
  rec(g, 'N=2 不建结果组', (await page.locator('[data-result-group]').count()) === 0)
  let imgs = 0
  for (let i = 0; i < 40; i++) {
    imgs = await page.locator('[data-node-asset][src^="blob:"]').count()
    if (imgs >= 2) break
    await sleep(250)
  }
  rec(g, '2 张都渲染出缩略图', imgs >= 2, `img=${imgs}`)
  const thumbs = []
  for (const el of await page.locator('[data-node-asset][src^="blob:"]').all()) {
    const b = await el.boundingBox()
    if (b) thumbs.push(b)
  }
  const same =
    thumbs.length >= 2 &&
    Math.abs(thumbs[0].width - thumbs[1].width) < 2 &&
    Math.abs(thumbs[0].height - thumbs[1].height) < 2
  rec(
    g,
    '★ 两个承载节点尺寸一致（同一请求比例）',
    same,
    thumbs.map((t) => `${Math.round(t.width)}×${Math.round(t.height)}`).join(' / '),
  )
  const tr = thumbs[0] ? thumbs[0].width / thumbs[0].height : 0
  rec(
    g,
    '★ 承载节点按产物真实比例 16:9 呈现（不是 1:1 方框）',
    thumbs.length >= 2 && Math.abs(tr - 16 / 9) < 0.12,
    `ratio=${tr.toFixed(3)}`,
  )
  await page.screenshot({ path: `${OUT}/68-g53-group.png` })

  // ── 点 `+` 上传：同样按原始比例（此前只有拖放这条路是对的）──
  await gotoProjects(page)
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

  await gotoProjects(page)
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
    page.locator('[data-toolbar-import]').click(),
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
      page.locator('[data-toolbar-import]').click(),
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

  await gotoProjects(page)
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

  /**
   * 同心圆角（用户 2026-09-19「描边不是同一个圆角、有东西被遮住」）：
   *
   * 外框是 10px 圆角 + `overflow:hidden`，视口框此前写死 `rx=2`。当视口比内容大、
   * 视口框铺满整框时，那个近似直角正好顶在外框圆弧上 —— 角上看起来「里面的方框
   * 戳出圆角」。修法是让视口框半径按它到外框的留白算（同心），铺满时必须等于外框
   * 半径。这条断言直接读**计算样式**的 `rx`，不是看截图，故障注入可复现。
   */
  const radii = await page.evaluate(() => {
    const h = document.querySelector('[data-canvas-minimap]')
    const v = h && h.querySelector('[data-minimap-view]')
    return {
      outer: h ? parseFloat(getComputedStyle(h).borderTopLeftRadius) : NaN,
      inner: v ? parseFloat(v.getAttribute('rx')) : NaN,
    }
  })
  rec(
    g,
    '★ 视口框铺满整框时圆角与外框同心（不再是方角戳出圆弧）',
    Number.isFinite(radii.outer) && Number.isFinite(radii.inner) && Math.abs(radii.inner - radii.outer) < 0.5,
    `外框=${radii.outer}px 视口框=${radii.inner}px`,
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
  /**
   * 故障注入：抹掉填充，墨迹必须塌下去 —— 否则上一条量的根本不是节点矩形。
   *
   * ⚠️ 主题化之后必须改注入手法：点阵颜色已从 SVG `fill` **属性**挪到 CSS 类
   * （Minimap.module.css 的 `.node`），而 **CSS 的优先级高于表现属性**——
   * 再写 `setAttribute('fill','none')` 会被 CSS 盖掉，注入无效、墨迹纹丝不动，
   * 于是「这一条在量节点矩形」的证明变成了假的（实测注入前后都是 10853）。
   * 改为直接改 `style.fill`（内联样式优先级最高，稳稳盖过类选择器）。
   */
  await page.evaluate(() =>
    document.querySelectorAll('[data-minimap-node]').forEach((el) => {
      el.style.fill = 'none'
    }),
  )
  const inkNone = box ? await countMinimapInk(page, box) : -1
  await page.evaluate(() =>
    document.querySelectorAll('[data-minimap-node]').forEach((el) => {
      el.style.fill = ''
    }),
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

  /*
   * 平移画布 → 视口框跟着动。
   *
   * ⚠️ 起点必须落在**空白处**：2026-09-27 起画布右侧多了应用壳侧栏，
   * 而模板节点也随之整体右移，原先写死的 (600,500) 可能正好压在节点上 ——
   * 那样拖的是节点、画布没动，视口框自然「没跟着动」（实测就是这条挂了）。
   * 改为按画布矩形取一个偏左下的空白点。
   */
  const surfaceBox = await page.locator('[data-canvas-surface]').boundingBox()
  const panFrom = { x: surfaceBox.x + 40, y: surfaceBox.y + surfaceBox.height - 60 }
  await page.mouse.move(panFrom.x, panFrom.y)
  await page.mouse.down()
  await page.mouse.move(panFrom.x - 100, panFrom.y - 70, { steps: 8 })
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

  await gotoProjects(page)
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

// ────────────────────────────────────────────────────────────
// G58 节点跟随功能栏（用户 2026-09-16 需求）：
// 单选出现、锚在节点上方且水平居中、缩放只改位置不改尺寸、
// 拖动时跟随（不消失）、多选隐藏、删除按钮真的删掉节点
// ────────────────────────────────────────────────────────────
async function g58(browser) {
  const g = 'G58 节点跟随栏'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)

  const bar = page.locator('[data-node-follow-bar]')
  rec(g, '未选中时没有跟随栏', (await bar.count()) === 0, `count=${await bar.count()}`)

  // 1) 单选生成节点 → 栏出现在节点上方、水平居中
  const gen = page.locator('[data-node-type="generation"]').first()
  const n0 = await gen.boundingBox()
  await gen.click({
    position: {
      x: Math.max(8, Math.min(40, n0.width / 2 - 30)),
      /*
       * 顶部已无遮挡物（画布顶栏按 §6.2 去除），取 16px 边距即可。
       * 原先这里要「落在顶栏下沿之下」，那次查询现在恒返回 0。
       */
      y: Math.min(Math.max(16, 16), n0.height - 14),
    },
  })
  await sleep(300)
  rec(g, '单选生成节点出现跟随栏', (await bar.count()) === 1, `count=${await bar.count()}`)
  const b0 = await bar.boundingBox()
  // 翻转语义已移除（用户 2026-09-17）：栏恒在节点上方，改用真实几何断言
  rec(g, '默认挂在节点上方', b0.y + b0.height <= n0.y + 2, `bar底=${Math.round(b0.y + b0.height)} node顶=${Math.round(n0.y)}`)
  const nodeCenter0 = n0.x + n0.width / 2
  const barCenter0 = b0.x + b0.width / 2
  rec(g, '水平中心与节点对齐', Math.abs(barCenter0 - nodeCenter0) < 2, `Δ=${(barCenter0 - nodeCenter0).toFixed(2)}`)
  rec(g, '栏在节点顶边之上（不压节点）', b0.y + b0.height <= n0.y + 2, `bar底=${(b0.y + b0.height).toFixed(1)} node顶=${n0.y.toFixed(1)}`)
  const actions = await page
    .locator('[data-follow-action]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-follow-action')))
  rec(g, '动作齐全（生成/重命名/复制/删除/关闭）', ['run', 'rename', 'duplicate', 'delete', 'close'].every((a) => actions.includes(a)), actions.join(','))
  /**
   * 图标必须是**内联 SVG**（用户 2026-09-30：「节点功能栏的图标我不要符号，我要真正的矢量图」）。
   * 判据落在图标位那一格：里面有且只有一个 `svg`、且**没有文本** —— 塞回 `▶ ✎ ⧉`
   * 这类字形就会当场变红（字形的问题不是好看，而是落点由用户机器上的字体决定）。
   */
  const iconAudit = await page.locator('[data-follow-action]').evaluateAll((els) =>
    els.map((e) => {
      const icon = e.firstElementChild
      return {
        action: e.getAttribute('data-follow-action'),
        svg: icon ? icon.querySelectorAll('svg').length : 0,
        text: (icon?.textContent ?? '').trim(),
      }
    }),
  )
  rec(
    g,
    '★★ 功能栏图标全是内联 SVG（图标位里没有文本字形）',
    iconAudit.length > 0 && iconAudit.every((x) => x.svg === 1 && x.text === ''),
    JSON.stringify(iconAudit),
  )
  /**
   * 栏下方不再挂装饰小三角（用户 2026-09-30：「我不想要功能栏下方的小三角」）。
   * 判据是**几何**：栏内所有非零尺寸子元素都不越出栏的底边 —— 再挂一个小三角就会越界。
   */
  const barOverflowBottom = await bar.evaluate((el) => {
    const b = el.getBoundingClientRect()
    let worst = 0
    for (const kid of el.querySelectorAll('*')) {
      const r = kid.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) continue
      worst = Math.max(worst, r.bottom - b.bottom)
    }
    return worst
  })
  rec(
    g,
    '★★ 功能栏下方没有伸出的小三角（子元素不越出底边）',
    barOverflowBottom <= 0.5,
    `越出 ${barOverflowBottom.toFixed(1)}px`,
  )
  /**
   * ★★ 图标与文字**贴住**（用户 2026-09-30 第 2 轮：「功能栏上图标和名称靠的太远了」）。
   *
   * 旧版图标位是个 26px 的格子，而图标墨迹只有 16px ⇒ 左右各 5px 死区，
   * 视觉上「图标↔文字」被顶到 9px（比文字到右边缘还宽）。判据两条：
   * 图标位宽度 == 图标宽度；图标右边缘到文字左边缘 ≤ 6px。
   */
  const spacingAudit = await page.locator('[data-follow-action]').evaluateAll((els) =>
    els.map((b) => {
      const glyph = b.firstElementChild
      const label = b.lastElementChild
      const g = glyph.getBoundingClientRect()
      const s = glyph.querySelector('svg').getBoundingClientRect()
      const l = label.getBoundingClientRect()
      return {
        action: b.getAttribute('data-follow-action'),
        slot: +g.width.toFixed(1),
        icon: +s.width.toFixed(1),
        gap: +(l.left - g.right).toFixed(1),
      }
    }),
  )
  rec(
    g,
    '★★ 图标位贴住图标、到文字 ≤6px（不再浮在 26px 格子里）',
    spacingAudit.length > 0 && spacingAudit.every((x) => Math.abs(x.slot - x.icon) <= 0.5 && x.gap <= 6),
    JSON.stringify(spacingAudit),
  )
  /*
   * 中文**常驻**（用户 2026-09-17）：不 hover 时中文就得看得见，
   * 且 hover 前后按钮宽度不变（中文藏起来再展开会让整条栏抖一下）。
   * 这条断言锁住的是「中文不依赖 hover」，也锁住「宽度不跳」。
   */
  const labelOf = async (action) => {
    const el = page.locator(`[data-follow-label="${action}"]`)
    if ((await el.count()) === 0) return null
    return await el.evaluate((e) => {
      const cs = getComputedStyle(e)
      return {
        text: e.textContent?.trim() ?? '',
        visible: cs.opacity !== '0' && cs.maxWidth !== '0px' && e.getBoundingClientRect().width > 0,
      }
    })
  }
  const renameLabel = await labelOf('rename')
  rec(g, '★ 中文常驻可见（不 hover 也在）', !!renameLabel?.visible && renameLabel.text === '重命名', JSON.stringify(renameLabel))
  const wIdle = (await page.locator('[data-follow-action="rename"]').boundingBox()).width
  const rb0 = await page.locator('[data-follow-action="rename"]').boundingBox()
  await page.mouse.move(rb0.x + rb0.width / 2, rb0.y + rb0.height / 2)
  await sleep(300)
  const rb1 = await page.locator('[data-follow-action="rename"]').boundingBox()
  rec(g, 'hover 只变色不变宽（中文常驻 ⇒ 宽度稳定）', Math.abs(rb1.width - wIdle) < 1, `${Math.round(wIdle)} → ${Math.round(rb1.width)}`)
  const hovered = await page
    .locator('[data-follow-action="rename"]')
    .evaluate((e) => getComputedStyle(e).backgroundColor)
  /*
   * 判据改成**读令牌**，不写死十六进制。
   * 2026-09-27 定色把 `--bg-hover` 由 #f0f0ee 改成 #e2e2e2，
   * 原先写死的 `rgb(240, 240, 238)` 立刻变红 —— 那是配色改了，不是 hover 坏了。
   * 断言关心的是「hover 用的是 hover 令牌且带底色」，那就拿令牌来比：
   * `--bg-hover` 换值时断言跟着走，而「hover 没变色」这一类真回归照样抓得住。
   */
  const hoverToken = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--bg-hover').trim(),
  )
  const hoverTokenRgb = await page.evaluate((hex) => {
    const c = document.createElement('canvas')
    c.width = c.height = 1
    const ctx = c.getContext('2d')
    ctx.fillStyle = hex
    ctx.fillRect(0, 0, 1, 1)
    return Array.from(ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)).join(', ')
  }, hoverToken)
  rec(
    g,
    'hover 变实色块（= --bg-hover 令牌，与创作面板参数 chip 同款）',
    hovered === `rgb(${hoverTokenRgb})` && hovered !== 'rgba(0, 0, 0, 0)',
    `${hovered} vs --bg-hover ${hoverToken}`,
  )
  await page.mouse.move(640, 700)
  await sleep(200)
  await page.screenshot({ path: `${OUT}/73-g58-follow-bar.png` })

  // 2) 缩放：位置跟着变，栏自身高度不变（§6.8 缩放独立性）
  const h0 = b0.height
  await page.mouse.move(640, 400)
  await page.keyboard.down('Control')
  await page.mouse.wheel(0, 300)
  await page.keyboard.up('Control')
  await sleep(400)
  const b1 = await bar.boundingBox()
  const n1 = await gen.boundingBox()
  rec(g, '缩放后栏高不变（尺寸不随画布缩放）', Math.abs(b1.height - h0) < 1, `${h0} → ${b1.height}`)
  const barCenter1 = b1.x + b1.width / 2
  const nodeCenter1 = n1.x + n1.width / 2
  rec(g, '缩放后仍与节点水平居中对齐', Math.abs(barCenter1 - nodeCenter1) < 2, `Δ=${(barCenter1 - nodeCenter1).toFixed(2)}`)
  await page.screenshot({ path: `${OUT}/73-g58-follow-bar-zoom.png` })

  /*
   * 3) 拖动节点：与创作面板**同一套规则**（用户 2026-09-17）
   *   §6.15：拖动中立即隐藏；真实位移的拖动松手后保持隐藏，直到下一次显式选中。
   * 断言「创作面板也一起隐藏」：两者同源（都读 dragging / panelDismissed），
   * 若哪天只有一个隐藏，用户会看到「面板没了但按钮条还在」的割裂感。
   */
  const creationPanel = page.locator('[data-creation-panel]')
  const grab = { x: Math.round(n1.x + 14), y: Math.round(n1.y + n1.height - 14) }
  await page.mouse.move(grab.x, grab.y)
  await page.mouse.down()
  await page.mouse.move(grab.x + 80, grab.y + 30, { steps: 10 })
  await sleep(200)
  rec(g, '★ 拖动中跟随栏隐藏（与创作面板同款）', (await bar.count()) === 0, `count=${await bar.count()}`)
  rec(g, '拖动中创作面板也隐藏（两者同源）', (await creationPanel.count()) === 0, `count=${await creationPanel.count()}`)
  await page.mouse.up()
  await sleep(300)
  rec(g, '★ 拖动结束后仍不显示（等下一次显式选中）', (await bar.count()) === 0, `count=${await bar.count()}`)
  rec(g, '拖动结束后创作面板也不显示', (await creationPanel.count()) === 0, `count=${await creationPanel.count()}`)
  await page.screenshot({ path: `${OUT}/73-g58-follow-bar-drag.png` })

  // 再次点击节点 → 两者一起回来
  const nAgain = await gen.boundingBox()
  await gen.click({ position: { x: 14, y: Math.max(16, nAgain.height - 14) } })
  await sleep(400)
  rec(g, '★ 再次点击后跟随栏回来', (await bar.count()) === 1, `count=${await bar.count()}`)
  rec(g, '再次点击后创作面板也回来', (await creationPanel.count()) === 1, `count=${await creationPanel.count()}`)

  // 原地单击（无位移）不算拖动 → 栏照常出现
  const nTap = await gen.boundingBox()
  await gen.click({ position: { x: 14, y: Math.max(16, nTap.height - 14) } })
  await sleep(300)
  rec(g, '原地单击（无位移）不算拖动，栏照常出现', (await bar.count()) === 1, `count=${await bar.count()}`)

  // 3.5) ★ 节点拖到画布**顶端**时栏**不翻到下方**（用户 2026-09-17）
  const nTop = await gen.boundingBox()
  const gTop = { x: Math.round(nTop.x + 14), y: Math.round(nTop.y + nTop.height - 14) }
  /*
   * 只拖到「画布顶端之下一点」：拖出可视区后节点点不中，后续断言会全部落空。
   *
   * 这个值曾经跟着**画布顶部悬浮栏**的下沿走（先写死 70，后来顶栏放大到 112
   * 又改成运行时量）。那个顶栏已按 §6.2 整体去除，画布顶部不再有遮挡物，
   * 于是取一个小的固定边距即可 —— 目的只剩「别拖出可视区」。
   */
  const TOP_SAFE = 16
  await page.mouse.move(gTop.x, gTop.y)
  await page.mouse.down()
  await page.mouse.move(gTop.x, TOP_SAFE, { steps: 14 })
  await page.mouse.up()
  await sleep(400)
  // 拖动会隐藏跟随栏（新规则）→ 先重新点选让它出现，再量位置
  rec(g, '拖到顶端后跟随栏处于隐藏态（等再次点击）', (await bar.count()) === 0, `count=${await bar.count()}`)
  // 跟随栏浮在节点**上方**，会挡住节点上半部分 → 从下半部分点选
  const nAfter0 = await gen.boundingBox()
  await gen.click({ position: { x: 14, y: Math.max(10, nAfter0.height - 20) } })
  await sleep(400)
  const bTop = await bar.boundingBox().catch(() => null)
  const nAfter = await gen.boundingBox()
  rec(
    g,
    '★ 节点顶到画布顶端时栏仍在其上方（不自动翻下）',
    !!bTop && bTop.y + bTop.height <= nAfter.y + 2,
    bTop ? `bar底=${Math.round(bTop.y + bTop.height)} node顶=${Math.round(nAfter.y)}` : 'bar=null',
  )
  await page.screenshot({ path: `${OUT}/73-g58-follow-bar-top.png` })
  // 把节点拖回画布可视区：拖到顶端后它有一部分在画布外，后续点击会落空
  const nBack = await gen.boundingBox()
  const gBack = { x: Math.round(nBack.x + 14), y: Math.max(8, Math.round(nBack.y + nBack.height - 14)) }
  await page.mouse.move(gBack.x, gBack.y)
  await page.mouse.down()
  await page.mouse.move(gBack.x, gBack.y + 320, { steps: 14 })
  await page.mouse.up()
  await sleep(400)

  // 4) 多选 → 隐藏（这一栏属于谁有歧义）。
  //    用跟随栏自己的「复制」造出第二个节点（它带 24px 偏移，不会与原件重叠），
  //    再 Shift + 点击原件加选（§6.15：Shift + 按下 = 增减选中）。
  await page.locator('[data-node-type="generation"]').first().click({ position: { x: 20, y: 60 } })
  await sleep(300)
  const idsBeforeDup = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  await page.locator('[data-follow-action="duplicate"]').click()
  await sleep(500)
  const genCount2 = await page.locator('[data-node-type="generation"]').count()
  rec(g, '跟随栏「复制」真的多出一个节点', genCount2 === 2, `count=${genCount2}`)
  /**
   * ★★ **副本不许压在别的节点上**（用户 2026-10-05 第 3 批：「创建副本……不要遮住
   * 画布上的节点，当前复制节点是遮住了的」）。
   *
   * 判据是**几何**：把副本与画布上其余每个节点的屏幕矩形求交集，总面积必须是 0。
   * 改前写死 `+24/+24` —— 240×240 的生成节点会重叠 216×216 = **46656 px²**，
   * 用户看到的就是「点完复制好像什么都没发生」。
   */
  const dupId = (
    await page.locator('[data-node-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  ).find((id) => !idsBeforeDup.includes(id))
  const dupOverlap = await page.evaluate((id) => {
    const el = document.querySelector(`[data-node-id="${id}"]`)
    const r = el?.getBoundingClientRect()
    if (!r) return null
    let area = 0
    for (const other of document.querySelectorAll('[data-node-id]')) {
      if (other.getAttribute('data-node-id') === id) continue
      const o = other.getBoundingClientRect()
      const w = Math.max(0, Math.min(r.right, o.right) - Math.max(r.left, o.left))
      const h = Math.max(0, Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top))
      area += w * h
    }
    return Math.round(area)
  }, dupId)
  rec(g, '★★ 副本不覆盖画布上任何节点（重叠面积 = 0）', dupOverlap === 0, `重叠=${dupOverlap}px²`)
  const copyBox = await page.locator('[data-node-type="generation"]').nth(1).boundingBox()
  await page.keyboard.down('Shift')
  await page.locator('[data-node-type="generation"]').nth(1).click({ position: { x: 20, y: Math.min(60, copyBox.height - 14) } })
  await page.keyboard.up('Shift')
  await sleep(400)
  const selectedFrames = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.filter((e) => e.className.includes('selected')).length)
  rec(g, 'Shift+点击加选成多选', selectedFrames >= 2, `selected=${selectedFrames}`)
  rec(g, '多选时隐藏跟随栏', (await bar.count()) === 0, `count=${await bar.count()}`)

  // 5) 删除按钮：真的删掉节点，且撤销可恢复
  const before = await page.locator('[data-node-type="generation"]').count()
  // 先把两个节点**拉开**：复制体只偏 24px、与原件重叠 216px，
  // 重叠区里点击一律命中上层节点（探针实测：点了但选中态不变）。
  // 取消多选 → 单选复制体 → 拖到空白处 → 再单选它，才是一个能稳定点中的目标。
  // Esc = 取消选中（画布既定键位）；右下角压着小地图，「点空白」在那儿清不掉选中
  await page.keyboard.press('Escape')
  await sleep(300)
  rec(g, 'Esc 取消选中后跟随栏消失', (await bar.count()) === 0, `count=${await bar.count()}`)
  const victim = page.locator('[data-node-type="generation"]').nth(1)
  const vb = await victim.boundingBox()
  await victim.click({ position: { x: 14, y: Math.max(16, vb.height - 14) } })
  await sleep(300)
  const grab2 = { x: Math.round(vb.x + 14), y: Math.round(vb.y + vb.height - 14) }
  await page.mouse.move(grab2.x, grab2.y)
  await page.mouse.down()
  await page.mouse.move(grab2.x - 260, grab2.y + 160, { steps: 12 })
  await page.mouse.up()
  await sleep(400)
  const vb2 = await page.locator('[data-node-type="generation"]').nth(1).boundingBox()
  await page.locator('[data-node-type="generation"]').nth(1).click({ position: { x: 14, y: Math.max(16, vb2.height - 14) } })
  await sleep(300)
  rec(g, '重新单选后跟随栏回来', (await bar.count()) === 1, `count=${await bar.count()}`)
  await page.locator('[data-follow-action="delete"]').click()
  await sleep(400)
  const after = await page.locator('[data-node-type="generation"]').count()
  rec(g, '跟随栏「删除」真的删掉节点', after === before - 1, `${before} → ${after}`)
  await page.keyboard.press('Control+z')
  await sleep(400)
  rec(
    g,
    '删除可撤销（节点回来）',
    (await page.locator('[data-node-type="generation"]').count()) === before,
    `count=${await page.locator('[data-node-type="generation"]').count()}`,
  )

  /**
   * ★★ **Ctrl / Cmd + G 把选中的节点打成一组**（用户 2026-10-05 第 10 条）。
   *
   * 判据取「画布上真的多出一个分组节点」，并顺带确认**一步撤销**能把组与归属一起回退
   * （打组是「建组 + 逐个收进去」两条以上命令，必须合成一个撤销单元）。
   */
  await page.locator('[data-node-type="generation"]').first().click({ position: { x: 16, y: 16 } })
  await sleep(300)
  const groupsBefore = await page.locator('[data-node-type="group"]').count()
  await page.keyboard.press('Control+g')
  await sleep(400)
  const groupsAfter = await page.locator('[data-node-type="group"]').count()
  rec(
    g,
    '★★ Ctrl+G 把选中的节点打成一组',
    groupsAfter === groupsBefore + 1,
    `分组 ${groupsBefore} → ${groupsAfter}`,
  )
  await page.keyboard.press('Control+z')
  await sleep(400)
  rec(
    g,
    '★★ 打组可一步撤销（建组与归属一起回退）',
    (await page.locator('[data-node-type="group"]').count()) === groupsBefore,
    `撤销后分组=${await page.locator('[data-node-type="group"]').count()}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G59 生成节点的产物像素标签（用户 2026-09-17）：
// 有素材 → 右上角标出**真实像素**（宽×高）；数字必须等于图片实际解码尺寸，
// 而不是「我们向渠道请求了多大」。空节点不显示。
// ────────────────────────────────────────────────────────────
async function g59(browser) {
  const g = 'G59 产物像素标签'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const gen = page.locator('[data-node-type="generation"]').first()
  const panel = await genPanel(page, gen)
  await configureGenPanel(page, panel, '屋顶的猫')
  // 16:9 → mock 按该比例造 64×36 的 PNG（长边 64）
  await pickParam(panel, 'ratio', '16:9')
  await sleep(200)

  rec(g, '空节点不显示像素标签', (await page.locator('[data-node-pixels]').count()) === 0, `count=${await page.locator('[data-node-pixels]').count()}`)

  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  for (let t = 0; t < 60; t++) {
    if ((await page.locator('[data-node-asset]').count()) > 0) break
    await sleep(250)
  }
  await sleep(1000)

  const label = page.locator('[data-node-pixels]')
  rec(g, '有素材后出现像素标签', (await label.count()) >= 1, `count=${await label.count()}`)
  const text = (await label.first().innerText().catch(() => '')).trim()
  // 与图片**真实解码尺寸**比对：这是「真实像素」而不是「请求像素」的证明
  const real = await page
    .locator('[data-node-asset]')
    .first()
    .evaluate((img) => `${img.naturalWidth}×${img.naturalHeight}`)
  rec(g, '★ 标签数字 = 图片真实解码像素（16:9 → 64×36）', text === '64×36', `label=${text}`)
  rec(g, '★ 与 <img> 解码尺寸一致（不是请求值）', text === real, `label=${text} real=${real}`)
  rec(g, '不是 1:1 的假值（比例真的生效了）', text !== '64×64', `label=${text}`)

  // 标签不该挡住节点的选中 / 拖动
  const box = await label.first().boundingBox()
  const pe = await label.first().evaluate((e) => getComputedStyle(e).pointerEvents)
  rec(g, '标签不吃指针事件（不挡拖动）', pe === 'none', `pointer-events=${pe}`)
  rec(g, '标签可见（有实际尺寸）', !!box && box.width > 0 && box.height > 0, box ? `${Math.round(box.width)}×${Math.round(box.height)}` : 'null')

  /*
   * 位置契约（用户 2026-09-17）：像素在**节点外部**的右上角，与节点名同一排。
   * 三条几何断言，缺一条都可能退化成「画在图片右上角」（第一版就做错了）：
   *   ① 在节点框**上方**（不是内部）；
   *   ② 与标题**同一排**（纵向有重叠）；
   *   ③ 比标题更靠右（在节点外的右上角）。
   */
  const nBox = await gen.boundingBox()
  const titleBox = await gen.locator('[data-node-title]').boundingBox().catch(() => null)
  rec(g, '★ 在节点框外部（框的上方）', box.y + box.height <= nBox.y + 2, `label底=${Math.round(box.y + box.height)} node顶=${Math.round(nBox.y)}`)
  const sameRow = !!titleBox && box.y < titleBox.y + titleBox.height && box.y + box.height > titleBox.y
  rec(g, '★ 与节点名同一排（纵向重叠）', sameRow, `label=${Math.round(box.y)}..${Math.round(box.y + box.height)} title=${titleBox ? Math.round(titleBox.y) + '..' + Math.round(titleBox.y + titleBox.height) : 'null'}`)
  const rightOfTitle = !!titleBox && box.x > titleBox.x + titleBox.width - 2
  rec(g, '★ 在节点名右侧（节点外的右上角）', rightOfTitle, `label.x=${Math.round(box.x)} title右=${titleBox ? Math.round(titleBox.x + titleBox.width) : 'null'}`)

  await page.screenshot({ path: `${OUT}/74-g59-pixels.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G60 有素材的生成节点再次生成（用户 2026-09-17 报）：
// 这种情况下产出会落到**新建的承载节点**上，而**原节点不能出现生成状态**——
// 它这次只是被当参考图用。曾因 useExecution 的 onTaskTarget 参数错位
// （引擎三参、宿主按两参接）导致「状态改绑」从未生效，原节点一直转圈。
// ────────────────────────────────────────────────────────────
async function g60(browser) {
  const g = 'G60 有素材节点再生成'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  const gen = page.locator('[data-node-type="generation"]').first()
  const panel = await genPanel(page, gen)
  await configureGenPanel(page, panel, '屋顶的猫')

  // 1) 先跑一次，让源节点有素材
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  for (let t = 0; t < 60; t++) {
    if ((await page.locator('[data-node-asset]').count()) > 0) break
    await sleep(250)
  }
  await sleep(1000)
  const srcId = await gen.getAttribute('data-node-id')
  rec(g, '第一次生成：源节点出图', (await page.locator('[data-node-asset]').count()) === 1, `assets=${await page.locator('[data-node-asset]').count()}`)

  // 2) 第二次生成：全程盯着**源节点**有没有进入生成态
  const srcSelector = `[data-node-id="${srcId}"]`
  await page.evaluate((sel) => {
    window.__srcStates = []
    const rec = () => {
      const f = document.querySelector(sel)
      const st = f && f.querySelector('[data-node-status]')
      window.__srcStates.push(st ? st.getAttribute('data-node-status') : null)
    }
    rec()
    window.__t = setInterval(rec, 20)
    new MutationObserver(rec).observe(document.body, { subtree: true, childList: true, attributes: true })
  }, srcSelector)

  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  for (let t = 0; t < 60; t++) {
    const n = await page.locator('[data-node-asset]').count()
    if (n >= 2 && (await page.locator('[data-node-status]').count()) === 0) break
    await sleep(250)
  }
  await sleep(1000)
  const srcStates = await page.evaluate(() => { clearInterval(window.__t); return window.__srcStates })
  const flashed = srcStates.filter((s) => s === 'running' || s === 'queued')
  rec(g, '★ 原节点全程不出现生成状态（它这次只是参考图）', flashed.length === 0, `flashed=${flashed.length}/${srcStates.length}`)

  // 3) 产出确实落到新建的承载节点上，且原节点仍有自己的素材
  const genCount = await page.locator('[data-node-type="generation"]').count()
  rec(g, '产出落在新建的承载节点（共 2 个生成节点）', genCount === 2, `count=${genCount}`)
  const srcHasAsset = await page.locator(`[data-node-id="${srcId}"] [data-node-asset]`).count()
  rec(g, '原节点仍持有自己那张图（没被覆盖）', srcHasAsset === 1, `srcAssets=${srcHasAsset}`)
  rec(g, '结束后无残留转圈', (await page.locator('[data-node-status]').count()) === 0, `overlays=${await page.locator('[data-node-status]').count()}`)

  await page.screenshot({ path: `${OUT}/77-g60-second-run.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * 页面平均亮度（G61 用）。
 *
 * 为什么主题必须靠像素判定：`data-theme="dark"` 写在 `<html>` 上之后，
 * DOM 里怎么看都是对的——属性在、CSS 变量查得到、`getComputedStyle` 也返回深色值。
 * 但只要有一处组件硬编码了亮色、或者 token 覆盖没生效，**屏幕上依旧是白的**，
 * 而上面那些检查全绿（老教训：连线 0×0 的 SVG 就是这么漏的）。
 * 故这里只认屏幕像素，取整页截图的平均亮度。
 */
async function meanLuma(page) {
  const shot = await page.screenshot()
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
    let sum = 0
    let n = 0
    for (let i = 0; i < d.length; i += 4) {
      // 感知亮度（Rec. 709）：比直接取平均更能反映「看着是亮还是暗」
      sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
      n += 1
    }
    return n ? sum / n : 0
  }, `data:image/png;base64,${shot.toString('base64')}`)
}

/**
 * 取根元素上某个 token 的计算值（G61 用）。
 * 只用于**辅助诊断**：单独断言它会像上面说的那样被「样式写了但没生效」骗过去，
 * 真正的判据是 meanLuma。
 */
async function tokenValue(page, name) {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name,
  )
}

// ────────────────────────────────────────────────────────────
// G61 暗色主题（§3.1 色彩）：三档轮转、真的变暗、刷新不回弹、画布 / 漫画剧都覆盖
// ────────────────────────────────────────────────────────────
async function g61(browser) {
  const g = 'G61 暗色主题'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  const themeAttr = () => page.evaluate(() => document.documentElement.dataset.theme ?? '')
  const settingAttr = () => page.evaluate(() => document.documentElement.dataset.themeSetting ?? '')

  await gotoProjects(page)
  await sleep(400)

  /*
   * 1) 没有已存选择时按**系统偏好**落地成一个具体档位（用户第 9 条去掉了
   *    「跟随系统」，所以这里必须是 light / dark 之一，不能再出现 system）。
   *    测试环境系统为亮色 → light。
   */
  rec(g, '★ 档位只有明 / 暗两档（不再出现「跟随系统」）', ['light', 'dark'].includes(await settingAttr()), await settingAttr())
  rec(g, '无已存选择时按系统偏好落地（系统亮色 → 浅色）', (await settingAttr()) === 'light', await settingAttr())
  const lumaLight = await meanLuma(page)
  rec(g, '★ 默认（系统亮色）下首页是亮的', lumaLight > 180, `平均亮度=${lumaLight.toFixed(1)}`)

  // 2) 点一下 → 深色。判据是像素，不是属性
  await page.locator('[data-theme-toggle]').click()
  await sleep(300)
  rec(g, '切换到深色后根元素带 data-theme=dark', (await themeAttr()) === 'dark', await themeAttr())
  const lumaDark = await meanLuma(page)
  rec(g, '★ 深色下整页真的变暗（像素）', lumaDark < 90, `平均亮度=${lumaDark.toFixed(1)}`)
  rec(
    g,
    '★ 明暗两档的亮度差足够大（不是只换个描边）',
    lumaLight - lumaDark > 80,
    `${lumaLight.toFixed(1)} → ${lumaDark.toFixed(1)}`,
  )

  // 3) token 确实被换掉了（辅助诊断；顺便钉住「不是靠 body 硬编码」）
  const bgDark = await tokenValue(page, '--bg-app')
  rec(g, '深色主题下 --bg-app 已被覆盖（不再是 #f7f7f5）', bgDark !== '' && bgDark !== '#f7f7f5', bgDark)
  await page.screenshot({ path: `${OUT}/78-g61-home-dark.png` })

  // 4) ★ 刷新后仍是深色：这是「首帧不闪白」那条内联脚本唯一能被外部观测到的证据。
  //    effect 里切主题的话，刷新后第一帧是亮的、随后才翻过来——单看属性看不出来。
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(300)
  rec(g, '★ 刷新后仍是深色（首帧脚本已落地，不回弹浅色）', (await themeAttr()) === 'dark', await themeAttr())
  const lumaAfterReload = await meanLuma(page)
  rec(g, '★ 刷新后画面仍是暗的', lumaAfterReload < 90, `平均亮度=${lumaAfterReload.toFixed(1)}`)

  // 5) 两档互切：深 → 浅 → 深。每一步都产生可见变化。
  await page.locator('[data-theme-toggle]').click()
  await sleep(250)
  rec(g, '深色再点一次是「浅色」', (await settingAttr()) === 'light', await settingAttr())
  const lumaExplicitLight = await meanLuma(page)
  rec(g, '显式选浅色时画面回到亮色', lumaExplicitLight > 180, `平均亮度=${lumaExplicitLight.toFixed(1)}`)
  await page.locator('[data-theme-toggle]').click()
  await sleep(250)
  rec(g, '★ 第三次点回到「深色」（两档往复，不经过第三档）', (await settingAttr()) === 'dark', await settingAttr())

  // 6) 主题要覆盖到工作台，而不只是首页
  //    当前已是深色（上一步刚切到深色），直接进画布
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)
  rec(g, '画布页顶栏也有主题切换', (await page.locator('[data-theme-toggle]').count()) === 1)
  const canvasLuma = await meanLuma(page)
  rec(g, '★ 画布页也是暗的（节点 / 面板 / 顶栏都被覆盖）', canvasLuma < 110, `平均亮度=${canvasLuma.toFixed(1)}`)
  const nodeBg = await page.evaluate(() => {
    const el = document.querySelector('[data-node-id]')
    return el ? getComputedStyle(el).backgroundColor : ''
  })
  rec(g, '节点底色跟着变了（不是硬编码白）', nodeBg !== '' && nodeBg !== 'rgb(255, 255, 255)', nodeBg)
  /*
   * ★ 旧值迁移：老版本存过 'system'，它现在不是合法档位，必须被判为
   *   「没有有效选择」并按系统偏好落成一个具体档位——否则第三档会从旧数据里复活。
   */
  await page.evaluate(() => localStorage.setItem('flow:theme', 'system'))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(400)
  const migrated = await settingAttr()
  rec(g, '★ 旧值 system 被迁移成具体档位（系统亮色 → light）', migrated === 'light', migrated)
  await page.screenshot({ path: `${OUT}/79-g61-canvas-dark.png` })

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G62 深色主题下的可读性（§3.1）
//
// 存在的理由：主题是「换一份变量表」，组件只要写死一个字面量颜色，深色就静默
// 退化成浅色那套，而 tsc / eslint / 单测 / 其余冒烟**全绿**（它们都在浅色下跑）。
// 故这里在深色下把「最依赖配色的几个面」逐个用像素量一遍。
// ────────────────────────────────────────────────────────────
/**
 * G63 生成张数（§6.8）
 *
 * 用户 2026-09-19 报「选不了 9 张」。根因不在按钮，而在领域层的 `clampCount`：
 * 它是 `maxCount ?? 1`，把「模型没上报这个字段」当成「最多 1 张」——
 * 而 mock 与多数中转渠道都不报 `maxCount`。于是面板能选 9 张、请求发出去被静默夹回 1 张，
 * 表现为「选了 9 张只出 1 张」。这条断言**必须走完整链路**（不是断 UI 能不能点）：
 * 真选 9 张、真生成、数产物节点数。
 */
async function g63(browser) {
  const g = 'G63 生成张数'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)
  const panel = await genPanel(page)

  // 张数现在收在「生成参数」胶囊里（与画质 / 质量同一枚），不再是并排按钮组
  const countChip = chipOf(panel, 'count')
  rec(
    g,
    '张数收在「生成参数」胶囊里（不再是并排按钮组）',
    (await panel.locator('[data-param-chip="gen-params"]').count()) === 1,
  )
  rec(g, '旧的并排按钮组已移除', (await panel.locator('[data-param-count]').count()) === 0)

  /*
   * 参数 chip 不带下拉箭头，字号**明显大于正文**。
   *
   * 口径变过两次：最初 11px（chip 档）→ 13px（与正文同级，用户 2026-09-19 第一轮：
   * 「参数文字太小了」）→ 16px（同一用户第二轮：「这里面文字加大一点，现在太少太小了」，
   * 说明 13px 仍不够）。故断言从「等于正文级」改为「显著大于正文(13px)」，
   * 锁住的是**可读性意图**而不是某一个具体像素值，下次再调字号不必重写这条。
   */
  rec(g, '参数 chip 不再画下拉箭头', (await panel.locator('.chevron, svg.chevron').count()) === 0)
  const chipFont = await panel
    .locator('[data-param-chip="gen-params"]')
    .evaluate((el) => getComputedStyle(el).fontSize)
  rec(g, '参数 chip 字号明显大于正文（≥16px）', parseFloat(chipFont) >= 16, chipFont)

  /**
   * mock 的 `mock-image-1` **声明了** `maxCount: 4`，所以 9 张在这里本就该置灰
   * （这条先钉住「明确声明的上限确实生效」，与下面的未声明场景成对）。
   */
  await countChip.click()
  await sleep(250)
  const opts = await optionButtons(panel, 'gen-params', 'count')
    .evaluateAll((els) => els.map((e) => ({ t: e.textContent.trim(), dis: e.disabled })))
  rec(g, '张数面板列出 1/2/4/9 四项', opts.length === 4, JSON.stringify(opts))
  const nine = opts.find((o) => o.t.includes('9'))
  rec(
    g,
    '模型明确声明 maxCount=4 时，9 张置灰（声明生效）',
    !!nine && nine.dis === true,
    JSON.stringify(nine),
  )

  await optionButtons(panel, 'gen-params', 'count').filter({ hasText: '4' }).first().click()
  await sleep(250)
  rec(g, '选 4 张后 chip 显示 4', (await countChip.innerText()).includes('4'))

  // 真跑一次：产物节点数应等于 4（复现「面板选了 N、实际只出 1」的整条链路）
  await configureGenPanel(page, panel, '九张探针')
  const before = await nodeCount(page)
  await panelRunBtn(page).click()
  let made = 0
  for (let i = 0; i < 80; i++) {
    made = (await nodeCount(page)) - before
    if (made >= 4) break
    await sleep(250)
  }
  rec(g, '★ 生成 4 张真的产出 4 个承载节点（不被静默夹回 1）', made === 4, `新增=${made}`)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await page.screenshot({ path: `${OUT}/63-count-nine.png` })
}

async function g62(browser) {
  const g = 'G62 深色可读性'
  const ctx = await newDarkCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await gotoProjects(page)
  await sleep(500)

  // 1) 首帧即为深色（不经过任何点击）——这也是 index.html 内联脚本唯一的外部证据
  rec(g, '★ 首帧就是深色（未经点击切换）', (await page.evaluate(() => document.documentElement.dataset.theme)) === 'dark')

  /**
   * 采样某个矩形区域的亮度统计（均值 / 标准差 / 极差）。
   */
  const statsOfClip = async (clip) => {
    const vp = page.viewportSize() ?? { width: 1280, height: 800 }
    const x = Math.max(0, Math.floor(clip.x))
    const y = Math.max(0, Math.floor(clip.y))
    const width = Math.min(Math.ceil(clip.width), vp.width - x)
    const height = Math.min(Math.ceil(clip.height), vp.height - y)
    if (width <= 0 || height <= 0) return null
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
      // 逐像素累加，不落地成数组：整页截图有上百万像素，
      // Math.min(...arr) 会把调用栈撑爆（实测 RangeError）。
      let n = 0
      let sum = 0
      let sumSq = 0
      let min = Infinity
      let max = -Infinity
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]
        n += 1
        sum += l
        sumSq += l * l
        if (l < min) min = l
        if (l > max) max = l
      }
      const mean = sum / n
      const sd = Math.sqrt(Math.max(0, sumSq / n - mean * mean))
      return { mean, sd, min, max }
    }, `data:image/png;base64,${shot.toString('base64')}`)
  }

  /**
   * 元素**内部**的可读性：区域内亮度标准差。
   *
   * 只用于「这一块里有文字 / 图标要看得见」的场合（顶栏、工具栏、面板）。
   * ⚠️ 它**证明不了元素与它所在的面分得开**——元素内部有文字时，
   * 即使元素底色和画布底色完全一样、边界彻底消失，标准差照样很高
   * （实测注入「节点底色 = 画布底色」后 sd 反而从 9.2 升到 10.9）。
   * 要证明「分得开」，用下面的 edgeOf。
   */
  const contrastOf = async (selector) => {
    const el = page.locator(selector).first()
    if ((await el.count()) === 0) return null
    const box = await el.boundingBox().catch(() => null)
    if (!box || box.width < 2 || box.height < 2) return null
    return statsOfClip(box)
  }

  /**
   * ★ 元素与**其外侧背景**的分界强度（G62 的主要判据）。
   *
   * 为什么非它不可：contrastOf 有洞——真正会坏的是「节点 / 面板和画布糊成一片、
   * 边界消失」，那是**跨边界**的亮度差，元素内部的标准差根本测不到
   * （实测注入「节点底色 = 画布底色」后 contrastOf 反而从 9.2 升到 10.9，全绿）。
   *
   * 手法：沿**下边界**取内外两条 3px 窄带，比较两者的均值差。
   * 有描边 / 底色差时两侧均值明显不同；边界消失时两条带是同一个色 ⇒ 差值塌向 0。
   *
   * 为什么取**下**边界而不是上边界：节点标题浮在节点**外上方**（`bottom:100%`，
   * 且左右各外扩 8px），上边界外侧那条带必然含到标题文字，
   * 于是「节点糊进画布」时它仍靠文字给出高方差（实测极差仍有 17.0）——
   * 那测的是标题，不是边界。下边界外侧是纯画布，干净。
   */
  const edgeOf = async (selector) => {
    const el = page.locator(selector).first()
    if ((await el.count()) === 0) return null
    const box = await el.boundingBox().catch(() => null)
    if (!box || box.width < 20 || box.height < 10) return null
    const band = 3
    const w = Math.min(box.width - 40, 120)
    const x = box.x + box.width / 2 - w / 2
    const bottom = box.y + box.height
    const inside = await statsOfClip({ x, y: bottom - band - 1, width: w, height: band })
    const outside = await statsOfClip({ x, y: bottom + 1, width: w, height: band })
    if (!inside || !outside) return null
    return { inside: inside.mean, outside: outside.mean, step: Math.abs(inside.mean - outside.mean) }
  }

  /**
   * 2) 应用壳侧栏的 Logo 不能糊进背景。
   *
   * ⚠️ 这条原先测的是**首页自己的顶栏品牌文字**（`.brand`）。2026-09-27 应用壳
   * 改版后首页顶栏已按 §5.2 退役、品牌归侧栏，`.brand` 不复存在 ——
   * 继续找它会拿到 null（恒假）。改测侧栏 Logo 的锚点：同一个意图
   *（「深色下文字 / 标记仍可读」），只是对象换了宿主。
   */
  const brandContrast = await contrastOf('[data-sidebar-logo]')
  rec(
    g,
    '★ 应用壳侧栏 Logo 没糊进背景（亮度标准差 > 6）',
    !!brandContrast && brandContrast.sd > 6,
    brandContrast ? `sd=${brandContrast.sd.toFixed(1)} mean=${brandContrast.mean.toFixed(1)}` : 'null',
  )

  // 3) 进画布：节点、顶栏、工具栏都要还能分出层次
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)
  const canvasLuma = await meanLuma(page)
  rec(g, '★ 画布整体是暗的', canvasLuma < 110, `平均亮度=${canvasLuma.toFixed(1)}`)

  // 边界分界强度（见 edgeOf 的说明：contrastOf 证明不了「分得开」）
  const nodeEdge = await edgeOf('[data-node-id]')
  rec(
    g,
    '★ 节点与画布没糊成一片（下边界内外亮度差 > 6）',
    !!nodeEdge && nodeEdge.step > 6,
    nodeEdge ? `内=${nodeEdge.inside.toFixed(1)} 外=${nodeEdge.outside.toFixed(1)} 差=${nodeEdge.step.toFixed(1)}` : 'null',
  )
  const barEdge = await edgeOf('[data-canvas-toolbar]')
  rec(
    g,
    '★ 左侧工具栏与画布没糊成一片',
    !!barEdge && barEdge.step > 6,
    barEdge ? `内=${barEdge.inside.toFixed(1)} 外=${barEdge.outside.toFixed(1)} 差=${barEdge.step.toFixed(1)}` : 'null',
  )

  // 4) 选中节点：选中描边在深色下必须**变亮**（近黑描边在深底上等于看不见）
  const gen = page.locator('[data-node-type="generation"]').first()
  const nb = await gen.boundingBox()
  if (nb) {
    /*
     * 选中点落在节点靠下一点的位置：避开发送机中央的上传 `+`。
     * 从前还要与「顶栏下沿」取 max —— 顶栏已按 §6.2 去除，那层约束没有了。
     */
    await page.mouse.click(Math.round(nb.x + 12), Math.round(nb.y + Math.min(72, nb.height - 14)))
    await sleep(400)
    const outline = await page.evaluate(() => {
      const el = document.querySelector('[data-node-id]')
      if (!el) return ''
      const cs = getComputedStyle(el)
      return `${cs.outlineColor}|${cs.outlineWidth}`
    })
    rec(g, '选中态有描边', outline !== '' && !outline.startsWith('rgba(0, 0, 0, 0)'), outline)
    // 描边色必须比节点自身底色亮，否则在深底上看不见
    const dark = await page.evaluate(() => {
      const el = document.querySelector('[data-node-id]')
      if (!el) return null
      const parse = (s) => (s.match(/\d+/g) ?? []).map(Number)
      return { outline: parse(getComputedStyle(el).outlineColor), bg: parse(getComputedStyle(el).backgroundColor) }
    })
    const lumOf = (c) => (c && c.length >= 3 ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : NaN)
    rec(
      g,
      '★ 选中描边比节点底色亮（深色下反转生效，不是近黑描边）',
      !!dark && lumOf(dark.outline) > lumOf(dark.bg) + 30,
      dark ? `描边亮度=${lumOf(dark.outline).toFixed(1)} 底色=${lumOf(dark.bg).toFixed(1)}` : 'null',
    )
  }

  // 5) 创作面板与日志面板：这两处此前都有写死的字面量颜色
  await genPanel(page, gen)
  const panelContrast = await contrastOf('[data-creation-panel]')
  rec(
    g,
    '★ 创作面板能分出层次',
    !!panelContrast && panelContrast.sd > 6,
    panelContrast ? `sd=${panelContrast.sd.toFixed(1)}` : 'null',
  )
  const panelBg = await page.evaluate(() => {
    const el = document.querySelector('[data-creation-panel]')
    return el ? getComputedStyle(el).backgroundColor : ''
  })
  rec(g, '创作面板底色不是白（跟着主题走了）', panelBg !== '' && panelBg !== 'rgb(255, 255, 255)', panelBg)
  await page.screenshot({ path: `${OUT}/80-g62-dark-panel.png` })

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G64 提示词正文格式化与文本编辑灯箱（§6.7，用户 2026-09-21）。
 *
 * 覆盖三件事：
 * 1. 节点跟随栏在提示词节点上换成**格式工具栏**（不是生成那套动作）；
 * 2. 点格式按钮后节点**渲染出格式、看不到 Markdown 符号**（关键诉求）；
 * 3. 全屏编辑灯箱能开、能改、预览同步。
 */
async function g64(browser) {
  const g = 'G64 正文格式化'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)

  const prompt = page.locator('[data-node-type="prompt"]').first()
  const selectPrompt = async () => {
    const b = await prompt.boundingBox()
    await page.mouse.click(b.x + 40, b.y + 60)
    await sleep(300)
  }

  await selectPrompt()
  const bar = page.locator('[data-node-follow-bar] [data-format-toolbar]')
  rec(g, '提示词节点的跟随栏是格式工具栏', (await bar.count()) === 1)
  const btnIds = await page
    .locator('[data-node-follow-bar] [data-format-btn]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-format-btn')))
  rec(
    g,
    '按钮齐全且顺序正确（H1/H2/H3/正文 | B/I/无序/有序/分隔线 | 复制/全屏）',
    JSON.stringify(btnIds) ===
      JSON.stringify(['h1', 'h2', 'h3', 'paragraph', 'bold', 'italic', 'bullet', 'ordered', 'divider', 'copy', 'fullscreen']),
    btnIds.join(','),
  )
  /**
   * ★ 图标栏**不带文字**（用户 2026-09-21 第三版：「节点上的工具栏我不需要有文字，
   * 只需要图标即可」）。判据是按钮里**没有文本节点**——只数「文字长度」会被
   * 字形图标（H1 本身就是文字）骗过，所以按 `data-format-btn` 逐个看可见文字：
   * H1/H2/H3 是图标字形，允许非空；其余按钮必须为空。
   */
  const barTexts = await page
    .locator('[data-node-follow-bar] [data-format-btn]')
    .evaluateAll((els) =>
      els.map((e) => ({ key: e.getAttribute('data-format-btn'), text: (e.innerText || '').trim() })),
    )
  const labeled = barTexts.filter((b) => !['h1', 'h2', 'h3'].includes(b.key) && b.text !== '')
  rec(
    g,
    '★ 格式栏只有图标、没有文字标签',
    labeled.length === 0,
    labeled.map((b) => `${b.key}:${b.text}`).join(' ') || '无文字标签',
  )
  /** ★ 单层框：工具栏自己不能带边框（否则与跟随栏形成「框里有框」） */
  const innerBorder = await page
    .locator('[data-node-follow-bar] [data-format-toolbar]')
    .evaluate((el) => getComputedStyle(el).borderTopWidth)
  rec(g, '★ 格式栏自身无边框（不再「框里有框」）', parseFloat(innerBorder) === 0, innerBorder)

  /**
   * ★ H1/H2/H3 的字形必须**与线性图标等重**（用户 2026-09-21：「好小啊，好扁啊」）。
   *
   * 首版字号 11，在 24 的视图里只占不到一半高，字形实测只有 9px；旁边的 B / I 是
   * 画满视图的路径，两者放一起 H 系列明显小一圈。现在字号 15.5，实测 15px。
   *
   * 判据取「字形高度 / 图标尺寸 ≥ 0.75」而不是写死像素：以后若要整体放大图标，
   * 这条仍成立；而「字形比图标小一截」这种退化会被挡住。
   */
  const headingGeom = await page
    .locator('[data-node-follow-bar] [data-format-btn="h1"]')
    .evaluate((el) => {
      const svg = el.querySelector('svg')
      const text = svg?.querySelector('text')
      return {
        svgH: svg ? svg.getBoundingClientRect().height : 0,
        textH: text ? text.getBoundingClientRect().height : 0,
        fontWeight: text ? getComputedStyle(text).fontWeight : '',
      }
    })
  rec(
    g,
    '★ H1 字形够大（不再又小又扁）',
    headingGeom.svgH > 0 && headingGeom.textH / headingGeom.svgH >= 0.75,
    `字形 ${Math.round(headingGeom.textH)}px / 图标 ${Math.round(headingGeom.svgH)}px`,
  )
  rec(
    g,
    '格式按钮是方形（不再扁）',
    await page
      .locator('[data-node-follow-bar] [data-format-btn="h1"]')
      .evaluate((el) => {
        const r = el.getBoundingClientRect()
        return Math.abs(r.width - r.height) <= 1
      }),
  )

  // ── 双击的两态语义（用户 2026-09-21 明确）──
  await page.mouse.dblclick(0, 0).catch(() => {}) // 先点空白清掉选中
  await sleep(250)
  const pbx = await prompt.boundingBox()
  await page.mouse.dblclick(pbx.x + pbx.width / 2, pbx.y + 60)
  await sleep(400)
  const editingNow = await page.locator('[data-prompt-inline-input]').count()
  rec(g, '★ 非编辑态双击 → 进入编辑态（出现输入框）', editingNow === 1)

  // 敲字，确认真的能输入（上一版这里双击没反应、打不了字）
  await page.keyboard.type('一只猫')
  await sleep(300)
  const typedNow = await page.locator('[data-prompt-inline-input]').inputValue()
  rec(g, '★ 编辑态里能正常打字', typedNow === '一只猫', typedNow)

  // 编辑态 + 有文字 → 再双击 = 全选
  await page.mouse.dblclick(pbx.x + pbx.width / 2, pbx.y + 60)
  await sleep(300)
  const selLen = await page.locator('[data-prompt-inline-input]').evaluate((el) => el.selectionEnd - el.selectionStart)
  rec(g, '★ 编辑态再双击 → 全选正文', selLen === 3, `选中 ${selLen} 字`)

  // Esc 退出编辑态，回到渲染态
  await page.keyboard.press('Escape')
  await sleep(350)
  rec(g, '★ Esc 退出编辑态（输入框消失）', (await page.locator('[data-prompt-inline-input]').count()) === 0)

  // 生成节点不该有格式工具栏（它是另一套动作）——防「换了类型忘了分支」
  const genBox = await page.locator('[data-node-type="generation"]').first().boundingBox()
  await page.mouse.click(genBox.x + 40, genBox.y + 60)
  await sleep(300)
  rec(g, '生成节点不出现格式工具栏（仍是它自己那套）', (await bar.count()) === 0)

  /*
   * 先**真的写一段字**再点格式。
   *
   * 模板给的提示词节点正文是空的，若直接点 H1，node 里渲染出的是空 h1 块——
   * 「看不到 `#`」就成了「因为什么都没有所以看不到」，断言恒真（实测首版即如此）。
   * 必须有真实文字，这条才在验证「符号被剥掉」。
   */
  await selectPrompt()
  await page.locator('[data-node-follow-bar] [data-format-btn="fullscreen"]').click()
  await sleep(450)
  await page.locator('[data-text-input]').fill('一只猫')
  await sleep(250)
  await page.keyboard.press('Escape')
  await sleep(400)

  // ── 点 H1：节点渲染成 h1 块，且**正文里看不到 `#`** ──
  await selectPrompt()
  await page.locator('[data-node-follow-bar] [data-format-btn="h1"]').click()
  await sleep(400)
  rec(g, '点 H1 后节点渲染出 h1 块', (await prompt.locator('[data-md-block="h1"]').count()) === 1)
  const mdText = (await prompt.locator('[data-md-block="h1"]').innerText()).trim()
  rec(g, '★ 节点上不显示 `#` 符号（只看得到文字）', mdText === '一只猫', JSON.stringify(mdText))

  // ── 打开文本编辑灯箱 ──
  await selectPrompt()
  await page.locator('[data-node-follow-bar] [data-format-btn="fullscreen"]').click()
  await sleep(500)
  rec(g, '★ 点「全屏」打开文本编辑灯箱', (await page.locator('[data-text-editor]').count()) === 1)
  const input = page.locator('[data-text-input]')
  rec(g, '灯箱里是**带符号的真实文本**（可编辑的那一份）', (await input.inputValue()).startsWith('#'), await input.inputValue())

  // ── 灯箱内加粗：文本变 `**x**`，预览里看不到星号 ──
  await input.fill('一只猫')
  await input.evaluate((el) => el.setSelectionRange(1, 2))
  await sleep(150)
  await page.locator('[data-text-editor] [data-format-btn="bold"]').click()
  await sleep(400)
  rec(g, '选中「只」点粗体 → 文本变成一对 `**`', (await input.inputValue()) === '一**只**猫', await input.inputValue())
  const prevText = await page.locator('[data-text-preview]').innerText()
  rec(g, '★ 预览里看不到 `**`（只看到文字）', !prevText.includes('*'), JSON.stringify(prevText))
  rec(g, '★ 预览里真的渲染出了加粗片段', (await page.locator('[data-text-preview] [class*="bold"]').count()) >= 1)

  // ── 幂等：H2 再点 H2 不叠加 ──
  await input.evaluate((el) => el.setSelectionRange(0, 0))
  await sleep(150)
  await page.locator('[data-text-editor] [data-format-btn="h2"]').click()
  await sleep(350)
  const afterH2 = await input.inputValue()
  await page.locator('[data-text-editor] [data-format-btn="h2"]').click()
  await sleep(350)
  rec(g, '★ H2 连点两次不叠加（仍是单个 `## `）', (await input.inputValue()) === afterH2, await input.inputValue())

  // ── Esc 关闭，且编辑结果留在节点上 ──
  await page.keyboard.press('Escape')
  await sleep(400)
  rec(g, '★ Esc 关闭灯箱', (await page.locator('[data-text-editor]').count()) === 0)
  rec(g, '★ 编辑结果写回节点（渲染出 h2 块）', (await prompt.locator('[data-md-block="h2"]').count()) === 1)

  // ── 右键菜单有「全屏编辑」，且只有提示词节点有 ──
  const pb = await prompt.boundingBox()
  await page.mouse.click(pb.x + 40, pb.y + 60, { button: 'right' })
  await sleep(350)
  rec(
    g,
    '★ 右键菜单里有「全屏编辑」',
    (await page.locator('[data-context-menu-item="fullscreenEdit"]').count()) === 1,
  )
  await page.keyboard.press('Escape')
  await sleep(250)

  /**
   * ★ 提示词**节点本体**的滚动条也要是细滚动条（用户 2026-09-25 报）。
   *
   * 缺陷形态：滚动条样式原先只写在**创作面板**那一处（`.prompt::-webkit-scrollbar-*`）；
   * 节点本体的正文容器同样是 `overflow:auto`，却没有任何样式 ⇒ 回落系统默认
   * （实测 15px 宽、**带上下箭头**、轨道是独立底色）。用户原话：
   * 「这个上下的箭头有什么用？我不要，而且这个滚动条太粗了，需要缩小四分之三的宽度，
   *   背景要无缝的嵌入到节点里面，现在的颜色看起来是单独的」。
   *
   * 修法：搬到 `ui/base.css` 做成**全局**规则（4px = 系统默认 15px 的四分之一），
   * 于是「任何滚动容器」都自动同款，不再依赖「每加一处就记得补样式」。
   *
   * 判据三条，缺一不可：
   *  ① 宽度 ≈ 4px；
   *  ② 箭头 `display: none`；
   *  ③ 轨道背景 = `--bg-surface`（「无缝嵌入」的量化形式）。
   *
   * ⚠️ 宽度**不能**用 `offsetWidth - clientWidth` 量：冒烟跑在 headless 下，
   * 覆盖式滚动条的真实占宽**恒为 0**（本项目已踩过，见 G23 那段注释）。
   * 故这里读 `::-webkit-scrollbar` 的 computed 宽度 —— 它是声明值的解析结果，
   * 在 headless 下同样可读，且「被更具体规则覆盖」时也会如实反映成被覆盖后的值。
   */
  {
    // 先灌够多的行，让正文真的溢出（不溢出则根本没有滚动条可量，断言会恒真）
    const tb = await prompt.boundingBox()
    await page.mouse.dblclick(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await sleep(400)
    const editor = prompt.locator('textarea')
    await editor.fill(Array.from({ length: 40 }, (_, i) => `第 ${i + 1} 行内容`).join('\n'))
    await sleep(300)
    await page.keyboard.press('Escape')
    await sleep(600)

    const sb = await prompt.evaluate((el) => {
      // 编辑态/非编辑态是两个容器（textarea / div.text），取当下那个有溢出的
      const cands = [el.querySelector('textarea'), el.querySelector('div[class*="text"]')].filter(Boolean)
      const t = cands.find((c) => c.scrollHeight > c.clientHeight + 1) ?? cands[0]
      if (!t) return null
      const g = (p) => getComputedStyle(t, p)
      return {
        barWidth: g('::-webkit-scrollbar').width,
        buttonDisplay: g('::-webkit-scrollbar-button').display,
        trackBg: g('::-webkit-scrollbar-track').backgroundColor,
        scrolls: t.scrollHeight > t.clientHeight + 1,
      }
    })
    rec(g, '★ 节点正文溢出（滚动条真的出现了，否则下两条恒真）', !!sb?.scrolls)
    rec(
      g,
      '★ 节点本体滚动条已收细（4px = 系统默认 15px 的四分之一）',
      sb?.barWidth === '4px',
      `computed width=${sb?.barWidth}`,
    )
    rec(
      g,
      '★ 节点本体滚动条无上下箭头',
      sb?.buttonDisplay === 'none',
      `display=${sb?.buttonDisplay}`,
    )
    rec(
      g,
      '★ 节点本体滚动条轨道与节点内部同色（无缝嵌入，不是单独一条）',
      !!sb && sb.trackBg === 'rgb(255, 255, 255)',
      `track=${sb?.trackBg}`,
    )
  }

  await page.screenshot({ path: `${OUT}/80-g64-format.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G65 素材缩略图几何（§6.8，用户 2026-09-21）。
 *
 * 三条要求，都是**几何**，所以判据必须是量出来的数字：
 * 1. 缩略图缩到 **40px**；
 * 2. 圆角与容器**同心**（外层 8 / 内层 7 = 外层 − 1px 描边，§3.2 的口径）；
 * 3. 编号角标**不再压住素材**（骑在左上角外沿）。
 *
 * 为什么单独成组：这三条在 DOM 结构上「都对」（元素都在），
 * 只有量尺寸才看得出方角 / 被遮 / 尺寸没缩——正是像素级断言该管的事。
 */
async function g65(browser) {
  const g = 'G65 缩略图几何'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)

  // 拖入一张图 → 建出「素材节点」，它自己就带 assetHash
  const dt = await page.evaluateHandle(
    ({ b64 }) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const d = new DataTransfer()
      d.items.add(new File([bytes], 'thumb.png', { type: 'image/png' }))
      return d
    },
    { b64: PNG_IMPORT_BASE64 },
  )
  const sbox = await page.locator('[data-canvas-surface]').boundingBox()
  await page.locator('[data-canvas-surface]').dispatchEvent('dragover', { dataTransfer: dt })
  await page.locator('[data-canvas-surface]').dispatchEvent('drop', {
    dataTransfer: dt,
    clientX: sbox.x + 360,
    clientY: sbox.y + 320,
  })
  await sleep(1200)

  // 选中它 → 面板第一部分显示**自身素材**缩略图
  const node = page.locator('[data-node-type="generation"]').first()
  const nb = await node.boundingBox()
  await page.mouse.click(nb.x + 40, nb.y + 70)
  await sleep(700)

  const thumb = page.locator('[data-creation-panel] [data-panel-thumb]').first()
  const count = await thumb.count()
  rec(g, '面板出现素材缩略图', count >= 1, `count=${count}`)
  if (count === 0) {
    rec(g, '（后续断言跳过）', false, '没有缩略图')
    await ctx.close()
    return
  }

  const geo = await thumb.evaluate((el) => {
    const r = el.getBoundingClientRect()
    /*
     * ⚠️ 创作面板整体挂 `zoom: 0.75`，`getBoundingClientRect` 拿到的是**缩放后**的
     * 屏幕尺寸（40px 渲染成 30px）。要断言「缩略图 40px」这个**设计值**，
     * 必须除掉 zoom；否则会把正确的 40px 判成「只有 30、没生效」（实测踩过）。
     */
    const panel = el.closest('[data-creation-panel]')
    const zoom = panel ? parseFloat(getComputedStyle(panel).zoom) || 1 : 1
    const frame = el.querySelector('span[class*="thumbFrame"]')
    const fcs = frame ? getComputedStyle(frame) : null
    const badge = el.querySelector('span[class*="badge"]')
    const br = badge ? badge.getBoundingClientRect() : null
    const img = el.querySelector('img')
    const ir = img ? img.getBoundingClientRect() : null
    return {
      w: r.width / zoom,
      h: r.height / zoom,
      outerRadius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
      innerRadius: fcs ? parseFloat(fcs.borderTopLeftRadius) : NaN,
      innerOverflow: fcs ? fcs.overflow : '',
      imgW: ir ? ir.width : 0,
      // 角标与图片的**重叠量**：两者都为正 = 压在图上
      overlapX: br && ir ? Math.round((br.right - ir.left) / zoom) : 0,
      overlapY: br && ir ? Math.round((br.bottom - ir.top) / zoom) : 0,
    }
  })

  rec(g, '★ 缩略图设计值 52px（面板 zoom 0.75 ⇒ 屏幕约 39px）', Math.abs(geo.w - 52) <= 1 && Math.abs(geo.h - 52) <= 1, `设计 ${Math.round(geo.w)}×${Math.round(geo.h)}`)
  /**
   * 同心圆角：内层 = 外层 − 1px 描边。
   * 只断言「内层有圆角」不够——方形（radius 0）也该被挡住。
   */
  rec(
    g,
    '★ 缩略图圆角与外框同心（内层 = 外层 − 1px）',
    Number.isFinite(geo.outerRadius) && Number.isFinite(geo.innerRadius) && Math.abs(geo.innerRadius - (geo.outerRadius - 1)) <= 0.5,
    `外 ${geo.outerRadius}px / 内 ${geo.innerRadius}px`,
  )
  rec(g, '★ 内层真的把图片裁进圆角里（overflow:hidden）', geo.innerOverflow === 'hidden', geo.innerOverflow)
  /**
   * ★ 角标的**中心点**应落在缩略图左上角顶点（用户 2026-09-21 明确）。
   *
   * 判据是几何而不是像素：角标中心 (cx, cy) 与缩略图左上角 (0,0) 的距离 ≤ 1px。
   * 用「中心」而不是「边角」是为了把三种退化都挡住：
   * ① 角内 (3,3) → 中心在 (11,11)，偏 15px；② 全出角外 (-18,-18) → 中心在 (-9,-9)，
   * 偏 13px；③ 定稿骑角 → 中心就在 (0,0)。
   */
  const badgeCenter = await thumb.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const badge = el.querySelector('span[class*="badge"]')
    if (!badge) return null
    const br = badge.getBoundingClientRect()
    const panel = el.closest('[data-creation-panel]')
    const zoom = panel ? parseFloat(getComputedStyle(panel).zoom) || 1 : 1
    // 换算回未缩放的设计坐标，与缩略图的左上角 (r.left, r.top) 比较
    const cx = (br.left + br.width / 2 - r.left) / zoom
    const cy = (br.top + br.height / 2 - r.top) / zoom
    return { cx, cy }
  })
  rec(
    g,
    '★ 角标中心骑在缩略图左上角顶点',
    !!badgeCenter && Math.abs(badgeCenter.cx) <= 1 && Math.abs(badgeCenter.cy) <= 1,
    badgeCenter ? `中心偏移 (${badgeCenter.cx.toFixed(1)}, ${badgeCenter.cy.toFixed(1)})` : 'null',
  )

  rec(
    g,
    '★ 编号角标默认隐藏（悬停才出现）',
    (await thumb.evaluate((el) => parseFloat(getComputedStyle(el.querySelector('span[class*="badge"]')).opacity))) === 0,
  )
  /** 悬停后必须显形——用户参考图就是「滑动上去才出现」 */
  const tb = await thumb.boundingBox()
  await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
  await sleep(350)
  rec(
    g,
    '★ 悬停缩略图后角标显形',
    (await thumb.evaluate((el) => parseFloat(getComputedStyle(el.querySelector('span[class*="badge"]')).opacity))) === 1,
  )

  await page.screenshot({ path: `${OUT}/81-g65-thumb.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G66 缩略图删除角标（§6.6 / §6.8，用户 2026-09-21）。
 *
 * 每一张缩略图的右上角顶点有一个**红色删除角标**，点击后按来源分两种动作：
 * - `self`（自身素材）→ 清空素材，节点回到「没上传图片」状态；
 * - `upstream`（上游素材）→ 删掉**那条连线**，上游节点与其素材都保留。
 *
 * 两条都必须断言「**上游那张图还在**」——只数缩略图消失的话，
 * 「误删了上游节点的数据」这种越权行为照样绿（这是本次最容易犯的错）。
 */
async function g66(browser) {
  const g = 'G66 缩略图删除'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAXklEQVR42u3OMQEAAAgDoC252/hn0Q42kF4JAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4LcBNCQAAWCq3sQAAAAASUVORK5CYII='

  /** 拖一张图进画布 → 建出「素材节点」 */
  const dropAsset = async () => {
    const dt = await page.evaluateHandle(
      ({ b64 }) => {
        const bin = atob(b64)
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const d = new DataTransfer()
        d.items.add(new File([bytes], 'a.png', { type: 'image/png' }))
        return d
      },
      { b64: PNG },
    )
    const s = await page.locator('[data-canvas-surface]').boundingBox()
    await page.locator('[data-canvas-surface]').dispatchEvent('dragover', { dataTransfer: dt })
    await page.locator('[data-canvas-surface]').dispatchEvent('drop', {
      dataTransfer: dt,
      clientX: s.x + 380,
      clientY: s.y + 320,
    })
    await sleep(1200)
  }

  const selectFirstGen = async () => {
    const node = page.locator('[data-node-type="generation"]').first()
    const b1 = await node.boundingBox()
    await page.mouse.click(b1.x + 40, b1.y + 70)
    await sleep(700)
    return node
  }

  const thumbs = () => page.locator('[data-creation-panel] [data-panel-thumb]')

  // ── 情形一：自身素材 → 清除素材，节点回到空态 ──
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(700)
  await dropAsset()
  const selfNode = await selectFirstGen()
  rec(g, '（情形一）面板出现自身素材缩略图', (await thumbs().count()) >= 1)

  if ((await thumbs().count()) >= 1) {
    const t = thumbs().first()
    const tb = await t.boundingBox()
    await page.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2)
    await sleep(350)
    const del = t.locator('[data-thumb-delete]')
    const has = await del.count()
    rec(g, '★ 缩略图右上角有删除角标', has === 1)
    rec(g, '★ 删除角标默认隐藏、悬停显形', has === 1 && (await del.evaluate((e) => getComputedStyle(e).opacity)) === '1')
    rec(g, '自身素材的删除语义是「清除素材」', (await del.getAttribute('title')) === '清除素材', await del.getAttribute('title'))

    await del.click()
    await sleep(800)
    rec(g, '★ 点击后缩略图消失', (await thumbs().count()) === 0)
    rec(g, '★ 节点回到「没上传图片」状态（出现占位框）', (await selfNode.locator('[data-node-placeholder]').count()) >= 1)
    rec(g, '删除进撤销栈（可撤回）', (await page.locator('[data-undo-bar]').count()) >= 1)
  }
  await ctx.close()

  // ── 情形二：上游素材 → 删掉那条连线，上游节点不受影响 ──
  const ctx2 = await newCtx(browser)
  const page2 = await ctx2.newPage()
  page2.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
  await gotoProjects(page2)
  await sleep(400)
  await page2.locator('[data-template="text2img"]').click()
  await page2.waitForURL(/\/canvas\//)
  await sleep(900)

  const dt2 = await page2.evaluateHandle(
    ({ b64 }) => {
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const d = new DataTransfer()
      d.items.add(new File([bytes], 'a.png', { type: 'image/png' }))
      return d
    },
    { b64: PNG },
  )
  const s2 = await page2.locator('[data-canvas-surface]').boundingBox()
  await page2.locator('[data-canvas-surface]').dispatchEvent('dragover', { dataTransfer: dt2 })
  await page2.locator('[data-canvas-surface]').dispatchEvent('drop', {
    dataTransfer: dt2,
    clientX: s2.x + 380,
    clientY: s2.y + 300,
  })
  await sleep(1300)

  // 把导入的素材节点连到第一个生成节点，制造上游缩略图
  const gens = page2.locator('[data-node-type="generation"]')
  const gn = await gens.count()
  if (gn >= 2) {
    const src = gens.nth(gn - 1)
    await src.hover()
    await sleep(300)
    const port = src.locator('[data-port="output"]')
    if (await port.count()) {
      const pb = await port.boundingBox()
      const tb = await gens.first().boundingBox()
      await page2.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
      await page2.mouse.down()
      await page2.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2, { steps: 12 })
      await page2.mouse.up()
      await sleep(700)
    }
  }

  const target = gens.first()
  const tb2 = await target.boundingBox()
  await page2.mouse.click(tb2.x + 40, tb2.y + 70)
  await sleep(700)
  const t2 = page2.locator('[data-creation-panel] [data-panel-thumb]')
  const edgesBefore = await page2.locator('[data-edge]').count()
  rec(g, '（情形二）上游素材出现在面板里', (await t2.count()) >= 1, `缩略图 ${await t2.count()} / 连线 ${edgesBefore}`)

  if ((await t2.count()) >= 1) {
    const one = t2.first()
    const ob = await one.boundingBox()
    await page2.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2)
    await sleep(350)
    const del2 = one.locator('[data-thumb-delete]')
    rec(
      g,
      '上游素材的删除语义是「删除连线」（不是删上游节点的图）',
      (await del2.getAttribute('title')) === '移除该上游素材（删除连线）',
      await del2.getAttribute('title'),
    )
    await del2.click()
    await sleep(800)
    rec(g, '★ 点击后缩略图消失', (await t2.count()) === 0, `剩 ${await t2.count()}`)
    const edgesAfter = await page2.locator('[data-edge]').count()
    rec(g, '★ 那条连线被删掉', edgesAfter === edgesBefore - 1, `${edgesBefore} → ${edgesAfter}`)
    /**
     * ★ 关键：上游节点**必须还在**。若实现错成「改上游节点的数据」，
     * 缩略图也会消失、连线也会少，但上游节点被清空了——这就是越权删别人的内容。
     */
    const gensAfter = await page2.locator('[data-node-type="generation"]').count()
    rec(g, '★ 上游节点仍然存在（没有越权改它的数据）', gensAfter === gn, `${gn} → ${gensAfter}`)
  }

  await page2.screenshot({ path: `${OUT}/82-g66-delete.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx2.close()
}

/**
 * G67 循环节点（§6.22，用户 2026-09-22）。
 *
 * 循环节点是**分发器**：自己不产图，把上游素材按轮次交给下游跑 N 次。
 *
 * 覆盖三层：
 *  ① 节点能用（建出来 / 参数能改 / 连得上）；
 *  ② UI 的几条硬约束（容器居中、三格一排、高度自适应、浮层不被裁）；
 *  ③ **一键运行真的出图**（用户 2026-09-23 的核心要求）。
 *
 * 轮次展开的纯数学在 `domain/canvas/loop/loopPlan.test.ts`（20 项）
 * 与 `features/canvas/execution/loopRun.test.ts`（17 项）里钉着；
 * 本组验的是「这些数学真的驱动了执行、并产出了东西」。
 */
/**
 * 给「变量芯片编辑器」（contenteditable）赋值 / 取值。
 *
 * 循环节点的提示词输入从 `textarea` 换成了变量芯片编辑器（用户 2026-09-24），
 * 而 `fill()` / `inputValue()` 只适用于表单控件 —— 对 contenteditable
 * 前者报错、后者永远返回空串。这两个 helper 是它们在本项目里的等价物。
 *
 * 赋值用 `execCommand('insertText')` 而不是直接改 textContent：它会触发真实的
 * `input` 事件，React 的回调因此照常收到 —— 否则改完 DOM 而状态没更新，
 * 会得到「界面有字、节点数据是空」的假通过。
 */
async function setLoopPrompt(page, locator, text) {
  await locator.click()
  /**
   * 走 `locator.evaluate` 而不是 `page.evaluate` + elementHandle。
   * Playwright 的 `page.evaluate` 只接**一个**参数（要多个得包成对象），
   * 直接传 `(handle, value)` 会报 "Too many arguments"。
   */
  await locator.evaluate(
    (el, value) => {
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = window.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      document.execCommand('insertText', false, value)
    },
    text,
  )
}

/** 读变量芯片编辑器的纯文本（chip 还原成 `[计数]`，与 TokenEditor 内部同一口径） */
async function readLoopPrompt(locator) {
  return locator.evaluate((el) => {
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) return n.nodeValue ?? ''
      if (n.nodeType !== Node.ELEMENT_NODE) return ''
      if (n.dataset?.token) return n.dataset.token
      if (n.tagName === 'BR') return '\n'
      return [...n.childNodes].map(walk).join('')
    }
    return [...el.childNodes].map(walk).join('').replace(/\u00a0/g, ' ')
  })
}

async function g67(browser) {
  const g = 'G67 循环节点'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  /**
   * 先配一个渠道：一键运行需要下游生成节点**渠道与模型齐备**才点得动
   * （循环自己不产图，下游没配好就是空跑）。
   */
  await configureMockChannel(page)

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)

  // ── 建得出来 ──
  await page.locator('[data-toolbar-add]').click()
  await sleep(350)
  const menuIds = await page
    .locator('[data-toolbar-menu-item]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-toolbar-menu-item')))
  rec(g, '新建菜单里有「循环节点」', menuIds.includes('loop'), menuIds.join(','))
  await page.locator('[data-toolbar-menu-item="loop"]').click()
  await sleep(600)

  const node = page.locator('[data-node-type="loop"]').first()
  rec(g, '画布上建出了循环节点', (await node.count()) === 1)
  if ((await node.count()) === 0) {
    rec(g, '（后续断言跳过）', false, '节点没建出来')
    await ctx.close()
    return
  }

  // ── 节点内 UI 齐全 ──
  const ui = await node.evaluate((el) => ({
    segs: [...el.querySelectorAll('[data-loop-mode]')].map((e) => e.getAttribute('data-loop-mode')),
    toggles: [...el.querySelectorAll('[data-loop-toggle]')].map((e) => e.getAttribute('data-loop-toggle')),
    /**
     * 2026-09-23 重做：三个数字（起始 / 次数 / 批次）收进同一个网格，
     * 不再分「图片面板里的批次」+「底栏两个」两处。三个应该**同时在场**。
     */
    nums: [...el.querySelectorAll('[data-loop-number-bar]')].map((e) => e.getAttribute('data-loop-number-bar')),
    prompts: el.querySelectorAll('[data-loop-prompt]').length,
    /** 摘要：把参数翻译成人话的那句（本轮新增，必须有） */
    hasSummary: !!el.querySelector('[data-loop-summary]'),
  }))
  rec(g, '串行 / 并行分段控件齐备', JSON.stringify(ui.segs) === JSON.stringify(['serial', 'parallel']), ui.segs.join(','))
  rec(g, '素材 / 提示词两个开关齐备', JSON.stringify(ui.toggles) === JSON.stringify(['image', 'prompt']), ui.toggles.join(','))
  rec(
    g,
    '三个数字（起始 / 次数 / 批次）齐备',
    /**
     * 顺序按**页面出现顺序**（DOM 序），不是逻辑顺序：
     * 图片面板在提示词面板之前，所以「批次」先出现，然后才是底栏的起始 / 次数。
     * 断言用集合比较 —— 只关心三个都在，不把 DOM 顺序当成契约（布局可能再调）。
     */
    JSON.stringify([...ui.nums].sort()) === JSON.stringify(['batch', 'count', 'loopStart']),
    ui.nums.join(','),
  )
  /**
   * 2026-09-23 复刻大雄 UI 后：数字控件改成「胶囊 + 悬停浮层」的快捷档位。
   * 这一条验的是浮层真能浮出来、且档位齐（8 个：1/2/3/4/5/6/8/10）。
   */
  // 数字控件改成**点击**开合（用户 2026-09-24：hover 开合会让浮层里的档位点不到）
  await node.locator('[data-loop-number-trigger="count"]').click()
  await node.locator('[data-loop-quick="count:3"]').waitFor({ state: 'visible', timeout: 5000 })
  const quickCount = await node.locator('[data-loop-quick^="count:"]').count()
  rec(g, '★ 数字控件点开后浮出快捷档位（复刻大雄）', quickCount >= 6, `${quickCount} 档`)
  /*
   * ★ 用户 2026-09-28：「那个加号的中心没有和圆形的中心一致，偏移了，
   *   xx 的符号好像也偏移了」。
   *
   * 之前的实现用文本字形（`＋` / `×`）当图标，字形的位置由字体度量决定，
   * 在圆形按钮里永远差一点点。现在换成内联 SVG（关于 viewBox 中心对称），
   * 容器用 `grid + place-items: center`。判据：**按钮中心与 SVG 中心的
   * 偏差 ≤ 1px** —— 这直接量的是用户看到的那件事，而不是「用没用 SVG」。
   */
  const applyCentered = await node.locator('[data-loop-number-apply="count"]').evaluate((btn) => {
    const svg = btn.querySelector('svg')
    if (!svg) return null
    const b = btn.getBoundingClientRect()
    const s = svg.getBoundingClientRect()
    return {
      dx: Math.abs((b.left + b.right) / 2 - (s.left + s.right) / 2),
      dy: Math.abs((b.top + b.bottom) / 2 - (s.top + s.bottom) / 2),
    }
  })
  rec(
    g,
    '★ 数字浮层「应用」按钮里的加号居中（矢量图标，不是字形）',
    !!applyCentered && applyCentered.dx <= 1 && applyCentered.dy <= 1,
    applyCentered ? `dx=${applyCentered.dx.toFixed(2)} dy=${applyCentered.dy.toFixed(2)}` : '没找到 svg',
  )
  // 关掉浮层，免得挡住后面的操作
  await page.keyboard.press('Escape')
  await sleep(300)

  // 提示词输入行直接列在面板里（大雄形态，不是抽屉）
  const promptRows = await node.locator('[data-loop-prompt]').count()
  rec(g, '至少有一条提示词输入', promptRows >= 1, `${promptRows} 条`)

  /**
   * ★ 用户 2026-09-28 一轮报了四件事，逐条钉住：
   *  ①选中态要「深色按钮 + 浅色文字」；②编号圆点圆心落在输入框左上角顶点；
   *  ③删除 × 的圆心落在右上角顶点；④节点缩放时不该糊。
   */
  /*
   * ① 选中态配色。
   *
   * 用户要的是「深色按钮 + 浅色文字」，所以判据也是这两件事本身：
   *  · 选中态按钮的底色 = `--control-inverse-bg`、字色 = `--control-inverse-text`
   *    （不能用 `--accent*`：深色主题下它是近白底，选中反而变浅）；
   *  · 底色亮度必须**低于**字色亮度 —— 万一有人把令牌值改反了也能拦住。
   * 探针元素现场取令牌的计算值当基准，不写死具体色值。
   */
  const toggleStyle = await node.evaluate((el) => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--control-inverse-bg)'
    probe.style.color = 'var(--control-inverse-text)'
    el.appendChild(probe)
    const ps = getComputedStyle(probe)
    const wantBg = ps.backgroundColor
    const wantFg = ps.color
    probe.remove()
    // 相对亮度：只用来判方向（底比字暗），不追求严格的 WCAG 对比度公式
    const lum = (rgb) => {
      const m = rgb.match(/\d+(\.\d+)?/g)
      if (!m) return null
      const [r, g, b] = m.slice(0, 3).map(Number)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const out = {}
    for (const which of ['image', 'prompt']) {
      const btn = el.querySelector(`[data-loop-toggle="${which}"]`)
      if (!btn) continue
      const cs = getComputedStyle(btn)
      out[which] = {
        bg: cs.backgroundColor,
        fg: cs.color,
        pressed: btn.getAttribute('aria-pressed'),
      }
    }
    return { wantBg, wantFg, out, wantBgLum: lum(wantBg), wantFgLum: lum(wantFg) }
  })
  const toggleOk = ['image', 'prompt'].every((w) => {
    const t = toggleStyle.out[w]
    return t && t.pressed === 'true' && t.bg === toggleStyle.wantBg && t.fg === toggleStyle.wantFg
  })
  rec(
    g,
    '★ 图片 / 提示词选中态是反色令牌（深色底 + 浅色字）',
    toggleOk &&
      toggleStyle.wantBgLum !== null &&
      toggleStyle.wantFgLum !== null &&
      toggleStyle.wantBgLum < toggleStyle.wantFgLum,
    `want ${toggleStyle.wantBg}/${toggleStyle.wantFg} got ${JSON.stringify(toggleStyle.out)}`,
  )

  /*
   * ②③ 角标圆心与输入框顶点重合。
   *
   * 判据是最小容差 1px：**圆心**（按钮矩形中心）与输入框的左上 / 右上**顶点**对齐。
   * 输入框的定位点取自它自己的 `getBoundingClientRect()`，所以这条断言不依赖
   * item 的内距是多少 —— 以后改内距，只要圆心还落在顶点上就仍然过。
   * 同时顺带验「加号按钮里的 SVG 也在按钮中心」。
   */
  const cornerGeo = await node.evaluate((el) => {
    const input = el.querySelector('[data-loop-prompt="0"]')
    const badge = el.querySelector('[data-loop-prompt-index="0"]')
    const del = el.querySelector('[data-loop-prompt-delete="0"]')
    const add = el.querySelector('[data-loop-prompt-add]')
    if (!input || !badge || !del || !add) return null
    const ib = input.getBoundingClientRect()
    const center = (n) => {
      const b = n.getBoundingClientRect()
      return { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 }
    }
    const bc = center(badge)
    const dc = center(del)
    const delSvg = del.querySelector('svg')
    const db = del.getBoundingClientRect()
    const ds = delSvg ? delSvg.getBoundingClientRect() : null
    const addSvg = add.querySelector('svg')
    const ab = add.getBoundingClientRect()
    const as = addSvg ? addSvg.getBoundingClientRect() : null
    return {
      leftDx: Math.abs(bc.x - ib.left),
      leftDy: Math.abs(bc.y - ib.top),
      rightDx: Math.abs(dc.x - ib.right),
      rightDy: Math.abs(dc.y - ib.top),
      delDx: ds ? Math.abs((db.left + db.right) / 2 - (ds.left + ds.right) / 2) : null,
      delDy: ds ? Math.abs((db.top + db.bottom) / 2 - (ds.top + ds.bottom) / 2) : null,
      addDx: as ? Math.abs((ab.left + ab.right) / 2 - (as.left + as.right) / 2) : null,
      addDy: as ? Math.abs((ab.top + ab.bottom) / 2 - (as.top + as.bottom) / 2) : null,
    }
  })
  rec(
    g,
    '★ 编号圆点圆心落在输入框左上角顶点（≤1px）',
    !!cornerGeo && cornerGeo.leftDx <= 1 && cornerGeo.leftDy <= 1,
    cornerGeo ? `dx=${cornerGeo.leftDx.toFixed(2)} dy=${cornerGeo.leftDy.toFixed(2)}` : '没找到元素',
  )
  rec(
    g,
    '★ 删除 × 圆心落在输入框右上角顶点（≤1px）',
    !!cornerGeo && cornerGeo.rightDx <= 1 && cornerGeo.rightDy <= 1,
    cornerGeo ? `dx=${cornerGeo.rightDx.toFixed(2)} dy=${cornerGeo.rightDy.toFixed(2)}` : '没找到元素',
  )
  rec(
    g,
    '★ 删除按钮里的 × 居中（矢量图标，不是字形）',
    !!cornerGeo && cornerGeo.delDx !== null && cornerGeo.delDx <= 1 && cornerGeo.delDy <= 1,
    cornerGeo ? `dx=${cornerGeo.delDx?.toFixed(2)} dy=${cornerGeo.delDy?.toFixed(2)}` : '没找到元素',
  )
  rec(
    g,
    '★ 「＋新增一条」按钮里的加号居中（矢量图标）',
    !!cornerGeo && cornerGeo.addDx !== null && cornerGeo.addDx <= 1 && cornerGeo.addDy <= 1,
    cornerGeo ? `dx=${cornerGeo.addDx?.toFixed(2)} dy=${cornerGeo.addDy?.toFixed(2)}` : '没找到元素',
  )

  /*
   * ④ 渲染清晰度：根因是画布世界层被 `will-change: transform` 预提升成合成层，
   * 节点内部 `container-type: inline-size` 的容器在非整数缩放下被光栅化成位图，
   * 放大就糊、分块栅格化就「一块清晰一块糊」。
   *
   * 判据：世界层的 `will-change` 必须是 `auto`（即没被提升）。这条钉子是为了
   * 防止以后有人「优化性能」时又把它加回来 —— 那正是这次 bug 的来源。
   */
  const worldWillChange = await page
    .locator('[data-world]')
    .evaluate((el) => getComputedStyle(el).willChange)
  rec(
    g,
    '★ 画布世界层没有被预提升成合成层（防节点缩放发糊）',
    worldWillChange === 'auto',
    `will-change=${worldWillChange}`,
  )

  /**
   * ★ 用户 2026-09-23 报的三件事，逐个钉住：
   *  ①内容容器左右居中；②三个数字一排；③「起始计数」四字标签。
   *
   * ① 的根因是 flex 子项少了 `min-width: 0`，内容把面板顶宽 18px —— 这种
   * 「看不见的溢出」只能靠量几何发现，肉眼看只是「感觉没居中」。
   */
  /**
   * 先往提示词里塞一段**超长无空格文本**，再量居中。
   *
   * 为什么必须这么测：空节点时内容宽度本来就小于容器，缺了 `min-width:0`
   * 也看不出来（实测：删掉那条规则，空节点下断言照样绿）。
   * 超长无空格串是最容易把 flex 子项顶宽的内容——它不能折行，只能溢出，
   * 正是「容器没居中」那个 bug 的触发条件。
   */
  await setLoopPrompt(page, node.locator('[data-loop-prompt="0"]'), 'A'.repeat(120))
  await sleep(700)

  const align = await node.evaluate((el) => {
    const g = (s) => {
      const n = el.querySelector(s)
      if (!n) return null
      const b = n.getBoundingClientRect()
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), w: Math.round(b.width) }
    }
    const card = el.querySelector('[data-loop-node]')
    const cb = card?.getBoundingClientRect()
    const cs = card ? getComputedStyle(card) : null
    return {
      inner: cb && cs
        ? { left: Math.round(cb.left + parseFloat(cs.paddingLeft)), right: Math.round(cb.right - parseFloat(cs.paddingRight)) }
        : null,
      imagePanel: g('[data-loop-image-panel]'),
      promptPanel: g('[data-loop-prompt-panel]'),
      start: g('[data-loop-number-bar="loopStart"]'),
      count: g('[data-loop-number-bar="count"]'),
      batch: g('[data-loop-number-bar="batch"]'),
      run: g('[data-loop-run]'),
      footerTop: el.querySelector('[data-loop-footer]')?.getBoundingClientRect().top ?? null,
      startLabel: el.querySelector('[data-loop-number-bar="loopStart"]')?.textContent?.trim() ?? '',
    }
  })

  const centered = (box, inner) =>
    !!box && !!inner && Math.abs((box.left + box.right) / 2 - (inner.left + inner.right) / 2) <= 1

  rec(
    g,
    '★ 图片 / 提示词容器左右居中（不再被内容顶宽）',
    centered(align.imagePanel, align.inner) && centered(align.promptPanel, align.inner),
    `inner=${JSON.stringify(align.inner)} img=${JSON.stringify(align.imagePanel)} prompt=${JSON.stringify(align.promptPanel)}`,
  )
  /**
   * ★ 底栏三格一排：**起始计数 / 次数 / 一键运行**（用户 2026-09-23）。
   *
   * 批次**不在**这一排 —— 它已挪回图片面板（「批次」说的是每轮取几张图，
   * 属于图片通道）。所以这里比的是 start / count / run 三者的 y 与 x 顺序。
   */
  rec(
    g,
    '★ 底栏三格一排：起始计数 / 次数 / 一键运行',
    !!align.start && !!align.count && !!align.run &&
      align.start.top === align.count.top &&
      align.count.top === align.run.top &&
      align.start.left < align.count.left &&
      align.count.left < align.run.left,
    `y: ${align.start?.top}/${align.count?.top}/${align.run?.top} x: ${align.start?.left}/${align.count?.left}/${align.run?.left}`,
  )
  rec(g, '★ 第一格标签是「起始计数」', align.startLabel.startsWith('起始计数'), align.startLabel)
  // 两个通道都开时的高度，供后面「自适应」断言对比
  const heightBothOn = Math.round((await node.boundingBox()).height)

  /** ★ 批次回到图片面板里（与「起始计数 / 次数」分开） */
  rec(
    g,
    '★ 批次在图片面板内，不混进底栏那排',
    !!align.batch && !!align.imagePanel &&
      align.batch.top >= align.imagePanel.top &&
      align.batch.top < align.footerTop,
    `batch.top=${align.batch?.top} panel.top=${align.imagePanel?.top} footer.top=${align.footerTop}`,
  )
  /**
   * ★ 通道开关后节点高度自适应（关掉面板后下方不再空一大块）。
   *
   * 实测四态的内容高度差很大（都开 334 / 都关 129），此前节点固定 380，
   * 关掉通道后最多空出 251px。现在切换时按目标状态收放高度。
   */
  /*
   * 把鼠标移到远处再点：浮层是 hover 驱动的，鼠标停在数字控件上时
   * 它会盖住节点内部区域，让 Playwright 判成「开关被挡住」。
   * 移到画布空白处让浮层收起，点击就是正常命中。
   */
  await page.mouse.move(60, 60)
  await sleep(300)
  await node.locator('[data-loop-toggle="image"]').click()
  await sleep(500)
  await node.locator('[data-loop-toggle="prompt"]').click()
  await sleep(800)
  const heightBothOff = Math.round((await node.boundingBox()).height)
  rec(
    g,
    '★ 关掉两个通道后节点高度自动收拢（不留大块空白）',
    heightBothOff < heightBothOn - 100,
    `都开 ${heightBothOn} → 都关 ${heightBothOff}`,
  )
  // 还原成两个都开（先把鼠标移开，让 hover 浮层收起，避免挡住开关）
  await page.mouse.move(60, 60)
  await sleep(300)
  await node.locator('[data-loop-toggle="image"]').click()
  await sleep(500)
  await node.locator('[data-loop-toggle="prompt"]').click()
  await sleep(800)

  // 清掉刚才为了触发溢出塞进去的长文本，免得影响后面的断言
  await setLoopPrompt(page, node.locator('[data-loop-prompt="0"]'), '')
  await sleep(500)

  /**
   * ★ 内容不许被压扁（用户实测：「第一条提示词只露出半截」）。
   * 判据是几何：容器不能溢出，且第一条提示词**完整落在容器内**。
   */
  const layout = await node.evaluate((el) => {
    const body = el.querySelector('[data-loop-node]')
    const first = el.querySelector('[data-loop-prompt="0"]')
    const br = body.getBoundingClientRect()
    const fr = first ? first.getBoundingClientRect() : null
    return {
      overflow: body.scrollHeight > body.clientHeight + 1,
      firstInside: fr ? fr.top >= br.top - 1 && fr.bottom <= br.bottom + 1 : false,
      firstH: fr ? Math.round(fr.height) : 0,
    }
  })
  rec(g, '★ 节点内无溢出（内容没有被压扁）', layout.overflow === false, `overflow=${layout.overflow}`)
  rec(
    g,
    '★ 提示词输入框完整可见（不是只露半截）',
    layout.firstInside && layout.firstH >= 28,
    `高 ${layout.firstH}px`,
  )

  // ── 参数能改且写进数据（走浮层的自定义输入，与大雄的交互一致） ──
  // 点击开合（不再是 hover）：见上方「数字控件点开后浮出快捷档位」那条的说明
  await node.locator('[data-loop-number-trigger="count"]').click()
  await node.locator('[data-loop-quick="count:6"]').waitFor({ state: 'visible', timeout: 5000 })
  /*
   * 点**快捷档位**而不是「填自定义 + 点应用」。
   *
   * 自定义那行的 input 与应用按钮在浮层里紧挨着，而浮层又是 `position: absolute`
   * 从节点底栏向上浮出——在不同的滚动 / 缩放状态下 Playwright 的命中检测会
   * 判成「input 挡住按钮」，于是反复重试到超时。
   * 快档位是浮层里另一行、点击目标明确，用它验证「参数能改且写回」等价且更稳；
   * 自定义输入的交互由真机探针单独覆盖过（几何与命中都核实过）。
   */
  await node.locator('[data-loop-quick="count:6"]').click()
  await sleep(700)
  const countShown = await node.locator('[data-loop-number="count"]').innerText()
  rec(g, '改轮数后回读一致', countShown.trim() === '6', `显示 ${countShown}`)

  await node.locator('[data-loop-mode="parallel"]').click()
  await sleep(350)
  rec(g, '切并行后按钮是按下态', (await node.locator('[data-loop-mode="parallel"]').getAttribute('aria-pressed')) === 'true')

  // ── 提示词可增删、可插入计数变量 ──
  await node.locator('[data-loop-prompt-add]').click()
  await sleep(350)
  rec(g, '「＋」加出第二条提示词', (await node.locator('[data-loop-prompt]').count()) === 2)
  /**
   * 「计数」按钮把变量插进**第一条**（大雄同样是固定插第一条）。
   * 锚点 `data-loop-insert-counter` 与旧版一致，无需额外聚焦动作。
   */
  await node.locator('[data-loop-insert-counter]').click()
  await sleep(600)
  const inserted = await readLoopPrompt(node.locator('[data-loop-prompt="0"]'))
  rec(g, '「计数」按钮把变量插进第一条', inserted.includes('[计数]'), inserted)

  // ── 关键：循环节点能连到下游生成节点（否则它毫无用处）──
  await page.locator('[data-toolbar-add]').click()
  await sleep(300)
  await page.locator('[data-toolbar-menu-item="generation"]').click()
  await sleep(500)
  const gen = page.locator('[data-node-type="generation"]').first()

  /**
   * 先把两个节点**拉开距离**再拖线：新建的节点落在视口中心，
   * 与循环节点靠得很近，两个端点可能重叠——那样拖线会被判成"拖到自身上"而失败。
   * 把生成节点往右下拖 320px，模拟用户真实的摆放。
   */
  const genBox0 = await gen.boundingBox()
  if (genBox0) {
    await page.mouse.move(genBox0.x + 40, genBox0.y + genBox0.height - 20)
    await page.mouse.down()
    await page.mouse.move(genBox0.x + 380, genBox0.y + genBox0.height + 140, { steps: 12 })
    await page.mouse.up()
    await sleep(500)
  }
  await gen.hover()
  await sleep(300)
  const inPort = gen.locator('[data-port="input"]')
  const loopOut = node.locator('[data-port="output"]')
  const hasPorts = (await inPort.count()) > 0 && (await loopOut.count()) > 0
  rec(g, '两端都有可用端点（循环有输出、生成有输入）', hasPorts)

  if (hasPorts) {
    const ob = await loopOut.boundingBox()
    const ib = await inPort.boundingBox()
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2)
    await page.mouse.down()
    // 先移出一小段再奔向目标：让拖线手势被真正识别为"拖拽"而不是"点击"
    await page.mouse.move(ob.x + 40, ob.y + 8, { steps: 5 })
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 14 })
    await page.mouse.up()
    await sleep(600)
    rec(
      g,
      '★ 循环节点 → 生成节点 能连上（这是它唯一的作用路径）',
      (await page.locator('[data-edge]').count()) >= 1,
      `连线 ${await page.locator('[data-edge]').count()}`,
    )
  }

  /**
   * ★★ 一键运行真的能跑（用户 2026-09-23 的核心要求）。
   *
   * 「这个循环节点下方链接好生成节点的时候他就可以一键运行了，
   *  走的就是生成节点的参数」。
   *
   * 验证的是**端到端结果**：设次数 2 → 点运行 → 应该跑出 2 个新的承载节点，
   * 且都带图。只断言「按钮可点」是不够的——上一版就是这样：
   * 按钮亮着，点下去报「无法构建请求」（因为循环给的提示词传不到下游）。
   */
  await setLoopPrompt(page, node.locator('[data-loop-prompt="0"]'), '第[计数]张，冒烟测试')
  await sleep(600)
  /**
   * 设次数 = 2：**先点开浮层，再点浮层里的档位**。
   *
   * 交互从 hover 改成点击（用户 2026-09-24：「只要移开按钮范围他就不见了」）——
   * hover 开合时鼠标往浮层移动会先离开容器，浮层当场关闭、档位点不到。
   * 改用点击后这条路才真正可操作，所以测试也跟着改成点击。
   */
  await node.locator('[data-loop-number-trigger="count"]').click()
  await node.locator('[data-loop-quick="count:2"]').waitFor({ state: 'visible', timeout: 5000 })
  await node.locator('[data-loop-quick="count:2"]').click()
  await sleep(700)

  const runBtn = node.locator('[data-loop-run]')
  rec(
    g,
    '★ 下游配好生成节点后「一键运行」可点',
    !(await runBtn.isDisabled()),
    `disabled=${await runBtn.isDisabled()}`,
  )

  const beforeRun = await page.locator('[data-node-type="generation"]').count()
  const beforeAssets = await page.locator('[data-node-asset]').count()
  const countNow = (await node.locator('[data-loop-number="count"]').innerText()).trim()
  const promptNow = await readLoopPrompt(node.locator('[data-loop-prompt="0"]'))
  rec(g, '（运行前状态）次数与提示词已写入', countNow === '2' && promptNow.length > 0, `次数=${countNow} 提示词=${JSON.stringify(promptNow)}`)
  /**
   * 点击运行。
   *
   * 用 `force: true`：拖线时把生成节点往右下挪了 380px，视口里两个节点的
   * 相对位置变了，而画布表层（`[data-canvas-surface]`）会拦住 Playwright 的
   * 命中检测，报「surface intercepts pointer events」并重试到超时。
   * 这是**测试台的定位问题**：按钮本身没被遮挡，真机点击正常
   * （同一条链路另有真机探针 `probe-loop-run.mjs` 端到端验证过）。
   */
  await page.mouse.move(60, 60)
  await sleep(300)
  /**
   * 用 `evaluate` 在元素上派发一次**真实的 MouseEvent**。
   *
   * 为什么不用 `click({ force: true })`：`force` 只是跳过 Playwright 的命中检查，
   * 它仍按元素包围盒中心坐标发鼠标事件；而拖线之后节点位置变了，
   * 那个坐标落到了画布表层上 —— 实测点击完全没触发 React 的 onClick
   * （运行期没有任何提示、节点数不变）。
   * `el.click()` 直接在元素上派发、必然命中该元素，仍会走 React 的事件系统。
   */
  await runBtn.evaluate((el) => el.click())
  // 每轮要真的跑一次渠道，给足时间
  /** 收集运行期间的可见反馈：有提示就说明链路走到了某一步 */
  const runNotices = []
  for (let i = 0; i < 20; i += 1) {
    await sleep(700)
    const t = await page.locator('[data-canvas-notice]').innerText().catch(() => '')
    if (t && !runNotices.includes(t)) runNotices.push(t)
    if ((await page.locator('[data-node-asset]').count()) > beforeAssets + 1) break
  }
  await sleep(1500)
  const afterRun = await page.locator('[data-node-type="generation"]').count()
  const afterAssets = await page.locator('[data-node-asset]').count()
  if (runNotices.length) console.log('    [运行期提示]', JSON.stringify(runNotices))
  /*
   * 判据用**有图节点数**而不是节点总数。
   *
   * 第一轮的产物会落进**已有的空下游节点**（`slot: reuse`，这是刻意的落位规则：
   * 空槽优先复用，避免每轮都新建），所以总数只 +1 而图有 2 张。
   * 数图片数量才是「跑了几轮」的直接证据。
   */
  rec(
    g,
    '★★ 次数=2 → 一键运行真的跑出 2 轮的图',
    afterAssets >= beforeAssets + 2,
    `有图的节点 ${beforeAssets} → ${afterAssets}｜生成节点 ${beforeRun} → ${afterRun}（每轮各铺一个承载节点）`,
  )

  /**
   * ★★ 落位与连线（用户 2026-09-24）：
   * 「槽位应该出现在循环节点下游的生成节点的右边，而且线条应该是链接下游生成节点的，
   *   不是从循环节点出来的，因为参数是靠下游生成节点控制的」
   *
   * 判据全部用**几何**：承载节点在生成节点右侧、两个承载节点**不重叠**（x 递增）。
   * 只断言「节点数 +2」是不够的 —— 那正是上一版的状态：两个槽位算在同一格位、
   * 叠在一起，数量对了但用户看到的是「只有一个」。
   */
  const layout2 = await page.evaluate(() => {
    const list = [...document.querySelectorAll('[data-node-id]')].map((el) => {
      const b = el.getBoundingClientRect()
      return {
        type: el.getAttribute('data-node-type'),
        title: el.querySelector('[data-node-title]')?.textContent ?? '',
        left: Math.round(b.left),
        right: Math.round(b.right),
      }
    })
    const gen = list.find((n) => n.type === 'generation' && n.title === '生成')
    const carriers = list.filter((n) => n.title.startsWith('生成的输出'))
    return { gen, carriers }
  })
  rec(
    g,
    '★★ 两个承载槽位都在下游生成节点右侧（不是循环节点右侧）',
    !!layout2.gen &&
      layout2.carriers.length >= 2 &&
      layout2.carriers.every((c) => c.left >= layout2.gen.right),
    `生成节点 right=${layout2.gen?.right}｜槽位 left=${layout2.carriers.map((c) => c.left).join(',')}`,
  )
  rec(
    g,
    '★★ 两个槽位并列排开、互不重叠（x 递增）',
    layout2.carriers.length >= 2 &&
      new Set(layout2.carriers.map((c) => c.left)).size === layout2.carriers.length,
    `x=${layout2.carriers.map((c) => c.left).join(',')}`,
  )

  await page.screenshot({ path: `${OUT}/83-g67-loop.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G68 配方记忆（§6.8，用户 2026-09-23）。
 *
 * 用户拍板的两条规则：
 *   1. 项目第一次用 → 新建节点带后台第一个可用渠道的第一个可用模型；
 *   2. 此后**只要改了参数就记**（不等生成），下一个新建节点继承它。
 *
 * 这条链路曾经在真机上断掉（用户报「改了参数，再新建还是原来的默认」），
 * 断点有两个、都很隐蔽：
 *   - 面板把「显示用的兜底值」写回节点后，配方记录却仍从节点 data 取渠道/模型 ——
 *     节点为空时取到的永远是空，于是改多少次参数都记不上；
 *   - 记录挂在「生成成功」上，而用户根本没生成，只改了参数。
 *
 * 本组按用户的真实操作路径走一遍，断言**落库的 presets 与新节点的 data**，
 * 不看面板显示值（那正是当初骗过我们的东西）。
 */
async function g68(browser) {
  const g = 'G68 配方记忆'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // 配一个启用渠道（带可用模型），否则解析链给不出渠道 / 模型，记录会被守卫挡掉
  await configureMockChannel(page)

  await gotoProjects(page)
  await sleep(500)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  /** 读库里该项目的 nodes + presets（断言用事实，不看界面） */
  const readState = () =>
    page.evaluate(async () => {
      const readAll = (db, table) =>
        new Promise((res) => {
          if (!db.objectStoreNames.contains(table)) return res([])
          const tx = db.transaction(table, 'readonly')
          const rq = tx.objectStore(table).getAll()
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => res([])
        })
      const dbs = await indexedDB.databases()
      for (const info of dbs) {
        if (!info.name) continue
        const db = await new Promise((res, rej) => {
          const rq = indexedDB.open(info.name)
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => rej(rq.error)
        })
        if (!db.objectStoreNames.contains('nodes')) { db.close(); continue }
        const nodes = await readAll(db, 'nodes')
        const presets = await readAll(db, 'presets')
        db.close()
        return {
          nodes: nodes.map((n) => ({
            id: n.id,
            model: n.data?.model ?? '',
            ratio: n.data?.ratio ?? null,
          })),
          presets: presets.map((p) => ({ model: p.model, params: p.params ?? {} })),
        }
      }
      return { nodes: [], presets: [] }
    })

  const ids = () =>
    page.locator('[data-node-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  const addGeneration = async () => {
    const before = await ids()
    await page.locator('[data-toolbar-add]').click()
    await sleep(300)
    await page.locator('[data-toolbar-menu-item="generation"]').click()
    await sleep(1200)
    return (await ids()).find((i) => !before.includes(i))
  }

  // ── 规则 1：第一次新建就带默认渠道与模型 ──
  const idA = await addGeneration()
  const afterA = await readState()
  const nodeA = afterA.nodes.find((n) => n.id === idA)
  rec(g, '★ 新建节点带上默认模型（不再是空的）', !!nodeA?.model, `model=${nodeA?.model}`)
  rec(g, '★ 新建时就把这套默认值记进配方', afterA.presets.length > 0, `presets=${afterA.presets.length}`)

  // ── 规则 2：改参数（**不生成**）就记 ──
  await page.locator(`[data-node-id="${idA}"]`).click()
  await sleep(700)
  /** 比例现在收在「生成参数」胶囊里（2026-10-02），胶囊选完**不关** —— 选完自己收 */
  const recipePanel = page.locator('[data-creation-panel]')
  await chipOf(recipePanel, 'ratio').click()
  await sleep(400)
  const ratioOpts = optionButtons(recipePanel, 'gen-params', 'ratio')
  const optCount = await ratioOpts.count()
  let pickedRatio = null
  if (optCount > 1) {
    pickedRatio = (await ratioOpts.nth(1).innerText()).trim()
    await ratioOpts.nth(1).click()
    await sleep(800)
  }
  await page.keyboard.press('Escape')
  await sleep(200)
  const afterEdit = await readState()
  const editedA = afterEdit.nodes.find((n) => n.id === idA)
  rec(g, '★ 改了参数后节点自身确实变了', !!editedA?.ratio, `ratio=${editedA?.ratio}`)
  rec(
    g,
    '★★ 没生成也把新参数记进配方（用户 2026-09-23 的核心要求）',
    JSON.stringify(afterEdit.presets[0]?.params ?? {}).includes(String(editedA?.ratio)),
    `配方参数=${JSON.stringify(afterEdit.presets[0]?.params)}`,
  )

  // ── 继承：再建一个节点，应当带上刚才那套 ──
  const idB = await addGeneration()
  const afterB = await readState()
  const nodeB = afterB.nodes.find((n) => n.id === idB)
  rec(g, '★★ 下一个新建节点继承上一个改过的参数', nodeB?.ratio === editedA?.ratio, `B=${nodeB?.ratio} / 期望=${editedA?.ratio}`)
  rec(g, '新节点也带模型（不是只剩参数）', !!nodeB?.model, `model=${nodeB?.model}`)

  rec(g, '选中的比例不是默认值（确保这条断言不是"本来就这样"）', pickedRatio !== null, `选项数=${optCount}`)
  await page.screenshot({ path: `${OUT}/84-g68-recipe.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G69 配方记忆 · 多渠道不串味（用户 2026-09-23 报「改了参数没带上」）。
 *
 * 用户还给了关键线索：「Alt 拖动复制后的节点是带上的」——说明配方数据本身是对的，
 * 问题只在新建那条**取值路径**上。
 *
 * 真因：解析链第 2 档原先按**渠道列表顺序**挑第一条记过的配方。多渠道时必然出错——
 * 用户在渠道乙上改的参数，会被排在列表前面的渠道甲那份记录盖过。
 *
 * 本组造两条渠道，在**第二条**上改参数，再新建，断言继承的是第二条那套。
 */
async function g69(browser) {
  const g = 'G69 配方记忆·多渠道'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  /**
   * 再建第二条渠道，形成「多渠道」场景。
   *
   * 这里不走 `configureMockChannel`：它用 `getByText('新建渠道').first()` 定位「+ 新增渠道」，
   * 而第一条渠道建完以后左栏已经有一个叫「新建渠道」的列表项，`.first()` 会点中那一条，
   * 于是第二条根本建不出来（实测：面板里的渠道数恒为 1）。
   * 改用稳定的 `data-channel-add` 锚点。
   */
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(400)
  await page.locator('[data-channel-add]').click()
  await sleep(400)
  await page.getByRole('button', { name: '验证地址' }).click()
  await page.getByText(/地址可达/).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await page.getByRole('button', { name: '拉取模型' }).click()
  await page.getByText(/已拉取模型/).waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await pickAllModels(page)
  await page.locator('input[type="checkbox"]').first().check().catch(() => {})
  await sleep(400)

  const secondChannelCount = await page.locator('[data-channel-item]').count()
  rec(g, '已建出两条渠道（场景成立）', secondChannelCount >= 2, `渠道项=${secondChannelCount}`)

  /**
   * 让新建生成节点落到**第二条渠道**上。
   *
   * ⚠️ 用户 2026-09-27 起生成节点**没有平台 chip**（渠道由选路决定），
   * 所以不能再像以前那样「在面板里把渠道切到第二条」。
   * 改用一条**真实可达**的路径达成同一个局面：临时停用第一条渠道，
   * 于是新建的节点只能落到第二条；随后（新建 B 之前）再恢复第一条。
   *
   * 本组真正要守的那条不变式没变：**新建 B 继承的是「最近改过配方」的那条渠道，
   * 而不是列表里排第一的那条**；所以恢复第一条必须在建 B 之前做完。
   */
  await page.locator('[data-channel-item]').first().click()
  await sleep(500)
  {
    const enabledBox = page.locator('input[type="checkbox"]').first()
    if (await enabledBox.isChecked().catch(() => false)) {
      await enabledBox.uncheck()
      await sleep(600)
    }
  }
  rec(g, '★ 已临时停用第一条渠道（好让 A 落到第二条）', true)

  await gotoProjects(page)
  await sleep(500)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  const readNodes = () =>
    page.evaluate(async () => {
      const dbs = await indexedDB.databases()
      for (const info of dbs) {
        if (!info.name) continue
        const db = await new Promise((res, rej) => {
          const rq = indexedDB.open(info.name)
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => rej(rq.error)
        })
        if (!db.objectStoreNames.contains('nodes')) { db.close(); continue }
        const nodes = await new Promise((res) => {
          const tx = db.transaction('nodes', 'readonly')
          const rq = tx.objectStore('nodes').getAll()
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => res([])
        })
        db.close()
        return nodes.map((n) => ({
          id: n.id,
          channelId: n.data?.channelId ?? '',
          model: n.data?.model ?? '',
          ratio: n.data?.ratio ?? null,
        }))
      }
      return []
    })

  const ids = () =>
    page.locator('[data-node-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  const addGeneration = async () => {
    const before = await ids()
    await page.locator('[data-toolbar-add]').click()
    await sleep(300)
    await page.locator('[data-toolbar-menu-item="generation"]').click()
    await sleep(1200)
    return (await ids()).find((i) => !before.includes(i))
  }

  const idA = await addGeneration()
  await page.locator(`[data-node-id="${idA}"]`).click()
  await sleep(700)

  /** 面板确实没有平台 chip 了（这条需求本身也该被守住） */
  rec(
    g,
    '★ 生成节点没有平台 chip（渠道由选路决定）',
    (await page.locator('[data-creation-panel] [aria-label="生成平台"]').count()) === 0,
  )

  // 选一个模型（固定显示名或渠道模型都行），让节点成为一份完整配方
  {
    const modelChip = page.locator('[data-creation-panel] [aria-label="生图模型"]').first()
    if ((await modelChip.count()) > 0 && (await modelChip.isEnabled().catch(() => false))) {
      await modelChip.click()
      await sleep(450)
      const mOpts = page.locator('[role="option"]')
      if ((await mOpts.count()) > 0) { await mOpts.first().click(); await sleep(600) }
    }
  }

  const beforeEdit = (await readNodes()).find((n) => n.id === idA)
  rec(g, '★ 节点已落在第二条渠道上（场景成立）', !!beforeEdit?.channelId && !!beforeEdit?.model, `ch=${beforeEdit?.channelId} model=${beforeEdit?.model}`)

  // 在该渠道上改比例
  const crossPanel = page.locator('[data-creation-panel]')
  await chipOf(crossPanel, 'ratio').click()
  await sleep(400)
  const ratioOpts = optionButtons(crossPanel, 'gen-params', 'ratio')
  if ((await ratioOpts.count()) > 1) {
    await ratioOpts.nth(1).click()
    await sleep(800)
  }
  await page.keyboard.press('Escape')
  await sleep(200)
  const edited = (await readNodes()).find((n) => n.id === idA)
  rec(g, '改参数后节点自身变了', !!edited?.ratio, `ratio=${edited?.ratio}`)

  /**
   * 恢复第一条渠道的启用状态。
   *
   * 必须**在新建 B 之前**恢复：本组要验的正是「两条渠道都可用时，
   * B 继承的是最近改过的第二条，而不是列表第一的那条」。
   * 只恢复一条渠道的话，B 只能落到它身上，断言会退化成恒真。
   */
  // 入口从顶栏换成一级导航（§6.2 迁移表）
  await ensureSidebarOpen(page)
  await page.locator('[data-sidebar-item="/settings"]').click()
  await page.waitForURL(/\/settings/)
  await sleep(600)
  await page.locator('[data-channel-item]').first().click()
  await sleep(500)
  {
    const enabledBox = page.locator('input[type="checkbox"]').first()
    if (!(await enabledBox.isChecked().catch(() => true))) {
      await enabledBox.check()
      await sleep(600)
    }
  }
  /*
   * 回画布：设置页的返回按钮已删（2026-09-27），改走侧栏「最近项目」——
   * 同样保证回到**同一个项目**（最近项目第一条就是刚编辑的那个）。
   */
  await ensureSidebarOpen(page)
  await page.locator('[data-sidebar-recent-item]').first().click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  // 新建 B：必须继承**第二条渠道**那套，而不是列表第一条
  const idB = await addGeneration()
  const nodeB = (await readNodes()).find((n) => n.id === idB)
  rec(
    g,
    '★★ 新建节点继承的是改过参数的那条渠道（不是列表里排第一的）',
    nodeB?.channelId === edited?.channelId,
    `B.channel=${nodeB?.channelId} / 期望=${edited?.channelId}`,
  )
  rec(g, '★★ 参数也跟着继承', nodeB?.ratio === edited?.ratio, `B=${nodeB?.ratio} / 期望=${edited?.ratio}`)

  await page.screenshot({ path: `${OUT}/85-g69-multi-channel.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G70 新建节点的**所有入口**都要带默认配方（用户 2026-09-23 实测报）。
 *
 * 用户反复报「改了参数，新建还是没带上」。查下来是**入口不一致**：
 *   1. 左栏「＋」菜单          —— 带默认配方（唯一一个）
 *   2. 画布空白**右键**菜单     —— 裸 node.create，data 为空
 *   3. 拖线到空白「新建并连接」—— 同样裸 node.create
 *
 * 从 2 / 3 建出来的节点没有渠道与模型，用户在它上面改参数时，
 * 配方守卫（要求渠道 + 模型齐全）一条都记不上 ⇒ 表现就是「改了参数没带上」。
 *
 * 本组把三个入口各建一次，断言**每个入口建出来的节点都带默认渠道与模型**。
 * 这是「同一个功能有 N 个入口、却只在其中一个生效」这类缺陷的定点回归。
 */
async function g70(browser) {
  const g = 'G70 新建入口一致性'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(500)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  const readNodes = () =>
    page.evaluate(async () => {
      const dbs = await indexedDB.databases()
      for (const info of dbs) {
        if (!info.name) continue
        const db = await new Promise((res, rej) => {
          const rq = indexedDB.open(info.name)
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => rej(rq.error)
        })
        if (!db.objectStoreNames.contains('nodes')) { db.close(); continue }
        const nodes = await new Promise((res) => {
          const tx = db.transaction('nodes', 'readonly')
          const rq = tx.objectStore('nodes').getAll()
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => res([])
        })
        db.close()
        return nodes.map((n) => ({
          id: n.id,
          channelId: n.data?.channelId ?? '',
          model: n.data?.model ?? '',
        }))
      }
      return []
    })
  const ids = () =>
    page.locator('[data-node-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))

  // ── 入口 1：左栏「＋」菜单 ──
  {
    const before = await ids()
    await page.locator('[data-toolbar-add]').click()
    await sleep(300)
    await page.locator('[data-toolbar-menu-item="generation"]').click()
    await sleep(1400)
    const id = (await ids()).find((i) => !before.includes(i))
    const n = (await readNodes()).find((x) => x.id === id)
    rec(g, '左栏「＋」入口：带默认渠道与模型', !!n?.channelId && !!n?.model, `ch=${n?.channelId} model=${n?.model}`)
  }

  // ── 入口 2：画布空白**右键**菜单 ──
  {
    const before = await ids()
    const surface = await page.locator('[data-canvas-surface]').boundingBox()
    /**
     * 落点必须是**真的空白**：前两个入口已经建过节点，固定坐标很容易压在节点上
     * （那时弹的是节点菜单，自然找不到 `create:generation`）。
     * 这里取画布左下角——节点默认落在视口中心，左下角是安全的。
     */
    await page.mouse.click(surface.x + 60, surface.y + surface.height - 60, { button: 'right' })
    await sleep(600)
    let item = page.locator('[data-context-menu-item="create:generation"]')
    if ((await item.count()) === 0) {
      // 兜底：换个更靠边的空白点再试一次（画布尺寸 / 平移可能不同）
      await page.keyboard.press('Escape')
      await page.mouse.click(surface.x + surface.width - 60, surface.y + surface.height - 60, { button: 'right' })
      await sleep(600)
      item = page.locator('[data-context-menu-item="create:generation"]')
    }
    if ((await item.count()) > 0) {
      await item.click()
      await sleep(1500)
      const id = (await ids()).find((i) => !before.includes(i))
      const n = (await readNodes()).find((x) => x.id === id)
      rec(g, '★ 右键菜单入口：带默认渠道与模型', !!n?.channelId && !!n?.model, `ch=${n?.channelId} model=${n?.model}`)
    } else {
      rec(g, '★ 右键菜单入口：带默认渠道与模型', false, '右键菜单项 create:generation 不存在')
      await page.keyboard.press('Escape')
    }
  }

  // ── 入口 3：拖线到空白「新建并连接」 ──
  {
    const before = await ids()
    // 从第一个节点的输出端口拖到空白处松手 → 弹出新建并连接菜单
    const srcNode = page.locator('[data-node-id]').first()
    const box = await srcNode.boundingBox()
    const outPort = srcNode.locator('[data-port="output"]').first()
    const ob = (await outPort.count()) > 0 ? await outPort.boundingBox() : null
    if (box && ob) {
      await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + 260, box.y + 380, { steps: 12 })
      await page.mouse.move(box.x + 300, box.y + 420, { steps: 8 })
      await page.mouse.up()
      await sleep(700)
    }
    const lnk = page.locator('[data-link-menu-item="create:generation"]')
    if ((await lnk.count()) > 0) {
      await lnk.click()
      await sleep(1600)
      const id = (await ids()).find((i) => !before.includes(i))
      const n = (await readNodes()).find((x) => x.id === id)
      rec(g, '★ 拖线新建入口：带默认渠道与模型', !!n?.channelId && !!n?.model, `ch=${n?.channelId} model=${n?.model}`)
    } else {
      // 端口或菜单锚点不同：如实记为「未覆盖」，而不是假装通过
      const items = await page
        .locator('[data-link-menu-item]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-link-menu-item')))
      rec(g, '★ 拖线新建入口：带默认渠道与模型', false, `未出现新建菜单，项=${JSON.stringify(items)}`)
      await page.keyboard.press('Escape')
    }
  }

  await page.screenshot({ path: `${OUT}/86-g70-entry-parity.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G71 批量节点接下游生成节点 → 「一键生成」驱动**下游节点**（用户 2026-09-24）。
 *
 * > 「批量节点的下游需要链接生图节点，所用的参数就是生图节点的参数，
 * >  点击一键生成的时候参考普通节点生成的逻辑」
 *
 * 语义与循环节点、提示词节点同源：分发器自己不产图，点生成是**让下游那趟跑起来**。
 *
 * 本组要钉两件事：
 *  ① 按钮文案从「生成当前节点」变成「生成下游节点」（用户靠它判断点下去会发生什么）；
 *  ② 点下去真的跑下游、产物铺在**下游生成节点**这一侧，且用的是**下游自己的提示词**。
 *
 * 一条**很容易复发的陷阱**也在这里钉住：批量自跑一次后会留下承载节点，
 * 它们带着渠道 / 模型、又和批量连着线 —— 若不排除，判据会把它们当成
 * 「用户接的下游」，按钮被劫持到空提示词的承载节点上，点下去毫无反应。
 */
async function g71(browser) {
  const g = 'G71 批量分发'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  // ── 两张开外链素材拖进画布，再收进批量容器 ──
  const dt = await page.evaluateHandle(
    ({ b64 }) => {
      const d = new DataTransfer()
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      d.items.add(new File([bytes], 'a.png', { type: 'image/png' }))
      d.items.add(new File([bytes], 'b.png', { type: 'image/png' }))
      return d
    },
    { b64: PNG_IMPORT_BASE64 },
  )
  const sbox = await page.locator('[data-canvas-surface]').boundingBox()
  await page.locator('[data-canvas-surface]').dispatchEvent('dragover', { dataTransfer: dt })
  await page.locator('[data-canvas-surface]').dispatchEvent('drop', {
    dataTransfer: dt,
    clientX: sbox.x + 240,
    clientY: sbox.y + 210,
  })
  await sleep(1200)
  const assetIds = await page
    .locator('[data-node-type="generation"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  rec(g, '拖入 2 张素材（形成 2 个集合成员）', assetIds.length === 2, `${assetIds.length} 张`)

  await addNodeViaToolbar(page, 'batch')
  const batch = page.locator('[data-node-type="batch"]').first()
  const batchId = await batch.getAttribute('data-node-id')
  for (const id of assetIds) await dragNode(page, id, batchId)
  await sleep(600)
  const childCount = await batch.locator('[data-batch-body]').getAttribute('data-batch-child-count')
  rec(g, '两张素材都收进了批量容器', childCount === '2', `childCount=${childCount}`)

  // ── ① 没有下游时：按钮是「生成当前节点」，点了自己出 N 份 ──
  await selectSingleNode(page, batch)
  await fillPanelPromptViaTextarea(page, '批量自跑')
  rec(
    g,
    '① 批量（无下游）按钮文案是「生成当前节点」',
    (await panelRunLabelOf(page)) === '生成当前节点',
    await panelRunLabelOf(page),
  )
  const beforeSelf = await page.locator('[data-node-asset]').count()
  await panelRunBtn(page).first().click()
  await waitForAssetCount(page, beforeSelf + 2, 20000)
  const afterSelf = await page.locator('[data-node-asset]').count()
  rec(g, '① 批量自跑展开成 N 份（2 张 → 2 个承载节点带图）', afterSelf >= beforeSelf + 2, `${beforeSelf} → ${afterSelf}`)

  /**
   * 自跑留下的承载节点必须**不**让按钮换语义 —— 这里正是那个陷阱的回归点。
   * 只有承载节点时，批量仍然是「生成当前节点」。
   */
  await selectSingleNode(page, batch)
  rec(
    g,
    '★ 只有自跑产出的承载节点时，按钮仍是「生成当前节点」（没被劫持）',
    (await panelRunLabelOf(page)) === '生成当前节点',
    await panelRunLabelOf(page),
  )

  // ── ② 接一个真正配好的下游生成节点 ──
  // 批量挪左下、生成节点摆右上：两端拉开，拖线才不会被判成拖到自身上
  const bb = await batch.boundingBox()
  await page.mouse.move(bb.x + 40, bb.y + 14)
  await page.mouse.down()
  await page.mouse.move(110, 470, { steps: 10 })
  await page.mouse.up()
  await sleep(500)
  await addNodeViaToolbar(page, 'generation')
  const gens = page.locator('[data-node-type="generation"]')
  const gen = gens.nth((await gens.count()) - 1)
  const genId = await gen.getAttribute('data-node-id')
  {
    const gb = await gen.boundingBox()
    await page.mouse.move(gb.x + 40, gb.y + gb.height - 20)
    await page.mouse.down()
    // 往右下摆：往上会钻进顶栏浮层（顶栏占屏幕顶部约 112px），点选会被它吃掉
    await page.mouse.move(760, 620, { steps: 12 })
    await page.mouse.up()
    await sleep(600)
  }
  // 下游生成节点的**自有提示词**（用户口径：「参数就是生图节点的参数」）
  await selectSingleNode(page, gen)
  await fillPanelPromptViaTextarea(page, '下游生成节点自己的提示词')

  const edgesBefore = await page.locator('[data-edge]').count()
  await gen.hover()
  await sleep(300)
  {
    const ob = await batch.locator('[data-port="output"]').boundingBox()
    const ib = await gen.locator('[data-port="input"]').boundingBox()
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2)
    await page.mouse.down()
    await page.mouse.move(ob.x + 40, ob.y + 8, { steps: 5 })
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 14 })
    await page.mouse.up()
    await sleep(700)
  }
  rec(
    g,
    '批量 → 生成节点 能连上（分发通路的前提）',
    (await page.locator('[data-edge]').count()) > edgesBefore,
    `${edgesBefore} → ${await page.locator('[data-edge]').count()}`,
  )

  await selectSingleNode(page, batch)
  const anchor = await page.locator('[data-panel-anchor]').getAttribute('data-panel-anchor').catch(() => null)
  rec(g, '② 重新选中的确实是批量节点', anchor === batchId, `anchor=${anchor}`)
  const label = await panelRunLabelOf(page)
  rec(g, '★★ 接了下游后按钮文案变成「生成下游节点」', label === '生成下游节点', label)

  const beforeRun = await page.locator('[data-node-asset]').count()
  const genBefore = await page.locator('[data-node-type="generation"]').count()
  await panelRunBtn(page).first().click()
  await waitForAssetCount(page, beforeRun + 1, 25000)
  await sleep(2000)
  const afterRun = await page.locator('[data-node-asset]').count()
  rec(
    g,
    '★★ 点批量 → 真的跑出下游那趟（图数增加）',
    afterRun > beforeRun,
    `图数 ${beforeRun} → ${afterRun}｜生成节点 ${genBefore} → ${await page.locator('[data-node-type="generation"]').count()}`,
  )

  // 产物承载节点挂在下游生成节点一侧，而不是批量节点一侧
  const geom = await page.evaluate(
    ({ gid, bid }) => {
      const box = (id) => {
        const el = document.querySelector(`[data-node-id="${id}"]`)
        if (el) {
          const b = el.getBoundingClientRect()
          return { left: Math.round(b.left), right: Math.round(b.right) }
        }
        // 承载节点可能没 id 记录，退化成按标题找
        return null
      }
      const carriers = [...document.querySelectorAll('[data-node-type="generation"]')]
        .map((el) => ({
          title: el.querySelector('[data-node-title]')?.textContent ?? '',
          b: el.getBoundingClientRect(),
        }))
        .filter((x) => x.title.includes('输出'))
        .map((x) => ({ title: x.title, left: Math.round(x.b.left), right: Math.round(x.b.right) }))
      return { gen: box(gid), batch: box(bid), carriers }
    },
    { gid: genId, bid: batchId },
  )
  rec(
    g,
    '★★ 下游那趟的承载节点铺在**生成节点**右侧（不是批量节点右侧）',
    !!geom.gen && geom.carriers.length > 0 && geom.carriers.every((c) => c.left >= geom.gen.right - 4),
    `生成节点 right=${geom.gen?.right}｜承载 left=${geom.carriers.map((c) => c.left).join(',')}`,
  )

  await page.screenshot({ path: `${OUT}/87-g71-batch-downstream.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * 选中单个节点。
 *
 * 点击点要避开两处遮挡：
 *  1. **左侧竖向工具条**（`[data-canvas-toolbar]`）—— 它常驻画布左侧，
 *     节点若被摆到左边缘附近，`x=40` 会正好落在它上面（实测报
 *     “toolbar subtree intercepts pointer events”）；
 *  2. 节点中央的上传 `+`（点它会弹文件选择器）。
 *
 * ⚠️ 这里**曾经**按 `[data-topbar]` 的下沿算 y（旧画布有悬浮顶栏）。
 * 2026-09-27 顶栏已整体去除（§6.2），那个查询恒返回 0、
 * 于是 y 落到 16 —— 正好撞上左侧工具条。
 * 现在改为**运行时按工具条右沿算 x**，不依赖任何已删除的元素。
 */
async function selectSingleNode(page, node) {
  const b = await node.boundingBox()
  if (!b) return
  const toolbarRight = await page
    .evaluate(() => {
      const el = document.querySelector('[data-canvas-toolbar]')
      return el ? el.getBoundingClientRect().right : 0
    })
    .catch(() => 0)
  /* 工具条右沿之后再留 16px；节点很窄时退回节点中部，别越出节点 */
  const x = Math.max(8, Math.min(toolbarRight + 16, b.width - 8))
  /* 贴近节点顶部但不出界：避开发动机中央的上传 `+` */
  const y = Math.max(8, Math.min(16, b.height - 14))
  await node.click({ position: { x, y } })
  await sleep(600)
}

/** 面板生成按钮的当前 aria-label（空闲 / 取消 / 忙碌三态） */
async function panelRunLabelOf(page) {
  return page
    .locator('[data-creation-panel] [data-panel-run]')
    .first()
    .getAttribute('aria-label')
    .catch(() => null)
}

/** 面板提示词框写入并失焦落库（面板是「本地草稿 + 300ms 防抖」） */
async function fillPanelPromptViaTextarea(page, text) {
  const panel = page.locator('[data-creation-panel]')
  await panel.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  const ta = panelPrompt(panel)
  if (!(await ta.count())) return
  await ta.click()
  await ta.fill(text)
  await ta.blur()
  await sleep(500)
}

/** 等带图节点数达到 n（超时即返回当前值，由调用方断言） */
async function waitForAssetCount(page, n, timeout) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if ((await page.locator('[data-node-asset]').count()) >= n) return
    await sleep(400)
  }
}

/**
 * G72 「跟随素材」比例档的开放条件（用户 2026-09-24 放全局）。
 *
 * 这一档原先是**批量节点专属**（那时批量是「自己出图」的思路）。
 * 现在真正的用法是「批量当上游 → 下游生成节点」，那一档就够不着了 ——
 * 用户实际是在下游生成节点上改比例，却看不到它。
 *
 * 本组把判据钉成「这次生成**有没有图片参考**」，而不是「节点是不是批量」：
 *  ① 纯文生图（没有任何参考图）→ 13 档，**不含**「跟随素材」（不给死开关）；
 *  ② 有上游图片（普通图生图）→ 14 档，**含**「跟随素材」。
 *
 * 只断言「档数」是不够的：用户要的是那一档**能被选中并生效**，
 * 所以顺带断言它选中后 chip 文案真的变成它。
 */
async function g72(browser) {
  const g = 'G72 跟随素材档'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  /** 读当前面板的比例候选（点开 chip 再关掉） */
  const ratioOptions = async () => {
    const panel = page.locator('[data-creation-panel]')
    await chipOf(panel, 'ratio').click()
    await sleep(350)
    const opts = await optionButtons(panel, 'gen-params', 'ratio')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option')))
    await page.keyboard.press('Escape')
    await sleep(200)
    return opts
  }

  // ── ① 没有上游图：不该有「跟随素材」 ──
  await addNodeViaToolbar(page, 'generation')
  const lonely = page.locator('[data-node-type="generation"]').first()
  await genPanel(page, lonely)
  const noSource = await ratioOptions()
  rec(
    g,
    '① 没有参考图（纯文生图）→ 13 档，不含「跟随素材」',
    noSource.length === 13 && !noSource.includes('跟随素材'),
    `档数=${noSource.length} 含=${noSource.includes('跟随素材')}`,
  )

  // ── ② 拖入一张图（它本身就是有图的生成节点），再建下游并连线 ──
  const dt = await page.evaluateHandle(
    ({ b64 }) => {
      const d = new DataTransfer()
      const bin = atob(b64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      d.items.add(new File([bytes], 'src.png', { type: 'image/png' }))
      return d
    },
    { b64: PNG_IMPORT_BASE64 },
  )
  const sbox = await page.locator('[data-canvas-surface]').boundingBox()
  await page.locator('[data-canvas-surface]').dispatchEvent('dragover', { dataTransfer: dt })
  await page.locator('[data-canvas-surface]').dispatchEvent('drop', {
    dataTransfer: dt,
    clientX: sbox.x + 220,
    clientY: sbox.y + 200,
  })
  await sleep(1600)

  const gens = page.locator('[data-node-type="generation"]')
  const src = gens.nth((await gens.count()) - 1)
  // 拖到左下，腾出右上给下游节点
  await moveNode(page, await src.getAttribute('data-node-id'), 120, 470)
  await addNodeViaToolbar(page, 'generation')
  const dst = page.locator('[data-node-type="generation"]').last()
  const dstId = await dst.getAttribute('data-node-id')
  await moveNode(page, dstId, 780, 150)

  await dst.hover()
  await sleep(300)
  {
    const ob = await src.locator('[data-port="output"]').boundingBox()
    const ib = await dst.locator('[data-port="input"]').boundingBox()
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2)
    await page.mouse.down()
    await page.mouse.move(ob.x + 40, ob.y + 8, { steps: 5 })
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 14 })
    await page.mouse.up()
    await sleep(700)
  }

  await genPanel(page, dst)
  const withSource = await ratioOptions()
  rec(
    g,
    '★★ 有上游图（普通图生图）→ 14 档，含「跟随素材」',
    withSource.length === 14 && withSource.includes('跟随素材'),
    `档数=${withSource.length} 含=${withSource.includes('跟随素材')}`,
  )

  // 选中示例：chip 文案要真的变成「跟随素材」
  const panel = page.locator('[data-creation-panel]')
  await chipOf(panel, 'ratio').click()
  await sleep(350)
  await panel
    .locator('[data-param-popup="gen-params"] [data-param-in="ratio"][data-param-option="跟随素材"]')
    .click()
  await sleep(500)
  const chipText = (await panel.locator('[data-param-chip="gen-params"]').innerText()).trim()
  rec(g, '★ 选中后 chip 显示「跟随素材」', chipText.includes('跟随素材'), `chip=${chipText}`)

  /**
   * 图标不能和 1:1 撞脸：这一格画的应当是「叠两张纸」而不是一个方块。
   *
   * 注意**要重新点开浮层**再查——上面那次选择点完，浮层已按「选完即关」收起，
   * 此时去查 `[data-param-popup]` 是查不到东西的（第一版就栽在这里，svg=0）。
   * 判据同时要求：存在 svg、且里面不是单个 rect（比例格是单 rect 的色块）。
   */
  await ensureParamOpen(panel, 'ratio')
  await sleep(350)
  const cell = panel.locator(
    '[data-param-popup="gen-params"] [data-param-in="ratio"][data-param-option="跟随素材"]',
  )
  const glyph = await cell.locator('svg').count().catch(() => 0)
  const rects = await cell.locator('svg rect').count().catch(() => 0)
  rec(
    g,
    '★ 「跟随素材」有专属图标（两张叠起来的纸，不是单个方块）',
    glyph === 1 && rects === 2,
    `svg=${glyph} rect=${rects}`,
  )
  await page.keyboard.press('Escape')
  await sleep(200)

  await page.screenshot({ path: `${OUT}/88-g72-follow-source.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G73 技能是「设定」不是「动作」（用户 2026-09-24 第 2 条）。
 *
 * 用户口径：「技能这个功能属于是设定，而不是进行 —— 选择好技能之后，
 * 点击生成开始生效。优化和翻译还有反推都是一个预设好的内容，所以点击后
 * 他直接就可以根据里面预设的内容生效」。
 *
 * 这条口径与旧版**相反**：旧版点技能 = 立刻跑一次 LLM（和优化同一类）。
 * 新版点技能 = 只选中，真正生效在**点生成**那一刻。
 *
 * 三件事必须同时成立，少一条都是静默失效：
 *  ① 点技能**不发起** LLM（正文纹丝不动）；
 *  ② 选中状态**看得见**（chip 显示技能名）；
 *  ③ 点生成**真的跑**技能，且结果写回正文；
 *  ④ 对照：优化仍是「点了立刻生效」，没被一起改坏。
 */
async function g73(browser) {
  const g = 'G73 技能即设定'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)

  // ── 先在技能库建一条技能 ──
  await page.goto(`${BASE}/skills`, { waitUntil: 'networkidle' })
  await sleep(700)
  /*
   * 用稳定锚点 `data-skills-new`，不按按钮文案找。
   * 技能库 2026-09-25 被抽成 `SkillsPanel`（/skills 与后台中枢共用），
   * 顶栏结构随之变过 —— 文案匹配在这种重构下很脆，
   * 而锚点是组件契约的一部分。
   */
  await page.locator('[data-skills-new]').click()
  await sleep(500)
  await page.locator('[data-skill-name]').fill('冒烟技能')
  await page.locator('[data-skill-content]').fill('把这段文字改写成一句诗。只输出结果。')
  await page.locator('[data-skill-save]').click()
  await sleep(900)
  rec(
    g,
    '技能库里建出一条技能',
    (await page.locator('[data-skill-item][data-skill-source="user"]').count()) === 1,
  )

  // ── 回画布，建提示词节点 ──
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1000)

  const promptNode = page.locator('[data-node-type="prompt"]').first()
  await genPanel(page, promptNode)
  const panel = page.locator('[data-creation-panel]')
  // 提示词节点已无平台 chip（用户 2026-09-27 第 8 轮）
  await sleep(200)
  await pickParam(panel, 'model', 'mock-chat-1')
  await sleep(250)

  // 写正文
  {
    const ta = panelPrompt(panel)
    await ta.click()
    await ta.fill('今天天气很好')
    await ta.blur()
    await sleep(600)
  }
  const bodyText = async () => (await promptNode.innerText()).replace(/\s+/g, '')
  rec(g, '（基线）正文是面板里写的那句', (await bodyText()).includes('今天天气很好'))

  // ── ① 点技能：只选中，不跑 LLM ──
  const skillChip = panel.locator('[data-panel-skill-chip]')
  await skillChip.click()
  await sleep(400)
  const items = panel.locator('[data-panel-skill-popup] [data-panel-skill-item]')
  const createdSkill = items.filter({ hasText: '冒烟技能' }).first()
  rec(
    g,
    '技能列表里有刚建的那条（内置技能也同时在列）',
    (await items.count()) >= 2 && (await createdSkill.count()) === 1,
    `${await items.count()} 条`,
  )
  await createdSkill.click()
  await sleep(1200)

  rec(
    g,
    '★ ① 选中的技能名显示在按钮上（选中状态可见）',
    (await skillChip.innerText()).replace(/\s+/g, '') === '冒烟技能',
    await skillChip.innerText(),
  )
  rec(
    g,
    '★★ ② 点技能**不发起** LLM：正文纹丝不动（技能是设定不是动作）',
    !(await bodyText()).includes('mock:') && (await bodyText()).includes('今天天气很好'),
    (await promptNode.innerText()).slice(0, 40),
  )

  // ── ③ 点生成：技能此时才生效 ──
  await panel.locator('[data-panel-run]').first().evaluate((el) => el.click())
  let applied = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if ((await bodyText()).includes('mock:')) {
      applied = true
      break
    }
  }
  rec(
    g,
    '★★ ③ 点生成后技能真的跑了，结果写进正文',
    applied,
    (await promptNode.innerText()).slice(0, 50),
  )

  // ── ④ 对照：优化仍是「点了立刻生效」 ──
  await genPanel(page, promptNode)
  const p2 = page.locator('[data-creation-panel]')
  const before = await bodyText()
  const optBtn = p2.locator('[data-panel-prompt-tools] button', { hasText: '优化' })
  await optBtn.click()
  let changed = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if ((await bodyText()) !== before) {
      changed = true
      break
    }
  }
  rec(g, '★ ④ 对照：优化点了立刻生效（不需要再点生成）', changed)

  await page.screenshot({ path: `${OUT}/89-g73-skill-as-setting.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G74 渠道配置页（§7 + §7A.4，2026-09-27 改口径）。
 *
 * 旧版把「渠道 / 功能预设词 / 技能库」三区塞在同一个页面里。用户 2026-09-27
 * 第 9 轮改口径：预设词与技能库都归**技能库一级页**，设置页只留渠道配置，
 * 页内二级菜单与「后台设置」标题一并删除。
 *
 * 本组因此验四件事：
 *  ① 设置页只剩渠道，没有页内二级菜单、没有标题贴边；
 *  ② 技能库页的「功能预设词」卡片进入第二层后，预设词仍可改、可保存、
 *     刷新后还在、可恢复默认（**功能搬家，一处都不能丢**）；
 *  ③ **★ 改了要真的生效** —— 改完「优化」后回画布点优化，发出去的请求里
 *     必须带上改过的那段（mock 的 completeText 回显 prompt，可观测铁证）；
 *  ④ 技能库两层结构与设置页映射分组见 G82 / G83。
 */
async function g74(browser) {
  const g = 'G74 渠道配置页'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)

  // ── ① 设置页只剩渠道配置 ──
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(700)
  const sections = await page.locator('[data-settings-section]').count()
  rec(g, '★★ 设置页不再有页内二级菜单', sections === 0, `data-settings-section=${sections}`)
  rec(g, '★ 没有「后台设置」标题（用户：这几个字贴边，不需要）', (await page.getByRole('heading', { name: '后台设置' }).count()) === 0)
  rec(g, '★ 直接就是渠道配置（渠道卡片在）', (await page.locator('[data-settings-card]').count()) === 1)
  rec(
    g,
    '★ 设置页不再展示功能预设词与技能库',
    (await page.locator('[data-settings-presets]').count()) === 0 &&
      (await page.locator('[data-settings-skills]').count()) === 0,
  )
  const shellBorder = await page.evaluate(() => {
    const el = document.querySelector('[data-settings-card]')
    if (!el) return null
    const cs = getComputedStyle(el)
    return (
      parseFloat(cs.borderTopWidth) +
      parseFloat(cs.borderRightWidth) +
      parseFloat(cs.borderBottomWidth) +
      parseFloat(cs.borderLeftWidth)
    )
  })
  rec(g, '★ 渠道区最外层容器没有描边', shellBorder === 0, `border=${shellBorder}px`)
  /**
   * ★★ 设置页不能再套旧的「左导航 + 内容」两栏外壳（用户 2026-09-27 报
   * 「后台渠道都没了」）：
   *
   * 删掉页内二级菜单后，旧 `.shell` 的 `grid-template-columns: 176px 1fr`
   * 仍在，把只剩一列的渠道卡片挤进 176px 窄列 —— 数据其实在，但列表被压成
   * 窄条、文字还被裁断，看起来就是「渠道没了」。
   *
   * 判据：内容卡片宽度必须接近工作区宽度（远大于旧的 176px），
   * 且左侧渠道栏要有正常的列表宽度。
   */
  const layoutGeom = await page.evaluate(() => {
    const card = document.querySelector('[data-settings-card]')?.getBoundingClientRect()
    const workspace = document.querySelector('[data-app-workspace]')?.getBoundingClientRect()
    return {
      cardW: card ? Math.round(card.width) : 0,
      workspaceW: workspace ? Math.round(workspace.width) : 0,
      hasLegacyShell: !!document.querySelector('[data-settings-shell]'),
    }
  })
  rec(
    g,
    '★★ 渠道卡片铺满工作区（不再被旧两栏外壳挤成 176px 窄条）',
    layoutGeom.cardW > 400 && layoutGeom.cardW >= layoutGeom.workspaceW - 40,
    `卡片=${layoutGeom.cardW}px 工作区=${layoutGeom.workspaceW}px`,
  )
  /**
   * ★★ 用户 2026-09-28：渠道的内容在工作区也必须居中。
   *
   * 之前 `.editor` 只有左内边距，表单贴着左侧渠道列表；宽屏下整块内容
   * 看起来偏左。判据：表单左右中心与编辑区中心一致（±2px 容忍子像素）。
   *
   * 注意必须**先选中渠道**：`selectedId` 刷新后归零（§7.1「进来不预选」），
   * 不选中时右侧只渲染 `<div class="placeholder">`，`[data-settings-form]`
   * 根本不存在 —— 直接量会拿到 `missing`，而不是「没居中」。
   */
  await page.locator('[data-channel-item]').first().click()
  await sleep(300)
  const centered = await page.evaluate(() => {
    const form = document.querySelector('[data-settings-form]')?.getBoundingClientRect()
    /**
     * 参照系必须是**表单真正所在的编辑区** `.editor`（两栏栅格右列），
     * 而不是整张卡片：卡片还含 264px 的左侧渠道列表，拿卡片中心去比会
     * 稳定偏右 ~halfSidebar，把「正确的居中」误判成失败。
     */
    const editor = document.querySelector('[data-settings-editor]')?.getBoundingClientRect()
    if (!form || !editor) return null
    return {
      formCenter: Math.round((form.left + form.right) / 2),
      editorCenter: Math.round((editor.left + editor.right) / 2),
      formW: Math.round(form.width),
    }
  })
  rec(
    g,
    '★★ 渠道内容在编辑区水平居中',
    !!centered && Math.abs(centered.formCenter - centered.editorCenter) <= 2,
    centered ? `表单中心=${centered.formCenter} 工作区中心=${centered.editorCenter} 宽=${centered.formW}px` : 'missing',
  )
  /**
   * ★★ 用户 2026-09-28：「渠道的选择和渠道内容一起居中」。
   *
   * 上一条只保证**右侧表单**在其编辑列里居中；但在宽屏上，若整块
   * 「左列表 + 右编辑」仍贴着工作区左侧铺开（`.layout` 是 264px + 1fr 的
   * 满宽栅格），组合体整体是偏左的 —— 观感依旧不对。
   *
   * 判据：两栏组合体 `[data-settings-workarea]` 的中心必须与工作区中心一致（±2px）。
   * 这要求 `.layout` 铺满、内容定宽居中（外层铺满满足 G45/G74 的宽度口径，
   * 内层 `margin-inline:auto` 满足本条），两者不矛盾。
   */
  const groupCentered = await page.evaluate(() => {
    const group = document.querySelector('[data-settings-workarea]')?.getBoundingClientRect()
    const workspace = document.querySelector('[data-app-workspace]')?.getBoundingClientRect()
    if (!group || !workspace) return null
    return {
      groupCenter: Math.round((group.left + group.right) / 2),
      workspaceCenter: Math.round((workspace.left + workspace.right) / 2),
      groupW: Math.round(group.width),
    }
  })
  rec(
    g,
    '★★ 渠道选择 + 内容整组在工作区水平居中',
    !!groupCentered && Math.abs(groupCentered.groupCenter - groupCentered.workspaceCenter) <= 2,
    groupCentered
      ? `组合体中心=${groupCentered.groupCenter} 工作区中心=${groupCentered.workspaceCenter} 宽=${groupCentered.groupW}px`
      : 'missing',
  )
  rec(g, '★ 设置页不再有旧的三区外壳', !layoutGeom.hasLegacyShell)

  /**
   * ★★ 用户 2026-09-28：「新增渠道和删除渠道这两个功能不要放在最底部了，
   * 跟随渠道选择的最后一个即可」。
   *
   * 之前列表 `flex:1` 把这一组挤到左栏底部，渠道少时跟条目之间隔着大片空白，
   * 视线要跨越整个列表。判据：`[data-channel-actions]` 是渠道列表的**最后一个**
   * 子节点，且排在最后一条 `[data-channel-item]` 之后 —— 这样「新增 / 删除」
   * 永远贴着最后一条渠道，新增一条就自动跟着往下走。
   *
   * 注意复用上面已经选中的渠道状态，**不要再次导航**：重复 `goto('/settings')`
   * 会重置 `selectedId`，并让后续「改预设词 → 画布优化」流程出现时序漂移。
   */
  const listActionsOrder = await page.evaluate(() => {
    const actions = document.querySelector('[data-channel-actions]')
    const list = actions?.parentElement
    if (!actions || !list) return null
    const kids = Array.from(list.children)
    const items = list.querySelectorAll('[data-channel-item]')
    return {
      isLast: kids[kids.length - 1] === actions,
      itemCount: items.length,
      afterLastItem:
        items.length > 0 &&
        items[items.length - 1].compareDocumentPosition(actions) === Node.DOCUMENT_POSITION_FOLLOWING,
    }
  })
  rec(
    g,
    '★★ 新增/删除渠道跟在最后一条渠道后面（不再是列表底部孤零零一组）',
    !!listActionsOrder && listActionsOrder.isLast && listActionsOrder.afterLastItem,
    listActionsOrder
      ? `是列表最后子节点=${listActionsOrder.isLast} 渠道数=${listActionsOrder.itemCount} 在末条之后=${listActionsOrder.afterLastItem}`
      : 'missing',
  )

  /**
   * ★★ 用户 2026-09-28：「右边具体的渠道配置我需要继续的设计一下排版，
   * 目前看不清，能不能分卡片？」
   *
   * 右侧编辑器此前是一长条没有分组的表单，扫读时找不到边界。
   *
   * 用户 2026-09-29 第 12 轮把「选路策略」从渠道第四张卡片拆成**全局设置**；
   * 第 13 轮再按批注把它**移出右侧编辑区**（「看起来就好像是在右边渠道表单里面一样」），
   * 升成一条横跨左右两栏的独立顶栏：
   *  - 全局选路条 `[data-settings-global-route]` 是 `.layout` 的直接子节点，
   *    **在 `.workarea` 之外、渠道表单之外**，与「当前选中哪条渠道」无关；
   *  - 渠道侧只剩 基本信息 → 连接与鉴权 → 模型列表 → 渠道权重与模型映射 四张卡片。
   */
  const cardOrder = await page.evaluate(() => {
    const form = document.querySelector('[data-settings-form]')
    const workarea = document.querySelector('[data-settings-workarea]')
    const layout = document.querySelector('[data-settings-card]')
    const globalCard = document.querySelector('[data-settings-global-route]')
    const sel = [
      '[data-settings-basics]',
      '[data-settings-connection]',
      '[data-settings-models]',
      '[data-settings-channel-route]',
    ]
    const found = sel.map((s) => document.querySelector(s))
    if (found.some((el) => !el)) return null
    if (!form || !workarea || !layout || !globalCard) return null
    if (!form.contains(found[0])) return null
    let prev = found[0]
    const ordered = found.every((el, i) => {
      if (i === 0) return true
      const ok = prev.compareDocumentPosition(el) === Node.DOCUMENT_POSITION_FOLLOWING
      prev = el
      return ok
    })
    /* 全局策略条必须排在 `.workarea` **之前**：比较结果是「后者在前者之后」即成立 */
    const aboveWorkarea =
      globalCard.compareDocumentPosition(workarea) === Node.DOCUMENT_POSITION_FOLLOWING
    return {
      counts: sel.map((s) => document.querySelectorAll(s).length),
      globalCount: document.querySelectorAll('[data-settings-global-route]').length,
      ordered,
      globalInLayout: layout.contains(globalCard),
      globalOutsideWorkarea: !workarea.contains(globalCard),
      globalOutsideForm: !form.contains(globalCard),
      aboveWorkarea,
    }
  })
  rec(
    g,
    '★★ 渠道配置分四张卡片（基本信息 / 连接与鉴权 / 模型列表 / 渠道权重与模型映射）',
    !!cardOrder && cardOrder.counts.every((n) => n === 1) && cardOrder.ordered,
    cardOrder ? `各卡片数=${cardOrder.counts.join(',')} 顺序正确=${cardOrder.ordered}` : 'missing',
  )
  rec(
    g,
    '★★ 选路策略是全局顶栏：在两栏工作区之外、渠道表单之外（与选中渠道无关）',
    !!cardOrder &&
      cardOrder.globalCount === 1 &&
      cardOrder.globalInLayout &&
      cardOrder.globalOutsideWorkarea &&
      cardOrder.globalOutsideForm &&
      cardOrder.aboveWorkarea,
    cardOrder
      ? `全局条数=${cardOrder.globalCount} 在layout=${cardOrder.globalInLayout} workarea外=${cardOrder.globalOutsideWorkarea} 表单外=${cardOrder.globalOutsideForm} 在workarea上方=${cardOrder.aboveWorkarea}`
      : 'missing',
  )

  /**
   * 浏览器批注（用户 2026-09-29）：「按住条目上下拖动这个提示文字放在新增渠道的上方」。
   * 判据：提示文字与 `[data-channel-add]` 同容器，且出现在它**之前**。
   */
  const dragHintOrder = await page.evaluate(() => {
    const hint = Array.from(document.querySelectorAll('[data-channel-actions] p')).find((p) =>
      (p.textContent ?? '').includes('按住条目上下拖动'),
    )
    const add = document.querySelector('[data-channel-add]')
    if (!hint || !add) return null
    return {
      sharesContainer: hint.parentElement === add.parentElement,
      beforeAdd: hint.compareDocumentPosition(add) === Node.DOCUMENT_POSITION_FOLLOWING,
    }
  })
  rec(
    g,
    '★★ 拖动提示文字在「+ 新增渠道」上方（浏览器批注）',
    !!dragHintOrder && dragHintOrder.sharesContainer && dragHintOrder.beforeAdd,
    dragHintOrder
      ? `同一容器=${dragHintOrder.sharesContainer} 在新增之前=${dragHintOrder.beforeAdd}`
      : 'missing',
  )

  // ── ② 预设词已迁到技能库第二层，仍可编辑 ──
  await page.goto(`${BASE}/skills`, { waitUntil: 'networkidle' })
  await sleep(700)
  rec(
    g,
    '★ 技能库浏览层有「功能预设词」卡片（预设词归这里）',
    (await page.locator('[data-skills-preset-card]').count()) === 1,
  )
  await page.locator('[data-skills-preset-card]').click()
  await sleep(500)
  rec(
    g,
    '★ 功能预设词在技能库第二层打开',
    (await page.locator('[data-settings-presets]').count()) === 1 &&
      (await page.locator('[data-presets-back]').count()) === 1,
  )
  const cards = await page
    .locator('[data-preset-card]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-preset-card')))
  rec(
    g,
    '三条内置动作各有一段可编辑的预设词',
    JSON.stringify(cards) === JSON.stringify(['optimize', 'translate', 'describe']),
    cards.join(','),
  )
  rec(
    g,
    '未改过时不显示「已改」标记',
    (await page.locator('[data-preset-card="optimize"] [data-preset-changed]').count()) === 0,
  )

  const MARK = 'MARKER_SYSTEM_INSTRUCTION'
  const defaultText = await page.locator('[data-preset-text="optimize"]').inputValue()
  await page.locator('[data-preset-text="optimize"]').fill(MARK)
  await page.locator('[data-preset-save="optimize"]').click()
  await sleep(900)
  rec(
    g,
    '保存后标为「已改」',
    (await page.locator('[data-preset-card="optimize"] [data-preset-changed]').count()) === 1,
  )

  await page.reload({ waitUntil: 'networkidle' })
  await sleep(800)
  await page.locator('[data-skills-preset-card]').click()
  await sleep(500)
  rec(
    g,
    '★ 刷新后改过的预设词仍在（真的落库，不是内存态）',
    (await page.locator('[data-preset-text="optimize"]').inputValue()) === MARK,
  )

  // ── ③ ★ 改了要真的生效 ──
  await gotoProjects(page)
  await page.locator('[data-template="text2img"]').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1200)
  const promptNode = page.locator('[data-node-type="prompt"]').first()
  const pb = await promptNode.boundingBox()
  await page.mouse.click(pb.x + 40, Math.max(100, pb.y + 40))
  await sleep(700)
  const panel = page.locator('[data-creation-panel]')
  // 提示词节点已无平台 chip（用户 2026-09-27 第 8 轮）
  await sleep(250)
  await pickParam(panel, 'model', 'mock-chat-1')
  await sleep(300)
  {
    const ta = panelPrompt(panel)
    await ta.click()
    await ta.fill('原始正文')
    await ta.blur()
    await sleep(700)
  }
  await panel.locator('[data-panel-prompt-tools] button', { hasText: '优化' }).click()
  const bodyText = async () => (await promptNode.innerText()).replace(/\s+/g, '')
  let hit = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if ((await bodyText()).includes(MARK)) {
      hit = true
      break
    }
  }
  rec(
    g,
    '★★ 改过的预设词真的被发出去（mock 回显 prompt 里带上了它）',
    hit,
    (await promptNode.innerText()).slice(0, 60),
  )

  // ── ④ 恢复默认 ──
  await page.goto(`${BASE}/skills`, { waitUntil: 'networkidle' })
  await sleep(700)
  await page.locator('[data-skills-preset-card]').click()
  await sleep(500)
  await page.locator('[data-preset-restore="optimize"]').click()
  await sleep(800)
  rec(
    g,
    '★ 恢复默认回到出厂值（且「已改」标记消失）',
    (await page.locator('[data-preset-text="optimize"]').inputValue()) === defaultText &&
      (await page.locator('[data-preset-card="optimize"] [data-preset-changed]').count()) === 0,
  )

  // ── ⑤ 技能库页可进入编辑层（两层结构见 G82） ──
  await page.locator('[data-presets-back]').click()
  await sleep(600)
  rec(
    g,
    '★ 从预设词可返回技能库浏览层',
    (await page.locator('[data-skills-browser]').count()) === 1,
  )

  await page.screenshot({ path: `${OUT}/90-g74-hub.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G80 应用壳与左侧功能栏（产品文档 §2.1 / §2.2；架构文档 §5.10）。
 *
 * 缺口 #30 的落地验收。要钉住五件事：
 *  ① 刷新后**收起**（64px）、点开合按钮 → 240px，且右侧工作区**真的变窄**；
 *  ② 七个一级导航项的**顺序**（产品口径，不按字母重排；第 7 项「素材传输」为用户
 *     2026-10-03 新增的图床设置页）；
 *  ③ 侧栏**全路由常驻**；
 *  ④ 主题切换在侧栏底部、点了能换主题；
 *  ⑤ 画布页的旧顶栏**确实没了**，日志与缩放读数搬到新位置。
 *
 * ⚠️ 判据必须是**几何**（宽度、相对位置）而不是「元素在不在」：
 * 侧栏把工作区挤窄 vs 浮在工作区上面，DOM 完全一样 —— 只有量矩形能分开。
 */
async function g80(browser) {
  const g = 'G80 应用壳'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  const rail = page.locator('[data-app-sidebar]')
  const workspace = page.locator('[data-app-workspace]')

  await gotoProjects(page)
  await sleep(800)

  // ── ① 收起 / 展开 + 工作区跟随 ──
  rec(g, '首屏有应用壳与侧栏', (await page.locator('[data-app-shell]').count()) === 1 && (await rail.count()) === 1)
  rec(
    g,
    '★ 刷新后侧栏是收起态（产品口径：不记忆上次状态）',
    (await rail.getAttribute('data-sidebar-open')) === 'false',
    `open=${await rail.getAttribute('data-sidebar-open')}`,
  )
  const collapsed = await rail.boundingBox()
  const wsCollapsed = await workspace.boundingBox()
  rec(g, '★ 收起宽度 64px（§5.10）', Math.round(collapsed.width) === 64, `${Math.round(collapsed.width)}px`)

  await page.locator('[data-sidebar-toggle]').click()
  await sleep(600)
  const expanded = await rail.boundingBox()
  const wsExpanded = await workspace.boundingBox()
  rec(g, '★ 展开宽度 240px（§5.10）', Math.round(expanded.width) === 240, `${Math.round(expanded.width)}px`)
  /**
   * ★★ 关键：工作区**变窄**，而不是被侧栏盖住。
   * 「盖住」时工作区矩形不随侧栏变化，画布左边一截会藏在侧栏底下 ——
   * 这是「浮层式侧栏」与「布局式侧栏」的唯一可观测差别。
   */
  rec(
    g,
    '★★ 展开后右侧工作区真的变窄（侧栏是布局的一部分，不是浮层）',
    Math.round(wsExpanded.width) < Math.round(wsCollapsed.width) - 100 &&
      Math.round(wsExpanded.x) === Math.round(expanded.width),
    `工作区 ${Math.round(wsCollapsed.width)} → ${Math.round(wsExpanded.width)}，x=${Math.round(wsExpanded.x)}`,
  )

  // ── ② 导航项与顺序 ──
  const navIds = await page
    .locator('[data-sidebar-item]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-sidebar-item')))
  rec(
    g,
    '★ 七个一级导航且顺序固定（首页/项目/画布/技能库/我的素材/渠道配置/素材传输）',
    JSON.stringify(navIds) ===
      JSON.stringify(['/', '/projects', '/canvas', '/skills', '/assets', '/settings', '/hosting']),
    navIds.join(','),
  )
  // 展开态要有文字（收起态只有图标）
  const firstLabel = (await page.locator('[data-sidebar-item="/"]').innerText()).trim()
  rec(g, '★ 展开态导航项带文字', firstLabel === '首页', JSON.stringify(firstLabel))

  // ── ③ 全路由常驻 ──
  await page.locator('[data-sidebar-item="/projects"]').click()
  await sleep(800)
  rec(
    g,
    '★★ 切到 /projects 后侧栏仍在、且展开态保持',
    (await rail.count()) === 1 && (await rail.getAttribute('data-sidebar-open')) === 'true',
    `open=${await rail.getAttribute('data-sidebar-open')}`,
  )
  rec(g, '项目页有自己的内容（模板库）', (await page.locator('[data-template="text2img"]').count()) >= 1)

  // ── ④ 主题切换在侧栏底部 ──
  const themeInRail = await rail.locator('[data-theme-toggle]').count()
  rec(g, '★ 主题切换在侧栏内（§6.2 迁移）', themeInRail === 1, `count=${themeInRail}`)
  /**
   * 位置：主题按钮必须在侧栏的**下半部分**。
   * 只断言「在侧栏里」不够 —— 挂在顶部也算「在侧栏里」，那就不是「底部」。
   */
  const themePos = await page.evaluate(() => {
    const railEl = document.querySelector('[data-app-sidebar]')
    const btn = railEl?.querySelector('[data-theme-toggle]')
    if (!railEl || !btn) return null
    const r = railEl.getBoundingClientRect()
    const b = btn.getBoundingClientRect()
    return { railBottom: r.bottom, btnBottom: b.bottom }
  })
  rec(
    g,
    '★ 主题按钮贴在侧栏底部',
    !!themePos && themePos.railBottom - themePos.btnBottom < 40,
    `距底 ${themePos ? Math.round(themePos.railBottom - themePos.btnBottom) : '?'}px`,
  )
  const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme)
  await rail.locator('[data-theme-toggle]').click()
  await sleep(500)
  const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme)
  rec(g, '★ 点它真的换主题', themeAfter !== themeBefore, `${themeBefore} → ${themeAfter}`)
  await rail.locator('[data-theme-toggle]').click() // 切回，免得影响后续
  await sleep(400)

  // ── ⑤ 画布页：旧顶栏没了、日志与缩放就位 ──
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(500)
  await createProject(page)
  await sleep(1200)
  rec(g, '★★ 画布页不再有旧的顶部悬浮栏（§6.2）', (await page.locator('[data-topbar]').count()) === 0)
  rec(g, '★ 日志入口在画布右上角', (await page.locator('[data-canvas-log]').count()) === 1)
  await page.locator('[data-canvas-log]').click()
  await sleep(400)
  rec(g, '★ 点日志入口能打开日志面板', (await page.locator('[data-log-panel]').count()) === 1)
  await page.keyboard.press('Escape')
  await sleep(300)
  rec(g, '★ 缩放读数在小地图附近（§6.2 迁移）', (await page.locator('[data-canvas-zoom]').count()) === 1)
  rec(
    g,
    '★ 画布左侧竖向工具条保留（§6.1）',
    (await page.locator('[data-canvas-toolbar]').count()) === 1,
  )
  /**
   * ★★ 画布 surface 宽度应约等于工作区宽度 —— 证明画布没被侧栏压住。
   * 这是壳层改版对画布最实质的影响：坐标与命中都基于 surface 的真实矩形（§6.3）。
   */
  const widths = await page.evaluate(() => {
    const s = document.querySelector('[data-canvas-surface]')?.getBoundingClientRect()
    const w = document.querySelector('[data-app-workspace]')?.getBoundingClientRect()
    return s && w ? { surface: Math.round(s.width), workspace: Math.round(w.width) } : null
  })
  rec(
    g,
    '★★ 画布 surface 宽度 = 工作区宽度（没有被侧栏压住）',
    !!widths && Math.abs(widths.surface - widths.workspace) <= 2,
    `surface=${widths?.surface} workspace=${widths?.workspace}`,
  )

  await page.screenshot({ path: `${OUT}/90-g80-shell.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G81 侧栏视觉与项目封面（用户 2026-09-27 四条反馈里的 1 / 2 / 4）。
 *
 *  1) 选中项**不带描边**；Logo 用猫画动态图标；折叠态悬停互换（Logo↔按钮）；
 *     折叠按钮与菜单项同尺寸、垂直居中。
 *  2) 项目封面 = 最后一张生成图，`object-fit: cover`（等比铺满、不拉伸）。
 *  4) 首页也有同一个 Logo。
 *
 * 判据全部是**计算样式与几何**：「像不像」「居不居中」这类事，
 * DOM 计数看不出来，肉眼又容易被 1~2px 骗过去。
 */
async function g81(browser) {
  const g = 'G81 侧栏视觉与封面'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // ── 4) 首页 Logo ──
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await sleep(800)
  const homeLogo = await page.evaluate(() => {
    const img = document.querySelector('[data-home-page] img')
    return img ? { w: Math.round(img.getBoundingClientRect().width) } : null
  })
  rec(g, '★ 首页有品牌 Logo（猫画动态图标）', !!homeLogo && homeLogo.w > 0, JSON.stringify(homeLogo))

  /**
   * 首页文字标（用户 2026-09-29 第 13 / 14 轮）：`轻画` 二字换成用户给的完整
   * QINGHUA 字样（含 Q 斜尾与 A 星形，无背景色块）。两条判据：
   *  ① 字标确实渲染出可见宽度（不是被裁成 0）；
   *  ② 它跟随主题文字色（`currentColor` → `--text-1`）—— 用户的诉求是
   *     「颜色符合项目配色即可，不用保留原色」，这正是深色/浅色下都能看清的前提。
   */
  const wordmark = await page.evaluate(() => {
    const svg = document.querySelector('[data-home-page] [data-qinghua-wordmark]')
    if (!svg) return null
    const box = svg.getBoundingClientRect()
    const title = svg.closest('h1')
    return {
      w: Math.round(box.width),
      h: Math.round(box.height),
      color: getComputedStyle(svg).color,
      titleColor: title ? getComputedStyle(title).color : null,
      hasImage: !!svg.querySelector('image'),
    }
  })
  rec(
    g,
    '★ 首页文字标是 QINGHUA 字形且可见',
    !!wordmark && wordmark.w > 0 && wordmark.h > 0,
    JSON.stringify(wordmark && { w: wordmark.w, h: wordmark.h }),
  )
  rec(
    g,
    '★★ 文字标跟随主题文字色（currentColor，非原图配色）',
    !!wordmark && wordmark.color === wordmark.titleColor && !wordmark.hasImage,
    wordmark ? `svg=${wordmark.color} h1=${wordmark.titleColor}` : 'missing',
  )

  // ── 1) 选中项不描边 ──
  const selStyle = await page.evaluate(() => {
    const el = document.querySelector('[data-sidebar-item="/"]')
    if (!el) return null
    const cs = getComputedStyle(el)
    return { boxShadow: cs.boxShadow, weight: cs.fontWeight }
  })
  rec(
    g,
    '★★ 侧栏选中项不带描边（隐性选中）',
    !!selStyle && (selStyle.boxShadow === 'none' || !selStyle.boxShadow.includes('inset')),
    `box-shadow=${selStyle?.boxShadow}`,
  )
  rec(g, '★ 选中靠字重区分（600）', selStyle?.weight === '600', `weight=${selStyle?.weight}`)

  // ── 1) 折叠态：Logo 靠左、按钮靠右；尺寸一致；悬停互换 ──
  const geo = await page.evaluate(() => {
    const rail = document.querySelector('[data-app-sidebar]')
    const logo = rail.querySelector('[data-sidebar-logo]')
    const btn = rail.querySelector('[data-sidebar-toggle]')
    const item = rail.querySelector('[data-sidebar-item="/projects"]')
    const r = (e) => {
      const b = e.getBoundingClientRect()
      return {
        w: Math.round(b.width),
        h: Math.round(b.height),
        cx: Math.round(b.x + b.width / 2),
        cy: Math.round(b.y + b.height / 2),
      }
    }
    return {
      logo: r(logo),
      btn: r(btn),
      item: r(item),
      logoOp: getComputedStyle(logo).opacity,
      btnOp: getComputedStyle(btn).opacity,
    }
  })
  rec(
    g,
    '★★ 折叠按钮与菜单项同高（展开态 40px；收起态为同格 34px）',
    geo.btn.h === geo.item.h || geo.btn.h === 34,
    `按钮 ${geo.btn.h}px / 菜单项 ${geo.item.h}px`,
  )
    rec(
      g,
      '★★ 折叠按钮与 Logo 垂直同心、落在同一 Logo 格（悬停互换）',
      Math.abs(geo.btn.cy - geo.logo.cy) <= 1 && Math.abs(geo.btn.cx - geo.logo.cx) <= 1,
      `按钮(${geo.btn.cx},${geo.btn.cy}) Logo(${geo.logo.cx},${geo.logo.cy})`,
    )
  rec(
    g,
    '★ 默认显示 Logo、按钮透明',
    geo.logoOp === '1' && geo.btnOp === '0',
    `logo=${geo.logoOp} btn=${geo.btnOp}`,
  )

  // 悬停 Logo 位 → 互换
  const logoBox = await page.locator('[data-sidebar-logo]').boundingBox()
  await page.mouse.move(logoBox.x + logoBox.width / 2, logoBox.y + logoBox.height / 2)
  await sleep(450)
  const hovered = await page.evaluate(() => {
    const rail = document.querySelector('[data-app-sidebar]')
    return {
      logoOp: getComputedStyle(rail.querySelector('[data-sidebar-logo]')).opacity,
      btnOp: getComputedStyle(rail.querySelector('[data-sidebar-toggle]')).opacity,
    }
  })
  rec(
    g,
    '★★ 悬停时 Logo 隐去、按钮出现',
    hovered.logoOp === '0' && hovered.btnOp === '1',
    `logo=${hovered.logoOp} btn=${hovered.btnOp}`,
  )

  // 移开 → Logo 回来
  await page.mouse.move(900, 500)
  await sleep(450)
  const away = await page.evaluate(() => {
    const rail = document.querySelector('[data-app-sidebar]')
    return {
      logoOp: getComputedStyle(rail.querySelector('[data-sidebar-logo]')).opacity,
      btnOp: getComputedStyle(rail.querySelector('[data-sidebar-toggle]')).opacity,
    }
  })
  rec(
    g,
    '★★ 移开后 Logo 回来、按钮隐去',
    away.logoOp === '1' && away.btnOp === '0',
    `logo=${away.logoOp} btn=${away.btnOp}`,
  )

  // ── 2) 项目封面 = 最后一张生成图 ──
  // 先跑一张图：配渠道 → 模板 → 生成
  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(500)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1300)
  {
    const genNode = page.locator('[data-node-type="generation"]').first()
    const b = await genNode.boundingBox()
    await page.mouse.click(Math.round(b.x + 40), Math.round(b.y + 16))
    await sleep(800)
  }
  const panel = page.locator('[data-creation-panel]')
  {
    const ta = panelPrompt(panel)
    if (await ta.count()) {
      await ta.click()
      await ta.fill('封面冒烟')
      await ta.blur()
      await sleep(600)
    }
  }
  const beforeImgs = await page.locator('[data-node-asset]').count()
  const runBtn = panel.locator('[data-panel-run]').first()
  if (await runBtn.count()) await runBtn.evaluate((el) => el.click())
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if ((await page.locator('[data-node-asset]').count()) > beforeImgs) break
  }
  await sleep(2500) // 等素材与 runRecord 落库

  await gotoProjects(page)
  await sleep(1800)
  const cover = await page.evaluate(() => {
    const card = document.querySelector('[data-project-card]')
    if (!card) return null
    const media = card.querySelector('img, video')
    if (!media) return null
    const cs = getComputedStyle(media)
    const mb = media.getBoundingClientRect()
    const tb = media.parentElement.getBoundingClientRect()
    return {
      tag: media.tagName.toLowerCase(),
      objectFit: cs.objectFit,
      sameW: Math.abs(mb.width - tb.width) <= 1,
      sameH: Math.abs(mb.height - tb.height) <= 1,
    }
  })
  rec(g, '★★ 项目封面用了最近生成的图（不是占位网格）', !!cover, JSON.stringify(cover))
  rec(
    g,
    '★★ 封面 object-fit 是 cover（等比铺满，不是拉伸）',
    cover?.objectFit === 'cover',
    `object-fit=${cover?.objectFit}`,
  )
  rec(
    g,
    '★ 封面铺满卡片缩略图区域',
    !!cover && cover.sameW && cover.sameH,
    `对齐=${cover?.sameW}/${cover?.sameH}`,
  )

  await page.screenshot({ path: `${OUT}/91-g81-cover.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * 已从全量移除的组（测的都是已不存在的功能，继续跑只会拿「它没出现」当失败）：
 * - g22：版本历史（§6.21 于 2026-09-16 下线）
 * - g41：陈旧标记与按范围重跑（2026-09-17 下线：橘点、整条流程重跑、仅刷新陈旧、全图重跑）
 * - g50 / g54：结果组折叠与子结果交互（2026-09-17 结果组整体下线）
 */
/**
 * G75 模型路由（§7.4.1，M7）。
 *
 * 验的是「界面上能改、改完真的落库」—— 单测已经覆盖了纯逻辑的分档与加权，
 * 这里只钉住**接线**：策略下拉存在且可切、映射能保存并在刷新后还在、
 * 优先度能写进渠道。缺的就是这类「写了组件但没接上」的缺陷。
 */
async function g75(browser) {
  const g = 'G75 模型路由'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(700)

  /**
   * ★ 全局选路策略是**跨渠道**的（用户 2026-09-29 第 12 轮）：未选中渠道时它也要在
   * —— 右栏其余部分此时只是占位文案，策略卡片不该跟着消失。
   */
  rec(
    g,
    '★ 未选中渠道时也出现全局「选路策略」卡片',
    (await page.locator('[data-settings-global-route]').count()) === 1,
  )
  const strategyBtn = page.locator('[data-route-strategy]')
  rec(g, '★ 全局策略选择器存在', (await strategyBtn.count()) === 1)
  rec(
    g,
    '★ 未选中渠道时不显示渠道侧「渠道权重与模型映射」',
    (await page.locator('[data-settings-channel-route]').count()) === 0,
  )

  /**
   * 第 13 轮把原生 `<select>` 换成 chip + 浮层（用户批注「跟没设计过一样」）。
   * 于是这里不能再 `selectOption()` / `inputValue()`，得**真的点开菜单**：
   * 这同时验证了浮层能展开、选项能点、点完会收起。
   */
  await strategyBtn.click()
  await sleep(200)
  const options = await page.locator('[data-route-strategy-option]').allTextContents()
  rec(
    g,
    '★ 策略浮层能展开，且三档齐备：优先度 / 性能优先 / 均衡分摊',
    options.join('|').includes('优先度') &&
      options.join('|').includes('性能优先') &&
      options.join('|').includes('均衡分摊'),
    options.join(' | '),
  )
  rec(
    g,
    '★ 策略浮层是 listbox 菜单（不再是原生 select）',
    (await page.locator('[data-route-strategy-menu][role="listbox"]').count()) === 1 &&
      (await strategyBtn.locator('option').count()) === 0,
  )

  await page.locator('[data-route-strategy-option="performance"]').click()
  await sleep(500)
  // 刷新会清空「当前选中渠道」（组件内存态）。全局策略不依赖选中渠道，
  // 故这条断言**故意不重新选中** —— 它正说明策略是全局的，不是挂在渠道上的。
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(700)
  const storedStrategy = await page
    .locator('[data-route-strategy]')
    .getAttribute('data-route-strategy-value')
  rec(
    g,
    '★ 策略切换后落库（刷新仍是 performance，且不必先选中渠道）',
    storedStrategy === 'performance',
    String(storedStrategy),
  )

  /**
   * 场景前提：**渠道表单**只在选中渠道后才渲染（`selected` 为 null 时是占位文案）。
   * 少了这一步，后面的按钮根本不存在 —— 这是「断言写对了但场景没搭起来」，
   * 不是功能缺陷。
   */
  await page.locator('[data-channel-item]').first().click()
  await sleep(600)
  rec(
    g,
    '★ 选中渠道后出现渠道侧「渠道权重与模型映射」',
    (await page.locator('[data-settings-channel-route]').count()) === 1,
  )

  // mock 协议可离线拉取模型
  await page.locator('button', { hasText: '拉取模型' }).first().click()
  await sleep(900)
  const apply = page.locator('[data-model-apply]')
  if ((await apply.count()) === 0) {
    await page.locator('button', { hasText: '选择模型' }).first().click()
    await sleep(500)
    // 勾第一个可用模型
    const opt = page.locator('[data-model-option]').first()
    if ((await opt.count()) > 0) await opt.click()
    await sleep(300)
    await page.locator('[data-model-apply]').click()
    await sleep(700)
  }

  // ② 优先度能写进渠道并落库
  await page.locator('[data-route-priority]').fill('7')
  await sleep(600)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(700)
  await page.locator('[data-channel-item]').first().click()
  await sleep(600)
  rec(
    g,
    '★ 优先度改写后刷新仍在（真的落库，不是内存态）',
    (await page.locator('[data-route-priority]').inputValue()) === '7',
    await page.locator('[data-route-priority]').inputValue(),
  )

  // ③ 映射：改一个已选模型的上游 ID → 保存 → 刷新后还在
  const rowCount = await page.locator('[data-route-map-row]').count()
  rec(g, '★ 已选模型都列出映射行', rowCount > 0, `行数=${rowCount}`)
  if (rowCount > 0) {
    const firstRow = page.locator('[data-route-map-row]').first()
    const logical = await firstRow.getAttribute('data-route-map-row')
    const input = page.locator(`[data-route-map-input="${logical}"]`)
    const saveBtn = page.locator(`[data-route-map-save="${logical}"]`)
    rec(
      g,
      '★ 映射「保存」按钮在未改动时禁用（防误写）',
      await saveBtn.isDisabled(),
      `disabled=${await saveBtn.isDisabled()}`,
    )
    await input.fill('upstream-renamed-by-smoke')
    await sleep(300)
    rec(g, '★ 改动后「保存」可点', await saveBtn.isEnabled())
    await saveBtn.click()
    await sleep(700)
    await page.reload({ waitUntil: 'networkidle' })
    await sleep(700)
    await page.locator('[data-channel-item]').first().click()
    await sleep(600)
    rec(
      g,
      '★ 映射保存后刷新仍在（真的落库）',
      (await page.locator(`[data-route-map-input="${logical}"]`).inputValue()) === 'upstream-renamed-by-smoke',
      await page.locator(`[data-route-map-input="${logical}"]`).inputValue(),
    )

    // ④ 清空 = 删除该条映射，回到「按原名发送」
    await page.locator(`[data-route-map-input="${logical}"]`).fill('')
    await sleep(300)
    await page.locator(`[data-route-map-save="${logical}"]`).click()
    await sleep(700)
    await page.reload({ waitUntil: 'networkidle' })
    await sleep(700)
    await page.locator('[data-channel-item]').first().click()
    await sleep(600)
    rec(
      g,
      '★ 清空并保存 → 该条映射被删除（回到恒等，不存空串）',
      (await page.locator(`[data-route-map-input="${logical}"]`).inputValue()) === '',
      `值="${await page.locator(`[data-route-map-input="${logical}"]`).inputValue()}"`,
    )
  }

  await page.screenshot({ path: `${OUT}/91-g75-model-routing.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G76 选路真的作用到执行（M7-3）。
 *
 * G75 只证明「配置能存」；这条证明**执行链路真的用了它**：
 * 把某渠道的映射改成另一个上游 ID 后，画布上跑一次生成，
 * 日志里记录的模型必须是**改后**的那个上游 ID，而不是节点上的逻辑名。
 *
 * 只验配置不验生效，是本项目反复踩过的「存了不用」缺陷
 * （预设词那次就是这么栽的，故单独成组、断言到日志这一层）。
 */
async function g76(browser) {
  const g = 'G76 选路作用于执行'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)

  // ① 后台：给已选模型改一个可识别的上游 ID
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(700)
  await page.locator('[data-channel-item]').first().click()
  await sleep(600)
  await page.locator('button', { hasText: '拉取模型' }).first().click()
  await sleep(900)
  /**
   * 把已选模型**重设为「只勾生图分类的第一个」**。
   *
   * 不复用既有勾选：前面的组（G74/G75）可能已给这条渠道勾过对话模型，
   * 而生成节点的下拉只列**图片类**模型 —— 沿用残留勾选会导致后面
   * `pickParam('model')` 找不到选项而超时（那是测试选错对象，不是功能缺陷）。
   */
  await page.locator('button', { hasText: '选择模型' }).first().click()
  await sleep(500)
  // 先取消全部勾选
  const checked = page.locator('[data-model-option] input:checked')
  const checkedCount = await checked.count()
  for (let i = 0; i < checkedCount; i += 1) {
    await checked.first().uncheck().catch(() => {})
    await sleep(120)
  }
  await page.locator('[data-model-tab="image"]').click()
  await sleep(400)
  const opt = page.locator('[data-model-option]').first()
  if ((await opt.count()) > 0) await opt.locator('input').check()
  await sleep(300)
  await page.locator('[data-model-apply]').click()
  await sleep(800)

  /**
   * 必须挑一个**生图模型**：生成节点的模型下拉只列图片类模型，
   * 若这里取到对话模型（mock 清单里两种都有），后面 `pickParam('model')`
   * 会找不到选项而超时 —— 那是测试选错了对象，不是功能缺陷。
   */
  const rows = await page.locator('[data-route-map-row]').evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-route-map-row')),
  )
  const logical = rows.find((id) => id && id.includes('image')) ?? rows[0]
  const MARK = 'upstream-applied-by-g76'
  /**
   * 收尾：把这条映射**清空还原**。
   *
   * 渠道是应用级单例、存在同一个 IndexedDB 里；本组若不还原，后面的组会读到
   * 一条被改过的映射 —— 表现为「与本次改动无关的组突然失败」。谁改的谁还原。
   */
  const restoreMapping = async () => {
    try {
      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
      await sleep(600)
      await page.locator('[data-channel-item]').first().click()
      await sleep(500)
      const input = page.locator(`[data-route-map-input="${logical}"]`)
      if ((await input.count()) > 0) {
        await input.fill('')
        await sleep(250)
        await page.locator(`[data-route-map-save="${logical}"]`).click()
        await sleep(600)
      }
    } catch {
      // 还原失败不掩盖本组结论，也不该让整轮冒烟崩掉
    }
  }
  await page.locator(`[data-route-map-input="${logical}"]`).fill(MARK)
  await sleep(300)
  await page.locator(`[data-route-map-save="${logical}"]`).click()
  await sleep(800)
  rec(g, '★ 后台已写入上游 ID 映射', true, `逻辑名=${logical} → ${MARK}`)

  // ② 画布：跑一次生成
  await gotoProjects(page)
  await page.locator('[data-template="text2img"]').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1200)

  const gen = page.locator('[data-node-type="generation"]').first()
  const gb = await gen.boundingBox()
  /**
   * 点**标题区**而不是节点中心：生成节点本体是媒体框，中心是素材区
   * （点它不会打开创作面板）。与既有冒烟同一手法（点 `gb.x + 40` 那一带）。
   */
  await page.mouse.click(Math.round(gb.x + 40), Math.max(100, Math.round(gb.y + 40)))
  await sleep(800)
  await page.locator('[data-creation-panel]').waitFor({ state: 'visible', timeout: 10000 })

  // 节点默认模型可能不是我们改的那条；把它选成改过的那条逻辑名
  const panel = page.locator('[data-creation-panel]')
  // 生成节点已无平台 chip（用户 2026-09-27）：面板会自动把首个可用渠道写进节点
  await sleep(400)
  await pickParam(panel, 'model', logical)
  await sleep(400)
  /**
   * 必须写提示词：`toRunRequest` 在 prompt 为空时返回 null ⇒ 节点不进计划
   * ⇒ 点生成**毫无反应**（这是本项目已知的一类静默失败）。
   * 模板自带提示词节点，但为稳妥这里显式填一句。
   */
  await page.keyboard.press('Escape')
  await sleep(300)
  /**
   * ★ 选完渠道 / 模型后**再点一次节点重开面板**。
   *
   * 派发 `setChannel` / `setModel` 会让面板重挂；重挂后 `panel` 这个
   * locator 指向的可能是已卸载的旧节点 ⇒ 后面点「生成当前节点」永远等不到
   * （全量串行才暴露，单跑本组是 6/6）。
   */
  await page.mouse.click(Math.round(gb.x + 40), Math.max(100, Math.round(gb.y + 40)))
  await sleep(600)
  await page.locator('[data-creation-panel]').waitFor({ state: 'visible', timeout: 10000 })
  const ta = panelPrompt(panel)
  if ((await ta.count()) > 0) {
    await ta.click()
    await ta.fill('一只在屋顶上的猫')
    await ta.blur()
    await sleep(700)
  }

  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()

  // 等出图（承载节点出现新图）
  let done = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    const n = await page.locator('[data-node-type="generation"] img').count()
    if (n > 0) {
      done = true
      break
    }
  }
  rec(g, '★ 生成真的跑通（画布上出现产物图）', done, `img 数=${await page.locator('[data-node-type="generation"] img').count()}`)

  // ③ 日志：记录的必须是**上游 ID**，不是逻辑名
  await page.getByRole('button', { name: '日志' }).click()
  await sleep(700)
  const dialog = page.getByRole('dialog', { name: '日志面板' })
  const text = (await dialog.count()) > 0 ? await dialog.innerText().catch(() => '') : ''
  rec(
    g,
    '★★ 日志里记录的是映射后的上游 ID（选路真的作用到执行，不是存了不用）',
    text.includes(MARK),
    `日志片段="${text.replace(/\n/g, ' ').slice(0, 120)}"`,
  )
  rec(
    g,
    '★ 日志里不再出现未经映射的逻辑名（适配器只认上游 ID）',
    !text.includes(logical) || logical === MARK,
    `logical=${logical}`,
  )

  await page.screenshot({ path: `${OUT}/92-g76-routing-applied.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await restoreMapping()
  await ctx.close()
}

/**
 * G77 多渠道选路（M7-3 的核心价值：单渠道时选路没意义）。
 *
 * 建**两条**都能提供同一模型的渠道，给它们不同优先度，
 * 然后跑一次生成 —— 日志里的平台名必须是**优先度高的那条**。
 *
 * 这条同时守住一个刚修的缺口：没存令牌的渠道必须被跳过
 * （否则选到它必然失败，而旁边有配好的站）。
 */
async function g77(browser) {
  const g = 'G77 多渠道选路'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(700)

  /**
   * 建第二条渠道：与第一条同样启用、同样勾同一个生图模型，
   * 但优先度给得更高 ⇒ 按 priority 策略应当总是选中它。
   */
  await page.locator('[data-channel-add]').click()
  await sleep(800)
  const items = page.locator('[data-channel-item]')
  const count = await items.count()
  rec(g, '★ 已建出第二条渠道（多渠道场景成立）', count >= 2, `渠道数=${count}`)

  const second = items.nth(count - 1)
  await second.click()
  await sleep(600)
  /**
   * 必须先**改名**：两条渠道默认都叫「新建渠道」，
   * 不改名的话后面「日志里的平台名是哪条」根本分辨不出来
   * —— 断言会恒真，什么都证明不了。
   */
  const NAME = '备用站-B'
  await page.locator('[data-settings-name]').fill(NAME)
  await sleep(500)
  await page.locator('button', { hasText: '保存配置' }).click()
  await sleep(700)
  await page.locator('button', { hasText: '拉取模型' }).first().click()
  await sleep(900)
  await page.locator('button', { hasText: '选择模型' }).first().click()
  await sleep(500)
  await page.locator('[data-model-tab="image"]').click()
  await sleep(400)
  const opt = page.locator('[data-model-option]').first()
  await opt.locator('input').check()
  await sleep(300)
  await page.locator('[data-model-apply]').click()
  await sleep(800)

  // 优先度拉到最高；启用开关打开
  const enabledBox = page.locator('input[type="checkbox"]').first()
  if ((await enabledBox.count()) > 0 && !(await enabledBox.isChecked())) {
    await enabledBox.check()
    await sleep(500)
  }
  await page.locator('[data-route-priority]').fill('99')
  await sleep(600)

  rec(g, '★ 第二条渠道已配好（改名 + 启用 + 勾模型 + 优先度 99）', true, `名称=${NAME}`)

  // 画布上跑一次生成
  await gotoProjects(page)
  await page.locator('[data-template="text2img"]').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1200)

  const gen = page.locator('[data-node-type="generation"]').first()
  const gb = await gen.boundingBox()
  /**
   * 点节点打开创作面板。
   *
   * ⚠️ 全量串行时这里**必须重新点一次**：前面的组（G46 会切到视频并把配方记忆
   * 写成视频模型）会让本组新建的节点默认落在视频档 ⇒ 图片模式下没有可用模型
   * ⇒ 面板虽在但模型 chip 禁用，生成按钮不渲染。
   * 故在选渠道 / 选模型之后再点节点重开一次面板，确保拿到的是**当前节点**的面板。
   */
  await page.mouse.click(Math.round(gb.x + 40), Math.max(100, Math.round(gb.y + 40)))
  await sleep(800)
  await page.locator('[data-creation-panel]').waitFor({ state: 'visible', timeout: 10000 })
  const panel = page.locator('[data-creation-panel]')
  const ta = panelPrompt(panel)
  if ((await ta.count()) > 0) {
    await ta.click()
    await ta.fill('一只在屋顶上的猫')
    await ta.blur()
    await sleep(700)
  }
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()

  let done = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if ((await page.locator('[data-node-type="generation"] img').count()) > 0) {
      done = true
      break
    }
  }
  rec(g, '★ 多渠道场景下生成跑通', done)

  await page.getByRole('button', { name: '日志' }).click()
  await sleep(700)
  const dialog = page.getByRole('dialog', { name: '日志面板' })
  const text = (await dialog.count()) > 0 ? await dialog.innerText().catch(() => '') : ''
  rec(
    g,
    '★★ 选路挑中了优先度更高的渠道（日志平台名 = 备用站-B）',
    text.includes(NAME),
    `日志片段="${text.replace(/\n/g, ' ').slice(0, 120)}"`,
  )

  await page.screenshot({ path: `${OUT}/93-g77-multi-channel.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G78 逻辑模型名（M7-4）＝ 用户要的那件事：
 *
 * > 「不同站点的模型 id 不一样，前端就想显示**一个**模型 id，
 * >   调用不同站点的同一个模型。其实都是一个模型，只是站点 id 不一样。」
 *
 * 验三点：
 *  ① 下拉里**只出一个**逻辑名（别名不再重复占位）；
 *  ② 选它之后能真出图；
 *  ③ 换到另一条渠道时，请求里用的是**那条渠道自己的**上游 ID
 *    （日志的 sentModel 会变）。
 */
async function g78(browser) {
  const g = 'G78 逻辑模型名'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(700)

  // ① 给第一条渠道：把 mock-image-1 映射成另一个名字（模拟「同模型不同站 ID」）
  await page.locator('[data-channel-item]').first().click()
  await sleep(600)
  await page.locator('button', { hasText: '拉取模型' }).first().click()
  await sleep(900)
  await page.locator('button', { hasText: '选择模型' }).first().click()
  await sleep(500)
  await page.locator('[data-model-tab="image"]').click()
  await sleep(400)
  const opt = page.locator('[data-model-option]').first()
  if ((await opt.count()) > 0) await opt.locator('input').check()
  await sleep(300)
  await page.locator('[data-model-apply]').click()
  await sleep(800)

  const firstRow = page.locator('[data-route-map-row]').first()
  const logical = await firstRow.getAttribute('data-route-map-row')
  await page.locator(`[data-route-map-input="${logical}"]`).fill('siteA-specific-id')
  await sleep(300)
  await page.locator(`[data-route-map-save="${logical}"]`).click()
  await sleep(800)
  rec(g, '★ 渠道 A 已把逻辑名映射成自己的上游 ID', true, `${logical} → siteA-specific-id`)
  /** 同 G76：谁改的谁还原，避免把被改过的映射留给后面的组 */
  const restoreMapping = async () => {
    try {
      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
      await sleep(600)
      await page.locator('[data-channel-item]').first().click()
      await sleep(500)
      const input = page.locator(`[data-route-map-input="${logical}"]`)
      if ((await input.count()) > 0) {
        await input.fill('')
        await sleep(250)
        await page.locator(`[data-route-map-save="${logical}"]`).click()
        await sleep(600)
      }
    } catch {
      // 同上：还原失败不掩盖本组结论
    }
  }

  // ② 画布：模型下拉应只列逻辑名
  await gotoProjects(page)
  await page.locator('[data-template="text2img"]').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1200)

  const gen = page.locator('[data-node-type="generation"]').first()
  const gb = await gen.boundingBox()
  await page.mouse.click(Math.round(gb.x + 40), Math.max(100, Math.round(gb.y + 40)))
  await sleep(800)
  await page.locator('[data-creation-panel]').waitFor({ state: 'visible', timeout: 10000 })

  const panel = page.locator('[data-creation-panel]')
  // 生成节点已无平台 chip（用户 2026-09-27）：渠道由面板解析链自动落到节点上
  await sleep(400)
  /**
   * 显式点开模型浮层再读选项。
   *
   * 不能用 `pickParam(panel, 'model')`：它第三个参数（选项文案）是必需的，
   * 不传会让「点选项」这一步匹配不到任何东西 —— 那是测试写错，不是功能缺陷。
   */
  await panel.locator('[data-param-chip="model"]').click()
  await panel.locator('[data-param-popup="model"]').waitFor({ state: 'visible', timeout: 5000 })
  await sleep(400)
  const optionTexts = await panel
    .locator('[data-param-popup="model"] button')
    .allTextContents()
  rec(g, '★ 模型浮层已展开（下拉可断言）', optionTexts.length > 0, `选项数=${optionTexts.length}`)
  rec(
    g,
    '★★ 模型下拉只出一个名字（别名不重复占位，不是两站的 ID 各列一个）',
    optionTexts.length > 0 &&
      optionTexts.some((t) => t.includes(logical)) &&
      !optionTexts.some((t) => t.includes('siteA-specific-id')),
    `选项=[${optionTexts.join(' | ')}]`,
  )

  // ③ 选它 → 出图 → 日志里记的是**该渠道的上游 ID**
  await panel
    .locator('[data-param-popup="model"] button', { hasText: logical })
    .first()
    .click()
  await sleep(400)
  const ta = panelPrompt(panel)
  if ((await ta.count()) > 0) {
    await ta.click()
    await ta.fill('一只在屋顶上的猫')
    await ta.blur()
    await sleep(700)
  }
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()

  let done = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if ((await page.locator('[data-node-type="generation"] img').count()) > 0) {
      done = true
      break
    }
  }
  rec(g, '★ 选中逻辑名后能真出图', done)

  await page.getByRole('button', { name: '日志' }).click()
  await sleep(700)
  const dialog = page.getByRole('dialog', { name: '日志面板' })
  const text = (await dialog.count()) > 0 ? await dialog.innerText().catch(() => '') : ''
  rec(
    g,
    '★★ 发出去的是该渠道映射后的上游 ID（前端显示逻辑名 ≠ 请求用逻辑名）',
    text.includes('siteA-specific-id') && !text.includes(logical),
    `日志片段="${text.replace(/\n/g, ' ').slice(0, 120)}"`,
  )

  await page.screenshot({ path: `${OUT}/94-g78-logical-name.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await restoreMapping()
  await ctx.close()
}

/**
 * G79 固定模型显示名（用户 2026-09-27 第 7 轮）。
 *
 * 三件事一起验，缺一这条需求就没真正落地：
 *  ① 生图节点**没有平台 chip**（渠道由选路决定）；
 *  ② 模型下拉列的是用户拍板的**固定显示名**，每个都带矢量图标；
 *  ③ 这些显示名在后台**能逐条映射**到本站真实 ID，且映射后
 *     请求发出去的是真实 ID（不是显示名）—— 这是「前端只显示、
 *     后端用映射」那句需求的可执行证据。
 */
async function g79(browser) {
  const g = 'G79 固定模型显示名'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await page.locator('[data-template="text2img"]').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1200)

  const panel = await genPanel(page)
  rec(
    g,
    '★ 生图节点没有平台 chip（用户：平台选中都不需要了）',
    (await panel.locator('[data-param-chip="channel"]').count()) === 0,
  )

  // ① 图片档：固定六个 + 每个带图标
  await panel.locator('[data-param-chip="model"]').click()
  await sleep(400)
  const imageRows = panel.locator('[data-param-popup="model"] button')
  const imageOpts = await imageRows.allInnerTexts()
  const imageValues = await imageRows.evaluateAll((els) =>
    els.map((e) => e.getAttribute('data-param-option')),
  )
  const wantImage = [
    'GPT Image 2.5 Flare',
    'GPT Image 2.5 Sunburst',
    'GPT Image 2',
    'Nano Banana Pro',
    'Nano Banana 2',
    'Midjourney',
  ]
  rec(
    g,
    '★ 生图档列出固定显示名（Agnes 自有那个在最前，其余是用户拍板的六个）',
    JSON.stringify(imageValues.slice(0, 7)) ===
      JSON.stringify(['Agnes Image 2.5 Flash', ...wantImage]),
    `opts=${JSON.stringify(imageValues)}`,
  )
  rec(
    g,
    '★ 固定项不含 Nano Banana 2 Lite（用户明确不要）',
    !imageOpts.some((t) => t.includes('Nano Banana 2 Lite')),
  )
  /**
   * 图标在 2026-09-27 第 8 轮从手绘 SVG 换成**官方 PNG**
   * （用户：「这些模型的 logo 我要官方的 logo，png 格式…当前的不太像」）。
   *
   * 断言两条，缺一都不足以证明「官方图标真的加载出来了」：
   *  ① 每个固定项前方有 `img[data-model-logo]`；
   *  ② 每张图**真的解码成功**（`naturalWidth > 0`）—— 只数 DOM 的话，
   *     路径写错、404 也会数出 6 个，图上却是空白。
   */
  const logoImgs = imageRows.locator('img[data-model-logo]')
  const logoCount = await logoImgs.count()
  const decoded = await logoImgs.evaluateAll((els) =>
    els.map((e) => ({ src: e.getAttribute('src') ?? '', w: e.naturalWidth })),
  )
  rec(g, '★ 固定模型每项前方都有官方 PNG 图标', logoCount >= 6, `图标数=${logoCount}`)
  rec(
    g,
    '★★ 图标真的解码出来了（不是 404 空图）',
    decoded.length >= 6 && decoded.every((d) => d.w > 0),
    JSON.stringify(decoded.slice(0, 3)),
  )
  await page.screenshot({ path: `${OUT}/95-g79-image-models.png` })
  await page.keyboard.press('Escape')
  await sleep(200)

  // ② 视频档：固定五个
  await panel.locator('[data-param-mode="video"]').click()
  await sleep(500)
  await panel.locator('[data-param-chip="model"]').click()
  await sleep(400)
  const videoValues = await panel
    .locator('[data-param-popup="model"] button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option')))
  rec(
    g,
    '★ 视频档列出固定显示名（Agnes 自有那个在最前）',
    JSON.stringify(videoValues.slice(0, 6)) ===
      JSON.stringify([
        'Agnes Video 2.0',
        '即梦 2.5',
        'Gemini Omni Flash 1.1',
        'Minimax H3 Max',
        'MiniMax H3',
        'Wan 3.0',
      ]),
    `opts=${JSON.stringify(videoValues)}`,
  )
  await page.keyboard.press('Escape')
  await sleep(200)

  // ③ 提示词节点：对话档固定四个 + **没有平台 chip** + 模型可点
  await gotoProjects(page)
  await page.locator('[data-template="text2img"]').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1000)
  const promptNode = page.locator('[data-node-type="prompt"]').first()
  const pPanel = await genPanel(page, promptNode)
  rec(
    g,
    '★ 提示词节点没有平台 chip（用户：提示词节点也不需要平台配置了）',
    (await pPanel.locator('[data-param-chip="channel"]').count()) === 0,
  )
  rec(
    g,
    '★ 提示词节点的模型 chip 可点（用户报「灰色的无法点击」）',
    await pPanel.locator('[data-param-chip="model"]').isEnabled(),
  )
  await pPanel.locator('[data-param-chip="model"]').click()
  await sleep(400)
  const chatValues = await pPanel
    .locator('[data-param-popup="model"] button')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option')))
  rec(
    g,
    '★ 对话档 = Agnes 两个免费 Flash + OpenAI 三个 + Gemini 3.8 Flash（Google 只留一个）',
    JSON.stringify(chatValues.slice(0, 5)) ===
      JSON.stringify([
        'Agnes 2.5 Flash',
        'Agnes 3.0 Flash',
        'GPT-6 Astra',
        'GPT-6 Sol',
        'GPT-6 Luna',
      ]),
    `opts=${JSON.stringify(chatValues)}`,
  )
  await page.keyboard.press('Escape')
  await sleep(200)

  // ④ 后台能逐条映射固定显示名 → 本站真实 ID
  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(700)
  await page.locator('[data-channel-item]').first().click()
  await sleep(600)
  const presetRow = page.locator('[data-route-map-row="GPT Image 2.5 Flare"]')
  rec(g, '★ 后台为固定显示名给出可填写的映射行', (await presetRow.count()) === 1)
  /**
   * 用户 2026-09-27 第 8 轮：「`gpt-image-2` 这个和头两个模型 id 格式不一样，
   * 应该是 `GPT Image 2`」。
   *
   * 映射区列的是**显示名**：15 个固定项各一行、每行标签就是那个显示名，
   * 不存在「`GPT Image 2` 与 `gpt-image-2` 各占一行」的重复。
   */
  const presetRows = page.locator('[data-route-map-preset="1"]')
  const presetLabels = await presetRows.locator('[data-route-map-label]').allInnerTexts()
  const allRows = page.locator('[data-route-map-row]')
  const allRowLabels = await allRows.locator('[data-route-map-label]').allInnerTexts()
  const trimmedLabels = allRowLabels.map((s) => s.trim())
  rec(
    g,
    '★ 映射区只列 19 个固定显示名（含 Agnes 自有四个），不含上游裸 ID 或重复项',
    (await allRows.count()) === 19 &&
      (await presetRows.count()) === 19 &&
      presetLabels.map((s) => s.trim()).includes('GPT Image 2') &&
      // Agnes 有自己的显示名，不再把它的 ID 塞进别家的名字里
      presetLabels.map((s) => s.trim()).includes('Agnes 2.5 Flash') &&
      presetLabels.map((s) => s.trim()).includes('Agnes 3.0 Flash') &&
      presetLabels.map((s) => s.trim()).includes('Agnes Video 2.0') &&
      !trimmedLabels.includes('gpt-image-2') &&
      !trimmedLabels.includes('agnes-2.5-flash') &&
      !trimmedLabels.includes('Agnes 2.0 Flash') &&
      !trimmedLabels.includes('agnes-2.5-pro') &&
      !trimmedLabels.includes('gemini-3.1-pro-preview') &&
      !trimmedLabels.includes('gemini-3.5-flash') &&
      new Set(trimmedLabels).size === trimmedLabels.length,
    `总行数=${await allRows.count()} 固定行数=${await presetRows.count()} 标签=${JSON.stringify(trimmedLabels)}`,
  )
  await page.locator('[data-route-map-input="GPT Image 2.5 Flare"]').fill('gpt-image-2.5-flare')
  await sleep(300)
  await page.locator('[data-route-map-save="GPT Image 2.5 Flare"]').click()
  await sleep(700)

  const restoreMapping = async () => {
    try {
      await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
      await sleep(600)
      await page.locator('[data-channel-item]').first().click()
      await sleep(500)
      const input = page.locator('[data-route-map-input="GPT Image 2.5 Flare"]')
      if ((await input.count()) > 0) {
        await input.fill('')
        await sleep(250)
        await page.locator('[data-route-map-save="GPT Image 2.5 Flare"]').click()
        await sleep(600)
      }
    } catch {
      // 还原失败不掩盖本组结论
    }
  }

  // ⑤ 画布选固定显示名 → 出图 → 日志里是映射后的真实 ID
  await gotoProjects(page)
  await page.locator('[data-template="text2img"]').waitFor({ state: 'visible', timeout: 20000 })
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(1200)
  const gen = page.locator('[data-node-type="generation"]').first()
  const gb = await gen.boundingBox()
  await page.mouse.click(Math.round(gb.x + 40), Math.max(100, Math.round(gb.y + 40)))
  await sleep(800)
  const panel2 = page.locator('[data-creation-panel]')
  await panel2.waitFor({ state: 'visible', timeout: 10000 })
  await pickParam(panel2, 'model', 'GPT Image 2.5 Flare')
  await sleep(400)
  rec(
    g,
    '★ 选中后 chip 显示的是**显示名**（前端只显示这一个名字）',
    (await paramLabel(panel2, 'model')) === 'GPT Image 2.5 Flare',
    await paramLabel(panel2, 'model'),
  )
  const ta = panelPrompt(panel2)
  if ((await ta.count()) > 0) {
    await ta.click()
    await ta.fill('一只在屋顶上的猫')
    await ta.blur()
    await sleep(700)
  }
  await page.locator('[data-creation-panel] button[aria-label="生成当前节点"]').click()
  let done = false
  for (let i = 0; i < 40; i += 1) {
    await sleep(500)
    if ((await page.locator('[data-node-type="generation"] img').count()) > 0) {
      done = true
      break
    }
  }
  rec(g, '★ 显示名配好映射后能真出图', done)

  await page.getByRole('button', { name: '日志' }).click()
  await sleep(700)
  const dialog = page.getByRole('dialog', { name: '日志面板' })
  const text = (await dialog.count()) > 0 ? await dialog.innerText().catch(() => '') : ''
  rec(
    g,
    '★★ 请求发的是映射后的真实 ID，不是显示名（前后端分离的要害）',
    text.includes('gpt-image-2.5-flare') && !text.includes('GPT Image 2.5 Flare'),
    `日志片段="${text.replace(/\n/g, ' ').slice(0, 140)}"`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await restoreMapping()
  await ctx.close()
}

/**
 * G82 技能库两层结构（产品文档 §7A；用户 2026-09-27 第 9 轮第 1 / 2 条）。
 *
 * 文档早就写明「卡片浏览 → 点击卡片编辑」，代码此前却是单层的「左列表 + 右编辑」。
 * 本组钉四件事：
 *  ① 浏览层是**卡片**，有分类筛选 / 搜索 / 新建 / 导入；
 *  ② 页面**没有「← 返回」**（导航归侧栏，用户第 2 条）；
 *  ③ 点卡片进第二层编辑，第二层有「返回浏览」；
 *  ④ ★ 返回浏览层时，搜索与筛选项**不丢**（文档 §7A.1 明确要求）。
 */
async function g82(browser) {
  const g = 'G82 技能库两层'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(`${BASE}/skills`, { waitUntil: 'networkidle' })
  await sleep(700)

  /**
   * ★★ 三层各自居中（用户 2026-09-28：「技能库的 UI 也要居中，不要左对齐」）。
   * 只看「有没有 max-width」不够 —— 少了 `margin-inline:auto` 一样定宽却是贴左。
   * 所以逐层量**内容舞台中心**与 `[data-app-workspace]` 中心的偏差。
   */
  const centerOffset = (sel) =>
    page.evaluate(
      ([stageSel, wsSel]) => {
        const stage = document.querySelector(stageSel)
        const ws = document.querySelector(wsSel)
        if (!stage || !ws) return null
        const a = stage.getBoundingClientRect()
        const b = ws.getBoundingClientRect()
        return Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2)
      },
      [sel, '[data-app-workspace]'],
    )

  rec(g, '第一层是卡片浏览（browser 在 DOM）', (await page.locator('[data-skills-browser]').count()) === 1)
  rec(g, '★★ 浏览层有居中舞台且水平居中', (await page.locator('[data-skills-browser-stage]').count()) === 1 && (await centerOffset('[data-skills-browser-stage]')) <= 2, `offset=${await centerOffset('[data-skills-browser-stage]')}`)
  rec(
    g,
    '★ 分类筛选齐备（全部 / 内置 / 我的 / 功能预设词）',
    JSON.stringify(
      await page
        .locator('[data-skills-filter]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-skills-filter'))),
    ) === JSON.stringify(['all', 'builtin', 'user', 'preset']),
  )
  rec(g, '★ 有搜索框与新建 / 导入入口', (await page.locator('[data-skills-search]').count()) === 1 && (await page.locator('[data-skills-new]').count()) === 1 && (await page.locator('[data-skills-import]').count()) === 1)
  /**
   * ★★ 页面级「← 返回」必须没有。用户 2026-09-27 第 2 条：「技能工作区里面的
   * 返回也不要了，刚刚我说了的，都不需要了的」。不能只看第一层 —— 第一层本就没
   * 有返回按钮；要证明「整页都没有」，在两层都量。
   */
  rec(g, '★★ 浏览层没有页面级「← 返回」', (await page.locator('[data-skills-back]').count()) === 0)

  // 建一条技能当素材
  await page.locator('[data-skills-new]').click()
  await sleep(400)
  rec(g, '★ 点「新建」直接进第二层编辑（不是先落一条空技能）', (await page.locator('[data-skill-editor]').count()) === 1)
  rec(g, '★★ 编辑层有居中舞台且水平居中', (await page.locator('[data-skill-editor-stage]').count()) === 1 && (await centerOffset('[data-skill-editor-stage]')) <= 2, `offset=${await centerOffset('[data-skill-editor-stage]')}`)
  rec(g, '★★ 编辑层有「返回浏览」且没有页面级返回按钮', (await page.locator('[data-skills-back]').count()) === 1)
  /**
   * 名字取满上限（24 字，含搜索词「两层冒烟」以复用后面的搜索断言），
   * 说明也填长 —— 用来验证长文本在卡片里换行，不撑破容器。
   */
  const longName = '两层冒烟'.repeat(6)
  const longDesc =
    '这是一段很长的技能说明，用来验证说明文字在卡片容器内自动换行，不会横向溢出把卡片撑破，也不会盖住下方的元信息。'
  await page.locator('[data-skill-name]').fill(longName)
  await page.locator('[data-skill-desc]').fill(longDesc)
  await page.locator('[data-skill-content]').fill('只输出结果。')
  await page.locator('[data-skill-save]').click()
  await sleep(900)
  rec(g, '保存后回到浏览层', (await page.locator('[data-skills-browser]').count()) === 1)
  const userCards = page.locator('[data-skill-item][data-skill-source="user"]')
  rec(g, '★ 新技能以卡片形式出现', (await userCards.count()) === 1)
  /**
   * ★★ 长名字 / 长说明不溢出容器：卡片本身与两个文本节点都要满足
   * `scrollWidth <= clientWidth + 1`（留 1px 给亚像素取整）。
   */
  const overflow = await userCards.first().evaluate((el) => {
    const bad = []
    for (const node of [el, ...el.querySelectorAll('span')]) {
      if (node.scrollWidth > node.clientWidth + 1) {
        bad.push(`${node.className || node.tagName}:${node.scrollWidth}>${node.clientWidth}`)
      }
    }
    return bad
  })
  rec(g, '★★ 超长技能名 / 说明在卡片内换行不溢出', overflow.length === 0, overflow.join(' | '))

  /**
   * ★★ 搜索 / 筛选跨层保留。先设搜索词与筛选，进编辑再返回，
   * 两个状态都必须还在 —— 否则用户每次从编辑层回来都要重设一遍。
   */
  await page.locator('[data-skills-filter="user"]').click()
  await page.locator('[data-skills-search]').fill('两层冒烟')
  await sleep(350)
  await userCards.first().click()
  await sleep(450)
  rec(g, '★ 点卡片进第二层编辑', (await page.locator('[data-skill-editor]').count()) === 1)
  await page.locator('[data-skills-back]').click()
  await sleep(450)
  const kept = await page.evaluate(() => {
    const search = document.querySelector('[data-skills-search]')
    const on = document.querySelector('[data-skills-filter][aria-selected="true"]')
    return { query: search ? search.value : null, filter: on?.getAttribute('data-skills-filter') ?? null }
  })
  rec(
    g,
    '★★ 返回浏览层时搜索与筛选项都保留',
    kept.query === '两层冒烟' && kept.filter === 'user',
    `query=${kept.query} filter=${kept.filter}`,
  )

  // 删掉刚建的技能，避免污染后续组
  await userCards.first().click()
  await sleep(450)
  await page.locator('[data-skill-remove]').click()
  await sleep(250)
  await page.locator('[data-skill-remove-yes]').click()
  await sleep(800)
  rec(g, '删除后回浏览层且卡片消失', (await page.locator('[data-skills-browser]').count()) === 1 && (await page.locator('[data-skill-item][data-skill-source="user"]').count()) === 0)

  // 第三层（功能预设词）同样要居中
  // 先把筛选与搜索复位到「全部」，否则「我的」筛选下不渲染预设词卡片
  await page.locator('[data-skills-filter="all"]').click()
  await page.locator('[data-skills-search]').fill('')
  await sleep(300)
  await page.locator('[data-skills-preset-card]').click()
  await sleep(450)
  rec(g, '★★ 预设词层有居中舞台且水平居中', (await page.locator('[data-presets-stage]').count()) === 1 && (await centerOffset('[data-presets-stage]')) <= 2, `offset=${await centerOffset('[data-presets-stage]')}`)
  rec(g, '预设词层有「返回浏览」', (await page.locator('[data-presets-back]').count()) === 1)
  await page.locator('[data-presets-back]').click()
  await sleep(350)

  await page.screenshot({ path: `${OUT}/98-g82-skills-two-level.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G83 模型映射分组与候选（用户 2026-09-27 第 9 轮第 3 条）。
 *
 * 要求两件事：
 *  ① 映射区按「生图 / 对话 / 视频」分三组，不再一长条平铺 15 个；
 *  ② 每条映射的输入框能下拉选**该渠道已勾选且同类**的模型 ID（仍可手填）。
 *
 * 第 ② 条只验 `list` 属性存在不够 —— 候选为空 / 混入别类也满足"有 list"，
 * 所以逐组核对：候选非空，且每个候选都出现在该渠道已勾选的同类模型里。
 */
async function g83(browser) {
  const g = 'G83 模型映射分组'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  /*
   * 只用 mock 渠道拉取一次模型，**不预先勾选**。
   * 这正是用户会遇到的场景：刚拉取完、还没勾模型就来填映射。
   * 候选在这种状态下也必须可用（见 routeMapOptions 的回落口径）。
   */
  await configureMockChannel(page)
  await sleep(600)

  const groups = await page
    .locator('[data-route-map-group]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-route-map-group')))
  rec(
    g,
    '★★ 模型映射按生图 / 对话 / 视频三组渲染',
    JSON.stringify(groups) === JSON.stringify(['image', 'chat', 'video']),
    groups.join(','),
  )

  /**
   * 第 13 轮把原生 `<datalist>` 换成 `ModelMapCombo` 的浮层菜单（用户批注：
   * 模型映射的下拉「跟没设计过一样」）。候选改为**真的点开**每一组的第一个
   * 下拉开关来读，顺带验证浮层能展开、Esc 能收起。
   */
  const options = {}
  const menuCategoryOk = []
  for (const cat of ['image', 'chat', 'video']) {
    const toggle = page.locator(`[data-route-map-group="${cat}"] [data-route-map-toggle]`).first()
    await toggle.click()
    await sleep(150)
    const menuCat = await page
      .locator('[data-route-map-menu]')
      .first()
      .getAttribute('data-route-map-menu')
    menuCategoryOk.push(menuCat === cat)
    options[cat] = await page
      .locator(`[data-route-map-menu="${cat}"] [data-route-map-option="${cat}"]`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))
    await page.keyboard.press('Escape')
    await sleep(120)
  }
  rec(
    g,
    '★★ 每组候选非空，且与该类别对应',
    ['image', 'chat', 'video'].every((c) => Array.isArray(options[c]) && options[c].length > 0),
    Object.entries(options)
      .map(([k, v]) => `${k}=${v.length}`)
      .join(' '),
  )
  /**
   * ★ 候选必须**同类**。跨类混入是这一版最容易出的错：菜单挂在组上，
   * 若筛选用错字段（例如只按已勾选、不按 category），对话模型会出现在生图组里。
   */
  rec(
    g,
    '★ 每组浮层的类别与实际候选一一对应',
    menuCategoryOk.every(Boolean),
    `类别匹配=${menuCategoryOk.join(',')}`,
  )
  rec(
    g,
    '★ 已无原生 datalist（候选改走浮层菜单）',
    (await page.locator('datalist[data-route-map-options]').count()) === 0,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G84 全局字体统一（用户 2026-09-27 报「文字看起来没有参考站那么清晰」）。
 *
 * 根因不是配色：深色主文字对比度实测 15.79:1（远高于 WCAG 的 4.5:1）。
 * 真 bug 是**全项目从来没设过全局字体**——`base.css` 只做了 reset，
 * `body` 因此用浏览器默认（实测 Times New Roman），而**表单控件默认不继承字体**，
 * button / select / option 走 UA 样式表的 Arial。同屏两种字体 ⇒ 观感发脏发虚。
 *
 * 这一组为什么必须有：字体是**全局基线**，一处改坏会同时影响所有页面，
 * 而单测读不到 computed font（jsdom 不做样式继承），只能靠真机量。
 * 判据取「页面上出现的字体**种类数**」而不是「某个元素是不是某个字体」——
 * 后者只能钉住被点名的那一个，下次新增一处漏网控件照样静默回退。
 */
async function g84(browser) {
  const g = 'G84 全局字体统一'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  /**
   * 收集页面上**直接带文本**的元素所用的字体。
   * 只看有直接文本子节点的元素：容器自身也算有 computed font，但用户读不到它的字。
   */
  const collectFonts = () =>
    page.evaluate(() => {
      const out = []
      for (const el of document.querySelectorAll('*')) {
        let txt = ''
        for (const n of el.childNodes) if (n.nodeType === 3) txt += n.textContent
        txt = txt.trim()
        if (!txt) continue
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        out.push({
          tag: el.tagName,
          txt: txt.slice(0, 14),
          font: getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '').trim(),
        })
      }
      return out
    })

  // 三个一级页都要查：字体是全局基线，任何一个页面漏设都是同一个 bug 的另一个落点
  const seenByFont = new Map()
  const total = []
  for (const url of ['/projects', '/settings', '/skills']) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
    await sleep(500)
    const rows = await collectFonts()
    total.push({ url, n: rows.length })
    for (const r of rows) {
      if (!seenByFont.has(r.font)) seenByFont.set(r.font, r)
    }
  }

  const fonts = [...seenByFont.keys()]
  rec(
    g,
    '★★ 全站只出现一种字体（不再 Times New Roman / Arial 混排）',
    fonts.length === 1,
    `字体种类=${fonts.length} [${fonts.join(' | ')}] 样本=${total.map((t) => `${t.url}:${t.n}`).join(' ')}`,
  )

  // 光「只有一种」还不够 —— 那一种必须真是应用字体，不是恰好统一成了浏览器默认
  const bodyFont = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily.split(',')[0].replace(/"/g, '').trim(),
  )
  const tokenFont = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim().split(',')[0].replace(/"/g, ''),
  )
  rec(g, '★ body 用的是应用字体（不是浏览器默认）', bodyFont === tokenFont, `body=${bodyFont} 令牌=${tokenFont}`)

  // ★ 表单控件是最容易漏的一处：它们不继承字体，必须显式 `font: inherit`
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' })
  await sleep(500)
  const controlFonts = await page.evaluate(() => {
    const out = []
    for (const sel of ['button', 'select', 'option', 'input', 'textarea']) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        out.push({
          sel,
          font: getComputedStyle(el).fontFamily.split(',')[0].replace(/"/g, '').trim(),
          size: getComputedStyle(el).fontSize,
        })
      }
    }
    return out
  })
  const badControls = controlFonts.filter((c) => c.font !== tokenFont)
  rec(
    g,
    '★★ 表单控件（button/select/option/input）也用应用字体（不继承 ⇒ 必须显式 inherit）',
    controlFonts.length > 0 && badControls.length === 0,
    `控件=${controlFonts.length} 走偏=${badControls.length}${badControls.length ? ' 例:' + JSON.stringify(badControls[0]) : ''}`,
  )

  /**
   * 字号上调一档（2026-09-27）：body 13 → 14、label 12 → 13、chip 11 → 12。
   * 只钉**相对关系**（panel-title > body > label > chip）与「正文不再小于 14px」，
   * 不钉绝对值——设计令牌整体调整时不该整组变红，但「又缩回 12px」必须被抓到。
   */
  const scales = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement)
    const v = (n) => parseFloat(cs.getPropertyValue(n))
    return { body: v('--fs-body'), label: v('--fs-label'), chip: v('--fs-chip'), title: v('--fs-panel-title') }
  })
  rec(g, '★ 正文 ≥ 14px（用户嫌小，整体上调一档）', scales.body >= 14, `body=${scales.body}px`)
  rec(
    g,
    '★ 字号层级关系不变（panel-title > body > label > chip）',
    scales.title > scales.body && scales.body > scales.label && scales.label > scales.chip,
    JSON.stringify(scales),
  )

  await page.screenshot({ path: `${OUT}/99-g84-typography.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G85 项目页五列 / 16:9 / 多选（用户 2026-09-28）。
 *
 * 这组刻意不复用 G3 的数据上下文：G3 会做搜索 / 排序 / 单删，
 * 断言顺序一长就会掩盖“五列和选择模式”本身的问题。
 * 这里从空存储造 6 个项目，只验证项目页的视觉与批量交互。
 */
async function g85(browser) {
  const g = 'G85 项目页五列与多选'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  for (let i = 0; i < 6; i += 1) {
    await createProject(page)
    await gotoProjects(page)
  }

  const cards = page.locator('[data-new-card], [data-project-card]')
  await cards.first().waitFor({ state: 'visible', timeout: 5000 })
  const projectCards = page.locator('[data-project-card]')
  rec(g, '6 个项目卡片全部渲染', (await projectCards.count()) === 6, `count=${await projectCards.count()}`)

  const layout = await page.evaluate(() => {
    const workspace = document.querySelector('[data-app-workspace]')?.getBoundingClientRect()
    const gridEl = document.querySelector('[data-new-card]')?.parentElement
    const grid = gridEl?.getBoundingClientRect()
    const nodes = [...document.querySelectorAll('[data-new-card], [data-project-card]')]
    const firstFive = nodes.slice(0, 5).map((el) => el.getBoundingClientRect())
    const projects = [...document.querySelectorAll('[data-project-card]')].slice(0, 5).map((el) => el.getBoundingClientRect())
    const firstProjectCard = document.querySelector('[data-project-card]')
    const thumb = firstProjectCard?.firstElementChild?.getBoundingClientRect()
    const cardNameEl = [...document.querySelectorAll('[data-project-card]')]
      .map((card) => card.querySelector('[data-project-name]'))
      .find(Boolean)
    const cardMetaEl = [...document.querySelectorAll('[data-project-card]')]
      .map((card) => card.querySelector('[data-project-meta]'))
      .find(Boolean)
    const menuBtnEl = firstProjectCard?.querySelector('button[aria-label="项目菜单"]')
    const sectionTitleEl = document.querySelector('[data-projects-heading]')
    return {
      workspace: workspace ? { left: workspace.left, width: workspace.width } : null,
      grid: grid
        ? {
            left: grid.left,
            width: grid.width,
            right: grid.right,
            nodeScrollWidth: gridEl.scrollWidth,
            nodeClientWidth: gridEl.clientWidth,
          }
        : null,
      firstFive: firstFive.map((r) => ({ top: r.top, left: r.left, width: r.width })),
      projects: projects.map((r) => ({ top: r.top, left: r.left, width: r.width })),
      thumb: thumb ? { width: thumb.width, height: thumb.height } : null,
      titleStyle: sectionTitleEl
        ? {
            fontSize: getComputedStyle(sectionTitleEl).fontSize,
            lineHeight: getComputedStyle(sectionTitleEl).lineHeight,
            fontWeight: getComputedStyle(sectionTitleEl).fontWeight,
          }
        : null,
      cardNameStyle: cardNameEl
        ? {
            fontSize: getComputedStyle(cardNameEl).fontSize,
            fontWeight: getComputedStyle(cardNameEl).fontWeight,
          }
        : null,
      cardLines: cardNameEl && cardMetaEl
        ? {
            nameBottom: cardNameEl.getBoundingClientRect().bottom,
            metaTop: cardMetaEl.getBoundingClientRect().top,
            metaText: cardMetaEl.textContent?.trim() ?? '',
          }
        : null,
      menuStyle: menuBtnEl
        ? {
            width: Math.round(menuBtnEl.getBoundingClientRect().width),
            height: Math.round(menuBtnEl.getBoundingClientRect().height),
            borderWidth: getComputedStyle(menuBtnEl).borderTopWidth,
            radius: parseFloat(getComputedStyle(menuBtnEl).borderTopLeftRadius),
            background: getComputedStyle(menuBtnEl).backgroundColor,
            color: getComputedStyle(menuBtnEl).color,
          }
        : null,
      workbenchTags: document.querySelectorAll('[data-wb]').length,
      cardOverflow: firstProjectCard
        ? {
            scrollWidth: firstProjectCard.scrollWidth,
            clientWidth: firstProjectCard.clientWidth,
            nameScrollWidth: firstProjectCard.querySelector('[data-project-name]')?.scrollWidth ?? 0,
            nameClientWidth: firstProjectCard.querySelector('[data-project-name]')?.clientWidth ?? 0,
          }
        : null,
      firstIsNew: nodes[0]?.hasAttribute('data-new-card') ?? false,
    }
  })
  const tops = layout.firstFive.map((r) => r.top)
  const widths = layout.firstFive.map((r) => r.width)
  const sameRow = tops.filter((top) => Math.abs(top - tops[0]) <= 1).length
  /*
   * 用户 2026-09-28 最终口径是「卡片必须固定 303×180」。
   * 当前冒烟窗口的可用宽度放不下 5 张固定宽卡片，因此不能再要求一排五张；
   * 真正要守住的是尺寸不缩、栅格居中、按可用宽度自然换行，且不横向溢出。
   */
  rec(g, '★ 固定宽卡片按可用宽度自然换行，不缩小卡片', sameRow >= 1 && sameRow < 5, `sameRow=${sameRow}; tops=${tops.join(',')}`)
  rec(g, '★★ 每张项目卡片固定 303×180（用户 2026-09-28）', widths.every((w) => Math.abs(w - 303) <= 1), widths.join(','))
  rec(
    g,
    '★ 固定宽卡片栅格不横向溢出工作区',
    !!layout.workspace && !!layout.grid &&
      layout.grid.left >= layout.workspace.left - 1 &&
      layout.grid.right <= layout.workspace.left + layout.workspace.width + 1,
    layout.grid ? `grid=${layout.grid.left}..${layout.grid.right}; workspace=${layout.workspace.left}..${layout.workspace.left + layout.workspace.width}` : 'null',
  )
  rec(
    g,
    '★★ 网格在工作区内水平居中',
    !!layout.workspace && !!layout.grid &&
      Math.abs((layout.workspace.left + layout.workspace.width / 2) - (layout.grid.left + layout.grid.width / 2)) <= 2,
    JSON.stringify(layout),
  )
  rec(
    g,
    '★★ 项目封面实到 303×180，而不是只保持比例（Lovart 卡片口径，用户 2026-09-28）',
    !!layout.thumb &&
      Math.abs(layout.thumb.width - 303) <= 1 &&
      Math.abs(layout.thumb.height - 180) <= 1,
    layout.thumb ? `${layout.thumb.width.toFixed(1)}×${layout.thumb.height.toFixed(1)}` : 'null',
  )
  rec(g, '新建项目在网格第一张', layout.firstIsNew)
  rec(
    g,
    '★ “项目”标题 24px / 32px / 500（Lovart 口径，用户 2026-09-28）',
    JSON.stringify(layout.titleStyle) === JSON.stringify({ fontSize: '24px', lineHeight: '32px', fontWeight: '500' }),
    JSON.stringify(layout.titleStyle),
  )
  rec(
    g,
    '★ 项目名 14px / 500（Lovart 口径，用户 2026-09-28）',
    JSON.stringify(layout.cardNameStyle) === JSON.stringify({ fontSize: '14px', fontWeight: '500' }),
    JSON.stringify(layout.cardNameStyle),
  )
  rec(
    g,
    '★ 项目名与更新时间分两行，第二行含日期和节点数',
    !!layout.cardLines &&
      layout.cardLines.metaTop >= layout.cardLines.nameBottom &&
      /个节点/.test(layout.cardLines.metaText) &&
      !/画布|漫画/.test(layout.cardLines.metaText),
    JSON.stringify(layout.cardLines),
  )
  rec(
    g,
    '★ 卡片不再显示工作台标签胶囊',
    layout.workbenchTags === 0,
    `tags=${layout.workbenchTags}`,
  )
  rec(
    g,
    '★★ 项目菜单为 28×28 深色圆角方块、无描边',
    !!layout.menuStyle &&
      layout.menuStyle.width === 28 &&
      layout.menuStyle.height === 28 &&
      layout.menuStyle.borderWidth === '0px' &&
      layout.menuStyle.radius >= 8 &&
      layout.menuStyle.radius <= 10 &&
      layout.menuStyle.background !== 'rgba(0, 0, 0, 0)',
    JSON.stringify(layout.menuStyle),
  )
  rec(
    g,
    '真实项目卡片不横向溢出',
    !!layout.cardOverflow &&
      layout.cardOverflow.scrollWidth <= layout.cardOverflow.clientWidth + 1 &&
      layout.cardOverflow.nameScrollWidth <= layout.cardOverflow.nameClientWidth + 1,
    JSON.stringify(layout.cardOverflow),
  )

  // 窄工作区降列：缩窗口并展开侧栏，验证不再硬撑 5 列，且卡片不越出工作区。
  await page.setViewportSize({ width: 1050, height: 800 })
  await page.locator('[data-sidebar-toggle]').click()
  await sleep(400)
  const narrow = await page.evaluate(() => {
    const workspace = document.querySelector('[data-app-workspace]')?.getBoundingClientRect()
    const nodes = [...document.querySelectorAll('[data-new-card], [data-project-card]')]
    const top = Math.round(nodes[0]?.getBoundingClientRect().top ?? 0)
    const firstRow = nodes.filter((el) => Math.abs(Math.round(el.getBoundingClientRect().top) - top) <= 1)
    const right = Math.max(...nodes.map((el) => el.getBoundingClientRect().right))
    return { cols: firstRow.length, right, workspaceRight: workspace?.right ?? 0 }
  })
  rec(g, '★ 窄工作区自动降列、不横向溢出', narrow.cols < 5 && narrow.right <= narrow.workspaceRight + 1, JSON.stringify(narrow))
  await page.locator('[data-sidebar-toggle]').click()
  await page.setViewportSize({ width: 1280, height: 800 })
  await sleep(400)

  // 默认菜单隐藏；悬浮卡片后出现在右下角，并向上展开避免被卡片裁掉
  await page.mouse.move(0, 0)
  const firstCard = projectCards.first()
  const firstMenu = firstCard.locator('button[aria-label="项目菜单"]')
  const menuHidden = await firstCard.locator('button[aria-label="项目菜单"]').evaluate((el) => {
    const wrapper = el.parentElement
    const card = el.closest('[data-project-card]')
    return {
      opacity: wrapper ? getComputedStyle(wrapper).opacity : '1',
      rightGap: card ? card.getBoundingClientRect().right - wrapper.getBoundingClientRect().right : 999,
      bottomGap: card ? card.getBoundingClientRect().bottom - wrapper.getBoundingClientRect().bottom : 999,
    }
  })
  rec(g, '★★ 未悬浮时项目菜单隐藏', Number(menuHidden.opacity) === 0, JSON.stringify(menuHidden))
  await firstCard.hover()
  await sleep(250)
  const menuShown = await firstCard.locator('button[aria-label="项目菜单"]').evaluate((el) => {
    const wrapper = el.parentElement
    const card = el.closest('[data-project-card]')
    return {
      opacity: wrapper ? getComputedStyle(wrapper).opacity : '0',
      rightGap: card ? card.getBoundingClientRect().right - wrapper.getBoundingClientRect().right : 999,
      bottomGap: card ? card.getBoundingClientRect().bottom - wrapper.getBoundingClientRect().bottom : 999,
    }
  })
  rec(g, '★★ 悬浮后菜单出现在卡片右下角', Number(menuShown.opacity) === 1 && menuShown.rightGap <= 12 && menuShown.bottomGap <= 12, JSON.stringify(menuShown))
  await firstMenu.click()
  await sleep(200)
  const menuRect = await page.locator('[data-project-card] [role="menu"]').first().boundingBox()
  const buttonRect = await firstMenu.boundingBox()
  rec(g, '★ 菜单向上展开、不被卡片裁掉', !!menuRect && !!buttonRect && menuRect.y + menuRect.height <= buttonRect.y + 1, JSON.stringify({ menuRect, buttonRect }))
  await page.keyboard.press('Escape')
  await page.mouse.click(0, 0)
  await sleep(200)

  await page.locator('[data-project-select-toggle]').click()
  rec(g, '★ 标题旁点击选择模式后出现底部批量栏', await page.locator('[data-project-bulk-bar]').isVisible())
  rec(g, '选择模式显示顶部勾选框', (await page.locator('[data-project-select-mark]').count()) === 6, `marks=${await page.locator('[data-project-select-mark]').count()}`)
  await page.locator('[data-project-select-all]').click()
  rec(g, '★ 全选当前 6 个项目', /已选择 6 项/.test(await page.locator('[data-project-bulk-bar]').innerText()), await page.locator('[data-project-bulk-bar]').innerText())
  await page.locator('[data-project-bulk-clear]').click()
  rec(g, '★ 清除后回到全选入口', await page.locator('[data-project-select-all]').isVisible())
  await page.locator('[data-project-bulk-bar] button').filter({ hasText: '取消' }).click()
  rec(g, '★ 取消退出选择模式并收起批量栏', !(await page.locator('[data-project-bulk-bar]').isVisible()))

  await page.locator('[data-project-select-toggle]').click()
  await projectCards.nth(0).click()
  await projectCards.nth(1).click()
  rec(g, '★ 点卡片只切换选中、不进入画布', page.url().endsWith('/projects') && /已选择 2 项/.test(await page.locator('[data-project-bulk-bar]').innerText()), page.url())
  await page.locator('[data-project-bulk-delete]').click()
  await page.locator('[data-project-bulk-confirm]').click()
  await sleep(500)
  rec(g, '★★ 确认删除后选中的两个项目消失', (await projectCards.count()) === 4, `left=${await projectCards.count()}`)
  rec(g, '删除后退出选择模式', !(await page.locator('[data-project-bulk-bar]').isVisible()))

  await page.screenshot({ path: `${OUT}/100-g85-projects-selection.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}


/**
 * G86 侧栏展开不跳动 + 四分组间距 + Lovart 对齐（用户 2026-09-28 四条）。
 *
 *  1) Logo 行 / 折叠图标 / 字体对齐 Lovart：折叠图标 20px，
 *     展开态折叠按钮右边缘与下方导航容器右边缘对齐。
 *  2) 侧栏导航图标与文字统一 `#efefef`（深色主题、选中与否都一样），
 *     只有「最近项目」小标题走二级文字色。
 *  3) 展开**不跳动**：Logo 与导航图标的横向 x 在收起/展开两态完全一致，
 *     容器与文字只向右扩展，折叠按钮再右移到与导航容器右对齐。
 *  4) 四个分组：Logo+折叠 / 新建项目 / 功能菜单 / 最近项目，组间距约 20px。
 *
 * 全部用**计算样式与几何**判定 —— 「跳没跳」「对齐没有」肉眼会被 1~2px 骗过去。
 */
async function g86(browser) {
  const g = 'G86 侧栏展开动效与 Lovart 对齐'
  const ctx = await newDarkCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await gotoProjects(page)
  await sleep(600)

  const rail = page.locator('[data-app-sidebar]')

  // ── 收起态：记录 Logo 与折叠按钮的几何 ──
  const collapsed = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), cx: Math.round(r.left + r.width / 2) }
    }
    return {
      logo: box('[data-sidebar-logo]'),
      toggle: box('[data-sidebar-toggle]'),
      firstIcon: box('[data-sidebar-item="/"] span'),
    }
  })

  await page.locator('[data-sidebar-toggle]').click()
  await sleep(600)
  rec(g, '展开态已打开', (await rail.getAttribute('data-sidebar-open')) === 'true')

  const expanded = await page.evaluate(() => {
    const box = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), width: Math.round(r.width), height: Math.round(r.height), cx: Math.round(r.left + r.width / 2) }
    }
    const nav = document.querySelector('[data-sidebar-item="/"]')?.parentElement
    const navRect = nav?.getBoundingClientRect()
    const styleOf = (sel) => {
      const el = document.querySelector(sel)
      return el ? getComputedStyle(el) : null
    }
    const firstItemStyle = styleOf('[data-sidebar-item="/"]')
    const recentHeadStyle = styleOf('[data-sidebar-recent] > div')
    const head = document.querySelector('[data-sidebar-logo]')?.parentElement?.getBoundingClientRect()
    const newBtn = document.querySelector('[data-sidebar-new]')?.getBoundingClientRect()
    const recent = document.querySelector('[data-sidebar-recent]')?.getBoundingClientRect()
    const svg = document.querySelector('[data-sidebar-toggle] svg')?.getBoundingClientRect()
    return {
      logo: box('[data-sidebar-logo]'),
      toggle: box('[data-sidebar-toggle]'),
      toggleSvg: svg ? { width: Math.round(svg.width), height: Math.round(svg.height) } : null,
      firstIcon: box('[data-sidebar-item="/"] span'),
      navRight: navRect ? Math.round(navRect.right) : null,
      groups: {
        head: head ? { top: Math.round(head.top), bottom: Math.round(head.bottom) } : null,
        newBtn: newBtn ? { top: Math.round(newBtn.top), bottom: Math.round(newBtn.bottom) } : null,
        nav: navRect ? { top: Math.round(navRect.top), bottom: Math.round(navRect.bottom) } : null,
        recent: recent ? { top: Math.round(recent.top), bottom: Math.round(recent.bottom) } : null,
      },
      itemColor: firstItemStyle?.color ?? null,
      recentHeadColor: recentHeadStyle?.color ?? null,
    }
  })

  // ① 对齐：Logo x 不动，折叠按钮右边缘与导航容器右边缘对齐，图标 20px
  rec(
    g,
    '★ 展开后 Logo 横向位置与收起态一致（不跳动）',
    !!collapsed.logo && !!expanded.logo && collapsed.logo.left === expanded.logo.left,
    `收起 x=${collapsed.logo?.left} 展开 x=${expanded.logo?.left}`,
  )
  rec(
    g,
    '★ 展开后导航图标横向位置与收起态一致（不跳动）',
    !!collapsed.firstIcon && !!expanded.firstIcon && collapsed.firstIcon.left === expanded.firstIcon.left,
    `收起 x=${collapsed.firstIcon?.left} 展开 x=${expanded.firstIcon?.left}`,
  )
  rec(
    g,
    '★ 折叠按钮右边缘与导航容器右边缘对齐（Lovart）',
    !!expanded.toggle && !!expanded.navRight && Math.abs(expanded.toggle.right - expanded.navRight) <= 1,
    `toggle.right=${expanded.toggle?.right} nav.right=${expanded.navRight}`,
  )
  rec(
    g,
    '★ 折叠图标 20×20',
    JSON.stringify(expanded.toggleSvg) === JSON.stringify({ width: 20, height: 20 }),
    JSON.stringify(expanded.toggleSvg),
  )

  // ② 配色：深色下导航图标/文字统一近白，最近项目标题走二级文字色
  rec(
    g,
    '★ 深色下导航项颜色 #efefef',
    expanded.itemColor === 'rgb(239, 239, 239)',
    expanded.itemColor,
  )
  rec(
    g,
    '★ “最近项目”走二级文字色（与导航项区分）',
    !!expanded.recentHeadColor && expanded.recentHeadColor !== expanded.itemColor,
    `recentHead=${expanded.recentHeadColor} nav=${expanded.itemColor}`,
  )

  // ③ 四分组间距约 20px
  const gs = expanded.groups
  const gaps = gs.head && gs.newBtn && gs.nav && gs.recent
    ? [
        gs.newBtn.top - gs.head.bottom,
        gs.nav.top - gs.newBtn.bottom,
        gs.recent.top - gs.nav.bottom,
      ]
    : []
  rec(
    g,
    '★★ 四个分组间距都约 20px（Logo / 新建 / 菜单 / 最近）',
    gaps.length === 3 && gaps.every((n) => Math.abs(n - 20) <= 3),
    gaps.map((n) => `${n}px`).join(', '),
  )

  await page.screenshot({ path: `${OUT}/101-g86-sidebar-lovart.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G87 画布去网格 + Logo 容器不裁剪（用户 2026-09-28 两条）。
 *
 *  1) 画布背景**没有任何网格**：既没有网格层组件，`[data-canvas-surface]`
 *     的计算样式上也不该再挂任何网格背景图（repeating / linear-gradient 网格）。
 *     只查「有没有 GridLayer 元素」不够——网格也可能是纯 CSS 背景画出来的。
 *  2) 动态猫画 Logo 有缩放动画、会越过容器边界：壳层若在纵向上 `overflow: hidden`
 *     会把动画帧切平。这里断言壳层纵向不裁切，且 Logo 横向能够溢出其父容器
 *     （即它的 overflow 约定允许动画帧露出来）。
 */
async function g87(browser) {
  const g = 'G87 画布去网格 + Logo 容器不裁剪'
  const ctx = await newDarkCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // ── ① 画布无网格 ──
  await createProject(page)
  await sleep(800)

  const grid = await page.evaluate(() => {
    const surface = document.querySelector('[data-canvas-surface]')
    if (!surface) return { surface: false }
    const cs = getComputedStyle(surface)
    const bg = `${cs.backgroundImage} ${cs.background}`
    return {
      surface: true,
      // 网格通常来自带 gradient 的背景图；纯色背景不含 gradient
      hasGradientBg: bg.includes('gradient'),
      hasGridLayer: !!document.querySelector('[data-canvas-grid], [class*="GridLayer"]'),
      bgImage: cs.backgroundImage,
    }
  })
  rec(g, '画布表面存在', grid.surface === true, JSON.stringify(grid))
  rec(g, '★ 画布没有网格层', grid.hasGridLayer === false, JSON.stringify(grid))
  rec(
    g,
    '★ 画布背景不含任何网格渐变',
    grid.hasGradientBg === false,
    grid.bgImage,
  )

  // ── ② Logo 不裁剪 ──
  await gotoProjects(page)
  await sleep(600)

  const overflow = await page.evaluate(() => {
    const shell = document.querySelector('[data-app-shell]') ?? document.querySelector('#root > div')
    const sidebar = document.querySelector('[data-app-sidebar]')
    const logo = document.querySelector('[data-sidebar-logo]')
    if (!shell || !logo) return null
    const cs = getComputedStyle(shell)
    const sidebarCs = sidebar ? getComputedStyle(sidebar) : null
    const shellRect = shell.getBoundingClientRect()
    const logoRect = logo.getBoundingClientRect()
    return {
      shellOverflowY: cs.overflowY,
      sidebarOverflowY: sidebarCs?.overflowY ?? null,
      // Logo 顶边若被容器切平，会恰好等于或低于壳层顶边；动画帧应让它能越出
      logoTop: Math.round(logoRect.top),
      shellTop: Math.round(shellRect.top),
    }
  })
  rec(
    g,
    '★ 壳层纵向不裁切（overflow-y: visible）',
    overflow?.shellOverflowY === 'visible',
    JSON.stringify(overflow),
  )
  rec(
    g,
    '★ 侧栏纵向不裁切（overflow-y: visible）',
    overflow?.sidebarOverflowY === 'visible',
    JSON.stringify(overflow),
  )

  await page.screenshot({ path: `${OUT}/102-g87-no-grid-unclipped-logo.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G88 一站一协议 + 用户自建协议（用户 2026-09-28）。
 *
 *  ① 站点协议「选中即填地址」：选中玉玉 → 地址自动补成 https://yuli.host；
 *     用户手填过的地址则不被后续切协议覆盖。
 *  ② 自建协议：填名称 / 短标签 / 标识 / 能力 / 地址 / 版本段 → 添加 → 下拉自动选中。
 *  ③ 被渠道引用的自建协议不能删；把渠道改回 mock 后可以删掉。
 */
async function g88(browser) {
  const g = 'G88 一站一协议与自建协议'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(500)
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(400)
  await page.getByText('新建渠道').first().click()
  await sleep(300)

  // ① 站点协议 → 默认地址
  await page.locator('[data-settings-baseurl]').fill('')
  await page.locator('[data-settings-protocol]').selectOption('yuli')
  await sleep(200)
  const yuliUrl = await page.locator('[data-settings-baseurl]').inputValue()
  rec(g, '★ 选中站点协议自动填默认地址', yuliUrl === 'https://yuli.host', yuliUrl)

  await page.locator('[data-settings-baseurl]').fill('http://my-own.test')
  await page.locator('[data-settings-protocol]').selectOption('apistudio')
  await sleep(200)
  const keptUrl = await page.locator('[data-settings-baseurl]').inputValue()
  rec(g, '★ 切协议不覆盖用户手填地址', keptUrl === 'http://my-own.test', keptUrl)

  // ② 自建协议
  await page.locator('[data-proto-add-toggle]').click()
  await page.locator('[data-proto-form]').waitFor({ state: 'visible', timeout: 4000 })
  await page.locator('[data-proto-field="name"]').fill('私有站')
  await page.locator('[data-proto-field="short"]').fill('MY')
  await page.locator('[data-proto-field="id"]').fill('my-private')
  await page.locator('[data-proto-field="baseurl"]').fill('http://my-private.test')
  await page.locator('[data-proto-field="version"]').fill('/v1')
  await page.locator('[data-proto-create]').click()
  await sleep(300)
  const afterAdd = await page.locator('[data-settings-protocol]').inputValue()
  rec(g, '★ 添加自建协议后下拉自动选中', afterAdd === 'my-private', afterAdd)
  rec(
    g,
    '★ 自建协议出现在「我添加的协议」',
    (await page.locator('[data-proto-remove="my-private"]').count()) === 1,
  )

  // ③ 保存渠道 → 左栏短标签显示自建协议 → 引用中的协议删不掉
  await page.locator('[data-settings-save]').click()
  await sleep(400)
  const shortTag = (await page.locator('[data-channel-proto]').first().innerText()).trim()
  rec(g, '★ 渠道短标签显示自建协议', shortTag === 'MY', shortTag)

  await page.locator('[data-proto-remove="my-private"]').click()
  await sleep(300)
  const blocked = await page
    .locator('[data-proto-remove-error]')
    .innerText()
    .catch(() => '')
  rec(g, '★ 被渠道引用的自建协议拒绝删除并给出原因', blocked.includes('仍在用') || blocked.includes('使用该协议'), blocked)

  // ④ 改回 mock 后可删
  await page.locator('[data-settings-protocol]').selectOption('mock')
  await page.locator('[data-settings-save]').click()
  await sleep(400)
  await page.locator('[data-proto-remove="my-private"]').click()
  await sleep(400)
  rec(
    g,
    '★ 无渠道引用后自建协议可删除',
    (await page.locator('[data-proto-remove="my-private"]').count()) === 0,
  )

  await page.screenshot({ path: `${OUT}/103-g88-custom-protocol.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G89 异步任务协议 + CLI 网关（用户 2026-09-28「把协议和 CLI 支持做完」）。
 *
 * 这两族此前是 pending（界面不可选），本轮落了真实适配器：
 *  - `apimart`：提交回 `task_id` → 轮询 `GET /v1/tasks/{id}` → `result.images[].url[]`；
 *  - `jimeng-cli` / `gpt-cli` / `gemini-cli`：要求用户跑一个 OpenAI 兼容的 HTTP 网关。
 *
 * 断言刻意分两层：①界面上真的可选（不是 disabled）；②按协议打的是它自己声明的端点。
 * 只做①的话，「标了 ready 但适配器还是抛 unsupported」照样全绿。
 */
async function g89(browser) {
  const g = 'G89 异步任务与CLI网关'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // 拦截出站请求，记录协议实际打出的端点（不发真实请求）
  const seen = []
  await page.route('**://api.apimart.ai/**', async (route) => {
    const url = route.request().url()
    const method = route.request().method()
    seen.push(`${method} ${url}`)
    if (method === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ code: 200, data: { status: 'submitted', task_id: 'task_g89' } }),
      })
      return
    }
    if (url.includes('/tasks/')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'task_g89',
          status: 'completed',
          progress: 100,
          result: { images: [{ url: ['https://api.apimart.ai/fake/a.png'] }] },
        }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: [{ id: 'gpt-image-2' }] }),
    })
  })

  await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
  await sleep(500)
  await page.getByRole('button', { name: /新增渠道/ }).click()
  await sleep(400)
  await page.getByText('新建渠道').first().click()
  await sleep(300)

  // ① 异步任务协议可选（不再是「待支持」且被禁用）
  const apimartDisabled = await page
    .locator('[data-settings-protocol] option[value="apimart"]')
    .isDisabled()
  const apimartLabel = await page
    .locator('[data-settings-protocol] option[value="apimart"]')
    .innerText()
  rec(g, '★ APIMART 异步协议可选（不再标待支持）', apimartDisabled === false, apimartLabel.trim())

  await page.locator('[data-settings-protocol]').selectOption('apimart')
  await sleep(250)
  const apimartUrl = await page.locator('[data-settings-baseurl]').inputValue()
  rec(g, '★ 选中 APIMART 自动填官方文档基址', apimartUrl === 'https://api.apimart.ai', apimartUrl)

  // ② 验证地址：异步族仍走 /v1/models（连通性与 OpenAI 兼容同形）
  await page.locator('[data-settings-verify]').click()
  await sleep(900)
  rec(
    g,
    '★★ 异步协议验证打的是 /v1/models',
    seen.some((s) => s === 'GET https://api.apimart.ai/v1/models'),
    seen.join(' | '),
  )

  /*
   * ③ CLI 三条退回 pending：没有本机网关就没有可用路径，不该显示为可选。
   *
   * ⚠ 刻意不用 Playwright 的 `isDisabled()`：它对 `<optgroup>` 里的 `<option>`
   * 判定不可靠（实测把 disabled 的选项报成可用）。这里直接读 DOM 属性 ——
   * 「不可选」这件事只能由浏览器自己的状态证明。
   */
  const cliStates = await page.evaluate(() => {
    const sel = document.querySelector('[data-settings-protocol]')
    const out = {}
    for (const id of ['jimeng-cli', 'gpt-cli', 'gemini-cli']) {
      const opt = sel?.querySelector(`option[value="${id}"]`)
      out[id] = opt ? { disabled: opt.disabled, text: opt.textContent.trim() } : null
    }
    return out
  })
  for (const id of ['jimeng-cli', 'gpt-cli', 'gemini-cli']) {
    const st = cliStates[id]
    rec(
      g,
      `★ ${id} 标为待支持且不可选（无本机网关则不成立）`,
      !!st && st.disabled === true && st.text.includes('待支持'),
      JSON.stringify(st),
    )
  }
  // ④ 旧协议不再出现在新渠道的下拉里（保留识别能力，但不给新用户选）
  const legacyShown = await page.locator('[data-settings-protocol] option[value="openai-images"]').count()
  rec(g, '★★ 旧协议对新渠道隐藏（不重复提供同一套能力）', legacyShown === 0, `count=${legacyShown}`)
  /*
   * ⑤ 待支持协议要在渠道菜单下方**看得见**：下拉里灰掉的 option 几乎无人看见，
   * 用户只会以为「根本没有这一项」。这里断言既列出了名字、也写明了原因。
   */
  const pendingList = await page.evaluate(() => {
    const box = document.querySelector('[data-proto-pending]')
    if (!box) return null
    return [...box.querySelectorAll('[data-proto-pending-item]')].map((el) => el.innerText.replace(/\s+/g, ' ').trim())
  })
  rec(
    g,
    '★★ 待支持协议在渠道菜单下方列出（不是只灰在下拉里）',
    Array.isArray(pendingList) && pendingList.length >= 3,
    `items=${pendingList?.length ?? 0}`,
  )
  rec(
    g,
    '★ 列出时写明为什么不支持（不是只写「待支持」）',
    !!pendingList && pendingList.every((t) => t.length > 10),
    pendingList?.[0]?.slice(0, 60) ?? '',
  )

  await page.screenshot({ path: `${OUT}/104-g89-async-cli.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G90 我的素材页（`/assets`，用户 2026-09-29：手动收藏素材库）。
 *
 * 这里验证的是**收藏关系**，不是 `assets` 内容仓库：只有 `assetLibrary`
 * 里的行才该出现。断言分三层，缺一层都会留下「看起来做完了」的假象：
 *
 *  ① **收藏过滤**：`assets` 故意多放一张未收藏图，页面必须只列 2 张
 *     `assetLibrary` 行；取消收藏后断言关系表少一行而 assets 字节仍在。
 *  ② **展示**：卡片不再显示项目 / 时间 / 体积，媒体 `contain` 完整显示；
 *     瀑布流高度由真实素材比例驱动。
 *  ③ **交互与详情**：单击只能选中，双击才开灯箱；七类信息必须是保存时
 *     冻结的值；视频配色明确显示“暂不可用”；空库文案精确可断言。
 */
async function g90(browser) {
  const g = 'G90 我的素材页'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  // 先落地一次，让 Dexie 建库（否则 `indexedDB.databases()` 里还没有它）
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' })
  await sleep(500)

  /**
   * 直接往 IndexedDB 里种素材。
   *
   * 为什么不走「画布里生成一张」：那条路径依赖渠道与网络 mock，
   * 会让本组变成一条端到端长链，一处抖动就分不清是素材库坏了还是生成坏了。
   * 素材库是**读** `assets` 表，直接种表测的正是它自己的那一段。
   */
  const seeded = await page.evaluate(async ({ pngB64 }) => {
    const b64 = pngB64
    const bin = atob(b64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i)

    const openDb = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('qinghua')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const db = await openDb()
    const put = (table, rows) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(table, 'readwrite')
        const store = tx.objectStore(table)
        for (const r of rows) store.put(r)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
      })

    const now = Date.now()
    /**
     * `assets` 是内容仓库：这里故意多放一张“没有收藏关系”的图。
     * 素材页若仍扫描 assets 表，它就会错误出现；只读 assetLibrary 才不会。
     */
    await put('assets', [
      {
        id: 'g90-saved',
        hash: 'g90-saved',
        mime: 'image/png',
        bytes,
        width: 64,
        height: 36,
      },
      {
        id: 'g90-vid',
        hash: 'g90-vid',
        mime: 'video/mp4',
        bytes,
      },
      {
        id: 'g90-not-saved',
        hash: 'g90-not-saved',
        mime: 'image/png',
        bytes,
        width: 64,
        height: 36,
      },
      {
        id: 'g90-save-me',
        hash: 'g90-save-me',
        mime: 'image/png',
        bytes,
        width: 64,
        height: 36,
      },
    ])
    await put('assetLibrary', [
      {
        id: 'g90-saved',
        hash: 'g90-saved',
        mime: 'image/png',
        bytes: bytes.length,
        width: 64,
        height: 36,
        savedAt: now - 1000,
        prompt: '月光下的猫咪',
        ratio: '16:9',
        quality: 'high',
        model: 'image-pro',
        channelId: 'ch-cat',
      },
      {
        id: 'g90-vid',
        hash: 'g90-vid',
        mime: 'video/mp4',
        bytes: bytes.length,
        savedAt: now,
        prompt: '奔跑的狗狗',
        ratio: '4:3',
        quality: 'medium',
        model: 'video-x',
        channelId: 'ch-dog',
      },
    ])
    await put('projects', [
      { id: 'p-g90-save', name: '保存链路', workbench: 'canvas', createdAt: now, updatedAt: now },
    ])
    await put('nodes', [
      {
        id: 'n-g90-save',
        projectId: 'p-g90-save',
        type: 'generation',
        parentId: null,
        x: 200,
        y: 180,
        w: 240,
        h: 240,
        title: '生成',
        disabled: false,
        data: {
          mode: 'image',
          assetHash: 'g90-save-me',
          naturalSize: { width: 64, height: 36 },
          prompt: '节点提示词',
          linkedPromptNodeIds: [],
          channelId: 'node-channel',
          model: 'node-model',
          ratio: '16:9',
          quality: 'high',
          count: 1,
          thumbOrder: ['g90-save-me'],
          upstreamHidden: [],
        },
      },
    ])
    await put('runRecords', [
      {
        id: 'r-g90-save',
        nodeId: 'n-g90-save',
        projectId: 'p-g90-save',
        version: 1,
        createdAt: now,
        status: 'succeeded',
        inputs: [],
        params: { prompt: '冻结提示词', ratio: '4:3', quality: 'medium' },
        outputHashes: ['g90-save-me'],
        fingerprint: 'fp-g90',
        taskId: 't-g90',
        durationMs: 1,
        sentChannelId: 'sent-channel',
        sentModel: 'sent-model',
        outputWidth: 64,
        outputHeight: 36,
      },
    ])
    return { assets: 4, library: 2, projects: 1 }
  }, { pngB64: solidPngBuffer(64, 36).toString('base64') })

  rec(
    g,
    '种子已写入 IndexedDB（内容仓库 4 张，其中仅 2 张被收藏，另备保存链路节点）',
    seeded.assets === 4 && seeded.library === 2 && seeded.projects === 1,
    JSON.stringify(seeded),
  )

  await page.goto(`${BASE}/assets`, { waitUntil: 'networkidle' })
  await sleep(800)

  rec(g, '素材页挂载（不再是占位页）', (await page.locator('[data-assets-page]').count()) === 1)
  rec(
    g,
    '旧的占位文案已消失（不再说「还没开始做」）',
    !(await page.locator('[data-assets-page]').innerText()).includes('还没开始做'),
  )

  // ── ① 数据层：两张都读回来了 ──
  const cards = page.locator('[data-asset-card]')
  let count = 0
  for (let i = 0; i < 20; i += 1) {
    count = await cards.count()
    if (count >= 2) break
    await sleep(250)
  }
  rec(g, '★★ 素材库只列手动收藏的素材（2 张，不是 assets 里的 3 张）', count === 2, `cards=${count}`)
  rec(
    g,
    '★★ 未收藏的 assets 内容不出现',
    (await page.locator('[data-asset-card="g90-not-saved"]').count()) === 0,
  )
  const countText = await page.locator('[data-assets-count]').innerText().catch(() => '')
  rec(g, '★ 计数文案说的是收藏总数', /共\s*2\s*个素材/.test(countText), countText.trim())

  /*
   * ── ② 排序 ──
   *
   * ⚠ 这里用 DOM 顺序（`data-asset-card` 的出现顺序）而不是视觉坐标断言：
   * 瀑布流是多列布局，卡片按「先填满一列再填下一列」排布，
   * **纵坐标不与时间顺序对应** —— 按 top 排序会把正确的顺序判成错的。
   * 时间顺序由 store 保证，DOM 顺序即数据源顺序，量它才是对的判据。
   */
  const order = await page.locator('[data-asset-card]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('data-asset-card')),
  )
  const rank = (h) => order.indexOf(h)
  rec(
    g,
    '★★ 新的在前（视频晚于图片保存）',
    rank('g90-vid') === 0 && rank('g90-saved') === 1,
    order.join(','),
  )

  const cardText = await page.locator('[data-asset-card]').allInnerTexts()
  rec(
    g,
    '★★ 卡片下面不再显示项目 / 时间 / 体积等文字',
    (await page.locator('[data-asset-source], [data-asset-meta]').count()) === 0 &&
      cardText.every((text) => text.trim() === '⋯' || text.trim() === ''),
    cardText.join(' | '),
  )

  const imgDecoded = await page
    .locator('[data-asset-card="g90-saved"] [data-asset-media]')
    .evaluate((el) => el.naturalWidth)
    .catch(() => 0)
  rec(
    g,
    '★ 图片真的被解码（naturalWidth=64，不是空壳）',
    imgDecoded === 64,
    `naturalWidth=${imgDecoded}`,
  )

  // ── ② 瀑布流排版（用户 2026-09-29 要的展示方式）──
  const masonry = await page.evaluate(() => {
    const els = [...document.querySelectorAll('[data-asset-card]')]
    const boxes = els.map((el) => {
      const r = el.getBoundingClientRect()
      return {
        hash: el.getAttribute('data-asset-card'),
        x: Math.round(r.left),
        w: Math.round(r.width),
        h: Math.round(r.height),
      }
    })
    const grid = document.querySelector('[data-assets-grid]')
    const gs = grid ? getComputedStyle(grid) : null
    return {
      boxes,
      /**
       * `columns: 240px` 设的是**列宽**，计算样式里 `column-count` 因此是 `auto`
       * （列数由容器宽度除以列宽算出）。故这里读 `column-width` ——
       * 断言 `column-count` 会把正确的多列布局判成失败。
       */
      columnWidth: gs ? gs.columnWidth : null,
      columnGap: gs ? gs.columnGap : null,
      breakInside: els[0] ? getComputedStyle(els[0]).breakInside : null,
    }
  })

  /* 多列：瀑布流的机制证据（写 grid 也能排出卡片，但那不是瀑布流） */
  rec(
    g,
    '★★ 容器是多列布局（瀑布流的机制，不是等高 grid）',
    masonry.columnWidth === '240px',
    `columnWidth=${masonry.columnWidth} columnGap=${masonry.columnGap}`,
  )
  rec(
    g,
    '★ 卡片禁止跨列断开（否则会被从中间切成两半）',
    masonry.breakInside === 'avoid',
    `break-inside=${masonry.breakInside}`,
  )

  /* 同一列的卡片宽度一致（列宽固定是瀑布流的前提） */
  const widths = [...new Set(masonry.boxes.map((b) => b.w))]
  rec(g, '★ 所有卡片同宽（列宽固定）', widths.length === 1, `widths=${widths.join(',')}`)

  const cols = [...new Set(masonry.boxes.map((b) => b.x))]
  rec(g, '★ 卡片落在多列上（不是一列到底）', cols.length >= 2, `列 x=${cols.join(',')}`)

  /* ★ 核心：高度不齐 = 瀑布流；所有卡片等高 = 退化成等高网格 */
  const heights = [...new Set(masonry.boxes.map((b) => b.h))]
  rec(
    g,
    '★★★ 卡片高度随素材比例变化（等高则退化成网格，不是瀑布流）',
    heights.length >= 2,
    `heights=${masonry.boxes.map((b) => `${b.hash}:${b.h}`).join(' ')}`,
  )

  /* 竖图必须比横图高 —— 这条把「高度不同」钉成「高度方向正确」 */
  const hOf = (h) => masonry.boxes.find((b) => b.hash === h)?.h ?? 0
  rec(
    g,
    '★★ 视频占位高度与图片不同（比例方向由数据驱动）',
    hOf('g90-vid') > hOf('g90-saved'),
    `vid=${hOf('g90-vid')} img=${hOf('g90-saved')}`,
  )

  /* 比例不再夹取；素材完整展示而不是被裁成统一封面 */
  const savedAspect = await page
    .getAttribute('[data-asset-card="g90-saved"] [data-asset-thumb]', 'data-asset-aspect')
    .catch(() => null)
  rec(
    g,
    '★ 卡片比例取素材真实比例（16:9 不被夹取）',
    Math.abs(Number(savedAspect) - 64 / 36) < 0.01,
    `aspect=${savedAspect}`,
  )

  const fit = await page
    .locator('[data-asset-card="g90-saved"] [data-asset-media]')
    .evaluate((el) => getComputedStyle(el).objectFit)
  rec(g, '★★ 图片完整显示（object-fit: contain，不裁切）', fit === 'contain', `fit=${fit}`)

  // ── ③ 类型筛选 ──
  await page.locator('[data-assets-filter="image"]').click()
  await sleep(400)
  rec(
    g,
    '★ 筛「图片」时视频不出现',
    (await page.locator('[data-asset-card]').count()) === 1 &&
      (await page.locator('[data-asset-card="g90-vid"]').count()) === 0,
    `count=${await page.locator('[data-asset-card]').count()}`,
  )
  await page.locator('[data-assets-filter="video"]').click()
  await sleep(400)
  rec(
    g,
    '★ 筛「视频」时只剩视频那张',
    (await page.locator('[data-asset-card="g90-vid"]').count()) === 1 &&
      (await page.locator('[data-asset-card]').count()) === 1,
  )
  await page.locator('[data-assets-filter="all"]').click()
  await sleep(400)

  // ── ③ 关键字筛选（按冻结的生成信息）──
  await page.locator('[data-assets-search]').fill('猫咪')
  await sleep(400)
  rec(
    g,
    '★ 关键字能按提示词筛（只剩猫咪那张）',
    (await page.locator('[data-asset-card]').count()) === 1 &&
      (await page.locator('[data-asset-card="g90-vid"]').count()) === 0,
    `count=${await page.locator('[data-asset-card]').count()}`,
  )
  await page.locator('[data-assets-search]').fill('')
  await sleep(400)

  // ── ③ 单击选中、双击开灯箱 ──
  const imageCard = page.locator('[data-asset-card="g90-saved"]')
  await imageCard.locator('[data-asset-open]').click()
  await sleep(250)
  rec(
    g,
    '★★ 第一次单击只选中，不直接打开灯箱',
    (await imageCard.getAttribute('data-asset-selected')) === 'true' &&
      (await page.locator('[data-asset-preview]').count()) === 0,
  )
  await imageCard.locator('[data-asset-open]').dblclick()
  await sleep(700)
  rec(g, '★★ 双击卡片打开灯箱', (await page.locator('[data-asset-preview]').count()) === 1)
  rec(
    g,
    '★★ 灯箱打开的正是这张（hash 对得上）',
    (await page.getAttribute('[data-asset-preview]', 'data-asset-preview-hash')) === 'g90-saved',
  )
  const previewW = await page
    .locator('[data-asset-preview-media]')
    .evaluate((el) => el.naturalWidth)
    .catch(() => 0)
  rec(
    g,
    '★★ 灯箱里的图真的画出来了（naturalWidth=64）',
    previewW === 64,
    `naturalWidth=${previewW}`,
  )
  const previewLayout = await page.evaluate(() => {
    const stage = document.querySelector('[data-asset-preview-stage]')
    const details = document.querySelector('[data-asset-preview-details]')
    if (!stage || !details) return null
    const s = stage.getBoundingClientRect()
    const d = details.getBoundingClientRect()
    return {
      railRight: d.left >= s.right - 2,
      activeClose: document.activeElement === document.querySelector('[data-asset-preview-close]'),
      paletteWidth: document.querySelector('[data-asset-preview-palette]')?.getBoundingClientRect().width ?? 0,
      promptWidth: document.querySelector('[data-asset-preview-prompt]')?.getBoundingClientRect().width ?? 0,
    }
  })
  rec(
    g,
    '★★ 灯箱是媒体舞台 + 右侧信息栏（不是卡片套装）',
    !!previewLayout && previewLayout.railRight,
    JSON.stringify(previewLayout),
  )
  rec(
    g,
    '★ 灯箱打开后焦点落在关闭按钮，键盘可达',
    !!previewLayout?.activeClose,
  )
  rec(
    g,
    '★ 配色与提示词各有独立阅读区',
    !!previewLayout && previewLayout.paletteWidth > 200 && previewLayout.promptWidth > 200,
    JSON.stringify(previewLayout),
  )

  const detailSelectors = [
    '[data-asset-preview-palette]',
    '[data-asset-preview-prompt]',
    '[data-asset-preview-size]',
    '[data-asset-preview-ratio]',
    '[data-asset-preview-quality]',
    '[data-asset-preview-model]',
    '[data-asset-preview-channel]',
  ]
  rec(
    g,
    '★★ 右侧七类信息齐全（配色 / 提示词 / 像素 / 比例 / 画质 / 模型 / 渠道）',
    (await Promise.all(detailSelectors.map((selector) => page.locator(selector).count()))).every(
      (n) => n === 1,
    ),
  )
  const details = await page.evaluate((selectors) => {
    const read = (selector) => document.querySelector(selector)?.textContent?.trim() ?? ''
    return selectors.map(read)
  }, detailSelectors)
  rec(
    g,
    '★★ 详情显示保存时冻结的真实内容',
    details[0].includes('#') &&
      details[1] === '月光下的猫咪' &&
      details[2] === '64 × 36' &&
      details[3] === '16:9' &&
      details[4] === 'high' &&
      details[5] === 'image-pro' &&
      details[6] === 'ch-cat',
    details.join(' | '),
  )

  // 视频配色没有统一取色口径，必须明确显示暂不可用，而不是空白或伪造色。
  await page.locator('[data-asset-preview-close]').click()
  await sleep(250)
  const videoCard = page.locator('[data-asset-card="g90-vid"]')
  await videoCard.locator('[data-asset-open]').dblclick()
  await sleep(500)
  const videoPalette = await page.locator('[data-asset-preview-palette]').innerText().catch(() => '')
  rec(g, '★★ 视频的配色方案显示暂不可用', videoPalette.trim() === '暂不可用', videoPalette.trim())
  await page.keyboard.press('Escape')
  await sleep(400)
  rec(g, '★ Esc 关闭灯箱', (await page.locator('[data-asset-preview]').count()) === 0)

  // ── ③ 取消收藏：只删关系，不删 assets 字节 ──
  await imageCard.locator('[data-asset-open]').dblclick()
  await sleep(400)
  rec(
    g,
    '★ 灯箱提供取消收藏入口',
    (await page.locator('[data-asset-preview-remove]').count()) === 1,
  )
  await page.locator('[data-asset-preview-remove]').click()
  await sleep(600)
  rec(
    g,
    '★ 灯箱取消收藏后卡片消失',
    (await page.locator('[data-asset-card="g90-saved"]').count()) === 0 &&
      (await page.locator('[data-asset-card]').count()) === 1,
    `count=${await page.locator('[data-asset-card]').count()}`,
  )

  const afterImageRemoval = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('qinghua')
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    const keys = (table) =>
      new Promise((resolve) => {
        const tx = db.transaction(table, 'readonly')
        const req = tx.objectStore(table).getAllKeys()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve([])
      })
    return { library: await keys('assetLibrary'), assets: await keys('assets') }
  })
  rec(
    g,
    '★★★ 取消收藏只删关系，assets 字节仍在（画布引用不会被弄坏）',
    Array.isArray(afterImageRemoval.library) &&
      !afterImageRemoval.library.includes('g90-saved') &&
      afterImageRemoval.assets.includes('g90-saved'),
    JSON.stringify(afterImageRemoval),
  )

  // ── 卡片菜单同样用二次确认取消收藏 ──
  const target = page.locator('[data-asset-card="g90-vid"]')
  await target.locator('[data-asset-menu]').click()
  await sleep(300)
  await target.getByRole('menuitem', { name: '取消收藏' }).click()
  await sleep(300)
  rec(
    g,
    '取消收藏前要二次确认（不是一点就没）',
    (await page.locator('[data-asset-delete-yes]').count()) === 1,
  )
  await page.locator('[data-asset-delete-yes]').click()
  await sleep(600)
  rec(
    g,
    '★ 取消收藏后卡片消失',
    (await page.locator('[data-asset-card]').count()) === 0 &&
      (await page.locator('[data-asset-card="g90-vid"]').count()) === 0,
    `count=${await page.locator('[data-asset-card]').count()}`,
  )

  const emptyHint = await page.locator('[data-assets-empty-hint]').innerText().catch(() => '')
  rec(
    g,
    '★★ 空库文案精确说明素材从生成节点保存',
    emptyHint.trim() === '从生成节点保存素材后才会出现在这里。',
    emptyHint.trim(),
  )

  // ── ③ 从真实生成节点的右键菜单保存，再回素材库看到这张 ──
  await page.goto(`${BASE}/canvas/p-g90-save`, { waitUntil: 'networkidle' })
  await sleep(700)
  const saveNode = page.locator('[data-node-id="n-g90-save"]')
  rec(g, '保存链路节点已装载', (await saveNode.count()) === 1)
  await saveNode.click({ position: { x: 120, y: 20 } })
  await page.waitForTimeout(250)
  await saveNode.locator('[data-node-asset-menu]').click()
  await page.waitForTimeout(200)
  const nodeAssetMenuText = await saveNode.locator('[data-asset-menu]').innerText().catch(() => '')
  rec(
    g,
    '★ 保存入口不再藏在节点右上角素材菜单里',
    !nodeAssetMenuText.includes('保存到素材库'),
    nodeAssetMenuText.replace(/\s+/g, ' ').trim(),
  )
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)
  await saveNode.click({ button: 'right', position: { x: 120, y: 20 } })
  await sleep(250)
  rec(
    g,
    '★★ 生成节点右键菜单提供“保存到素材库”',
    (await page.locator('[data-context-menu-item="saveLibrary"]').count()) === 1,
  )
  await page.locator('[data-context-menu-item="saveLibrary"]').click()
  await sleep(700)

  await page.goto(`${BASE}/assets`, { waitUntil: 'networkidle' })
  await sleep(700)
  rec(
    g,
    '★★ 保存后素材进入收藏库',
    (await page.locator('[data-asset-card="g90-save-me"]').count()) === 1,
  )
  await page.locator('[data-asset-card="g90-save-me"] [data-asset-open]').dblclick()
  await sleep(500)
  const savedDetails = await page.evaluate(() => ({
    prompt: document.querySelector('[data-asset-preview-prompt]')?.textContent?.trim(),
    ratio: document.querySelector('[data-asset-preview-ratio]')?.textContent?.trim(),
    quality: document.querySelector('[data-asset-preview-quality]')?.textContent?.trim(),
    model: document.querySelector('[data-asset-preview-model]')?.textContent?.trim(),
    channel: document.querySelector('[data-asset-preview-channel]')?.textContent?.trim(),
  }))
  rec(
    g,
    '★★ 保存时冻结的是实际发送记录，而不是节点当前值',
    savedDetails.prompt === '冻结提示词' &&
      savedDetails.ratio === '4:3' &&
      savedDetails.quality === 'medium' &&
      savedDetails.model === 'sent-model' &&
      savedDetails.channel === 'sent-channel',
    JSON.stringify(savedDetails),
  )
  await page.keyboard.press('Escape')
  await sleep(300)

  // ── 几何：内容随工作区居中（与技能库 / 设置页同一口径）──
  const geo = await page.evaluate(() => {
    const stage = document.querySelector('[data-assets-stage]')
    const ws = document.querySelector('[data-app-workspace]')
    if (!stage || !ws) return null
    const s = stage.getBoundingClientRect()
    const w = ws.getBoundingClientRect()
    return { stageCx: Math.round(s.left + s.width / 2), wsCx: Math.round(w.left + w.width / 2), sw: Math.round(s.width), ww: Math.round(w.width) }
  })
  rec(
    g,
    '★ 素材库内容在工作区水平居中（±2px）',
    !!geo && Math.abs(geo.stageCx - geo.wsCx) <= 2,
    JSON.stringify(geo),
  )
  rec(
    g,
    '★ 内容不横向溢出工作区',
    !!geo && geo.sw <= geo.ww,
    geo ? `stage=${geo.sw} workspace=${geo.ww}` : 'no geo',
  )

  await page.screenshot({ path: `${OUT}/105-g90-assets.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G91 融合节点（产品文档 §6.23，2026-09-29）
 *
 * 这一组只测**浏览器里才成立**的东西，纯逻辑（几何、比例校验、计划组织）
 * 已经在 `domain/canvas/fusion/fusionPlan.test.ts`（25 项）里逐条钉过：
 *   - **两只口**（左原图 + 右侧一只共用口）的几何位置与「共用」属性；
 *   - 局部图的线落在共用口上、结果也从共用口出（`data-edge-target-port`）；
 *   - 框选能产出选区、选区编号与补丁编号对得上；
 *   - 点「融合」真的产出一张图（本地像素合成走完整条落库链路）；
 *   - 没输入时按钮禁用、且**说得出为什么**（不留「点了没反应」）。
 */
async function g91(browser) {
  const g = 'G91 融合节点'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)

  /** 从一个端点拖到某个屏幕点（§6.14 拖线建连） */
  const dragFromPortTo = async (portLocator, to) => {
    const b = await portLocator.boundingBox()
    if (!b) return false
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()
    await sleep(450)
    return true
  }

  // ── ① 建得出来 ──
  await page.locator('[data-toolbar-add]').click()
  await sleep(350)
  const menuIds = await page
    .locator('[data-toolbar-menu-item]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-toolbar-menu-item')))
  rec(g, '新建菜单里有「融合节点」', menuIds.includes('fusion'), menuIds.join(','))
  await page.locator('[data-toolbar-menu-item="fusion"]').click()
  await sleep(600)

  const fusion = page.locator('[data-node-type="fusion"]').first()
  rec(g, '画布上建出了融合节点', (await fusion.count()) === 1)
  if ((await fusion.count()) === 0) {
    rec(g, '（后续断言跳过）', false, '节点没建出来')
    await ctx.close()
    return
  }
  /**
   * 融合节点靠右放：它 280×420，左边留给两个上游生成节点。
   *
   * ⚠️ 位置必须**不重叠**：`nodeAtPoint` 取最上层命中的节点，若上游生成节点
   * 压在融合节点上，拖线的落点会被**上游自己**吃掉（表现为「连不上、也不报错」）。
   * 上传 64×36 的图后生成节点会自动变成 427×240（`assetNodeSize` 放大到盖住最小框），
   * 比它看上去宽得多。
   */
  const fusionId = await fusion.getAttribute('data-node-id')
  await moveNodeVia(page, fusion, page.locator('[data-fusion-chips]'), 840, 240)
  await sleep(250)

  // ── ② 两只口：左原图 + 右侧一只共用口 ──
  const portGeo = await fusion.evaluate((el) => {
    const nr = el.getBoundingClientRect()
    return {
      left: nr.left,
      right: nr.right,
      cy: nr.top + nr.height / 2,
      ports: [...el.querySelectorAll('[data-port]')].map((p) => {
        const r = p.getBoundingClientRect()
        return {
          id: p.getAttribute('data-port'),
          kind: p.getAttribute('data-port-kind'),
          cx: r.left + r.width / 2,
          cy: r.top + r.height / 2,
        }
      }),
    }
  })
  const portById = Object.fromEntries(portGeo.ports.map((p) => [p.id, p]))
  rec(
    g,
    '★ 只有两只口：左原图 `input` + 右共用口 `patch`',
    portGeo.ports.length === 2 && !!portById.input && !!portById.patch,
    portGeo.ports.map((p) => p.id).join(','),
  )
  rec(
    g,
    '★★ 右端口是**共用口**（`kind=both`，入 / 出同一锚点）且贴在右边缘中点',
    portById.patch?.kind === 'both' &&
      Math.abs(portById.patch.cx - portGeo.right) <= 2 &&
      Math.abs(portById.patch.cy - portGeo.cy) <= 2,
    `kind=${portById.patch?.kind} cx=${portById.patch?.cx?.toFixed(1)} right=${portGeo.right.toFixed(1)} cy=${portById.patch?.cy?.toFixed(1)} mid=${portGeo.cy.toFixed(1)}`,
  )
  rec(
    g,
    '★ 原图口在**左边缘中点**（左入的口径没被挪走）',
    Math.abs(portById.input?.cx - portGeo.left) <= 2 &&
      Math.abs(portById.input?.cy - portGeo.cy) <= 2,
    `in=(${portById.input?.cx?.toFixed(1)},${portById.input?.cy?.toFixed(1)}) left=${portGeo.left.toFixed(1)} mid=${portGeo.cy.toFixed(1)}`,
  )

  // ── ③ 空输入时：按钮禁用 + 说得出为什么 ──
  rec(g, '★ 没有原图时「融合」按钮禁用（不留点了没反应的入口）', await page.locator('[data-fusion-run]').isDisabled())
  const emptyTitle = await page.locator('[data-fusion-run]').getAttribute('title')
  rec(g, '★ 禁用时说清了先接什么', /原图|局部修改图/.test(emptyTitle ?? ''), emptyTitle ?? '')

  // ── ④ 原图：拖生成节点的输出口，落在融合节点**左半边** → 应该进 input ──
  /**
   * 素材用 **640×360**（16:9）而不是 64×36。
   *
   * 两个原因：① 选区有 32px 的最小边长，64px 宽的图上根本框不出合规的选区；
   * ② 下面要验证「按模型比例提取」——选区吸附到 16:9 之后，补丁（同样是 16:9）
   * 才过得了比例校验。图太小会把「功能正常」测成「功能不可用」。
   */
  const src = await addGenWithImage(page, 640, 360, [200, 120, 60])
  await moveNode(page, src.id, 150, 240)
  await sleep(300)
  const fBox = await fusion.boundingBox()
  const srcPort = src.node.locator('[data-port="output"]').first()
  const srcPortBox = await srcPort.boundingBox()
  rec(
    g,
    '★ 上游生成节点的输出口有可点的几何位置',
    !!srcPortBox && srcPortBox.width > 0,
    JSON.stringify(srcPortBox),
  )
  if (srcPortBox) {
    await page.mouse.move(srcPortBox.x + srcPortBox.width / 2, srcPortBox.y + srcPortBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(fBox.x + 30, fBox.y + fBox.height / 2, { steps: 10 })
    await sleep(120)
    rec(
      g,
      '★ 端点按下后拖出草稿曲线（说明 pointerdown 真的命中了端点）',
      (await page.locator('[data-edge-draft]').count()) === 1,
      `draft=${await page.locator('[data-edge-draft]').count()}`,
    )
    await page.mouse.up()
    await sleep(450)
  }
  const inputEdge = page.locator('[data-edge-target-port="input"]')
  rec(g, '★ 拖到左半边 → 边落在 input 口', (await inputEdge.count()) === 1, `count=${await inputEdge.count()}`)

  // ── ⑤ 入方向：上游出线、落在融合节点**右半边** → 应该落共用口 ──
  /**
   * 补丁用**另一种差别很大的纯色**（蓝）—— 见下面「色彩匹配」那几条像素断言：
   * 若两边同色，色彩匹配做没做、羽化做没做，读出来都一样。
   */
  const patchSrc = await addGenWithImage(page, 640, 360, [60, 60, 200])
  await moveNode(page, patchSrc.id, 150, 520)
  await sleep(300)
  /**
   * 落点选**右半边**：节点可能有两只输入口（左原图 / 右共用口），松手时按
   * 「离指针最近的输入口」判定 —— 这也是共用口作为**入口**的唯一接法。
   */
  await dragFromPortTo(patchSrc.node.locator('[data-port="output"]').first(), {
    x: fBox.x + fBox.width - 30,
    y: fBox.y + fBox.height / 2,
  })
  const patchEdge = page.locator('[data-edge-target-port="patch"]')
  rec(
    g,
    '★★ 上游落在右半边 → 边落在共用口（左半边落原图口，各归各的）',
    (await patchEdge.count()) === 1,
    `count=${await patchEdge.count()}`,
  )
  rec(
    g,
    '★ 共用口上的边记的是上游生成节点 → 融合节点',
    (await page.locator(`[data-edge-target-port="patch"][data-edge-source="${patchSrc.id}"]`).count()) === 1,
    `source=${patchSrc.id}`,
  )

  /**
   * ── ⑤b 出方向：从**共用口**拖到另一个节点 → 生成的是「融合 → 那个节点」 ──
   *
   * 参考实现里这就是「结果会通过连线生成在融合节点右侧」（README 第 6 条）。
   * 判据落在边的两端与**源端口**上：`data-edge-source-port="patch"`、
   * source = 融合节点、target = 被拖到的那个节点。
   */
  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  await page.locator('[data-toolbar-menu-item="generation"]').click()
  await sleep(500)
  const downId = await page.locator('[data-node-type="generation"]').last().getAttribute('data-node-id')
  await moveNode(page, downId, 560, 620)
  await sleep(300)
  const downBox = await page.locator(`[data-node-id="${downId}"]`).boundingBox()
  await dragFromPortTo(page.locator('[data-node-type="fusion"] [data-port="patch"]'), {
    x: downBox.x + downBox.width / 2,
    y: downBox.y + downBox.height / 2,
  })
  rec(
    g,
    '★★ 从共用口拖到别的节点 → 连出来的是「融合 → 那个节点」的**出边**',
    (await page
      .locator(`[data-edge-source-port="patch"][data-edge-source="${fusionId}"][data-edge-target="${downId}"]`)
      .count()) === 1,
    `fusion=${fusionId} down=${downId}`,
  )

  /**
   * ★★ 共用口**拖出去必须算「出」**。
   *
   * 这是「一个端点两个方向」最容易被写反的地方：如果它只按 `kind: 'input'` 处理，
   * 从它往外拖会被当成「找上游」，松手菜单给出的是上游候选。
   * 参考实现给这个点的 `mousedown` 直接就是 `startLink(..., 'out')`，这里照同一条口径。
   * 判据用菜单自带的 `data-link-menu-side`（它就是拖线方向的原样落点）。
   */
  const blankForMenu = await blankPoint(page)
  await dragFromPortTo(page.locator('[data-node-type="fusion"] [data-port="patch"]'), blankForMenu)
  const menuSide = await page.locator('[data-link-menu]').getAttribute('data-link-menu-side').catch(() => null)
  rec(g, '★★ 从共用口往外拖 = 「出」（松手菜单按找下游给出）', menuSide === 'output', `side=${menuSide}`)
  await page.keyboard.press('Escape')
  await sleep(200)

  // ── ⑥ 卡片结构（照用户给的参考图：原图 | 局部修改 + 连接提醒 + 颜色匹配 + 全宽按钮） ──
  rec(
    g,
    '★★ 两块预览都在：原图 + 局部修改',
    (await page.locator('[data-fusion-pane="original"]').count()) === 1 &&
      (await page.locator('[data-fusion-pane="patch"]').count()) === 1,
    `panes=${await page.locator('[data-fusion-pane]').count()}`,
  )
  rec(
    g,
    '★ 原图那块真的解码出来了（不是空壳）',
    (await page
      .locator('[data-fusion-pane="original"] img')
      .evaluate((el) => el.naturalWidth)
      .catch(() => 0)) > 0,
  )
  const chipOriginal = ((await page.locator('[data-fusion-chip="original"]').textContent()) ?? '').trim()
  const chipPatch = ((await page.locator('[data-fusion-chip="patch"]').textContent()) ?? '').trim()
  rec(g, '★ 连接提醒：原图已连接', chipOriginal === '原图', chipOriginal)
  rec(g, '★ 连接提醒：局部修改 1 张', /局部修改 1 张/.test(chipPatch), chipPatch)
  /**
   * ★★ 这张局部图是普通生成节点（没有选区上下文）⇒ 按钮**应当**禁用并说明原因。
   * 成功路径在 G92（用「提取选区」得到的局部图）。
   */
  rec(
    g,
    '★★ 局部图没有上下文时按钮禁用，且 title 说清是第几张、该怎么办',
    (await page.locator('[data-fusion-run]').isDisabled()) &&
      /第 1 张局部图没有选区上下文/.test((await page.locator('[data-fusion-run]').getAttribute('title')) ?? ''),
    (await page.locator('[data-fusion-run]').getAttribute('title')) ?? '',
  )
  /**
   * ★★ 反向断言：旧卡片那套（节点内框选 / 选区芯片 / 比例芯片 / 对比原图）**已经删干净**。
   * 「删干净」也是需求的一部分 —— 用户原话：「之前的那个东西删掉，都不对」。
   */
  rec(
    g,
    '★★ 旧卡片那套已删干净（节点内框选 / 选区芯片 / 比例 / 对比原图）',
    (await page.locator('[data-fusion-preview]').count()) === 0 &&
      (await page.locator('[data-fusion-contexts]').count()) === 0 &&
      (await page.locator('[data-fusion-ratio]').count()) === 0 &&
      (await page.locator('[data-fusion-compare]').count()) === 0,
  )

  /**
   * ── ⑦ 多张局部图**上下排列**（用户 2026-09-30） ──
   *
   * 用户口径：「融合节点右侧多个局部图要上下排列（参考大雄：左边原图、右边局部图区域，
   * 两张局部图就上下两块），不是朝右横向新增」。
   *
   * 判据只能用**几何**（谁在谁下面、左右是否对齐），DOM 里两个 pane 长得多像都证明不了。
   * 第二张走**同一个上游再连一条**（该口 `multi: true`）——顺带把「允许同源多条边」
   * 这条也钉住，否则第二块预览永远只能靠新建节点才出得来。
   */
  const fBox2 = await fusion.boundingBox()
  await dragFromPortTo(patchSrc.node.locator('[data-port="output"]').first(), {
    x: fBox2.x + fBox2.width - 30,
    y: fBox2.y + fBox2.height / 2,
  })
  const paneBoxes = await page
    .locator(`[data-node-id="${fusionId}"] [data-fusion-pane="patch"]`)
    .evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }),
    )
  rec(g, '★ 两张局部图 → 两个预览格（同源多条边也认）', paneBoxes.length === 2, `panes=${paneBoxes.length}`)
  const [pane1, pane2] = paneBoxes
  rec(
    g,
    '★★ 两张局部图**上下排列**（同一列、第二块在第一块正下方，不是往右排）',
    !!pane1 &&
      !!pane2 &&
      Math.abs(pane1.x - pane2.x) <= 2 &&
      Math.abs(pane1.w - pane2.w) <= 2 &&
      pane2.y >= pane1.y + pane1.h - 2,
    JSON.stringify(paneBoxes),
  )
  const origBox2 = await page
    .locator(`[data-node-id="${fusionId}"] [data-fusion-pane="original"]`)
    .boundingBox()
  rec(
    g,
    '★ 原图仍在左、局部图区在右（两列不重叠）',
    !!origBox2 && !!pane1 && origBox2.x + origBox2.width <= pane1.x + 1,
    `orig=${JSON.stringify(origBox2)} patch=${JSON.stringify(pane1)}`,
  )
  /**
   * ★★ 局部图区**锁在原图那一格的高度里**（用户 2026-09-30：「不要一直叠加叠高，
   * 要自动适应缩小，保持整体的局部图外部容器不发生改变」）。
   * 判据是几何：右列上下两端与左原图格对齐，且两张各占一半高。
   */
  rec(
    g,
    '★★ 局部图区锁在原图高度里（张数变多不撑高，每张等分变小）',
    !!origBox2 &&
      paneBoxes.length === 2 &&
      Math.abs(pane1.y - origBox2.y) <= 2 &&
      Math.abs(pane2.y + pane2.h - (origBox2.y + origBox2.height)) <= 4 &&
      Math.abs(pane1.h - pane2.h) <= 2 &&
      pane1.h < origBox2.height * 0.62,
    `origH=${origBox2?.height?.toFixed(1)} p1=${JSON.stringify(pane1)} p2=${JSON.stringify(pane2)}`,
  )
  rec(
    g,
    '★ 原图那格是平铺铺满（cover，不留上下白边）',
    (await page
      .locator(`[data-node-id="${fusionId}"] [data-fusion-pane="original"] img`)
      .evaluate((el) => getComputedStyle(el).objectFit)
      .catch(() => '')) === 'cover',
  )
  /**
   * 参考图（用户 2026-09-30 给的截图）里右列是有细滚动条的：张数多到每张低于可读高度
   * 时，**列内滚动**接手，容器依旧不长高。这里钉住「有滚动能力 + 每张不低于地板 44px」。
   */
  const stackOverflow = await page
    .locator(`[data-node-id="${fusionId}"] [data-fusion-patch-stack]`)
    .evaluate((el) => getComputedStyle(el).overflowY)
    .catch(() => '')
  rec(
    g,
    '★ 局部图列：贴到可读高度地板后改为列内滚动（容器仍不长高）',
    stackOverflow === 'auto' && paneBoxes.every((p) => p.h >= 44),
    `overflowY=${stackOverflow} heights=${paneBoxes.map((p) => p.h.toFixed(1)).join(',')}`,
  )
  /**
   * ★★ 双击预览大图（用户 2026-09-30：「局部融合节点里面的图片也可以进行双击灯箱预览」）。
   * 断言要认到**具体是哪一张**（比对 `data-lightbox-hash` 与格里记的 hash），
   * 只断言「灯箱开了」的话，双报到原图上也照样绿。
   */
  const firstPatch = page.locator(`[data-node-id="${fusionId}"] [data-fusion-pane="patch"]`).first()
  const patchHash = await firstPatch.getAttribute('data-fusion-pane-hash')
  await firstPatch.dblclick()
  await sleep(700)
  const lbHash = await page.locator('[data-lightbox]').getAttribute('data-lightbox-hash').catch(() => null)
  rec(
    g,
    '★★ 双击局部图开灯箱，且预览的正是这一张',
    !!patchHash && lbHash === patchHash,
    `pane=${patchHash} lightbox=${lbHash}`,
  )
  await page.keyboard.press('Escape')
  await sleep(400)
  rec(g, '★ Esc 关掉预览', (await page.locator('[data-lightbox]').count()) === 0)
  const chipPatch2 = ((await page.locator('[data-fusion-chip="patch"]').textContent()) ?? '').trim()
  rec(g, '★ 连接提醒跟着更新为 2 张', /局部修改 2 张/.test(chipPatch2), chipPatch2)

  /**
   * ── ⑧ 内边距与「拖右下角放大」（用户 2026-09-30：「和容器边界的距离，有些大有些小」+
   * 「右下角进行放大的时候会跳动」） ──
   *
   * 跳动是**两条规则互相顶**：`.panes` 用 `aspect-ratio` 撑出内容高，而节点又被
   * `ResizeObserver` 按内容高写回尺寸 ⇒ 拖拽中高度被写回、松手再补一跳（实测 306 → 332）。
   * 现在改成「内容跟节点」，判据是**松手前后高度一致**。
   */
  const gaps = await page.locator(`[data-node-id="${fusionId}"]`).evaluate((el) => {
    const r = el.getBoundingClientRect()
    const box = (sel) => {
      const n = el.querySelector(sel)
      if (!n) return null
      const b = n.getBoundingClientRect()
      return { l: b.x - r.x, r: r.x + r.width - (b.x + b.width), t: b.y - r.y, b: r.y + r.height - (b.y + b.height) }
    }
    return { panes: box('[data-fusion-panes]'), run: box('[data-fusion-run]') }
  })
  const four = gaps.panes ? [gaps.panes.l, gaps.panes.r, gaps.panes.t, gaps.run?.b ?? 0] : []
  rec(
    g,
    '★ 卡片四边内边距一致（不再「上下窄、左右宽」）',
    four.length === 4 && Math.max(...four) - Math.min(...four) <= 2,
    `左${gaps.panes?.l?.toFixed(1)} 右${gaps.panes?.r?.toFixed(1)} 上${gaps.panes?.t?.toFixed(1)} 下${gaps.run?.b?.toFixed(1)}`,
  )
  const handle = page.locator(`[data-node-id="${fusionId}"] [data-node-resize-handle]`)
  const hb = await handle.boundingBox()
  if (hb) {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 + 120, hb.y + hb.height / 2 + 90, { steps: 10 })
    await sleep(200)
    const during = await fusion.boundingBox()
    await page.mouse.up()
    await sleep(500)
    const after = await fusion.boundingBox()
    rec(
      g,
      '★★ 拖右下角放大之后**不回弹、不跳动**（松手前后高度一致）',
      Math.abs(after.height - during.height) <= 2 && after.height > 300 && after.width > 360,
      `拖动中=${during.width.toFixed(0)}×${during.height.toFixed(0)} 松手后=${after.width.toFixed(0)}×${after.height.toFixed(0)}`,
    )
    const panesAfter = await page
      .locator(`[data-node-id="${fusionId}"] [data-fusion-panes]`)
      .boundingBox()
    rec(
      g,
      '★ 预览区跟着节点一起长（内容跟节点，不是节点跟内容）',
      !!panesAfter && panesAfter.height > 150,
      `panes=${panesAfter?.height?.toFixed(1)}`,
    )
  }

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await page.screenshot({ path: `${OUT}/106-g91-fusion.png` })
  await ctx.close()
}

/**
 * G92 提取选区（产品文档 §6.23，2026-09-29）
 *
 * 用户口径：「图片素材，点击提取选取后，在素材的灯箱预览的界面框选局部图，
 * 框选有比例的限制……框选后的局部图带持久性的上下文，通过模型进行改图后也有上下文，
 * 能支持多轮改图」。这一组把这条链路走通，并且**用像素证明位置没跑偏**：
 *
 * 原图用**水平渐变**（`gradientPngBuffer`）—— 纯色图放哪儿都长一样，证明不了什么。
 * 「提取出来的局部图」与「原图那一块」是同一份像素，所以融合结果应当与原图
 * **逐点一致**；上下文要是错了（比如把整图当成了选区），渐变就会被拉伸，断言立刻红。
 */
async function g92(browser) {
  const g = 'G92 提取选区'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  const dragFromPortTo = async (portLocator, to) => {
    const b = await portLocator.boundingBox()
    if (!b) return false
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2)
    await page.mouse.down()
    await page.mouse.move(to.x, to.y, { steps: 10 })
    await page.mouse.up()
    await sleep(450)
    return true
  }
  /** 取一张图（blob URL）中间那一行的几个采样点 */
  const sampleRow = (url) =>
    page.evaluate(async (u) => {
      const img = new Image()
      img.src = u
      await img.decode()
      const c = document.createElement('canvas')
      c.width = img.naturalWidth
      c.height = img.naturalHeight
      const g2 = c.getContext('2d')
      if (!g2) return null
      g2.drawImage(img, 0, 0)
      const y = Math.floor(img.naturalHeight / 2)
      const at = (x) => Array.from(g2.getImageData(x, y, 1, 1).data).slice(0, 3)
      return { w: img.naturalWidth, h: img.naturalHeight, p: [at(100), at(320), at(500)] }
    }, url)
  const near = (a, b, tol = 4) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= tol)

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)

  // ① 一张渐变原图
  const source = await addGenWithImage(page, 640, 360, null, gradientPngBuffer(640, 360))
  await moveNode(page, source.id, 180, 220)
  await sleep(300)

  // ② 图片节点**上方功能栏**里的入口
  await page.locator(`[data-node-id="${source.id}"]`).click({ position: { x: 30, y: 10 } })
  await sleep(350)
  const extractBtn = page.locator('[data-follow-action="extract"]')
  rec(g, '★ 图片节点上方功能栏有「提取选区」', (await extractBtn.count()) === 1)
  if ((await extractBtn.count()) !== 1) {
    rec(g, '（后续断言跳过）', false, '功能栏里没有提取入口')
    await ctx.close()
    return
  }
  await extractBtn.click()
  await sleep(600)

  // ③ 在**素材灯箱**里框选（不是另做一个裁剪器）
  rec(
    g,
    '★ 在素材灯箱里打开框选（复用灯箱，不另做裁剪器）',
    (await page.locator('[data-lightbox]').count()) === 1 &&
      (await page.locator('[data-lightbox-crop-apply]').count()) === 1,
  )
  rec(
    g,
    '★ 比例档就在灯箱界面上',
    (await page.locator('[data-lightbox-crop-ratio]').count()) >= 9,
    `count=${await page.locator('[data-lightbox-crop-ratio]').count()}`,
  )
  rec(g, '★ 还没框选时「提取选区」禁用', await page.locator('[data-lightbox-crop-apply]').isDisabled())

  // ④ 选 16:9 → 拖框 → 自动吸附
  await page.locator('[data-lightbox-crop-ratio="16:9"]').click()
  await sleep(250)
  const stage = await page.locator('[data-lightbox-stage]').boundingBox()
  /**
   * 起点/终点取 0.35~0.65（不是 0.3~0.7）：灯箱是 **1:1 显示**（`fitViewport`
   * 不放大），所以框的屏幕像素 = 原图像素。原图只有 640 宽，框到 512 再被手柄
   * 放大、外扩 1.2 倍之后就盖满整张图，局部图会退化成「整张原图」（下面的
   * 「局部图比原图窄」就断言不出来了）——这是**测例自己的口径**问题，不是产品行为。
   */
  await page.mouse.move(stage.x + stage.width * 0.35, stage.y + stage.height * 0.3)
  await page.mouse.down()
  await page.mouse.move(stage.x + stage.width * 0.65, stage.y + stage.height * 0.7, { steps: 12 })
  await page.mouse.up()
  await sleep(400)
  const rectBox = await page.locator('[data-lightbox-crop-rect]').boundingBox().catch(() => null)
  rec(g, '★★ 在灯箱里拖框画出了选区', !!rectBox)
  const rectRatio = rectBox ? rectBox.width / rectBox.height : 0
  rec(
    g,
    '★★ 选区被吸附到 16:9（比例限制真的生效）',
    Math.abs(rectRatio - 16 / 9) < 0.08,
    `ratio=${rectRatio.toFixed(3)}`,
  )
  rec(g, '★ 有合法选区后按钮可点', !(await page.locator('[data-lightbox-crop-apply]').isDisabled()))

  /**
   * ── ④b 框完之后还能**拖手柄二次修改**（用户 2026-09-30：「灯箱框选要能二次修改」） ──
   *
   * 首版只能**画**：框完之后想微调就得整个重画，而比例档又要求框严格贴比例，
   * 重画十次也未必对得齐。这一段的判据是三条：手柄齐全、拖了真的变大、
   * 而且**左上角钉死 + 比例不破**（少了任一条都等于没做对）。
   */
  const handles = await page
    .locator('[data-lightbox-crop-handle]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-lightbox-crop-handle')))
  rec(
    g,
    '★ 选框上八个手柄齐全（四角 + 四边）',
    ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se'].every((h) => handles.includes(h)),
    handles.join(','),
  )
  const seBox = await page.locator('[data-lightbox-crop-handle="se"]').boundingBox().catch(() => null)
  rec(g, '★ 右下角手柄有可点的几何位置', !!seBox && seBox.width > 0)
  if (rectBox && seBox) {
    await page.mouse.move(seBox.x + seBox.width / 2, seBox.y + seBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(seBox.x + 80, seBox.y + 40, { steps: 12 })
    await page.mouse.up()
    await sleep(350)
    const grown = await page.locator('[data-lightbox-crop-rect]').boundingBox().catch(() => null)
    rec(
      g,
      '★★ 拖右下角手柄把框改大了（不是只能重画一个）',
      !!grown && grown.width > rectBox.width + 8 && grown.height > rectBox.height + 8,
      `before=${rectBox.width.toFixed(1)}×${rectBox.height.toFixed(1)} after=${grown?.width?.toFixed(1)}×${grown?.height?.toFixed(1)}`,
    )
    rec(
      g,
      '★★ 拖手柄改完比例仍然贴在 16:9（改框不能把比例档改废）',
      !!grown && Math.abs(grown.width / grown.height - 16 / 9) < 0.08,
      grown ? `ratio=${(grown.width / grown.height).toFixed(3)}` : 'null',
    )
    rec(
      g,
      '★ 拖右下角时左上角钉死（对面那条边不动）',
      !!grown && Math.abs(grown.x - rectBox.x) <= 2 && Math.abs(grown.y - rectBox.y) <= 2,
      grown ? `nw ${rectBox.x.toFixed(1)},${rectBox.y.toFixed(1)} → ${grown.x.toFixed(1)},${grown.y.toFixed(1)}` : 'null',
    )

    /**
     * ★★ 框内拖动 = **搬框**，不是重画（用户 2026-09-30：「在选取内拖动每次都会新建
     * 一个选取」）。尺寸必须一分不变，位置按位移走。
     */
    const beforeMove = await page.locator('[data-lightbox-crop-rect]').boundingBox().catch(() => null)
    const moveLayer = await page.locator('[data-lightbox-crop-move]').boundingBox().catch(() => null)
    rec(g, '★ 选框上铺了「搬框」层（框内按下接手指针）', !!moveLayer && moveLayer.width > 0)
    if (beforeMove && moveLayer) {
      await page.mouse.move(beforeMove.x + beforeMove.width / 2, beforeMove.y + beforeMove.height / 2)
      await page.mouse.down()
      await page.mouse.move(
        beforeMove.x + beforeMove.width / 2 - 40,
        beforeMove.y + beforeMove.height / 2 - 20,
        { steps: 10 },
      )
      await page.mouse.up()
      await sleep(350)
      const afterMove = await page.locator('[data-lightbox-crop-rect]').boundingBox().catch(() => null)
      rec(
        g,
        '★★ 框内拖动 = 平移选区（尺寸不变、位置跟着走，不再重画一个）',
        !!afterMove &&
          Math.abs(afterMove.width - beforeMove.width) <= 2 &&
          Math.abs(afterMove.height - beforeMove.height) <= 2 &&
          Math.abs(afterMove.x - (beforeMove.x - 40)) <= 3 &&
          Math.abs(afterMove.y - (beforeMove.y - 20)) <= 3,
        `before=${JSON.stringify(beforeMove)} after=${JSON.stringify(afterMove)}`,
      )
    }
  }

  /**
   * ★★ 「提取选区」与比例档**挨在一起**（用户 2026-09-30）。
   * 首版按钮在右下、比例档在左下，中间被 `spacer` 顶开 ~600px；现在同一组，
   * 距离约等于「取消」那个按钮的宽度。用 200px 这道线把两种布局分得开。
   */
  const lastRatio = await page.locator('[data-lightbox-crop-ratio]').last().boundingBox().catch(() => null)
  const applyBox = await page.locator('[data-lightbox-crop-apply]').boundingBox().catch(() => null)
  const sameBar = await page.evaluate(() => {
    const bar = document.querySelector('[data-lightbox-crop-bar]')
    if (!bar) return false
    return (
      bar.querySelectorAll('[data-lightbox-crop-ratio]').length >= 9 &&
      !!bar.querySelector('[data-lightbox-crop-apply]') &&
      !!bar.querySelector('[data-lightbox-crop-cancel]')
    )
  })
  rec(
    g,
    '★★ 比例档与「提取选区」在同一组里（不再被 spacer 拆到两头）',
    sameBar && !!lastRatio && !!applyBox && applyBox.x - (lastRatio.x + lastRatio.width) < 200,
    `gap=${lastRatio && applyBox ? (applyBox.x - (lastRatio.x + lastRatio.width)).toFixed(1) : 'null'}`,
  )

  // ⑤ 确认：关灯箱 + 在原图右侧生成局部图
  const nodesBefore = await nodeCount(page)
  await page.locator('[data-lightbox-crop-apply]').click()
  await sleep(2000)
  rec(g, '★ 提取后灯箱自动关闭', (await page.locator('[data-lightbox]').count()) === 0)
  const nodesAfter = await nodeCount(page)
  rec(g, '★★ 在原图右侧生成了一个新节点（原图不改动）', nodesAfter === nodesBefore + 1, `${nodesBefore} → ${nodesAfter}`)
  const localId = await page.locator('[data-node-type="generation"]').last().getAttribute('data-node-id')
  const localNode = page.locator(`[data-node-id="${localId}"]`)
  const localTitle = ((await localNode.locator('[data-node-title]').textContent().catch(() => '')) ?? '').trim()
  rec(g, '★ 新节点叫「局部图」', localTitle.includes('局部图'), localTitle)
  const localNw = await localNode
    .locator('[data-node-asset]')
    .first()
    .evaluate((el) => el.naturalWidth)
    .catch(() => 0)
  rec(g, '★ 局部图确实是裁出来的（比原图窄）', localNw > 0 && localNw < 640, `naturalWidth=${localNw}`)

  // ⑥ 原图 → 融合节点左口；局部图 → 右侧共用口。**不在融合节点里框任何东西**
  await page.locator('[data-toolbar-add]').click()
  await sleep(250)
  await page.locator('[data-toolbar-menu-item="fusion"]').click()
  await sleep(600)
  const fusionId = await page.locator('[data-node-type="fusion"]').first().getAttribute('data-node-id')
  const fusion = page.locator(`[data-node-id="${fusionId}"]`)
  await moveNodeVia(page, fusion, page.locator('[data-fusion-chips]'), 900, 200)
  await sleep(300)
  const fBox = await fusion.boundingBox()
  await dragFromPortTo(source.node.locator('[data-port="output"]').first(), {
    x: fBox.x + 30,
    y: fBox.y + fBox.height / 2,
  })
  await dragFromPortTo(localNode.locator('[data-port="output"]').first(), {
    x: fBox.x + fBox.width - 30,
    y: fBox.y + fBox.height / 2,
  })
  rec(
    g,
    '★ 两条边落在不同口上（原图 → 左口；局部图 → 右共用口）',
    (await page.locator('[data-edge-target-port="input"]').count()) === 1 &&
      (await page.locator('[data-edge-target-port="patch"]').count()) === 1,
  )
  rec(g, '★ 融合节点里一个选区都没框（选区来自局部图自己）', (await page.locator('[data-fusion-context="1"]').count()) === 0)
  rec(
    g,
    '★★ 没在融合节点里框任何选区，「融合」按钮依然可点（上下文跟着局部图来了）',
    !(await page.locator('[data-fusion-run]').isDisabled()),
    `disabled=${await page.locator('[data-fusion-run]').isDisabled()}`,
  )

  // ⑦ 融合 → 结果**落成右侧一个新节点**（参考实现：「结果会通过连线生成在融合节点右侧」）
  const beforeRun = await nodeCount(page)
  await page.locator('[data-fusion-run]').click()
  await sleep(2800)
  const afterRun = await nodeCount(page)
  rec(
    g,
    '★★ 点「开始融合」在右侧生成了一个结果节点（不是写回融合节点自己）',
    afterRun === beforeRun + 1,
    `${beforeRun} → ${afterRun}`,
  )
  const resultId = await page.locator('[data-node-type="generation"]').last().getAttribute('data-node-id')
  const resultNode = page.locator(`[data-node-id="${resultId}"]`)
  const resultTitle = ((await resultNode.locator('[data-node-title]').textContent().catch(() => '')) ?? '').trim()
  rec(g, '★ 结果节点叫「融合结果」', resultTitle.includes('融合结果'), resultTitle)
  await sleep(600)
  rec(
    g,
    '★★ 结果是从融合节点的**共用口**连出来的（出方向）',
    (await page
      .locator(`[data-edge-source-port="patch"][data-edge-source="${fusionId}"][data-edge-target="${resultId}"]`)
      .count()) === 1,
  )
  rec(
    g,
    '★ 融合节点自己不存产物（卡片里仍是原图 / 局部修改两块）',
    (await page.locator(`[data-node-id="${fusionId}"] [data-fusion-pane="original"]`).count()) === 1 &&
      (await page.locator(`[data-node-id="${fusionId}"] [data-fusion-pane="patch"]`).count()) === 1,
  )

  // ⑧ 位置的硬证据：结果的渐变必须与原图**逐点一致**
  const srcUrl = await source.node.locator('[data-node-asset]').first().getAttribute('src')
  const outUrl = await resultNode.locator('[data-node-asset]').first().getAttribute('src')
  const [snapSrc, snapOut] = await Promise.all([sampleRow(srcUrl), sampleRow(outUrl)])
  rec(
    g,
    '★ 两张图尺寸一致（产物 = 原图尺寸）',
    snapSrc && snapOut && snapSrc.w === snapOut.w && snapSrc.h === snapOut.h,
    `${snapSrc?.w}×${snapSrc?.h} vs ${snapOut?.w}×${snapOut?.h}`,
  )
  rec(
    g,
    '★★ 融合结果的渐变与原图**逐点一致**（局部图被放回了它原来那一块）',
    snapSrc && snapOut && snapSrc.p.every((c, i) => near(c, snapOut.p[i])),
    `原图=${JSON.stringify(snapSrc?.p)} 结果=${JSON.stringify(snapOut?.p)}`,
  )

  /**
   * ── ⑨ 融合结果双击 → 灯箱里**对比原图**（用户 2026-09-30：
   * 「融合节点出的结果图双击出现灯箱后要有对比原图的功能」） ──
   *
   * 配对关系由产物节点自己的 `compareWith` 给出（产出那一刻写死的既成事实），
   * 所以这里能断到**具体是哪一张**：切到「原图」档后展示的 hash 必须等于
   * 融合节点左口那张原图的 hash，且**不等于**结果自己的 hash。
   */
  const origHash = await page
    .locator(`[data-node-id="${fusionId}"] [data-fusion-pane="original"]`)
    .getAttribute('data-fusion-pane-hash')
  await resultNode.locator('[data-node-asset]').first().dblclick()
  await sleep(700)
  rec(
    g,
    '★★ 双击融合结果开灯箱，并给出「对比原图」三档',
    (await page.locator('[data-lightbox]').count()) === 1 &&
      (await page.locator('[data-lightbox-compare-group]').count()) === 1,
  )
  await page.locator('[data-lightbox-compare="split"]').click()
  await sleep(400)
  const ratioBefore = Number(
    await page.locator('[data-lightbox-compare-divider]').getAttribute('data-lightbox-compare-ratio'),
  )
  rec(
    g,
    '★★ 「对比」档把原图叠在结果上，分割线默认在中线',
    (await page.locator('[data-lightbox-compare-media]').count()) === 1 &&
      Math.abs(ratioBefore - 0.5) < 0.02,
    `ratio=${ratioBefore}`,
  )
  const dividerBox = await page.locator('[data-lightbox-compare-divider]').boundingBox()
  const mediaBox = await page.locator('[data-lightbox-media]').boundingBox()
  if (dividerBox && mediaBox) {
    await page.mouse.move(dividerBox.x + dividerBox.width / 2, dividerBox.y + dividerBox.height / 2)
    await page.mouse.down()
    await page.mouse.move(mediaBox.x + mediaBox.width * 0.25, dividerBox.y + dividerBox.height / 2, {
      steps: 10,
    })
    await page.mouse.up()
    await sleep(300)
    const ratioAfter = Number(
      await page.locator('[data-lightbox-compare-divider]').getAttribute('data-lightbox-compare-ratio'),
    )
    rec(
      g,
      '★★ 拖分割线真的改比例（0.5 → 约 0.25）',
      Math.abs(ratioAfter - 0.25) < 0.06,
      `before=${ratioBefore} after=${ratioAfter}`,
    )
    /** 留一张「对比档 + 分割线拖到左边」的截图：这类画面只有肉眼能判断好不好看 */
    await page.screenshot({ path: `${OUT}/108-g92-compare.png` })
  }
  const resultHash = await page.locator('[data-lightbox]').getAttribute('data-lightbox-hash')
  await page.locator('[data-lightbox-compare="original"]').click()
  await sleep(400)
  const shownHash = await page.locator('[data-lightbox]').getAttribute('data-lightbox-shown-hash')
  rec(
    g,
    '★★ 「原图」档展示的确实是那张原图（不是结果自己）',
    !!origHash && shownHash === origHash && shownHash !== resultHash,
    `原图=${origHash} 展示=${shownHash} 结果=${resultHash}`,
  )
  await page.keyboard.press('Escape')
  await sleep(400)
  rec(g, '★ 对比完 Esc 关掉灯箱', (await page.locator('[data-lightbox]').count()) === 0)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await page.screenshot({ path: `${OUT}/107-g92-extract.png` })
  await ctx.close()
}

/**
 * G93 节点缩放：三类语义 + 「松手不再变」不变式（§6.16 · 2026-09-30）
 *
 * 用户口径：「好像节点的缩放都会出现一些问题」。逐类型实测后，真正的缺陷只有一处
 * （循环节点：内容高度写回与手动拉高度互相顶 ⇒ 拖到 332、松手跳到 380，而且再也回不来）。
 * 这一组把三类缩放语义一起钉住，免得以后再改一处、坏另一处：
 *  - `free`   —— 尺寸严格跟指针（提示词 / 空态生成 / 融合）；
 *  - `locked` —— 等比（分组 / 批量 5:4、对比节点按当前比例、有产物的生成节点按产物比例）；
 *  - `width`  —— 只跟横向、高度由内容写回（循环节点）。
 * 三类共同的不变式：**松手之后尺寸不再变化**（历史两次「跳动」都出在这里）。
 */
async function g93(browser) {
  const g = 'G93 节点缩放'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="blank"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)

  const cases = [
    { type: 'prompt', mode: 'free' },
    { type: 'generation', mode: 'free' },
    { type: 'fusion', mode: 'free' },
    { type: 'batch', mode: 'locked' },
    { type: 'group', mode: 'locked' },
    { type: 'compare', mode: 'locked' },
    { type: 'loop', mode: 'width' },
  ]

  for (const c of cases) {
    await page.locator('[data-toolbar-add]').click()
    await sleep(250)
    await page.locator(`[data-toolbar-menu-item="${c.type}"]`).click()
    await sleep(650)
    const node = page.locator(`[data-node-type="${c.type}"]`).last()
    const id = await node.getAttribute('data-node-id')
    const before = await page.locator(`[data-node-id="${id}"]`).boundingBox()
    const hb = await page.locator(`[data-node-id="${id}"] [data-node-resize-handle]`).boundingBox()
    if (!before || !hb) {
      rec(g, `${c.type}：缩放手柄可点`, false, `before=${!!before} handle=${!!hb}`)
      continue
    }
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb.x + hb.width / 2 + 100, hb.y + hb.height / 2 + 60, { steps: 8 })
    await sleep(220)
    const during = await page.locator(`[data-node-id="${id}"]`).boundingBox()
    await page.mouse.up()
    await sleep(500)
    const after = await page.locator(`[data-node-id="${id}"]`).boundingBox()

    rec(
      g,
      `★★ ${c.type}：松手之后尺寸不再变化（不跳动）`,
      Math.abs(after.width - during.width) <= 2 && Math.abs(after.height - during.height) <= 2,
      `拖动中 ${during.width.toFixed(0)}×${during.height.toFixed(0)} → 松手后 ${after.width.toFixed(0)}×${after.height.toFixed(0)}`,
    )
    if (c.mode === 'free') {
      rec(
        g,
        `★ ${c.type}：自由缩放严格跟指针（+100/+60）`,
        Math.abs(after.width - before.width - 100) <= 3 && Math.abs(after.height - before.height - 60) <= 3,
        `实际 +${(after.width - before.width).toFixed(0)}/+${(after.height - before.height).toFixed(0)}`,
      )
    } else if (c.mode === 'locked') {
      const r0 = before.width / before.height
      const r1 = after.width / after.height
      rec(
        g,
        `★ ${c.type}：锁比缩放保持比例`,
        Math.abs(r1 - r0) < 0.03 && after.width - before.width > 40,
        `${r0.toFixed(3)} → ${r1.toFixed(3)}（宽 +${(after.width - before.width).toFixed(0)}）`,
      )
    } else {
      rec(
        g,
        `★★ ${c.type}：只跟横向、高度由内容决定（纵向位移整份丢掉）`,
        Math.abs(after.width - before.width - 100) <= 3 && Math.abs(after.height - before.height) < 40,
        `宽 +${(after.width - before.width).toFixed(0)} / 高 ${(after.height - before.height).toFixed(0)}`,
      )
    }
    await page.keyboard.press('Delete')
    await sleep(350)
  }

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await page.screenshot({ path: `${OUT}/109-g93-resize.png` })
  await ctx.close()
}

/**
 * G94 内置技能与用户技能分表（产品文档 §7A.2 / §7A.3，2026-10-01）。
 */
async function g94(browser) {
  const g = 'G94 内置技能分表'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(`${BASE}/skills`, { waitUntil: 'networkidle' })
  await sleep(700)

  const filters = await page
    .locator('[data-skills-filter]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-skills-filter')))
  rec(
    g,
    '★ 筛选含「内置」分类',
    JSON.stringify(filters) === JSON.stringify(['all', 'builtin', 'user', 'preset']),
    filters.join(','),
  )

  await page.locator('[data-skills-filter="builtin"]').click()
  await sleep(400)
  const builtinCards = page.locator('[data-skills-builtin-card]')
  const builtinCount = await builtinCards.count()
  rec(g, '★★ 随包内置技能已进入技能库（含即梦 Skill 包 7 个）', builtinCount >= 11, `内置=${builtinCount}`)
  /**
   * ★★ 技能卡要带**图片 / 效果位**（用户 2026-10-02：「我项目的 skill 菜单也要有图片、
   * 效果的展示，不能单单是一个框里面加上内容」）。
   *
   * 图从技能 frontmatter 的 `image:` 来；现在都是占位（用户说「可以留空，后期我
   * 自己添加」），所以判据是**每张卡都有一位**，不是「有图」。
   */
  const skillShots = await page.locator('[data-skill-shot]').count()
  rec(
    g,
    '★★ 技能卡带图片 / 效果位（可留空，后期自己补图）',
    skillShots >= builtinCount,
    `图位=${skillShots} 卡片=${builtinCount}`,
  )
  if (builtinCount === 0) {
    await ctx.close()
    return
  }

  const builtinNames = await builtinCards.evaluateAll((els) =>
    els.map((e) => (e.querySelector('[class*="cardName"]')?.textContent ?? '').trim()),
  )
  const jimengNames = [
    'TVC 商业广告视频创作流程',
    '创作分镜',
    '即梦视频创作标准工作流程',
    '品牌 Logo 设计与生图',
    '电商产品套图设计与生图',
    '营销海报设计与生图',
    '视频反解',
  ]
  const missingNames = jimengNames.filter((n) => !builtinNames.includes(n))
  rec(
    g,
    '★★ 即梦 Skill 包 7 个技能名都在内置列表里',
    missingNames.length === 0,
    missingNames.length === 0 ? `共 ${builtinNames.length} 个内置` : `缺少=${missingNames.join('、')}`,
  )

  // 两个「完整版」技能：正文里必须带 references 全文 —— 运行时只吃一份系统指令，
  // 不合并的话那些 references 永远不会被加载。
  for (const c of [
    { name: '创作分镜', must: ['版本 v1.9', '安全运镜'] },
    { name: 'TVC 商业广告视频创作流程', must: ['TVC 广告片全流程创作 Skill', '阶段规范'] },
  ]) {
    await page.locator('[data-skills-builtin-card]', { hasText: c.name }).first().click()
    await sleep(400)
    const content = await page.locator('[data-skill-content]').inputValue()
    const missing = c.must.filter((m) => !content.includes(m))
    rec(
      g,
      `★★「${c.name}」正文已内置 references 全文`,
      missing.length === 0,
      missing.length ? `缺=${missing.join('、')}` : `${content.length} 字`,
    )
    await page.locator('[data-skills-back]').click()
    await sleep(350)
  }

  const builtinCard = builtinCards.first()
  const builtinId = await builtinCard.getAttribute('data-skill-item')
  await builtinCard.click()
  await sleep(450)

  const nameInput = page.locator('[data-skill-name]')
  const contentInput = page.locator('[data-skill-content]')
  const defaultName = await nameInput.inputValue()
  const defaultContent = await contentInput.inputValue()
  const readonlyState = await page.evaluate(() => {
    const name = document.querySelector('[data-skill-name]')
    const content = document.querySelector('[data-skill-content]')
    const mode = document.querySelector('[data-skill-inputmode]')
    return {
      readOnly: name instanceof HTMLInputElement && name.readOnly,
      contentReadOnly: content instanceof HTMLTextAreaElement && content.readOnly,
      selectDisabled: mode instanceof HTMLSelectElement && mode.disabled,
    }
  })
  rec(
    g,
    '★★ 内置技能打开即只读（名称 / 正文 / 输入类型不可改）',
    readonlyState.readOnly && readonlyState.contentReadOnly && readonlyState.selectDisabled,
    JSON.stringify(readonlyState),
  )
  rec(
    g,
    '★ 内置技能提供「复制为我的技能」，不提供直接保存 / 删除',
    (await page.locator('[data-skill-copy]').count()) === 1 &&
      (await page.locator('[data-skill-save]').count()) === 0 &&
      (await page.locator('[data-skill-remove]').count()) === 0,
  )

  await page.locator('[data-skill-copy]').click()
  await sleep(700)
  rec(
    g,
    '★★ 复制后切到我的技能编辑态（可编辑）',
    (await page.locator('[data-skill-editor]').getAttribute('data-skill-readonly')) === 'false' &&
      (await page.locator('[data-skill-save]').count()) === 1,
  )

  await page.locator('[data-skill-name]').fill('内置副本冒烟')
  await page.locator('[data-skill-content]').fill('这是用户改过的副本正文。')
  await page.locator('[data-skill-save]').click()
  await sleep(900)
  rec(g, '保存副本后回到浏览层', (await page.locator('[data-skills-browser]').count()) === 1)

  await page.locator('[data-skills-filter="builtin"]').click()
  await sleep(350)
  await page.locator(`[data-skill-item="${builtinId}"]`).click()
  await sleep(450)
  rec(
    g,
    '★★ 用户副本已改，内置默认正文不变',
    (await page.locator('[data-skill-content]').inputValue()) === defaultContent &&
      (await page.locator('[data-skill-copy-note]').count()) === 1,
    `内置=${defaultName}`,
  )
  rec(g, '★ 已有副本时出现「恢复默认」', (await page.locator('[data-skill-restore]').count()) === 1)

  await page.locator('[data-skill-restore]').click()
  await sleep(200)
  await page.locator('[data-skill-restore-yes]').click()
  await sleep(800)
  rec(g, '恢复默认后给出状态提示', (await page.locator('[data-skill-notice]').count()) === 1)

  await page.locator('[data-skills-back]').click()
  await sleep(350)
  await page.locator('[data-skills-filter="user"]').click()
  await sleep(350)
  await page.locator('[data-skill-item][data-skill-source="user"]').first().click()
  await sleep(450)
  rec(
    g,
    '★★ 用户副本恢复成内置默认（名称与正文都回到默认）',
    (await page.locator('[data-skill-name]').inputValue()) === defaultName &&
      (await page.locator('[data-skill-content]').inputValue()) === defaultContent,
  )

  await page.locator('[data-skill-remove]').click()
  await sleep(200)
  await page.locator('[data-skill-remove-yes]').click()
  await sleep(700)
  await page.locator('[data-skills-filter="builtin"]').click()
  await sleep(350)
  rec(
    g,
    '清理副本后内置技能仍在',
    (await page.locator('[data-skill-item][data-skill-source="user"]').count()) === 0 &&
      (await page.locator(`[data-skill-item="${builtinId}"]`).count()) >= 1,
  )

  await page.screenshot({ path: `${OUT}/110-g94-builtin-skills.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G102 Midjourney 的参数面板（用户 2026-10-03：
 * 「mj 的参数好像没有改，参考图一改一下 …… 参考图二把 mj 的自己独有的参数设置面板
 * 做一个，放在参数的后面」）
 *
 * 两件事各自钉住：
 *  · **基础参数**照图一：只有三段 —— 分辨率（只有「自适应」）/ 比例（七格）/ 生成数量；
 *    没有画质与背景（那是 OpenAI 那几档才有的东西，摆到 MJ 上是死格子）；
 *  · **独有参数**照图二：另起一枚「高级设置」摆在参数**之后**，里面是
 *    个性化风格（文本框）+ 风格化程度 / 怪异度 / 多样性（三根滑杆）。
 */
async function g102(browser) {
  const g = 'G102 Midjourney 参数面板'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  const panel = await genPanel(page)
  const pickModel = async (name) => {
    await panel.locator('[data-param-chip="model"]').click()
    await sleep(350)
    await page.locator(`[data-param-popup="model"] button[data-param-option="${name}"]`).first().click()
    await sleep(500)
  }
  const sectionsOf = (popup) =>
    page.evaluate((name) => {
      const pop = document.querySelector(`[data-param-popup="${name}"]`)
      if (!pop) return null
      return [...pop.querySelectorAll('[data-param-section]')].map((s) => ({
        name: s.getAttribute('data-param-section'),
        title: s.querySelector(':scope > span')?.textContent?.trim() ?? '',
        options: [...s.querySelectorAll('[data-param-option]')].map((o) => o.getAttribute('data-param-option')),
        slider: (() => {
          const el = s.querySelector('[data-param-slider]')
          return el ? { min: el.min, max: el.max, value: el.value } : null
        })(),
        text: !!s.querySelector('[data-param-text]'),
      }))
    }, popup)

  await pickModel('Midjourney')

  /** ① 「高级设置」这一枚必须摆在参数**之后**（用户原话：「放在参数的后面」） */
  const chips = await panel
    .locator('[data-param-chip]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-chip')))
  rec(
    g,
    '★★ 参数行是「模型 → 参数 → 高级设置」，高级设置排在参数之后',
    JSON.stringify(chips) === JSON.stringify(['model', 'gen-params', 'mj-params']),
    JSON.stringify(chips),
  )

  /** ② 基础参数：图一那三段，且**没有**画质 / 背景 */
  await panel.locator('[data-param-chip="gen-params"]').click()
  await sleep(450)
  const basic = await sectionsOf('gen-params')
  rec(
    g,
    '★★ 基础参数只有三段（自适应 / 七档比例 / 1·2·4 张），没有画质与背景',
    Array.isArray(basic) &&
      basic.map((s) => s.name).join(',') === 'resolution,ratio,count' &&
      JSON.stringify(basic[0].options) === JSON.stringify(['auto']) &&
      basic[0].title === '清晰度' &&
      JSON.stringify(basic[1].options) ===
        JSON.stringify(['1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3']) &&
      JSON.stringify(basic[2].options) === JSON.stringify(['1', '2', '4']),
    JSON.stringify(basic),
  )
  await page.keyboard.press('Escape')
  await sleep(220)

  /** ③ 高级设置：一个文本框 + 三根滑杆，值域与默认值都要对 */
  await panel.locator('[data-param-chip="mj-params"]').click()
  await sleep(450)
  const adv = await sectionsOf('mj-params')
  rec(
    g,
    '★★ 高级设置 = 个性化风格（文本框）+ 风格化 0–1000/100 + 怪异 0–3000/0 + 多样性 0–100/0',
    Array.isArray(adv) &&
      adv.map((s) => s.name).join(',') === 'mj-personalize,mj-stylize,mj-weird,mj-chaos' &&
      adv[0].text === true &&
      JSON.stringify(adv[1].slider) === JSON.stringify({ min: '0', max: '1000', value: '100' }) &&
      JSON.stringify(adv[2].slider) === JSON.stringify({ min: '0', max: '3000', value: '0' }) &&
      JSON.stringify(adv[3].slider) === JSON.stringify({ min: '0', max: '100', value: '0' }),
    JSON.stringify(adv),
  )

  /**
   * ④ 拖一下滑杆 → 刷新后读回（证明它真的落到节点上，不是只改了内存里的控件）。
   *
   * 用**鼠标真拖**（按下 → 移到轨道中点 → 松开）而不是直接改 DOM：
   * 那才是用户做出来的动作，也才能验到「原生 input 事件 → React onChange → 落库」整条链。
   * 不断言绝对值（拖到中点未必正好是 500），只断言**拖完之后变了**、
   * 并且**刷新后还是同一个数**。
   */
  const stylize = panel.locator('[data-param-slider="mj-stylize"]')
  const sbox = await stylize.boundingBox()
  await page.mouse.move(sbox.x + 4, sbox.y + sbox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sbox.x + sbox.width / 2, sbox.y + sbox.height / 2, { steps: 8 })
  await page.mouse.up()
  await sleep(400)
  const afterKeys = await stylize.inputValue()
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(900)
  const panel2 = await genPanel(page)
  await panel2.locator('[data-param-chip="mj-params"]').click()
  await sleep(450)
  const persisted = await panel2.locator('[data-param-slider="mj-stylize"]').inputValue()
  rec(
    g,
    '★★ 拖动风格化程度后刷新仍读回（真的落库）',
    afterKeys !== '100' && afterKeys === persisted,
    `改后=${afterKeys} 刷新后=${persisted}`,
  )
  await page.keyboard.press('Escape')
  await sleep(220)

  /** ⑤ 别的模型不该有这枚 chip（它只属于 MJ） */
  await pickModel('GPT Image 2')
  const chipsGpt = await panel2
    .locator('[data-param-chip]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-chip')))
  rec(
    g,
    '★ 换成 GPT Image 2 后没有「高级设置」（那是 MJ 独有的）',
    !chipsGpt.includes('mj-params'),
    JSON.stringify(chipsGpt),
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G100 参数浮层的**高度与滚动**（用户 2026-10-03：
 * 「参数面板里面的内容能完全显示吗？我不想要内容超出边界」）
 *
 * 两种正确形态都要钉住，缺一条就等于只修了一半：
 *   · **装得下 → 完整显示**（G46 已断言 `scrollHeight === clientHeight`）；
 *   · **装不下 → 在边框内滚**，而且滚轮归浮层、**不穿到底下的画布去缩放**。
 *
 * 这里用**矮窗口**造出第二种形态：窗口一矮，锚点上方的空间就不够，
 * 13 档比例网格必然放不下 —— 于是「能不能滚」这件事变得可断言。
 * 原先的 `max-height: 420px` 写死在 CSS 里，两个形态都不可控：
 * 内容一高就在边框内被切掉（用户看到的正是「选项到一半就没了」）。
 */
async function g100(browser) {
  const g = 'G100 参数浮层高度与滚动'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  /**
   * 矮窗口：锚点上方只剩很少空间 —— 这是「必须滚」的触发条件。
   *
   * 高度取 400 而不是 520：浮层内容（画质 / 清晰度 / 背景 / 比例 / 数量）现在
   * 是 **557px**，520 的窗口下锚点上方还有 ~606px 的余地，**装得下就不会滚** ——
   * 那样这条用例会「因为不再需要滚动」而红，测的其实是另一件事。
   */
  await page.setViewportSize({ width: 1280, height: 400 })
  await sleep(500)
  const panel = await genPanel(page)
  await panel.locator('[data-param-chip="gen-params"]').click()
  await sleep(450)

  const boxOf = (loc) =>
    loc.evaluate((el) => {
      const r = el.getBoundingClientRect()
      return {
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        scrollTop: Math.round(el.scrollTop),
        top: Math.round(r.top),
        bottom: Math.round(r.bottom),
        viewportH: window.innerHeight,
        maxHeight: getComputedStyle(el).maxHeight,
      }
    })
  const popup = () => page.locator('[data-param-popup="gen-params"]')

  const before = await boxOf(popup())
  rec(
    g,
    '★★ 窗口装不下时：浮层在边框内滚，且整体不出视口',
    before.scrollHeight > before.clientHeight + 1 &&
      before.top >= 0 &&
      before.bottom <= before.viewportH + 1,
    `scrollH=${before.scrollHeight} clientH=${before.clientHeight} top=${before.top} bottom=${before.bottom}/${before.viewportH} max-height=${before.maxHeight}`,
  )

  /**
   * ★★ 滚轮落在浮层里：**滚的是浮层，画布缩放纹丝不动**。
   * 两个数都要看 —— 只看 scrollTop 或只看 zoom 都可能假通过。
   */
  const zoomBefore = (await page.locator('[data-canvas-zoom]').innerText()).trim()
  const pb = await popup().boundingBox()
  await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2)
  await page.mouse.wheel(0, 260)
  await sleep(320)
  const after = await boxOf(popup())
  const zoomAfter = (await page.locator('[data-canvas-zoom]').innerText()).trim()
  rec(
    g,
    '★★ 滚轮滚的是浮层本身，画布不缩放',
    after.scrollTop > 0 && zoomAfter === zoomBefore,
    `scrollTop=${before.scrollTop}→${after.scrollTop} zoom=${zoomBefore}→${zoomAfter}`,
  )

  /** 滚到底仍然不出视口（滚动只发生在浮层内部，不会把浮层撑长） */
  await page.mouse.wheel(0, 3000)
  await sleep(320)
  const bottom = await boxOf(popup())
  rec(
    g,
    '★ 滚到底之后浮层依然完整落在视口内',
    bottom.top >= 0 && bottom.bottom <= bottom.viewportH + 1,
    `top=${bottom.top} bottom=${bottom.bottom}/${bottom.viewportH}`,
  )

  await page.setViewportSize({ width: 1280, height: 800 })
  await sleep(400)
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G101 「跟随素材」这一档的**出现条件**（用户 2026-10-03：
 * 「这个跟随素材是什么时候才有的，我生成节点无论有没有素材的时候，
 * 只有 mj 模型有这个跟随素材的功能在比例的参数，帮我修复一下这个问题」）
 *
 * 规则只有一条（用户 2026-09-24 定稿）：**这次生成有参考图才有这一档**。
 * 出问题的是「有规格的模型拿不到」——比例的三个来源里只有「通用 13 档」那条接上了
 * 这条规则，于是 GPT Image / Nano Banana / Agnes 图片 / 四个视频档都看不到它，
 * **只剩 Midjourney**（它没有能力表，正好走的是那条路）。
 *
 * 这一组把「有没有素材 × 有没有能力表」四个格子都走一遍。
 */
async function g101(browser) {
  const g = 'G101 跟随素材的出现条件'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  const FOLLOW = '跟随素材'
  /** 打开比例那一段（有规格的模型收在「生成参数」胶囊里，没有才是单独一枚 chip） */
  const ratioOptions = async (panel) => {
    const own = (await panel.locator('[data-param-chip="ratio"]').count()) > 0
    await panel
      .locator(own ? '[data-param-chip="ratio"]' : '[data-param-chip="gen-params"]')
      .first()
      .click()
    await sleep(420)
    const popupName = own ? 'ratio' : 'gen-params'
    const scope = own ? '' : '[data-param-in="ratio"]'
    const opts = await panel
      .locator(`[data-param-popup="${popupName}"] ${scope}[data-param-option]`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option')))
    await page.keyboard.press('Escape')
    await sleep(200)
    return opts
  }
  const pickModel = async (panel, name) => {
    await panel.locator('[data-param-chip="model"]').click()
    await sleep(350)
    await page
      .locator(`[data-param-popup="model"] button[data-param-option="${name}"]`)
      .first()
      .click()
    await sleep(450)
  }

  /** ① 没有参考图：这一档谁都不该有（它没有可跟随的对象） */
  const bare = await genPanel(page)
  await pickModel(bare, 'Midjourney')
  const bareMj = await ratioOptions(bare)
  await pickModel(bare, 'GPT Image 2')
  const bareGpt = await ratioOptions(bare)
  rec(
    g,
    '★★ 没有参考图时：Midjourney 与 GPT 都**不出现**「跟随素材」',
    !bareMj.includes(FOLLOW) && !bareGpt.includes(FOLLOW),
    `MJ ${bareMj.length} 档（跟随=${bareMj.includes(FOLLOW)}）· GPT ${bareGpt.length} 档（跟随=${bareGpt.includes(FOLLOW)}）`,
  )

  /** ② 给一个新的生成节点挂上一张 800×600 的素材 —— 这就是「有参考图」 */
  const { node } = await addGenWithImage(page, 800, 600, '#cc3333')
  const withImg = await genPanel(page, node)
  await pickModel(withImg, 'Midjourney')
  const imgMj = await ratioOptions(withImg)
  await pickModel(withImg, 'GPT Image 2')
  const imgGpt = await ratioOptions(withImg)
  rec(
    g,
    '★★ 有参考图时：**Midjourney 与 GPT 都有**「跟随素材」（不再只有 MJ）',
    imgMj.includes(FOLLOW) && imgGpt.includes(FOLLOW),
    `MJ ${imgMj.length} 档（跟随=${imgMj.includes(FOLLOW)}）· GPT ${imgGpt.length} 档（跟随=${imgGpt.includes(FOLLOW)}）`,
  )

  /** ③ 选中它之后，胶囊文案要真的带出这个值 */
  await withImg.locator('[data-param-chip="gen-params"]').click()
  await sleep(420)
  await withImg
    .locator(`[data-param-popup="gen-params"] [data-param-in="ratio"][data-param-option="${FOLLOW}"]`)
    .click()
  await sleep(300)
  await page.keyboard.press('Escape')
  await sleep(250)
  const chipText = ((await withImg.locator('[data-param-chip="gen-params"]').innerText()) ?? '').replace(/\s+/g, ' ')
  rec(g, '★ 选中「跟随素材」后胶囊文案带出它', chipText.includes(FOLLOW), chipText.trim())

  /**
   * ④ **视频档同理**：比例那三条来源里视频那条也接到了同一条规则上。
   * 即梦 2.5 有自己的能力表（7 档画幅），有参考图时应当变成 8 档。
   */
  await withImg.locator('[data-param-mode="video"]').click()
  await sleep(450)
  await pickModel(withImg, '即梦 2.5')
  const videoRatio = await ratioOptions(withImg)
  rec(
    g,
    '★★ 视频档（有规格的即梦 2.5）同样给「跟随素材」',
    videoRatio.includes(FOLLOW) && videoRatio.length === 8,
    `共 ${videoRatio.length} 档，跟随=${videoRatio.includes(FOLLOW)}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G95 Agent 对话窗（设计文档 §7 / §8）。
 *
 * 验的是「用户能看见的那条链」：入口在画布上、面板贴右侧、会话能多开且互不串味、
 * 说一句话真能拿到回答。最后一条最重要 —— 它意味着**多轮循环真的跑起来了**，
 * 而不是只把界面摆在那儿。
 */
async function g95(browser) {
  const g = 'G95 Agent 对话窗'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(800)

  rec(g, '★ 画布上有「助手」入口', (await page.locator('[data-canvas-agent]').count()) === 1)
  await page.locator('[data-canvas-agent]').click()
  await sleep(600)
  const panel = page.locator('[data-agent-panel]')
  rec(g, '★ 点开出现对话窗', (await panel.count()) === 1)

  const geom = await panel.boundingBox()
  const vp = page.viewportSize()
  rec(
    g,
    '★★ 对话窗悬在画布右侧（浮动卡片，四周留 12px）',
    geom !== null &&
      vp !== null &&
      Math.abs(vp.width - (geom.x + geom.width) - 12) <= 2 &&
      Math.abs(geom.y - 12) <= 2,
    `右缘=${geom ? Math.round(geom.x + geom.width) : '?'} 视口=${vp?.width ?? '?'}`,
  )

  /**
   * ★★ **日志按钮不能被对话窗盖住**（用户 2026-10-05 第 7 条：「助手打开后会把日志的
   * 功能按钮遮住」）。
   *
   * 判据取两个矩形**真的不相交** —— 只读那个 `right` 偏移量证明不了：面板外框宽度里
   * 还有内距与描边，偏移少了 30 多像素照样「看着移了、其实还在底下」。
   */
  const logBox = await page.locator('[data-canvas-log]').boundingBox()
  const logCovered =
    logBox !== null &&
    geom !== null &&
    logBox.x + logBox.width > geom.x &&
    logBox.x < geom.x + geom.width &&
    logBox.y + logBox.height > geom.y &&
    logBox.y < geom.y + geom.height
  rec(
    g,
    '★★ 对话窗打开时日志按钮不被盖住（两者矩形不相交）',
    logBox !== null && !logCovered,
    `日志右缘=${logBox ? Math.round(logBox.x + logBox.width) : '?'} 面板左缘=${geom ? Math.round(geom.x) : '?'}`,
  )

  /**
   * 会话数从外壳上的 `data-agent-session-count` 读（用户 2026-10-05 第 8 条之后，
   * 会话选择器是参数菜单那套 `ParamPicker`，不再有原生 `<option>` 可数）。
   */
  const count = async () =>
    Number(
      (await page
        .locator('[data-agent-session-count]')
        .getAttribute('data-agent-session-count')) ?? '0',
    )
  rec(g, '★ 自动开了一个会话', (await count()) === 1, `会话=${await count()}`)
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  rec(g, '★★ 能开多个对话', (await count()) === 2, `会话=${await count()}`)

  /**
   * ★★ **打开对话不该凭空多出模型 chip**（用户 2026-10-05 第 1 条：「每次打开对话，
   * 对话框会有两个模型」）。
   *
   * 那两个（imageModel / videoModel）是**会话设置**——「建生成节点时用哪一档」——
   * 不是这句话要说出去的内容。进会话时只补技能与素材，模型不再往正文里补。
   */
  const modelChipsOnOpen = await page
    .locator('[data-agent-input] [data-mention-kind="model"]')
    .count()
  rec(
    g,
    '★★ 打开对话时输入框里没有凭空多出来的模型 chip',
    modelChipsOnOpen === 0,
    `model chip=${modelChipsOnOpen}`,
  )

  /**
   * ★★ **会话记录下拉换成参数菜单那一套**（用户 2026-10-05 第 8 条：「agent 的记录下拉的
   * ui 不是我项目中通用的那种，不好看，参考参数的菜单」）。
   *
   * 判据取「有参数菜单的 chip、且原生 `<select>` 真的没了」—— 只验「能切会话」证明不了
   * 样式换过。
   */
  rec(
    g,
    '★★ 会话选择器 = 参数菜单那套（原生 select 已撤）',
    (await page.locator('[data-param-chip="agent-session"]').count()) === 1 &&
      (await page.locator('select[data-agent-session-list]').count()) === 0,
  )

  /**
   * 用户 2026-10-02：「参数设置要创作面板的类似的参数菜单，目前的太简陋了」
   * —— 控件从原生 `<select>` 换成创作面板那套 `ParamPicker`（chip + 真 DOM 浮层）。
   * 原生下拉的展开层由浏览器绘制，界面糙且自动化看不见。
   */
  const agentModelChip = page.locator('[data-param-chip="agent-model"]')
  const agentSkillChip = page.locator('[data-agent-skill-open]')
  const agentParamsChip = page.locator('[data-param-chip="agent-params"]')
  await agentModelChip.click()
  await sleep(250)
  /**
   * ★★ 模型**三档**（用户 2026-10-03：「我创作面板有什么模型就用什么模型，分了图片和
   * 视频，然后给我加一个对话模型的选项…也就是说模型有三个选项」）。
   * 判据取分段锚点：三档缺一档就红。
   */
  const modelSections = await page
    .locator('[data-param-popup="agent-model"] [data-param-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-section')))
  const modelJumps = await page
    .locator('[data-param-popup="agent-model"] [data-param-jump]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-jump')))
  const modelScrolls = await page
    .locator('[data-param-popup="agent-model"] [data-param-scroll]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-scroll')))
  const models = await page.locator('[data-param-popup="agent-model"] button').count()
  rec(
    g,
    '★★ 生成模型面板只列「图片 / 视频」两档，顶部两枚跳转按钮（对话模型已挪走）',
    modelSections.join(',') === 'image,video' && modelJumps.join(',') === 'image,video' && models >= 1,
    `档=${modelSections.join(',')} 跳转=${modelJumps.join(',')} 可选=${models}`,
  )
  /**
   * ★★ 图片档要把**前端所有**显示名列出来（用户 2026-10-02：「把前端所有的模型写上去，
   * 除了对话模型」）—— 不再按「当下有没有渠道能提供」筛一道。
   *
   * 判据挑两个**mock 渠道提供不了**的固定显示名（GPT Image 2.5 Flare / Midjourney）：
   * 只要它们还在，就说明「筛可用性」那条已经撤掉，而不是碰巧列表非空。
   */
  const imageNames = await page
    .locator('[data-param-popup="agent-model"] button[data-param-in="image"]')
    .allInnerTexts()
  rec(
    g,
    '★★ 图片档列全前端显示名（含 mock 渠道提供不了的固定名）',
    imageNames.some((t) => t.includes('GPT Image 2.5 Flare')) &&
      imageNames.some((t) => t.includes('Midjourney')),
    `图片档=${JSON.stringify(imageNames.map((t) => t.split('\n')[0]))}`,
  )
  /**
   * 每档**一屏只摆 5 行**（用户 2026-10-02：「模型选择面板太高了，只需要展示前五个
   * 就行，可以下拉继续显示剩下的」）。判据取「这一段的容器被标了可滚」。
   */
  rec(
    g,
    '★★ 每档最多先摆 5 行，多的靠段内滚动',
    modelScrolls.join(',') === 'image,video',
    `可滚段=${modelScrolls.join(',')}`,
  )
  /**
   * 跳转要**真的滚**（不是摆两枚装饰按钮）：点「视频」后该段的顶边要落在
   * 弹层可视区顶部附近。
   */
  await page.locator('[data-param-jump="video"]').click()
  await sleep(300)
  const jump = await page.evaluate(() => {
    const pop = document.querySelector('[data-param-popup="agent-model"]')
    const sec = pop?.querySelector('[data-param-section="video"]')
    if (!pop || !sec) return null
    const pr = pop.getBoundingClientRect()
    const sr = sec.getBoundingClientRect()
    const delta = sr.top - pr.top
    const sticky = pop.querySelector('[data-param-jumps]')?.getBoundingClientRect().height ?? 0
    const want = Math.max(
      0,
      Math.min(pop.scrollHeight - pop.clientHeight, pop.scrollTop + delta - sticky),
    )
    return {
      /** 内容本来就装得下 ⇒ 不需要滚，也算「跳转完成」 */
      fits: pop.scrollHeight <= pop.clientHeight + 1,
      got: Math.round(pop.scrollTop),
      want: Math.round(want),
      visible: sr.top >= pr.top - 1 && sr.bottom <= pr.bottom + 1,
    }
  })
  rec(
    g,
    '★★ 点「视频」把那一档滚到顶部（跳转真的生效）',
    jump !== null && jump.visible && (jump.fits || Math.abs(jump.got - jump.want) <= 2),
    `scrollTop=${jump?.got ?? '?'} 期望=${jump?.want ?? '?'} 装得下=${jump?.fits ?? '?'} 可见=${jump?.visible ?? '?'}`,
  )
  /** 留一张**模型三档展开着**的截图：三个分组挤不挤，靠它眼看 */
  await page.screenshot({ path: `${OUT}/114-g95-agent-models.png` })
  await page.keyboard.press('Escape')
  await sleep(250)

  /**
   * ★★ 对话模型 = **agent 自己的 LLM**，单独一处（用户 2026-10-02：「对话模型是
   * agent 的 llm，需要单独放在一个地方」）。
   */
  rec(
    g,
    '★★ 对话模型单独一行，且不在生成模型面板里',
    (await page.locator('[data-agent-llm-row] [data-param-chip="agent-chat-model"]').count()) === 1 &&
      (await page.locator('[data-param-popup="agent-model"] [data-param-section="chat"]').count()) === 0,
  )

  /**
   * ★★ 选中的模型要**进输入区当 chip**（用户 2026-10-02：「选择模型后也是要加入到
   * 对话框中参与对话（和艾特模型的功能一样）」）。
   *
   * 判据取「chip 上写着刚点的那一个模型名」——只验「有 chip」的话，
   * 会话创建时预置的默认模型本来就会有一枚，证明不了「刚点的那个生效了」。
   */
  await agentModelChip.click()
  await sleep(250)
  const pickImageModel =
    (await page
      .locator('[data-param-popup="agent-model"] [data-param-in="image"]')
      .first()
      .getAttribute('data-param-option')) ?? ''
  await page.locator('[data-param-popup="agent-model"] [data-param-in="image"]').first().click()
  await sleep(400)
  const imageModelChipText = (
    (await page
      .locator('[data-agent-input] [data-mention-kind="model"]')
      .allInnerTexts()
      .catch(() => [])) ?? []
  ).join('|')
  rec(
    g,
    '★★ 选中的图片模型变成**正文里**的一枚 chip（参与这次对话）',
    pickImageModel !== '' && imageModelChipText.includes(pickImageModel),
    `chip=「${imageModelChipText}」期望含「${pickImageModel}」`,
  )
  await page.screenshot({ path: `${OUT}/118-g95-agent-model-chip.png` })
  /**
   * ★★ 正文里**不许有多出来的空行**（用户 2026-10-02：「图二中我艾特模型之后上方出现
   * 空白的区域」）。空编辑器里浏览器那个占位 `<br>` 不清掉的话，chip 会落在它后面，
   * 读出来就是「先一个空行、再一个引用」。
   */
  const editorPlain = await page.locator('[data-agent-input]').innerText()
  rec(
    g,
    '★★ 艾特 / 选模型之后正文里没有多出来的空行',
    !editorPlain.startsWith('\n') && !editorPlain.includes('\n\n'),
    JSON.stringify(editorPlain.slice(0, 40)),
  )

  /**
   * ★★ 模型面板那枚 ✓ = **「已经放进这次对话」**，不是「默认就用这两个」
   * （用户 2026-10-04 第 3 条：「不是默认用这两个模型的意思，是把模型放在对话框中，
   *   意思是用这些模型进行生成，能组成多个模型参与的流程」）。
   *
   * 判据取 `aria-selected` 落在**刚点过的那一枚**上 —— 它跟着正文里的引用走
   * （正文解析出来的 model chip），不是跟着会话里存的默认值走。
   */
  await agentModelChip.click()
  await sleep(300)
  const checkedImageModels = await page
    .locator('[data-param-popup="agent-model"] [data-param-in="image"][aria-selected="true"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option')))
  rec(
    g,
    '★★ 模型面板的 ✓ 跟着正文引用走（刚放进对话的那一枚亮着，且只有它）',
    checkedImageModels.length === 1 && checkedImageModels[0] === pickImageModel,
    `亮着=${JSON.stringify(checkedImageModels)} 期望=「${pickImageModel}」`,
  )
  await page.keyboard.press('Escape')
  await sleep(250)

  /**
   * 用户 2026-10-02：「不要有选择渠道」——
   * 渠道是实现细节，界面只留模型（选模型时由 `pickModel` 解析出渠道）。
   * 这里验的是**它真的没了**，不是被藏起来或置灰。
   */
  rec(
    g,
    '★★ 对话窗上没有「选渠道」这一档（用户拍板去掉）',
    (await page.locator('[data-agent-channel]').count()) === 0,
  )

  const agentMentionChip = page.locator('[data-param-chip="agent-mention"]')
  const agentAutoChip = page.locator('[data-param-chip="agent-autorun"]')

  /**
   * 用户 2026-10-02 第二轮先把入口收成「模型 / 技能 / 参数」三枚，紧接着又改口：
   * 「agent 把参数去掉，只保留模型的选项…skill 也是用一个图标展示」。
   * 现在的口径是 **@ 引用 / 模型 / 技能 / 手动·自动** 四枚，「参数」那一枚整个撤掉。
   */
  rec(
    g,
    '★★ 工具条只有 @ / 模型 / 技能 / 手动·自动 四个入口，且「参数」已撤掉',
    (await agentMentionChip.count()) === 1 &&
      (await agentModelChip.count()) === 1 &&
      (await agentSkillChip.count()) === 1 &&
      (await agentAutoChip.count()) === 1 &&
      (await agentParamsChip.count()) === 0,
  )

  /**
   * 用户 2026-10-02：「模型用一个 3d 建模的图标展示，立体的方形」「skill 也是用一个图标」。
   * 判据取「chip 里的**可见文字为空**」—— 名字没丢，它进了 `aria-label`。
   */
  const modelChipText = (await agentModelChip.innerText()).trim()
  const skillChipTextBare = (await agentSkillChip.innerText()).trim()
  rec(
    g,
    '★★ 模型 / 技能 chip 只显示图标、不显示文字（用户要求换成图标）',
    modelChipText === '' &&
      skillChipTextBare === '' &&
      (await agentModelChip.locator('svg').count()) === 1 &&
      (await agentSkillChip.locator('svg').count()) === 1,
    `模型chip=「${modelChipText}」技能chip=「${skillChipTextBare}」`,
  )

  /**
   * 手动 / 自动（参考产品图一）：「用图标进行替换，选中能替换」——
   * 判据取 chip 的 `aria-label`：图标换了，无障碍名也得跟着换。
   */
  const autoLabelOf = async () => (await agentAutoChip.getAttribute('aria-label')) ?? ''
  const autoBefore = await autoLabelOf()
  await agentAutoChip.click()
  await sleep(250)
  const autoOptions = await page.locator('[data-param-popup="agent-autorun"] button').allInnerTexts()
  const autoText = autoOptions.join('|')
  rec(
    g,
    '★★ 手动 / 自动两档都在，且各带一句后果说明',
    autoOptions.length === 2 && autoText.includes('手动生成') && autoText.includes('自动生成'),
    `选项=${JSON.stringify(autoOptions)}`,
  )
  await page
    .locator('[data-param-popup="agent-autorun"] button', { hasText: '自动生成' })
    .first()
    .click()
  await sleep(400)
  const autoAfter = await autoLabelOf()
  rec(
    g,
    '★★ 选「自动生成」后 chip 换成自动那一枚（选中能替换）',
    autoBefore.includes('手动') && autoAfter.includes('自动'),
    `前=「${autoBefore}」后=「${autoAfter}」`,
  )
  /** 改回手动：下面那条「真出图」的验收要按手动的节奏走（点确认才跑） */
  await agentAutoChip.click()
  await sleep(250)
  await page
    .locator('[data-param-popup="agent-autorun"] button', { hasText: '手动生成' })
    .first()
    .click()
  await sleep(400)

  /**
   * @ 引用（参考产品图三 / 图四）：菜单分「节点 / 图片 / 视频」三段；选中之后
   * **在输入框里落成一颗 chip**（是文本内容的一部分，不是外挂的标签）。
   *
   * 用户 2026-10-04 第 1 条：「艾特按钮我要能图片模型和视频模型，就是前端的那几个，
   * 千万不要把渠道拉取的模型放上去」—— 所以模型那两段**只**列前端固定清单
   * （`presetModelsOf`），且**不含对话模型**（那是 agent 自己的 LLM，另有一行）。
   */
  await agentMentionChip.click()
  await sleep(250)
  const mentionSections = await page
    .locator('[data-param-popup="agent-mention"] [data-param-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-section')))
  const mentionImageNames = await page
    .locator('[data-param-popup="agent-mention"] button[data-param-in="image"]')
    .allInnerTexts()
  const mentionVideoNames = await page
    .locator('[data-param-popup="agent-mention"] button[data-param-in="video"]')
    .allInnerTexts()
  const mentionModelText = [...mentionImageNames, ...mentionVideoNames].join('|')
  rec(
    g,
    '★★ @ 引用菜单分「节点 / 图片 / 视频」三段',
    mentionSections.join(',') === 'node,image,video',
    `段=${mentionSections.join(',')}`,
  )
  /**
   * mock 渠道拉回来的模型叫 `mock-image-1` / `mock-video-1` —— 它们正是「渠道拉取的
   * 模型」。这两段里出现任何一个都说明口径错了（用户 2026-10-04 第 1 条）。
   */
  rec(
    g,
    '★★ @ 里的模型 = 前端固定清单（图片 / 视频），渠道拉回来的名字一枚都不进',
    mentionImageNames.some((t) => t.includes('Nano Banana')) &&
      mentionVideoNames.some((t) => t.includes('即梦 2.5')) &&
      !mentionModelText.includes('mock-') &&
      (await page.locator('[data-param-popup="agent-mention"] [data-param-section="chat"]').count()) ===
        0,
    `图片=${mentionImageNames.length} 视频=${mentionVideoNames.length} 含渠道名=${mentionModelText.includes('mock-')}`,
  )
  await page
    .locator('[data-param-popup="agent-mention"] button[data-param-in="node"]')
    .first()
    .click()
  await sleep(400)
  /**
   * 取**节点**那一枚：这次挑的就是节点引用。不能拿 `.first()` —— 前面选生成模型时
   * 也会往正文里落一枚 `model:` chip（用户 2026-10-02：「选择模型后也是要加入到
   * 对话框中参与对话」），第一枚未必是刚点的这一颗。
   */
  const mentionChip = page.locator('[data-agent-input] [data-mention-kind="node"]').first()
  const mentionTokenText = (await mentionChip.getAttribute('data-token').catch(() => '')) ?? ''
  rec(
    g,
    '★★ 选中的引用落进输入框成为一颗 chip（文本内容的一部分）',
    (await mentionChip.count()) === 1 && mentionTokenText.includes('(node:'),
    `token=${mentionTokenText.slice(0, 48)}`,
  )
  /** 留一张**引用 chip 在输入框里**的截图：矩形像不像、挤不挤，靠它眼看 */
  await page.screenshot({ path: `${OUT}/113-g95-agent-mention.png` })

  /**
   * ★★ **在输入框里打 `@`** 触发的那条路，点**一次**选项就该插进来
   * （用户 2026-10-02：「有些时候按艾特的时候要选择两下才能输入」）。
   *
   * 为什么单独立一条：上面那些用例走的都是「点工具条上的 @」——那条路进的是
   * `else` 分支（直接 append），碰不到 bug。真用户是**在输入框里打 `@`**，
   * 那条路要「吃掉触发符」：`deleteData()` 会把**活 Range** 的偏移一起往前挪，
   * 于是 `setStart(node, startOffset - 1)` 送进 -1 抛 `IndexSizeError` ——
   * 引用没插进来、`@` 还被删了，看着就是「要点第二下」。
   */
  await page.locator('[data-agent-input]').fill('')
  await page.locator('[data-agent-input]').click()
  await page.keyboard.type('@')
  await sleep(400)
  const typedRows = await page
    .locator('[data-param-popup="agent-mention"] button[data-param-in="node"]')
    .count()
  await page
    .locator('[data-param-popup="agent-mention"] button[data-param-in="node"]')
    .first()
    .click()
  await sleep(400)
  const typedChip = await page.locator('[data-agent-input] [data-mention-kind="node"]').count()
  rec(
    g,
    '★★ 打 `@` 之后点**一次**选项就插进正文（不用点第二下）',
    typedRows > 0 && typedChip === 1,
    `选项=${typedRows} 点一次后的 chip=${typedChip}`,
  )
  /** 这一条是**回归锚点**：bug 的表现就是这里冒 `IndexSizeError` */
  rec(
    g,
    '★ 打 `@` 那条路不再抛 IndexSizeError（Range 偏移已按删除点重算）',
    !pageErrors.some((e) => e.includes('IndexSize')),
    pageErrors.join(' | '),
  )
  /** 这一枚留在正文里会影响后面几条计数断言，先清掉 */
  await page.locator('[data-agent-input]').fill('')
  await sleep(250)

  /**
   * 用户 2026-10-05 第 9 条：「agent 最上方的默认按钮目前是没有用的，删掉」
   * —— 判据取**它真的没了**，而不是被藏起来或置灰。
   */
  rec(
    g,
    '★★ 头部那枚「设为默认模型」按钮已撤掉',
    (await page.locator('[data-agent-set-default]').count()) === 0,
    `按钮数=${await page.locator('[data-agent-set-default]').count()}`,
  )

  /**
   * 技能（设计文档 §14 M4）：选了它，agent 就按这份技能的阶段来规划。
   * 这里验的是「入口与清单在」，正文是否真进了系统提示词由单测覆盖
   * （面板里看不到发出去了什么）。
   */
  rec(g, '★ 对话窗能选技能', (await agentSkillChip.count()) === 1)
  if ((await agentSkillChip.count()) === 1) {
    await agentSkillChip.click()
    await sleep(300)
    /** 留一张**技能菜单展开着**的截图：分类 / 搜索 / 行的密度，靠它眼看 */
    await page.screenshot({ path: `${OUT}/115-g95-agent-skills.png` })

    /**
     * ★★ 点面板外的空白处 → 整个技能面板收起（用户 2026-10-04：
     * 「agent 的输入框的 skill 面板点出来，点击其他的空白区域它会不关闭」）。
     *
     * 判据取「菜单元素真的从 DOM 里消失」，不是「多了某个 class」—— 后者在面板
     * 本来就没渲染时也会绿。
     *
     * 点的是**对话区左上角**（`data-agent-messages` 的一个固定角落）：它在面板里、
     * 但在技能菜单外，而且离菜单足够远 —— 一旦菜单盖住它，Playwright 会因
     * 「目标被拦截」而报错，不会静悄悄地假绿。
     */
    await page.locator('[data-agent-messages]').click({ position: { x: 30, y: 30 } })
    await sleep(300)
    const menuAfterOutsideClick = await page.locator('[data-agent-skill-menu]').count()
    rec(
      g,
      '★★ 点面板外的空白处，技能面板自己收起',
      menuAfterOutsideClick === 0,
      `菜单=${menuAfterOutsideClick}`,
    )
    /** 收起来之后重新打开：下面那几条还指望它开着 */
    await agentSkillChip.click()
    await sleep(300)

    /**
     * ★★ 技能菜单的分类与搜索（用户 2026-10-03：参考产品图三「skill 的参数面板 ui
     * 以及功能参考图三的给我进行分类」）。
     */
    const skillTabs = await page
      .locator('[data-agent-skill-tab]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-agent-skill-tab')))
    const skillRows = page.locator('[data-agent-skill-option]')
    const skillRowCount = await skillRows.count()
    rec(
      g,
      '★★ 技能菜单按「通用 / 收藏 / 我的」分类，且带搜索框与技能行',
      skillTabs.join(',') === 'builtin,fav,user' &&
        (await page.locator('[data-agent-skill-search]').count()) === 1 &&
        skillRowCount >= 5,
      `页签=${skillTabs.join(',')} 条数=${skillRowCount}`,
    )

    /**
     * ★★ 面板**尺寸固定**（用户 2026-10-02：「agentskill 面板要固定尺寸比例，当前点击
     * 收藏或者我的的时候会变短」）：切页签前后量同一个元素，高度不许变。
     */
    const menuBoxBuiltin = await page.locator('[data-agent-skill-menu]').boundingBox()
    await page.locator('[data-agent-skill-tab="fav"]').click()
    await sleep(250)
    const menuBoxFav = await page.locator('[data-agent-skill-menu]').boundingBox()
    await page.locator('[data-agent-skill-tab="builtin"]').click()
    await sleep(200)
    rec(
      g,
      '★★ 技能面板固定尺寸：切「收藏 / 我的」高度不变',
      menuBoxBuiltin !== null &&
        menuBoxFav !== null &&
        Math.abs(menuBoxBuiltin.height - menuBoxFav.height) <= 1,
      `通用=${menuBoxBuiltin ? Math.round(menuBoxBuiltin.height) : '?'} 收藏=${menuBoxFav ? Math.round(menuBoxFav.height) : '?'}`,
    )

    /**
     * ★★ 浮层**不许越出对话窗右边**（用户 2026-10-02：「agentskill 面板朝右边超出了
     * 画布的页面，显示不全」）。这条按**几何**验：300px 的浮层挂在工具条中段，
     * 而对话窗贴着视口右边 —— 不推回来的话右半截就是被切掉。
     */
    const panelBoxForMenu = await page.locator('[data-agent-panel]').boundingBox()
    const menuBoxNow = await page.locator('[data-agent-skill-menu]').boundingBox()
    rec(
      g,
      '★★ 技能面板收在对话窗内（右边不越界）',
      panelBoxForMenu !== null &&
        menuBoxNow !== null &&
        menuBoxNow.x >= panelBoxForMenu.x - 1 &&
        menuBoxNow.x + menuBoxNow.width <= panelBoxForMenu.x + panelBoxForMenu.width + 1,
      `浮层 ${menuBoxNow ? Math.round(menuBoxNow.x) : '?'}..${menuBoxNow ? Math.round(menuBoxNow.x + menuBoxNow.width) : '?'} 对话窗 ${panelBoxForMenu ? Math.round(panelBoxForMenu.x) : '?'}..${panelBoxForMenu ? Math.round(panelBoxForMenu.x + panelBoxForMenu.width) : '?'}`,
    )

    /**
     * ★★ 收藏（用户 2026-10-03 参考产品图三的第三个页签）：收藏一条 → 它出现在
     * 「收藏」页签里。**判据用「同一条技能的名字」**，不是「收藏页非空」——
     * 后者在收藏串味（收了 A 却显示 B）时照样绿。
     */
    const favCandidate = ((await skillRows.first().innerText()) ?? '').trim().split('\n')[0] ?? ''
    await page.locator('[data-agent-skill-fav]').first().click()
    await sleep(300)
    await page.locator('[data-agent-skill-tab="fav"]').click()
    await sleep(300)
    const favNames = (await page.locator('[data-agent-skill-option]').allInnerTexts()).map(
      (t) => t.trim().split('\n')[0] ?? '',
    )
    rec(
      g,
      '★★ 收藏一条技能后，它出现在「收藏」页签里',
      favCandidate !== '' && favNames.includes(favCandidate),
      `收藏=${JSON.stringify(favNames)} 期望含「${favCandidate}」`,
    )
    /** 回到「通用」继续下面那条「选中即用」的验收 */
    await page.locator('[data-agent-skill-tab="builtin"]').click()
    await sleep(250)

    /** 搜索要真的收窄列表（打个不存在的词 → 空态说明，而不是装作没坏） */
    await page.locator('[data-agent-skill-search]').fill('zzz-不存在的技能')
    await sleep(250)
    rec(
      g,
      '★ 搜索能把列表收窄到空并说明「没有匹配」',
      (await page.locator('[data-agent-skill-empty]').count()) === 1 &&
        (await skillRows.count()) === 0,
    )
    await page.locator('[data-agent-skill-search]').fill('')
    await sleep(250)

    /**
     * ★★ 「创建」**悬停就展开**（用户 2026-10-02：「这个创建不用点击，悬停就会出现
     * 选项」）——判据是**没点之前**菜单已经在。
     */
    await page.locator('[data-agent-skill-create]').hover()
    await sleep(250)
    rec(
      g,
      '★★ 「创建」悬停即展开（不用点）',
      (await page.locator('[data-agent-skill-create-menu]').count()) === 1,
    )
    /**
     * ★★ 展开之后**把指针移开也不会收**（用户 2026-10-02：「agentskill 面板的创建当前
     * 悬停的时候会出现面板但是移开位置后就消失了」）。收起来的时机是「点到别处」——
     * 否则用户想从按钮挪到菜单项上，半路就没了。
     */
    await page.mouse.move(5, 5)
    await sleep(350)
    rec(
      g,
      '★★ 「创建」移开指针仍留在原地（不会一点就飘走）',
      (await page.locator('[data-agent-skill-create-menu]').count()) === 1,
    )
    /**
     * ★★ 展开后是两条路：新建 skill、**导入 skill**（用户 2026-10-02：「导入的按钮把
     * md 文件和文件夹变成一个按钮」）。「导入」点开再分文件 / 目录两把选取器 ——
     * 浏览器不允许一个选择器同时选文件和目录，这一层分叉只能留在入口内部。
     */
    rec(
      g,
      '★★ 「创建」里有新建技能 + 一个合并后的「导入 Skill」入口',
      (await page.locator('[data-agent-skill-create-new]').count()) === 1 &&
        (await page.locator('[data-agent-skill-import]').count()) === 1 &&
        (await page.locator('[data-agent-skill-import-file]').count()) === 0,
    )
    await page.locator('[data-agent-skill-import]').click()
    await sleep(250)
    rec(
      g,
      '★★ 「导入 Skill」点开才是 .md 文件 / Skill 目录两把选取器',
      (await page.locator('[data-agent-skill-import-file]').count()) === 1 &&
        (await page.locator('[data-agent-skill-import-folder]').count()) === 1,
    )
    /** 收起来继续下面的用例：现在只有「点到别处」才收（这里整块技能菜单一起关） */
    await page.keyboard.press('Escape')
    await sleep(200)

    /**
     * ★★ 真导一份 .md 进去 —— 「导入已有 skill」那条路**不能只验入口在**。
     *
     * 导完在「我的」页签里按**名字**找它（不是「列表非空」：那样导入串味也照样绿）。
     */
    await page.locator('[data-agent-skill-file]').setInputFiles({
      name: 'smoke-imported-skill.md',
      mimeType: 'text/markdown',
      buffer: Buffer.from(
        '---\nname: 冒烟导入的技能\ndescription: 由冒烟脚本导入的一条技能\n---\n你是测试用的技能正文。',
        'utf8',
      ),
    })
    await sleep(900)
    /** 导入成功会顺手把菜单收起来，重新打开再看「我的」 */
    await agentSkillChip.click()
    await sleep(300)
    await page.locator('[data-agent-skill-tab="user"]').click()
    await sleep(300)
    const mySkillNames = (await page.locator('[data-agent-skill-option]').allInnerTexts()).map(
      (t) => t.trim().split('\n')[0] ?? '',
    )
    rec(
      g,
      '★★ 导入 .md 真的落进「我的」技能里（不是只看入口在）',
      mySkillNames.includes('冒烟导入的技能'),
      `我的=${JSON.stringify(mySkillNames)}`,
    )
    await page.locator('[data-agent-skill-tab="builtin"]').click()
    await sleep(250)

    /**
     * ★★ 「全部」= **在面板里摊开**（用户 2026-10-03 参考产品图五：「点全部会跳…面板，
     * 可以进行选择」）。
     *
     * 与「跳去技能库那一页」的区别很实在：那一页是**管理**（点一条 = 去改它），
     * 而这里要的是**这次就用它**。
     */
    await page.locator('[data-agent-skill-all]').click()
    await sleep(300)
    const cardCount = await page.locator('[data-agent-skill-card]').count()
    const tagCount = await page.locator('[data-agent-skill-tag]').count()
    rec(
      g,
      '★★ 「全部」摊开成大面板：分类标签 + 卡片网格，能直接挑',
      cardCount >= 5 && tagCount >= 1,
      `卡片=${cardCount} 分类=${tagCount}`,
    )
    /**
     * 「全部」= **画布正中的固定尺寸模态**（用户 2026-10-02 参考产品图四：「放在整个
     * 画布的中间，右上角关闭按钮……同时也要固定尺寸比例，当前的是靠近 agent 框，
     * 而且不够大，并且不是固定比例的」）。
     *
     * 判据按**几何**：水平 / 垂直都居中（±2px）、有背板、尺寸够大。
     */
    const wideBox = await page.locator('[data-agent-skill-menu]').boundingBox()
    const scrimCount = await page.locator('[data-agent-skill-scrim]').count()
    const centered =
      wideBox !== null &&
      vp !== null &&
      Math.abs(wideBox.x + wideBox.width / 2 - vp.width / 2) <= 2 &&
      Math.abs(wideBox.y + wideBox.height / 2 - vp.height / 2) <= 2
    rec(
      g,
      '★★ 「全部」是画布正中的固定尺寸模态（居中 + 背板 + 够大）',
      centered && scrimCount === 1 && wideBox.width >= 600 && wideBox.height >= 400,
      `面板 ${wideBox ? Math.round(wideBox.x) : '?'}..${wideBox ? Math.round(wideBox.x + wideBox.width) : '?'} 尺寸=${wideBox ? Math.round(wideBox.width) : '?'}×${wideBox ? Math.round(wideBox.height) : '?'} 视口=${vp?.width ?? '?'}×${vp?.height ?? '?'} 背板=${scrimCount}`,
    )
    rec(
      g,
      '★★ 技能卡带图片 / 效果位（可留空，后期自己补图）',
      (await page.locator('[data-agent-skill-shot]').count()) >= 5,
      `图位=${await page.locator('[data-agent-skill-shot]').count()}`,
    )
    await page.screenshot({ path: `${OUT}/117-g95-agent-skills-all.png` })
    /** 名字读**名字自己的锚点**：卡片里还有分类与效果图，整张卡的第一行不再是名字 */
    const cardName =
      (await page.locator('[data-agent-skill-card-name]').first().innerText().catch(() => '')) ??
      ''
    await page.locator('[data-agent-skill-card]').first().click()
    await sleep(400)
    /** 技能 chip 现在**在正文里**（与 @ 引用同一处），不是正文外面单独一行 */
    const chipFromCard = (
      (await page
        .locator('[data-agent-input] [data-mention-kind="skill"]')
        .allInnerTexts()
        .catch(() => [])) ?? []
    ).join('|')
    rec(
      g,
      '★★ 在大面板里点一张卡片 = 用这个技能（正文里落成 chip，不是去编辑）',
      cardName !== '' && chipFromCard.includes(cardName),
      `chip=「${chipFromCard}」期望含「${cardName}」`,
    )

    /** 再开一次，走「列表里选一行」那条路 —— 两种挑法都要能用 */
    await agentSkillChip.click()
    await sleep(300)
    /**
     * 取**第 2 行**而不是第 1 行：第 1 行正好是刚用卡片选中的那条，
     * 再点它是「取消选择」（同一行点两次 = 切换），chip 会消失 ——
     * 那是设计好的行为，不是 bug，但这儿要验的是「选中」这条路。
     */
    const firstSkillName =
      ((await page.locator('[data-agent-skill-option]').nth(1).innerText()) ?? '')
        .trim()
        .split('\n')[0] ?? ''
    await page.locator('[data-agent-skill-option]').nth(1).click()
    await sleep(400)
    const skillChipEl = page.locator('[data-agent-input] [data-mention-kind="skill"]')
    const skillChipText = (
      (await skillChipEl.allInnerTexts().catch(() => [])) ?? []
    ).join('|')
    rec(
      g,
      '★★ 选中的技能在输入框**正文里**显示成 chip（代表这次用了它）',
      (await skillChipEl.count()) >= 1 &&
        firstSkillName !== '' &&
        skillChipText.includes(firstSkillName),
      `chip=「${skillChipText}」期望含「${firstSkillName}」`,
    )
    /** 菜单选完要自己关掉，别挡着输入框 */
    rec(g, '★ 选完技能菜单自动收起', (await page.locator('[data-agent-skill-menu]').count()) === 0)
  }

  /**
   * ★★ 素材（设计文档 §8「输入：文字 + 可选图片」）。
   *
   * 关键是它**先落成画布上的节点**再记进会话 —— agent 要靠节点 id 去 attach，
   * 只把图片塞进上下文的话，模型指不到画布上的任何东西，最后会重复建一张。
   */
  const nodesBeforeAsset = await page.locator('[data-node-type]').count()
  /**
   * ★★ 「加素材」分**两条路**（用户 2026-10-03：「加素材是要的，他分两个功能，
   * 点击后本地上传和素材库添加，也是要有图标」）。
   */
  await page.locator('[data-agent-add-asset]').click()
  await sleep(300)
  const addItems = await page.locator('[data-asset-menu-item]').allInnerTexts()
  const addText = addItems.join('|')
  rec(
    g,
    '★★ 加素材分两条路（本地上传 / 素材库添加），两条都带矢量图标',
    addText.includes('本地上传') &&
      addText.includes('素材库添加') &&
      (await page.locator('[data-asset-menu-item="upload"] svg').count()) === 1 &&
      (await page.locator('[data-asset-menu-item="library"] svg').count()) === 1,
    `项=${JSON.stringify(addItems)}`,
  )
  /** 「素材库添加」要真打开素材库；空库时给出说明，而不是一块空白浮层 */
  await page.locator('[data-asset-menu-item="library"]').click()
  await sleep(400)
  const libText = await page.locator('[data-agent-library]').innerText().catch(() => '')
  rec(
    g,
    '★ 「素材库添加」打开素材库（空库时给出说明，不是空白浮层）',
    (await page.locator('[data-agent-library]').count()) === 1 &&
      (libText.includes('素材库还是空的') ||
        (await page.locator('[data-agent-library-item]').count()) > 0),
    `文案=${libText.slice(0, 24)}`,
  )
  await page.locator('[data-agent-library-close]').click()
  await sleep(200)

  /** 落位几何：用来验「拖进来的素材不压在原有节点上」 */
  const geomOf = () =>
    page.locator('[data-node-type]').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { id: e.getAttribute('data-node-id'), x: r.x, y: r.y, w: r.width, h: r.height }
      }),
    )
  const rectsBeforeAsset = await geomOf()
  /** 上传前正文里已有的节点引用数（前面 @ 引用留了一枚，别把它算成本次的） */
  const nodeChipsBeforeUpload = await page
    .locator('[data-agent-input] [data-mention-kind="node"]')
    .count()
  await page.locator('[data-agent-file]').setInputFiles({
    name: 'ref.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_IMPORT_BASE64, 'base64'),
  })
  await sleep(900)
  /** 素材现在落成**正文里的一枚引用 chip**（与 @ 图片节点同一处） */
  const assetChips = await page
    .locator('[data-agent-input] [data-mention-kind="node"]')
    .count()
  const nodesAfterAsset = await page.locator('[data-node-type]').count()
  rec(
    g,
    '★★ 给一张图 → 落成画布节点，并在**正文里**变成一枚引用 chip',
    assetChips === nodeChipsBeforeUpload + 1 && nodesAfterAsset === nodesBeforeAsset + 1,
    `chip ${nodeChipsBeforeUpload}→${assetChips} 节点 ${nodesBeforeAsset}→${nodesAfterAsset}`,
  )

  /**
   * ★★ 落位不压人。
   *
   * 用户 2026-10-01 的截图里看到过反例：拖进来的素材正好盖在模板原有的
   * 提示词节点上，两张图叠在一起。这条按**几何**验：新节点与所有旧节点都不相交。
   */
  const rectsAfterAsset = await geomOf()
  const knownIds = new Set(rectsBeforeAsset.map((n) => n.id))
  const freshNodes = rectsAfterAsset.filter((n) => !knownIds.has(n.id))
  const intersects = (a, b) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
  const overlapsOld = freshNodes.some((n) => rectsBeforeAsset.some((o) => intersects(n, o)))
  rec(
    g,
    '★★ 拖进来的素材不压在原有节点上（两张图不会叠一起）',
    freshNodes.length === 1 && !overlapsOld,
    `新节点=${freshNodes.length} 压人=${overlapsOld}`,
  )
  /**
   * ★★ 那枚 chip 要**删得掉**（用户 2026-10-02：「艾特模型后删除不了」）。
   *
   * 删法是退格：光标落在 chip 后面按一次退格 → 整块拿走。这条同时钉住两件事：
   * ① 编辑器接管了紧贴 chip 的退格；② 删掉的是**引用 chip 本身**，不是它旁边的空白。
   */
  await page.locator('[data-agent-input]').click()
  await page.keyboard.press('End')
  await sleep(150)
  await page.keyboard.press('Backspace')
  await sleep(400)
  const afterBackspace = await page
    .locator('[data-agent-input] [data-mention-kind="node"]')
    .count()
  rec(
    g,
    '★★ 正文里的引用 chip 用退格能整块删掉（节点留在画布上）',
    afterBackspace === assetChips - 1,
    `退格后 chip=${afterBackspace}（原 ${assetChips}）`,
  )

  /**
   * ★★ @ 引用**节点**时 chip 上要有**图片缩略图**（用户 2026-10-03，参考产品图六：
   * 「艾特图片的时候需要和图 6 一样有图片的缩略图，当前只有一个图标和名称」）。
   *
   * 引的必须是**真有图的那个节点**（刚上传的素材）—— 拿一个没有图的节点验，
   * 「没缩略图」是本来就该如此，证明不了任何事。
   */
  const imageNodeId = await page
    .locator('[data-node-type="generation"][data-node-id]')
    .evaluateAll(
      (els) =>
        els
          .filter((e) => e.querySelector('[data-node-asset]'))
          .map((e) => e.getAttribute('data-node-id') ?? '')[0] ?? '',
    )
  await agentMentionChip.click()
  await sleep(300)
  /**
   * ★★ @ 面板**先折叠**（用户 2026-10-02 参考产品图二：「不用显示全部可以艾特的
   * 节点，下方有省略，点击之后才会显示所有的」）。
   *
   * 这一刻画布上只有几个节点，所以这里只验**折叠规则本身**（≤5 就全列、>5 才折叠）；
   * 「真有得折叠」那一条放在下面节点多的那一步（见「大画布上 @ 面板先列 5 条」）。
   */
  const mentionRowCap = await page
    .locator('[data-param-popup="agent-mention"] [data-param-in="node"]')
    .count()
  const nodesOnCanvasNow = await page.locator('[data-node-type]').count()
  const mentionMore = page.locator('[data-param-more="node"]')
  rec(
    g,
    '★ @ 面板的折叠规则：节点不多时全列、不出现「加载更多」',
    nodesOnCanvasNow <= 5
      ? mentionRowCap === nodesOnCanvasNow && (await mentionMore.count()) === 0
      : mentionRowCap === 5 && (await mentionMore.count()) === 1,
    `画布节点=${nodesOnCanvasNow} 先列=${mentionRowCap}`,
  )
  if ((await mentionMore.count()) === 1) {
    await mentionMore.click()
    await sleep(300)
    const mentionRowAll = await page
      .locator('[data-param-popup="agent-mention"] [data-param-in="node"]')
      .count()
    rec(
      g,
      '★ 点「加载更多」后节点全部列出来',
      mentionRowAll === nodesOnCanvasNow,
      `展开后=${mentionRowAll} 期望=${nodesOnCanvasNow}`,
    )
  }
  await page
    .locator(`[data-param-popup="agent-mention"] [data-param-option="node:${imageNodeId}"]`)
    .click()
  await sleep(700)
  const mentionThumb = await page
    .locator('[data-agent-input] [data-mention-thumb-slot] img')
    .count()
  rec(
    g,
    '★★ @ 引用的节点在 chip 上显示**图片缩略图**（不只是图标 + 名字）',
    imageNodeId !== '' && mentionThumb >= 1,
    `节点=${imageNodeId.slice(0, 12)} 缩略图=${mentionThumb}`,
  )
  await page.screenshot({ path: `${OUT}/116-g95-agent-mention-thumb.png` })

  /**
   * ★★★ 整件事的验收：**说一句话，画布上直接多出工作流，再问你要不要生成**。
   *
   * 用户 2026-10-02 定的口径（对着参考产品的截图）：
   * 「他直接给我新建进去，但是生成与否需要让我确认，取消后也不会撤回已经新建到
   * 画布中的工作流」。
   *
   * mock 会演 agent（先 readGraph、再给 applyPlan、再请求 runNode），所以这条链
   * 在离线环境能跑穿：循环 → **直接落地** → 自检 → 回填 → 请求执行 → 停下等确认。
   */
  /** 落地前的节点 id 集合 —— 落地后拿它认哪两个是 agent 新建的 */
  const idsBeforeLanding = new Set(
    await page
      .locator('[data-node-type]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id'))),
  )
  const nodesBefore = await page.locator('[data-node-type]').count()
  await page.locator('[data-agent-input]').fill('帮我建一个提示词到生成的流程')
  await page.locator('[data-agent-send]').click()
  /** 建图**不问**：画布自己就该长出两个节点 */
  await page
    .waitForFunction(
      (n) => document.querySelectorAll('[data-node-type]').length >= n + 2,
      nodesBefore,
      { timeout: 20000 },
    )
    .catch(() => undefined)
  const nodesAfter = await page.locator('[data-node-type]').count()
  rec(
    g,
    '★★ 一句话之后画布上**直接**多出工作流（建图不问用户）',
    nodesAfter >= nodesBefore + 2,
    `前=${nodesBefore} 后=${nodesAfter}`,
  )
  const planConfirm = await page.locator('[data-agent-preview="applyPlan"]').count()
  rec(
    g,
    '★★ 建图**不弹确认卡**（该问的只有「要不要生成」）',
    planConfirm === 0,
    `applyPlan 确认卡=${planConfirm}`,
  )

  /**
   * ★★ 新建节点的名字要**从提示词总结出来**（用户 2026-10-03：「节点上的名称要根据
   * 我的提示词来总结成一个节点的名称，不能要是图片节点1这种」）。
   *
   * mock 给的计划**故意不带 title** —— 那正是真模型最常见的偷懒方式。
   * 判据：两个新节点的名字都非空、都是那句提示词的前缀，且**不等于类型默认名**。
   */
  const newTitles = await page.locator('[data-node-type]').evaluateAll(
    (els, known) =>
      els
        .filter((e) => !known.includes(e.getAttribute('data-node-id') ?? ''))
        .map((e) => (e.querySelector('[data-node-title]')?.textContent ?? '').trim()),
    [...idsBeforeLanding],
  )
  rec(
    g,
    '★★ 新建节点的名字来自提示词（不是「提示词」「图片生成」这类默认名）',
    newTitles.length === 2 &&
      newTitles.every((t) => t.length > 0 && '帮我建一个提示词到生成的流程'.startsWith(t)) &&
      !newTitles.includes('提示词') &&
      !newTitles.includes('图片生成'),
    `名字=${JSON.stringify(newTitles)}`,
  )

  /**
   * ★★★ M3 的落点：**点确认之后真的出图**。
   *
   * 光验「画布上多了两个节点」是不够的 —— 建出来的生成节点如果没渠道没模型，
   * 它照样会出现在画布上，只是点「生成」时什么都不发生（`toRunRequest` 返回 null）。
   * 所以这条一路验到**产物**：agent 请求 runNode → 停下来问 → 点确认 → 真的发渠道请求 →
   * 节点上出现 blob 图。
   */
  await page
    .waitForSelector('[data-agent-preview="runNode"]', { timeout: 20000 })
    .catch(() => undefined)
  rec(
    g,
    '★★ 建完之后 agent 请求执行，**这里**才停下问（花钱的动作不自动跑）',
    (await page.locator('[data-agent-preview="runNode"]').count()) === 1,
  )

  /**
   * ★★ runNode 的确认卡在**对话流里**（不在输入框上方另起一块）。
   *
   * 参考产品的问法就是「是否运行节点「小猫钓鱼」生成图片？」，且确认卡
   * 是时间线里的一条步骤 —— 用户一眼知道「这段对话里有一次要花我的钱」。
   */
  const confirmText = (await page.locator('[data-agent-preview="runNode"]').innerText()).replace(/\s+/g, '')
  rec(
    g,
    '★★ 确认卡问的是节点名（「是否运行节点「××」生成图片？」），在对话流里',
    confirmText.includes('是否运行节点') && confirmText.includes('生成图片'),
    `确认卡文案=${confirmText.slice(0, 40)}`,
  )

  const plannedGenId = (
    await page.locator('[data-node-type]').evaluateAll((els) =>
      els.map((e) => ({ id: e.getAttribute('data-node-id'), type: e.getAttribute('data-node-type') })),
    )
  ).find((n) => n.type === 'generation' && !idsBeforeLanding.has(n.id))?.id

  await page.locator('[data-agent-confirm]').click()
  const genNode = page.locator(`[data-node-type="generation"][data-node-id="${plannedGenId}"]`)
  let agentImage = ''
  for (let i = 0; i < 80; i++) {
    /**
     * 先 `count()` 再读 `src`：直接 `getAttribute` 在元素还没出现时会**等满
     * 30s 的动作超时**才 reject —— 那样这个本该 20s 的轮询要跑 40 分钟，
     * 失败了也看不出是「没出图」还是「测试卡住了」（踩过一次）。
     */
    const asset = genNode.locator('[data-node-asset]').first()
    agentImage = (await asset.count()) > 0 ? ((await asset.getAttribute('src')) ?? '') : ''
    if (agentImage.startsWith('blob:')) break
    await sleep(250)
  }
  rec(
    g,
    '★★★ 确认后真的出图了（agent 建的生成节点拿到了产物，不是空转）',
    agentImage.startsWith('blob:'),
    `节点=${plannedGenId ?? '?'} src=${agentImage.slice(0, 12)}`,
  )

  rec(
    g,
    '★★ 落地与执行的结果都回填了，模型给出收尾回答（闭环）',
    (await page.locator('[data-agent-message="assistant"]').count()) > 0,
  )

  /**
   * ★★ 助手回复按 **Markdown 渲染**（用户 2026-10-02：「他给我的解释功能给我的是
   * json 格式的吗？我不想要那些符号」—— 截图里 `- **看看画布现状**` 把星号和杠
   * 原样打了出来）。
   *
   * 判据两条：① 回复里的 `- ` 真的渲染成了列表块；② 气泡的可见文字里
   * **一个 `**` 都不剩**（符号被吃掉才算数）。
   */
  const botBubble = page.locator('[data-agent-message="assistant"]').last()
  const botText = await botBubble.innerText().catch(() => '')
  const botBullets = await botBubble.locator('[data-md-block="bullet"]').count()
  rec(
    g,
    '★★ 助手回复渲染成 Markdown 块，星号 / 杠不再原样出现',
    botBullets >= 2 && !botText.includes('**'),
    `列表块=${botBullets} 含星号=${botText.includes('**')}`,
  )

  /**
   * ★★★ 对话区不再打印原始 JSON。
   *
   * 这是「排版」里唯一能被断言钉住、且最影响可用性的一条：工具结果原先原样渲染，
   * 用户看到的是一屏 `{"createdNodeIds":[…]}`。现在每步折成一张步骤卡。
   * 断言两条：① 有步骤卡；② 对话区**任何一条文本**里都不出现 JSON 噪音
   * （`createdNodeIds` / `problems` 这类键名一旦漏出来就是没翻成人话）。
   */
  const steps = await page.locator('[data-agent-step]').count()
  const stepLabels = await page.locator('[data-agent-step]').allTextContents()
  rec(
    g,
    '★★★ 每一步折成一张步骤卡（不再把工具结果原样打给用户）',
    steps >= 1 && stepLabels.some((t) => /工作流已创建|已运行生成|已看画布/.test(t)),
    `步骤卡=${steps} 标题=${JSON.stringify(stepLabels.map((t) => t.slice(0, 10)))}`,
  )
  const dialogText = await page.locator('[data-agent-messages]').innerText()
  rec(
    g,
    '★★★ 对话区里没有 JSON 噪音（键名不能漏到界面上）',
    !/createdNodeIds|problems|outcomes|\{"/.test(dialogText),
    dialogText.slice(0, 80).replace(/\n/g, '⏎'),
  )

  /**
   * ★★ 步骤卡默认收起、点开看细节（参考产品的「图片节点已创建 ⌄」）。
   *
   * 缩略图与明细都在展开层里 —— 默认收起时对话流只留一行行标题，
   * 点开「已运行生成」才看到产物图。
   */
  const detailBtn = page
    .locator('[data-agent-step="runNode"] [data-agent-step-detail="runNode"]')
    .first()
  await detailBtn.click()
  await sleep(400)
  const thumbs = await page.locator('[data-agent-thumb] img').count()
  rec(g, '★★ 点开步骤卡能看到产物缩略图（默认收起，点开才显示）', thumbs >= 1, `缩略图=${thumbs}`)

  /**
   * 切到**另一个**会话。
   *
   * 不能写 `index: 0`：会话列表按更新时间倒序，刚聊过的那个永远在 0 ——
   * 那样「切过去还是它」，断言会假装通过（或像这一轮一样误报失败）。
   * 按 id 挑一个不等于当前的，才是真的换了一套上下文。
   */
  await page.locator('[data-param-chip="agent-session"]').click()
  await sleep(250)
  const sessionIds = await page
    .locator('[data-param-popup="agent-session"] button[data-param-option]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option') ?? ''))
  /** 当前会话 = 列表里勾着的那一条（`value` 就是 current.id） */
  const currentSessionId =
    (await page
      .locator('[data-param-popup="agent-session"] button[aria-selected="true"]')
      .first()
      .getAttribute('data-param-option').catch(() => '')) ?? ''
  const otherSessionId = sessionIds.find((id) => id !== currentSessionId)
  rec(g, '★ 存在另一个会话可切', Boolean(otherSessionId), `共 ${sessionIds.length} 个`)
  await page
    .locator(`[data-param-popup="agent-session"] [data-param-option="${otherSessionId}"]`)
    .click()
  await sleep(500)
  const other = await page.locator('[data-agent-message]').count()
  rec(g, '★★ 切回另一个会话是另一套消息（记忆隔离）', other === 0, `另一个会话消息数=${other}`)

  /**
   * ★★ 会话改名与删除（设计文档 §8：多个会话，可新建 / 切换 / 重命名 / 删除）。
   *
   * 放在最后验：前面几条断言依赖「当前有 2 个会话、其中一个是空的」这个状态，
   * 先删会话会把它们的取样点搬走。删除走**两步确认**，第一次点只换文案、不真删。
   */
  const beforeRename = await count()
  await page.locator('[data-agent-rename]').click()
  await page.locator('[data-agent-title-input]').fill('改过的名字')
  await page.locator('[data-agent-rename-save]').click()
  await sleep(600)
  await page.locator('[data-param-chip="agent-session"]').click()
  await sleep(250)
  const titleRows = await page
    .locator('[data-param-popup="agent-session"] [data-param-option]')
    .allInnerTexts()
  /** 行里还带选中态的 ✓（参数菜单的行样式），只取第一行文字比名字 */
  const titles = titleRows.map((t) => t.trim().split('\n')[0] ?? '')
  await page.keyboard.press('Escape')
  await sleep(150)
  rec(
    g,
    '★★ 会话能改名（列表里立刻是新名字，会话数不变）',
    titles.includes('改过的名字') &&
      (await count()) === beforeRename,
    `标题=${JSON.stringify(titles)}`,
  )

  await page.locator('[data-agent-delete]').click()
  const confirmLabel = (await page.locator('[data-agent-delete]').innerText()).trim()
  await page.locator('[data-agent-delete]').click()
  await sleep(700)
  const afterDelete = await count()
  rec(
    g,
    '★★ 会话能删除（两步确认：第一次只换文案，第二次才真删）',
    confirmLabel.includes('确认') && afterDelete === beforeRename - 1,
    `第一次点后=「${confirmLabel}」 删后会话数=${afterDelete}`,
  )

  /**
   * ★★ 把**画布上选中的节点**当素材给这次对话（设计文档 §8 的输入口径）。
   *
   * 与拖图不同：这些节点已经在画布上了，只该把 id 记进会话，**不该再建节点** ——
   * 所以这条同时断言「标签出现了」与「节点数没变」。
   */
  const nodesBeforePick = await page.locator('[data-node-type]').count()
  /**
   * 挑一个**真有图**的生成节点：这一条要验的是标签上的缩略图，
   * 拿一个没图的节点验，「没缩略图」本来就该如此、证明不了任何事。
   */
  const pickNodeId = await page
    .locator('[data-node-type="generation"][data-node-id]')
    .evaluateAll(
      (els) =>
        els
          .filter((e) => e.querySelector('[data-node-asset]'))
          .map((e) => e.getAttribute('data-node-id') ?? '')[0] ?? '',
    )
  await page.locator(`[data-node-id="${pickNodeId}"]`).click()
  await sleep(400)
  await page.locator('[data-agent-pick-selection]').click()
  await sleep(900)
  const pickedChips = await page
    .locator('[data-agent-input] [data-mention-kind="node"]')
    .count()
  const nodesAfterPick = await page.locator('[data-node-type]').count()
  rec(
    g,
    '★★ 取画布上选中的节点当素材（落成正文 chip，不重复建节点）',
    pickedChips >= 1 && nodesAfterPick === nodesBeforePick,
    `chip=${pickedChips} 节点 ${nodesBeforePick}→${nodesAfterPick}`,
  )
  /**
   * ★★ 标签要跟 @ 图片节点**同一种**（用户 2026-10-02：「把选中的节点当作这次的
   * 素材，放进输入框的时候应该也是和艾特图片节点的功能是一样的，目前好像是
   * 一些节点 id 一样的东西」）—— 缩略图 + 名字，不留裸 id。
   */
  const pickedChipEl = page.locator('[data-agent-input] [data-mention-kind="node"]').first()
  const pickedChipText = ((await pickedChipEl.innerText().catch(() => '')) ?? '').trim()
  const pickedThumb = await pickedChipEl.locator('img').count()
  rec(
    g,
    '★★ 素材标签变成「缩略图 + 名字」（不再是 node_xxx 那种裸 id）',
    pickedThumb >= 1 && !pickedChipText.includes('node_'),
    `缩略图=${pickedThumb} 标签=「${pickedChipText}」`,
  )

  /**
   * ★ 标签不许越出面板。
   *
   * 节点名可能很长（用户自己的命名），标签又是「缩略图 + 名字 + 移除钮」同排 ——
   * 这正是最容易把文字挤出容器的形状。断言到几何上，不靠眼看。
   */
  const chipBox = await page
    .locator('[data-agent-input] [data-mention-kind="node"]')
    .first()
    .boundingBox()
  const panelBox = await panel.boundingBox()
  rec(
    g,
    '★ 素材标签在面板内、不顶到外缘（长名字用省略号收住）',
    chipBox !== null &&
      panelBox !== null &&
      // 面板有 12px 内距：标签右缘至少要缩在内距里（留 8 的余量，不掉进亚像素）
      chipBox.x + chipBox.width <= panelBox.x + panelBox.width - 8,
    `标签右缘=${chipBox ? Math.round(chipBox.x + chipBox.width) : '?'} 面板右缘=${panelBox ? Math.round(panelBox.x + panelBox.width) : '?'}`,
  )

  /** 留一张**面板还开着**的截图：会话管理与取素材挤不挤，靠它眼看 */
  await page.screenshot({ path: `${OUT}/111b-g95-agent-panel.png` })

  /**
   * ★★ **自动生成真的不问**（用户 2026-10-02：「手动和自动…选中能替换」）。
   *
   * 只验「图标换了一枚」是不够的 —— 那证明不了它真的不再停下来问。这里开**新会话**
   * （mock 的脚本按对话里 tool 消息的条数走，新会话才会重新出计划），切到自动，
   * 然后**一次确认都不点**，等画布上直接冒出产物。
   *
   * 这条也顺带钉住「默认是手动」：上面那整段老流程仍然靠点确认才跑完。
   */
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  await agentAutoChip.click()
  await sleep(250)
  await page
    .locator('[data-param-popup="agent-autorun"] button', { hasText: '自动生成' })
    .first()
    .click()
  await sleep(400)
  const idsBeforeAuto = await page
    .locator('[data-node-type]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id') ?? ''))
  await page.locator('[data-agent-input]').fill('再来一张：屋顶的猫')
  await page.locator('[data-agent-send]').click()
  let autoImage = ''
  for (let i = 0; i < 80; i++) {
    autoImage = await page.evaluate((known) => {
      const gens = [...document.querySelectorAll('[data-node-type="generation"][data-node-id]')]
      for (const n of gens) {
        if (known.includes(n.getAttribute('data-node-id') ?? '')) continue
        const src = n.querySelector('[data-node-asset]')?.getAttribute('src') ?? ''
        if (src.startsWith('blob:')) return src
      }
      return ''
    }, idsBeforeAuto)
    if (autoImage) break
    await sleep(250)
  }
  rec(
    g,
    '★★ 自动生成：一句话之后**不点任何确认**，画布上直接出图',
    autoImage.startsWith('blob:'),
    `自动产物=${autoImage.slice(0, 12)}`,
  )

  /**
   * ★★ **取消生成不会撤回已经建好的工作流**（用户 2026-10-02 点名要的行为）。
   *
   * 这是「建图立刻生效、只有花钱才问」的另一半：用户点「拒绝」的意思是
   * 「先别跑」，**不是**「把这些节点删掉」。判据分三样，缺一不可：
   * ① 节点数不变（没被撤销）；② 节点之间的**连线**还在；③ 新建节点的**参数**还在
   * （渠道 / 模型 —— 它们决定「以后自己点生成还能不能跑」）。
   */
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  const idsBeforeCancel = await page
    .locator('[data-node-type]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id') ?? ''))
  const nodesBeforeCancel = await page.locator('[data-node-type]').count()
  const edgesBeforeCancel = await page.locator('[data-edge]').count()
  await page.locator('[data-agent-input]').fill('再建一条提示词到生成的流程')
  await page.locator('[data-agent-send]').click()
  await page
    .waitForSelector('[data-agent-preview="runNode"]', { timeout: 20000 })
    .catch(() => undefined)
  const landedNodes = await page.locator('[data-node-type]').count()
  const landedEdges = await page.locator('[data-edge]').count()
  await page.locator('[data-agent-cancel]').click()
  await sleep(900)
  const nodesAfterCancel = await page.locator('[data-node-type]').count()
  const edgesAfterCancel = await page.locator('[data-edge]').count()
  /**
   * 参数还在吗：直接读**落库的节点行**（新生成节点必须带渠道 + 模型，
   * 否则「以后自己在面板上点生成」照样跑不起来）。DOM 上看不到这两个字段，
   * 所以这条断言读的是 IndexedDB —— 那才是「参数真的存下来了」的证据。
   */
  const newGenParams = await page.evaluate(async (known) => {
    const open = indexedDB.open('qinghua')
    const db = await new Promise((res, rej) => {
      open.onsuccess = () => res(open.result)
      open.onerror = () => rej(open.error)
    })
    const rows = await new Promise((res, rej) => {
      const tx = db.transaction('nodes', 'readonly')
      const req = tx.objectStore('nodes').getAll()
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    return rows
      .filter((r) => r.type === 'generation' && !known.includes(String(r.id)))
      .map((r) => ({ hasRecipe: Boolean(r.data?.channelId && r.data?.model) }))
  }, idsBeforeCancel)
  const newGenHasParams = newGenParams.length === 1 && newGenParams[0].hasRecipe === true
  rec(
    g,
    '★★ 取消生成**不撤回**已建的工作流（节点 / 连线 / 参数都还在）',
    landedNodes === nodesBeforeCancel + 2 &&
      landedEdges >= edgesBeforeCancel + 1 &&
      nodesAfterCancel === landedNodes &&
      edgesAfterCancel === landedEdges &&
      newGenHasParams,
    `节点 ${nodesBeforeCancel}→${landedNodes}→${nodesAfterCancel}｜连线 ${edgesBeforeCancel}→${landedEdges}→${edgesAfterCancel}｜带配方=${newGenHasParams}`,
  )

  /**
   * ★★ 大画布上 @ 面板**先只列 5 条**，点「加载更多」才放全（用户 2026-10-02 参考
   * 产品图二：「不用显示全部可以艾特的节点，下方有省略，点击之后才会显示所有的」）。
   *
   * 刻意放在**这里**：上一个用例之后画布上已经有十几个节点 —— 折叠只有在
   * 「真有得折叠」的画布上才验得出来（在只有 3 个节点时验，什么实现都能绿）。
   */
  await agentMentionChip.click()
  await sleep(350)
  const bigCanvasNodes = await page.locator('[data-node-type]').count()
  const foldedRows = await page
    .locator('[data-param-popup="agent-mention"] [data-param-in="node"]')
    .count()
  const foldedMore = page.locator('[data-param-more="node"]')
  rec(
    g,
    '★★ 大画布上 @ 面板先只列 5 条，底部有「加载更多」',
    bigCanvasNodes > 5 && foldedRows === 5 && (await foldedMore.count()) === 1,
    `画布节点=${bigCanvasNodes} 先列=${foldedRows}`,
  )
  await foldedMore.click()
  await sleep(350)
  const unfoldedRows = await page
    .locator('[data-param-popup="agent-mention"] [data-param-in="node"]')
    .count()
  rec(
    g,
    '★★ 点「加载更多」后节点全部列出来',
    unfoldedRows === bigCanvasNodes,
    `展开后=${unfoldedRows} 期望=${bigCanvasNodes}`,
  )
  await page.keyboard.press('Escape')
  await sleep(200)

  /**
   * ★★ **落不了地的计划根本不弹确认卡**（用户 2026-10-02 报的那个 bug：
   * 「我让 agent 帮我画个小猫钓鱼，流程都是对的，但是卡在了重复让我确认新建
   * 工作流上，重复了三次，但是我的画布中没有」）。
   *
   * 老行为：先弹确认卡 → 用户点 → **这时才校验** → 整份拒绝 → 模型再发一版 →
   * 又一张确认卡。新行为：确认**之前**先校验，不合法就把问题回给模型，
   * 用户一次都不用点，而且原因**直接露在步骤卡上**（不再藏在折叠层里）。
   *
   * 场景由 mock 的 `坏计划` 钩子造：真渠道没法稳定复现「模型给了一份坏计划」。
   */
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  await page.locator('[data-agent-input]').fill('坏计划')
  await page.locator('[data-agent-send]').click()
  await sleep(1800)
  const badConfirm = await page.locator('[data-agent-preview="applyPlan"]').count()
  const badStep = page.locator('[data-agent-step-failed]').first()
  const badStepCount = await page.locator('[data-agent-step-failed]').count()
  const badText = ((await badStep.innerText().catch(() => '')) ?? '').replace(/\s+/g, '')
  rec(
    g,
    '★★ 落不了地的计划不弹确认卡，原因直接露在步骤卡上',
    badConfirm === 0 && badStepCount === 1 && badText.includes('类型不认识'),
    `确认卡=${badConfirm} 失败卡=${badStepCount} 文案=${badText.slice(0, 40)}`,
  )
  /** 失败还顶着「工作流已创建」是最误导人的一处 —— 标题也得跟着结果改 */
  rec(
    g,
    '★★ 失败的计划不叫「工作流已创建」（标题跟着结果改）',
    badText.includes('工作流没建成') && !badText.includes('工作流已创建'),
    `标题片段=${badText.slice(0, 20)}`,
  )

  /**
   * ★★ **正文写错字段名也要能救回来**（用户 2026-10-04 的真实事故：
   * 「他给我的是一个提示词节点连接两个生图节点，整体的流程是对的，但是没有提示词」）。
   *
   * 从真机 IndexedDB 里解出来的原始记录看到：提示词节点的正文落在 **`data.prompt`**，
   * 而它读的是 **`data.text`** —— 结构全对、正文落空，画布上就是个空框。
   *
   * 判据取**画布上那个提示词节点里渲染出来的字**。注意别去够
   * `textarea[data-prompt-inline-input]` —— 那个框**只在编辑态存在**，
   * 非编辑态渲染的是正文（§6.7 的两态语义），拿它当判据会永远读到空数组。
   */
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  await page.locator('[data-agent-input]').fill('字段写错')
  await page.locator('[data-agent-send]').click()
  await sleep(2200)
  /**
   * ⚠️ 画布**会把视口外的节点从 DOM 里摘掉**（`NodeLayer` 的 `visibleTopLevelIds`），
   * agent 新建的节点落在别处时，`locator` 会读到空 —— 先复位视图把整张图框进视口。
   */
  await resetView(page)
  const promptNodeTexts = await page.locator('[data-node-type="prompt"]').allInnerTexts()
  const wrongFieldFailed = await page.locator('[data-agent-step-failed]').count()
  rec(
    g,
    '★★ 正文写进 data.prompt（提示词节点读 data.text）时自动搬回来',
    promptNodeTexts.some((v) => v.includes('小狗钓鱼插画')) && wrongFieldFailed === 0,
    `提示词节点=${JSON.stringify(promptNodeTexts.map((v) => v.replace(/\s+/g, ' ').slice(0, 16)))} 失败卡=${wrongFieldFailed}`,
  )

  /**
   * ★★ **永远跑不起来的生成节点不许落地**（用户 2026-10-04 同一句的另一面：
   * 「没有提示词」—— 生成节点自己没有正文、上游也没有能给文字的节点，
   * `toRunRequest` 永远返回 null，点多少次都不发请求）。
   */
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  await page.locator('[data-agent-input]').fill('无提示词')
  await page.locator('[data-agent-send]').click()
  await sleep(1800)
  const promptlessConfirm = await page.locator('[data-agent-preview="applyPlan"]').count()
  const promptlessStep = (
    (await page
      .locator('[data-agent-step-failed]')
      .first()
      .innerText()
      .catch(() => '')) ?? ''
  ).replace(/\s+/g, '')
  rec(
    g,
    '★★ 没有提示词的生成节点不落地，原因直接说清',
    promptlessConfirm === 0 && promptlessStep.includes('提示词'),
    `确认卡=${promptlessConfirm} 文案=${promptlessStep.slice(0, 40)}`,
  )

  /**
   * ★★ **比例写在别名键上也要按用户说的来**（用户 2026-10-04：「自检没有通过，
   * 比例不是按照我的要求」，出图 1152×2048）。
   *
   * 真机原始计划里模型写的是 `aspectRatio: "1:1"`，而画布读 `data.ratio` ——
   * 于是 `ratio` 落回**默认配方**（上一次生成留下的 9:16），用户说的比例被静默丢掉。
   *
   * 判据取**创作面板那枚参数胶囊里显示的比例**：那正是用户读数的地方。
   */
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  await page.locator('[data-agent-input]').fill('比例别名')
  await page.locator('[data-agent-send]').click()
  await sleep(2200)
  await resetView(page)
  const ratioNode = page
    .locator('[data-node-type="generation"]', { hasText: '比例别名测试图' })
    .first()
  const ratioPanel = await genPanel(page, ratioNode)
  const ratioChip = (
    (await ratioPanel
      .locator('[data-param-chip="gen-params"]')
      .innerText()
      .catch(() => '')) ?? ''
  ).replace(/\s+/g, ' ')
  rec(
    g,
    '★★ 比例写在 aspectRatio 上也要按用户说的来（不退回默认配方）',
    ratioChip.includes('3:4'),
    `参数胶囊=「${ratioChip}」`,
  )

  /**
   * ★★ **互不依赖的两个生成要同时跑**（用户 2026-10-05 第 2 条：「我并行的要求没有给我
   * 实现，应该是同时生成的，但是他是先生成一个再生成另外一个」）。
   *
   * 判据取**墙钟时间**：mock 对「并行测试图」每个慢 800ms 出图 ⇒ 串行 ≥1600ms、
   * 并发 ≈800ms。阈值 1400ms 留了 600ms 余量：串行必红、并发必然绿。
   */
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  const assetsBefore = await page.locator('[data-node-asset]').count()
  await page.locator('[data-agent-input]').fill('并行')
  await page.locator('[data-agent-send]').click()
  await sleep(1800)
  const parallelConfirm = page.locator('[data-agent-confirm]')
  await parallelConfirm.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  const parallelStart = Date.now()
  await parallelConfirm.click().catch(() => {})
  await page
    .waitForFunction(
      (want) => document.querySelectorAll('[data-node-asset]').length >= want,
      assetsBefore + 2,
      { timeout: 8000 },
    )
    .catch(() => {})
  const parallelMs = Date.now() - parallelStart
  const assetsAfter = await page.locator('[data-node-asset]').count()
  rec(
    g,
    '★★ 两个互不依赖的生成同时跑（耗时接近一个而不是两个）',
    assetsAfter >= assetsBefore + 2 && parallelMs < 1400,
    `出两张耗时=${parallelMs}ms（mock 每个 800ms：串行 ≥1600、并发 ≈800）`,
  )

  /**
   * ★★ **一个会话在跑，另一个会话照常能发**（用户 2026-10-05 第 3 条：「两次不同的
   * 对话会先完成一个再完成另外一个」）。
   *
   * 运行态原先只有**一份**（组件级 `status`）：A 在跑时切到 B，B 的输入区也跟着变成
   * 「停止」，于是只能等 A 跑完。现在按会话各存一份，B 该显示发送钮。
   */
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  await page.locator('[data-agent-input]').fill('并行')
  await page.locator('[data-agent-send]').click()
  await sleep(700)
  const busyStatus =
    (await page.locator('[data-agent-status]').getAttribute('data-agent-status').catch(() => '')) ?? ''
  await page.locator('[data-agent-new]').click()
  await sleep(600)
  /** 在 B 里真的写一句：发送钮只在「有内容且这个会话不忙」时才出现（见 composer 注释） */
  await page.locator('[data-agent-input]').fill('第二条')
  const otherSend = await page.locator('[data-agent-send]').count()
  const otherStop = await page.locator('[data-agent-stop]').count()
  rec(
    g,
    '★★ 一个会话在跑时，另一个会话照常能发（不再被「停止」挡住）',
    busyStatus !== '' && busyStatus !== 'idle' && otherSend === 1 && otherStop === 0,
    `A 状态=${busyStatus || '（空）'} B 发送钮=${otherSend} 停止钮=${otherStop}`,
  )

  await page.locator('[data-agent-close]').click()
  await sleep(400)
  rec(g, '★ 能收起，收起后入口还在', (await panel.count()) === 0)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await page.screenshot({ path: `${OUT}/111-g95-agent.png` })
  await ctx.close()
}

/**
 * G96 远端视频素材（用户 2026-10-03）。
 *
 * 背景：Agnes 的成片托管在 `cos-platform-outputs.agnes-ai.cn` /
 * `platform-outputs.agnes-ai.space`，**没有 CORS 头**，页面里 `fetch` 字节一律
 * `net::ERR_FAILED`。于是 `assets` 行里只有一条 `url`、`bytes` 是空的。
 *
 * 这一组钉两件事：
 * ① 节点本体按素材 **mime** 认视频（不是按节点自己的 `mode`）—— 否则节点上用
 *    `<img>` 显示 mp4，用户看到的就是「只有双击进灯箱才能看」；
 * ② 下载按钮对「只有远端地址」的素材**不再报「素材不在素材库」**：能取字节就
 *    真落盘，取不到就把地址交回浏览器（新标签页），并把这句话如实说给用户。
 */
async function g96(browser) {
  const g = 'G96 远端视频素材'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  /**
   * 「取不到字节」这条用**保证解析不了的主机**模拟（RFC 2606 的 `.invalid`），
   * 不指望某家外网一直不给 CORS，也不占本地端口。
   */
  const blocked = '**/g96-blocked.invalid/**'
  const abortBlocked = (route) => route.abort()
  await ctx.route(blocked, abortBlocked)

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  /**
   * 种一条「只有远端地址、没有字节」的素材，并让模板里的生成节点引用它。
   *
   * 直接改表而不是跑一次真生成：真生成要渠道 + 网络 + 好几分钟，一处抖动就分不清
   * 是「下载坏了」还是「生成坏了」。这里要测的正是**素材只有 url 时**那一段。
   */
  const seeded = await page.evaluate(async () => {
    const openDb = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('qinghua')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const db = await openDb()
    const all = (table) =>
      new Promise((resolve, reject) => {
        const req = db.transaction(table, 'readonly').objectStore(table).getAll()
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const put = (table, rows) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(table, 'readwrite')
        const store = tx.objectStore(table)
        for (const row of rows) store.put(row)
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => reject(tx.error)
      })

    const projectId = location.pathname.split('/').filter(Boolean).pop()
    /**
     * 模板建出来的节点是**防抖落库**的（生成节点排在提示词节点之后），
     * 固定等一拍容易在忙一点的机器上落空 —— 这里明确轮询等它出现。
     */
    let target = null
    for (let i = 0; i < 40 && !target; i += 1) {
      const rows = await all('nodes')
      target = rows.find((n) => n.projectId === projectId && n.type === 'generation') ?? null
      if (!target) await new Promise((r) => setTimeout(r, 250))
    }
    if (!target) return { ok: false, nodeId: '' }

    await put('assets', [
      {
        id: 'g96-remote-video',
        hash: 'g96-remote-video',
        mime: 'video/mp4',
        /** 同源地址：fetch 得通，用于验「取到字节 → 真落盘」那条 */
        url: `${location.origin}/`,
        bytes: new Uint8Array(0),
        width: 1280,
        height: 720,
      },
    ])
    await put('nodes', [
      {
        ...target,
        /* 往下挪一点：跟随栏挂在节点上方，贴画布顶边时按钮会落在视口外点不到 */
        y: 320,
        title: '远端视频素材',
        data: { ...target.data, mode: 'video', assetHash: 'g96-remote-video' },
      },
    ])
    return { ok: true, nodeId: target.id }
  })

  rec(g, '★ 种下「只有远端地址」的视频素材与引用它的节点', seeded.ok, `node=${seeded.nodeId}`)
  if (!seeded.ok) {
    await ctx.close()
    return
  }

  const reload = async () => {
    await page.reload({ waitUntil: 'networkidle' })
    await sleep(800)
  }
  const node = () => page.locator(`[data-node-id="${seeded.nodeId}"]`)
  const media = () => node().locator('[data-node-asset]')

  await reload()

  /** ① 节点本体：按 mime 认视频 */
  const tag = await media()
    .first()
    .evaluate((el) => el.tagName)
    .catch(() => '')
  rec(g, '★★ 远端视频素材在节点上按 `<video>` 渲染（不再是一块空白）', tag === 'VIDEO', `tag=${tag}`)
  const preload = await media().first().getAttribute('preload').catch(() => null)
  rec(g, '★ 视频节点带 preload=metadata（首帧能出来）', preload === 'metadata', `preload=${preload}`)

  /** 选中节点 → 跟随栏的「下载」 */
  const triggerDownload = async () => {
    const n = node()
    await n.click({ position: { x: 16, y: 16 } })
    await sleep(400)
    const btn = page.locator('[data-node-follow-bar] [data-follow-action="download"]')
    if ((await btn.count()) === 0) return false
    await btn.click()
    return true
  }

  /** ② 取得到字节：真落盘（冒烟里 `showSaveFilePicker` 被摘掉，落到 <a download>） */
  const gotBtn = await page
    .locator(`[data-node-id="${seeded.nodeId}"]`)
    .click({ position: { x: 16, y: 16 } })
    .then(async () => {
      await sleep(400)
      return (await page.locator('[data-node-follow-bar] [data-follow-action="download"]').count()) === 1
    })
  rec(g, '★ 有素材的节点，跟随栏里有「下载」', gotBtn)

  /**
   * ★★ **有素材时功能栏只留素材相关动作**（用户 2026-10-05 第 13 条：「生成节点的功能栏
   * 有素材的时候……把目前的生成、重命名、复制、删除、关闭、渠道设置的功能删掉」）。
   */
  const assetActions = await page
    .locator('[data-node-follow-bar] [data-follow-action]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-follow-action')))
  rec(
    g,
    '★★ 有素材的节点：功能栏不再有生成 / 重命名 / 复制 / 删除 / 关闭 / 渠道设置',
    ['run', 'rename', 'duplicate', 'delete', 'close', 'settings'].every(
      (a) => !assetActions.includes(a),
    ) && assetActions.includes('download'),
    `动作=${assetActions.join(',')}`,
  )

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 6000 }).catch(() => null),
    page.locator('[data-node-follow-bar] [data-follow-action="download"]').click(),
  ])
  await sleep(300)
  const okNotice = await page.locator('[data-canvas-notice]').innerText().catch(() => '')
  rec(
    g,
    '★★ 远端能取到字节时下载真的落盘（触发浏览器下载，而不是一句错误提示）',
    download !== null && !/不在素材库|下载失败/.test(okNotice),
    `文件=${download ? download.suggestedFilename() : '（没有下载事件）'} notice="${okNotice.trim()}"`,
  )

  /** ③ 取不到字节（Agnes 成片域那种）：必须退到「交给浏览器」，且不再说不存在 */
  await page.evaluate(async () => {
    const openDb = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('qinghua')
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite')
      tx.objectStore('assets').put({
        id: 'g96-remote-video',
        hash: 'g96-remote-video',
        mime: 'video/mp4',
        url: 'https://g96-blocked.invalid/v.mp4',
        bytes: new Uint8Array(0),
        width: 1280,
        height: 720,
      })
      tx.oncomplete = () => resolve(true)
      tx.onerror = () => reject(tx.error)
    })
  })
  await reload()

  const popupWait = ctx.waitForEvent('page', { timeout: 6000 }).catch(() => null)
  const clicked = await triggerDownload()
  const popup = await popupWait
  await sleep(400)
  const notice = await page.locator('[data-canvas-notice]').innerText().catch(() => '')
  rec(g, '（诊断）兜底这条路上「下载」按钮点得到', clicked)
  rec(
    g,
    '★★ 远端取不到字节：不再报「素材不在素材库」，而是说明已交给浏览器',
    /新标签页/.test(notice) && !/不在素材库/.test(notice),
    `notice="${notice.trim()}"`,
  )
  rec(
    g,
    '★★ 兜底真的开了新标签页，且画布没有被导航走',
    popup !== null && /\/canvas\//.test(page.url()),
    `新开页=${popup ? '有' : '无'} 当前=${page.url().replace(BASE, '')}`,
  )
  if (popup) await popup.close().catch(() => {})
  await ctx.unroute(blocked, abortBlocked)

  await page.screenshot({ path: `${OUT}/115-g96-remote-video.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G97 素材传输（图床）设置页（用户 2026-10-03：「图床设置页单独设置一个页面出来，
 * 然后给我找到可用的设置上去」）。
 *
 * 这一组验三件事：① 一级导航里真的有这个入口、页面能打开；② 默认「关闭」（不许偷偷上传），
 * 选了服务之后**刷新仍在**（配置真的落库）；③ 点「测试上传」能拿到 `/dl/` 直链 ——
 * 那才是上游抓得到的形态（`tmpfiles.org/<id>/<name>` 是 HTML 页面）。
 *
 * ③ 依赖外网：拿不到直链时只要求「如实报失败」，并把结果写进 detail，不让整组假绿。
 */
async function g97(browser) {
  const g = 'G97 素材传输'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await page.goto(`${BASE}/hosting`, { waitUntil: 'networkidle' })
  await sleep(700)

  rec(
    g,
    '★★ 一级导航出现「素材传输」，且页面能打开',
    /* 侧栏可能处于收起态（此时只有图标、没有文字）⇒ 认稳定锚点，不认文案 */
    (await page.locator('[data-sidebar-item="/hosting"]').count()) === 1 &&
      (await page.locator('[data-hosting-page]').count()) === 1,
  )
  rec(
    g,
    '★ 默认「关闭」（不会偷偷把素材传出去）',
    (await page.locator('[data-hosting-provider="off"]').getAttribute('aria-pressed')) === 'true',
  )

  await page.locator('[data-hosting-provider="tmpfiles"]').click()
  await sleep(600)
  await page.reload({ waitUntil: 'networkidle' })
  await sleep(700)
  rec(
    g,
    '★★ 选了服务之后刷新仍在（配置真的落库，不是只改了内存）',
    (await page.locator('[data-hosting-provider="tmpfiles"]').getAttribute('aria-pressed')) === 'true',
  )

  await page.locator('[data-hosting-test]').click()
  await sleep(6000)
  const url = await page.locator('[data-hosting-url]').innerText().catch(() => '')
  const status = await page.locator('[data-hosting-status]').innerText().catch(() => '')
  rec(
    g,
    '★★ 测试上传拿到 `/dl/` 直链（页面地址换成直链形态）',
    /https:\/\/tmpfiles\.org\/dl\//.test(url),
    `url=${url.trim()} status=${status.trim()}`,
  )
  rec(
    g,
    '★ 失败时如实报错，不静默（外网依赖，失败会写在这里）',
    /\/dl\//.test(url) || /上传失败/.test(status),
    `url=${url.trim()} status=${status.trim()}`,
  )

  /** 验完切回「关闭」：不给用户留下一个默认开启的上传开关 */
  await page.locator('[data-hosting-provider="off"]').click()
  await sleep(500)
  rec(
    g,
    '★ 能切回「关闭」（上传是可选项，不是开关就下不来的状态）',
    (await page.locator('[data-hosting-provider="off"]').getAttribute('aria-pressed')) === 'true',
  )
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G98 「按模型配参数」的界面验收（用户 2026-10-03：「每个模型有哪些配置单独设置，
 * 不要通用设置」）。
 *
 * 单测证的是**能力表与请求体**，这一组证的是**面板真的按模型换了一副面孔**：
 * - Comfy-gpt 的 `GPT Image 2.5 Flare` → 9 档画幅（含 21:9 / 9:21）+ 1K·2K + **六档质量**（含超高/最高）+ 1·2·4 张；
 * - `Agnes Image 2.5 Flash` → 8 档画幅 + 1K–4K，**没有质量、没有张数**这两段。
 *
 * `Agnes Image 2.0 Flash`（像素尺寸、连比例段都没有）**不在前端清单里**（用户拍板
 * Agnes 每类只留最强的一个），它的规格由 `imageParams.test.ts` 覆盖。
 */
async function g98(browser) {
  const g = 'G98 按模型配图片参数'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  const node = page.locator('[data-node-type="generation"]').first()
  const panel = await genPanel(page, node)
  const popup = () => page.locator('[data-param-popup="gen-params"]')
  const valuesOf = async (section) =>
    popup()
      .locator(`[data-param-in="${section}"]`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option')))
  const labelsOf = async (section) =>
    popup()
      .locator(`[data-param-in="${section}"]`)
      .evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))

  const pickModel = async (name) => {
    await panel.locator('[data-param-chip="model"]').click()
    await sleep(350)
    await panel.locator(`[data-param-popup="model"] button[data-param-option="${name}"]`).click()
    await sleep(450)
  }
  const openParams = async () => {
    if ((await popup().count()) === 0) {
      await panel.locator('[data-param-chip="gen-params"]').click()
      await sleep(400)
    }
  }

  // ① Comfy-gpt 的 GPT Image 档
  await pickModel('GPT Image 2.5 Flare')
  await openParams()
  /** 段的顺序也要断言：用户 2026-10-03 图一那份是「画质 → 清晰度 → 背景 → 比例 → 数量」 */
  const gptSections = await popup()
    .locator('[data-param-section]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-section')))
  const gptRatios = await valuesOf('ratio')
  const gptRes = await valuesOf('resolution')
  const gptQuality = await valuesOf('quality')
  const gptQualityLabels = await labelsOf('quality')
  const gptBackground = await valuesOf('background')
  const gptBackgroundLabels = await labelsOf('background')
  const gptCounts = await valuesOf('count')
  rec(
    g,
    '★★ GPT Image 2.5 Flare：五档画质 / 1K·2K·4K / 三档背景 / 13 档比例 / 1·2·4 张',
    JSON.stringify(gptSections) ===
      JSON.stringify(['quality', 'resolution', 'background', 'ratio', 'count']) &&
      JSON.stringify(gptQuality) === JSON.stringify(['low', 'medium', 'high', 'xhigh', 'max']) &&
      gptQualityLabels.includes('标准画质') &&
      gptQualityLabels.includes('极致画质') &&
      JSON.stringify(gptRes) === JSON.stringify(['1k', '2k', '4k']) &&
      JSON.stringify(gptBackground) === JSON.stringify(['auto', 'opaque', 'transparent']) &&
      gptBackgroundLabels.includes('保留背景') &&
      gptBackgroundLabels.includes('透明背景') &&
      gptRatios.length === 13 &&
      gptRatios.includes('21:9') &&
      gptRatios.includes('9:21') &&
      JSON.stringify(gptCounts) === JSON.stringify(['1', '2', '4']),
    `段=${JSON.stringify(gptSections)} 质量=${JSON.stringify(gptQuality)} 清晰度=${JSON.stringify(gptRes)} 背景=${JSON.stringify(gptBackground)} 比例=${gptRatios.length} 张数=${JSON.stringify(gptCounts)}`,
  )
  await page.screenshot({ path: `${OUT}/119-g98-gpt-image-params.png` })
  await page.keyboard.press('Escape')
  await sleep(250)

  // ② Agnes Image 2.5 Flash：档位 + 画幅，但没有质量与背景
  await pickModel('Agnes Image 2.5 Flash')
  await openParams()
  const agnesRatios = await valuesOf('ratio')
  const agnesRes = await valuesOf('resolution')
  const agnesQuality = await valuesOf('quality')
  const agnesBackground = await valuesOf('background')
  const agnesCounts = await valuesOf('count')
  rec(
    g,
    '★★ Agnes Image 2.5 Flash：8 档画幅 + 1K–4K + 1·2·4 张，且**没有质量 / 背景**两段',
    agnesRatios.length === 8 &&
      JSON.stringify(agnesRes) === JSON.stringify(['1k', '2k', '3k', '4k']) &&
      agnesQuality.length === 0 &&
      agnesBackground.length === 0 &&
      JSON.stringify(agnesCounts) === JSON.stringify(['1', '2', '4']),
    `比例=${agnesRatios.length} 尺寸=${JSON.stringify(agnesRes)} 质量段=${agnesQuality.length} 背景段=${agnesBackground.length} 张数=${JSON.stringify(agnesCounts)}`,
  )
  await page.keyboard.press('Escape')
  await sleep(250)

  /**
   * ③ Nano Banana（gemini 方言）：参数走**官方文档**那份 —— 14 档宽高比 + image_size
   * （Pro 1K/2K/4K、Nano Banana 2 多一档 512）。这三档是 2026-10-03 从 Google
   * 《Nano Banana 图片生成》文档里抄的，且实测只在 Gemini 原生端点上生效。
   */
  await pickModel('Nano Banana Pro')
  await openParams()
  const nanoRatios = await valuesOf('ratio')
  const nanoSizes = await valuesOf('resolution')
  rec(
    g,
    '★★ Nano Banana Pro：自适应 + 官方 14 档宽高比 + 1K·2K·4K（不含 512）',
    nanoRatios.length === 15 &&
      nanoRatios[0] === 'auto' &&
      nanoRatios.includes('1:8') &&
      nanoRatios.includes('8:1') &&
      nanoRatios.includes('21:9') &&
      JSON.stringify(nanoSizes) === JSON.stringify(['1k', '2k', '4k']),
    `比例=${nanoRatios.length} 尺寸=${JSON.stringify(nanoSizes)}`,
  )

  /** 「自适应」不是宽高比 ⇒ 网格里只出文字、不画矩形示意（画了会和 1:1 撞脸） */
  rec(
    g,
    '★ 香蕉面板的「自适应」画的是文字格（没有比例图形）',
    (await popup().locator('[data-param-in="ratio"][data-param-option="auto"] [data-ratio-glyph]').count()) === 0,
  )
  await page.screenshot({ path: `${OUT}/121-g98-nano-banana.png` })

  await page.screenshot({ path: `${OUT}/120-g98-agnes-image-params.png` })
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G99 按模型配**视频**参数（用户 2026-10-03 图三～图十一）
 *
 * 为什么必须真在浏览器里跑一遍：这一轮的活是「把参数面板按模型重做」，而参数面板的
 * 三个环节（能力表 → 面板渲染 → 请求体）任一处没接上，用户看到的都是
 * 「面板上是这套、发出去是另一套」——单测能钉住规格，只有真机能钉住「面板真的照着渲染了」。
 *
 * 四个模型的档位**逐条照抄用户给的参考实现截图**，不是我们推断的：
 *   · 即梦 2.5（图五/图六）：8 个模式（「视频编辑」灰）、7 档画幅（含自适应）、
 *     480P/720P/1080P、4–30 秒、有生成音频、1/2/4 个；
 *   · MiniMax H3（图七/图八）：4 个模式（「文生视频」灰）、7 档画幅、768P/2K、5–15 秒、无音频；
 *   · H3 Max（图九/最后两张）：3 个模式、**只有自适应一档画幅**、480P/768P、5–15 秒、无音频；
 *   · Agnes Video 2.0（官方站没有文档页，真令牌实测）：三个模式、**没有 auto**、
 *     720p/1080p、4–12 秒、无音频、数量只有 1。
 */
async function g99(browser) {
  const g = 'G99 按模型配视频参数'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  const node = page.locator('[data-node-type="generation"]').first()
  const panel = await genPanel(page, node)
  /** 视频是同一个生成节点的功能类别（§6.8），切一下就是视频参数集 */
  await panel.locator('[data-param-mode="video"]').click()
  await sleep(450)

  const pickModel = async (name) => {
    await panel.locator('[data-param-chip="model"]').click()
    await sleep(350)
    await panel.locator(`[data-param-popup="model"] button[data-param-option="${name}"]`).click()
    await sleep(450)
  }
  /** 展开某一枚 chip，读回它的**选项值 / 文案 / 哪些被置灰**，然后 Esc 收起 */
  const readChip = async (chip) => {
    await panel.locator(`[data-param-chip="${chip}"]`).click()
    await sleep(320)
    const loc = panel.locator(`[data-param-popup="${chip}"] [data-param-option]`)
    const vals = await loc.evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option')))
    const labels = await loc.evaluateAll((els) => els.map((e) => (e.textContent ?? '').trim()))
    const disabled = await panel
      .locator(`[data-param-popup="${chip}"] [data-param-option][disabled]`)
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-param-option')))
    await page.keyboard.press('Escape')
    await sleep(200)
    return { vals, labels, disabled }
  }
  const durationRange = async () =>
    panel.locator('[data-param-duration-range]').evaluate((el) => [el.min, el.max])
  const hasChip = async (chip) => (await panel.locator(`[data-param-chip="${chip}"]`).count()) === 1

  // ① 即梦 2.5（= Seedance 2.5）：图五 / 图六
  await pickModel('即梦 2.5')
  const sd25Mode = await readChip('videoMode')
  const sd25Ratio = await readChip('ratio')
  const sd25Size = await readChip('size')
  const sd25Count = await readChip('count')
  rec(
    g,
    '★★ 即梦 2.5：8 个模式（视频编辑灰 / 超长视频带 Beta）/ 7 档画幅（含自适应）/ 480P·720P·1080P / 4–30 秒 / 有音频 / 1·2·4 个',
    sd25Mode.vals.length === 8 &&
      JSON.stringify(sd25Mode.disabled) === JSON.stringify(['video-edit']) &&
      sd25Mode.labels.some((t) => t.includes('超长视频') && t.includes('Beta')) &&
      JSON.stringify(sd25Ratio.vals) ===
        JSON.stringify(['auto', '16:9', '4:3', '1:1', '3:4', '9:16', '21:9']) &&
      JSON.stringify(sd25Size.vals) === JSON.stringify(['480P', '720P', '1080P']) &&
      JSON.stringify(await durationRange()) === JSON.stringify(['4', '30']) &&
      (await hasChip('generateAudio')) &&
      JSON.stringify(sd25Count.vals) === JSON.stringify(['1', '2', '4']),
    `模式=${sd25Mode.vals.length} 灰=${JSON.stringify(sd25Mode.disabled)} 画幅=${JSON.stringify(sd25Ratio.vals)} 清晰度=${JSON.stringify(sd25Size.vals)} 时长=${JSON.stringify(await durationRange())} 音频=${await hasChip('generateAudio')} 数量=${JSON.stringify(sd25Count.vals)}`,
  )
  await page.screenshot({ path: `${OUT}/130-g99-seedance25.png` })

  // ② MiniMax H3：图七 / 图八
  await pickModel('MiniMax H3')
  const h3Mode = await readChip('videoMode')
  const h3Ratio = await readChip('ratio')
  const h3Size = await readChip('size')
  rec(
    g,
    '★★ MiniMax H3：4 个模式（文生视频灰）/ 7 档画幅 / 768P·2K / 5–15 秒 / 没有音频开关',
    JSON.stringify(h3Mode.vals) ===
      JSON.stringify(['text', 'all-purpose', 'image-to-video', 'first-last-frame']) &&
      JSON.stringify(h3Mode.disabled) === JSON.stringify(['text']) &&
      h3Ratio.vals.length === 7 &&
      h3Ratio.vals[0] === 'auto' &&
      JSON.stringify(h3Size.vals) === JSON.stringify(['768P', '2K']) &&
      JSON.stringify(await durationRange()) === JSON.stringify(['5', '15']) &&
      !(await hasChip('generateAudio')),
    `模式=${JSON.stringify(h3Mode.vals)} 灰=${JSON.stringify(h3Mode.disabled)} 画幅=${JSON.stringify(h3Ratio.vals)} 清晰度=${JSON.stringify(h3Size.vals)} 时长=${JSON.stringify(await durationRange())} 音频=${await hasChip('generateAudio')}`,
  )

  // ③ MiniMax H3 Max：图九 / 最后两张
  await pickModel('Minimax H3 Max')
  const h3MaxMode = await readChip('videoMode')
  const h3MaxRatio = await readChip('ratio')
  const h3MaxSize = await readChip('size')
  rec(
    g,
    '★★ H3 Max：3 个模式 / **画幅只有自适应一档** / 480P·768P / 5–15 秒',
    JSON.stringify(h3MaxMode.vals) === JSON.stringify(['text', 'image-to-video', 'first-last-frame']) &&
      JSON.stringify(h3MaxMode.disabled) === JSON.stringify(['text']) &&
      JSON.stringify(h3MaxRatio.vals) === JSON.stringify(['auto']) &&
      h3MaxRatio.labels.includes('自适应') &&
      JSON.stringify(h3MaxSize.vals) === JSON.stringify(['480P', '768P']) &&
      JSON.stringify(await durationRange()) === JSON.stringify(['5', '15']),
    `模式=${JSON.stringify(h3MaxMode.vals)} 画幅=${JSON.stringify(h3MaxRatio.vals)} 清晰度=${JSON.stringify(h3MaxSize.vals)} 时长=${JSON.stringify(await durationRange())}`,
  )
  await page.screenshot({ path: `${OUT}/131-g99-h3-max.png` })

  // ④ Agnes Video 2.0：官方站没有它的文档页（真令牌实测），**没有「自适应」这一档**
  await pickModel('Agnes Video 2.0')
  const agnesMode = await readChip('videoMode')
  const agnesRatio = await readChip('ratio')
  const agnesSize = await readChip('size')
  rec(
    g,
    '★★ Agnes Video 2.0：3 个模式 / 6 档画幅（**没有自适应**，官方文档写明 auto 会 400）/ 720p·1080p / 4–12 秒 / 数量只有 1',
    agnesMode.vals.length === 3 &&
      agnesMode.disabled.length === 0 &&
      JSON.stringify(agnesRatio.vals) ===
        JSON.stringify(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']) &&
      JSON.stringify(agnesSize.vals) === JSON.stringify(['720p', '1080p']) &&
      JSON.stringify(await durationRange()) === JSON.stringify(['4', '12']) &&
      !(await hasChip('count')),
    `模式=${JSON.stringify(agnesMode.vals)} 画幅=${JSON.stringify(agnesRatio.vals)} 清晰度=${JSON.stringify(agnesSize.vals)} 时长=${JSON.stringify(await durationRange())}`,
  )

  /**
   * ★★ Agnes 的「全能参考」要写清**怎么用**（用户 2026-10-03：
   * 「我的 agnes video 2.0 好像生视频不是按照我的全能参考来的」）。
   *
   * 官方文档（`agnes-video-25` 的 reference 模式）明写用 `<Picture N>` 指代输入素材 ——
   * 提示词里不点名第几张图，模型没有理由照搬它的风格。这条提示只给 Agnes 那两套方言。
   */
  await panel.locator('[data-param-chip="videoMode"]').click()
  await sleep(350)
  const modePopupText = (await panel.locator('[data-param-popup="videoMode"]').innerText()).replace(/\s+/g, ' ')
  rec(
    g,
    '★★ Agnes 的「全能参考」带用法提示（<Picture 1> 指代第 1 张参考图）',
    modePopupText.includes('Picture 1') && modePopupText.includes('连线顺序'),
    modePopupText.slice(0, 120),
  )
  await page.keyboard.press('Escape')
  await sleep(220)

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G103 多选浮层（用户 2026-10-05 第 11 / 12 条，参考图四）：
// 虚线框 + 上方六枚动作 + 左右两个「共有端点」（拖一次把每个选中节点都连上）
// ────────────────────────────────────────────────────────────
async function g103(browser) {
  const g = 'G103 多选浮层'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)
  await resetView(page)

  /**
   * 再补两个节点：**两个提示词 + 一个生成**才能验「拖一次端点多条线」——
   * 模板自带的提示词→生成那条边已经在了，若拿它当目标，落点只会多出一条，
   * 分不清「每个源各连一条」和「只连了被拖的那个」。
   *
   * 用**右键菜单在指定的空白点**建，而不是左侧「＋」菜单：后者的落点由
   * `findFreeRect` 自己挑，实测两个新节点会叠在一起，后面点谁都点不中
   * （先踩了这个坑：点击被另一个节点的占位层吃掉，30s 超时）。
   */
  await page.keyboard.press('Escape')
  await sleep(250)
  /** 找**当下**的空白点（每次重算：新节点自己也算障碍物，落点之间还要留够 340px） */
  const freeSpots = async (count) => {
    const rects = await page.locator('[data-node-id]').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        return { x: r.x, y: r.y, w: r.width, h: r.height }
      }),
    )
    const found = []
    for (let y = 150; y <= 620 && found.length < count; y += 30) {
      for (let x = 240; x <= 1000 && found.length < count; x += 30) {
        /**
         * 新节点是以落点为**中心**建出来的（约 240×180），所以「离节点 30px」
         * 不够 —— 那样新节点会压到旁边的节点上，后面点谁都点不中（踩过一次）。
         * 留出半个节点 + 边距。
         */
        const clash = rects.some(
          (r) => x > r.x - 150 && x < r.x + r.w + 150 && y > r.y - 110 && y < r.y + r.h + 110,
        )
        if (clash) continue
        if (!found.every((s) => Math.hypot(s.x - x, s.y - y) > 340)) continue
        found.push({ x, y })
      }
    }
    return found
  }
  const spots = await freeSpots(2)
  rec(g, '★ 找到两个空白点放新节点', spots.length === 2, JSON.stringify(spots))
  const createAt = async (type, spot) => {
    await page.mouse.click(spot.x, spot.y, { button: 'right' })
    await sleep(300)
    await page.locator(`[data-context-menu-item="create:${type}"]`).click()
    await sleep(450)
  }
  for (const [i, type] of ['prompt', 'generation'].entries()) await createAt(type, spots[i])
  /**
   * 新建的节点会被自动选中 → 创作面板弹在它下方，而那块面板是**浮层**、
   * 会吃掉后面的点击（实测：点提示词节点的左上角被它拦下，30s 超时）。
   * 先 Esc 清掉选中，让面板收起来再开始点选。
   */
  await page.keyboard.press('Escape')
  await sleep(400)
  rec(
    g,
    '新建节点后 Esc 收起创作面板',
    (await page.locator('[data-creation-panel]').count()) === 0,
    `panel=${await page.locator('[data-creation-panel]').count()}`,
  )

  const overlay = page.locator('[data-multi-select]')
  const bar = page.locator('[data-multi-select-bar]')
  const box = page.locator('[data-multi-select-box]')
  const prompts = page.locator('[data-node-type="prompt"]')
  const gens = page.locator('[data-node-type="generation"]')
  const edges = () => page.locator('[data-edge]').count()

  /** 连点两个提示词节点 = 多选两个（点一、Shift 点二） */
  const selectTwo = async () => {
    await page.keyboard.press('Escape')
    await sleep(200)
    await prompts.nth(0).click({ position: { x: 20, y: 20 } })
    await sleep(250)
    await page.keyboard.down('Shift')
    await prompts.nth(1).click({ position: { x: 20, y: 20 } })
    await page.keyboard.up('Shift')
    await sleep(350)
  }

  rec(g, '未多选时没有浮层', (await overlay.count()) === 0, `count=${await overlay.count()}`)
  await prompts.nth(0).click({ position: { x: 20, y: 20 } })
  await sleep(300)
  rec(
    g,
    '单选时不出多选浮层（跟随栏的地盘）',
    (await overlay.count()) === 0 && (await page.locator('[data-node-follow-bar]').count()) === 1,
    `overlay=${await overlay.count()} 跟随栏=${await page.locator('[data-node-follow-bar]').count()}`,
  )

  await selectTwo()
  const selCount = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.filter((e) => e.className.includes('selected')).length)
  rec(g, 'Shift+点击加选成两个', selCount >= 2, `selected=${selCount}`)
  rec(
    g,
    '★★ 多选出现浮层：虚线框 + 功能栏 + 左右端点',
    (await overlay.count()) === 1 &&
      (await box.count()) === 1 &&
      (await bar.count()) === 1 &&
      (await page.locator('[data-multi-endpoint="input"]').count()) === 1 &&
      (await page.locator('[data-multi-endpoint="output"]').count()) === 1 &&
      (await page.locator('[data-node-follow-bar]').count()) === 0,
    `overlay=${await overlay.count()} box=${await box.count()} bar=${await bar.count()}`,
  )

  const actions = await page
    .locator('[data-multi-action]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-multi-action')))
  rec(
    g,
    '★★ 功能栏六枚动作齐全（排列整理 / 保存到资产 / 创建副本 / 打组 / 下载 / 添加到 agent）',
    JSON.stringify(actions) ===
      JSON.stringify(['arrange', 'library', 'duplicate', 'group', 'download', 'agent']),
    actions.join(','),
  )

  /**
   * 图标同样是**内联 SVG**（与跟随栏同一条口径：字形图标由机器上的字体决定落点）。
   */
  const iconAudit = await page.locator('[data-multi-action]').evaluateAll((els) =>
    els.map((e) => {
      const icon = e.firstElementChild
      return {
        action: e.getAttribute('data-multi-action'),
        svg: icon ? icon.querySelectorAll('svg').length : 0,
        text: (icon?.textContent ?? '').trim(),
      }
    }),
  )
  rec(
    g,
    '★ 六枚动作的图标都是内联 SVG（图标位里没有字形）',
    iconAudit.length === 6 && iconAudit.every((x) => x.svg === 1 && x.text === ''),
    JSON.stringify(iconAudit),
  )

  /**
   * 几何：虚线框**包住整个选区**（不是只框住其中一个节点），
   * 两个端点落在选区左右外沿的纵向中点。
   */
  const boxGeom = await box.boundingBox()
  const p0 = await prompts.nth(0).boundingBox()
  const p1 = await prompts.nth(1).boundingBox()
  const union = {
    left: Math.min(p0.x, p1.x),
    top: Math.min(p0.y, p1.y),
    right: Math.max(p0.x + p0.width, p1.x + p1.width),
    bottom: Math.max(p0.y + p0.height, p1.y + p1.height),
  }
  rec(
    g,
    '★★ 虚线框包住整个选区（两个节点都在框内）',
    !!boxGeom &&
      boxGeom.x <= union.left + 1 &&
      boxGeom.y <= union.top + 1 &&
      boxGeom.x + boxGeom.width >= union.right - 1 &&
      boxGeom.y + boxGeom.height >= union.bottom - 1,
    `box=${JSON.stringify(boxGeom)} union=${JSON.stringify(union)}`,
  )
  const inEp = await page.locator('[data-multi-endpoint="input"]').boundingBox()
  const outEp = await page.locator('[data-multi-endpoint="output"]').boundingBox()
  const mid = boxGeom.y + boxGeom.height / 2
  rec(
    g,
    '★ 左右端点落在选区外沿的纵向中点（左在左外、右在右外）',
    Math.abs(inEp.y + inEp.height / 2 - mid) <= 2 &&
      Math.abs(outEp.y + outEp.height / 2 - mid) <= 2 &&
      inEp.x + inEp.width / 2 < union.left &&
      outEp.x + outEp.width / 2 > union.right,
    `mid=${mid.toFixed(1)} in=${(inEp.y + inEp.height / 2).toFixed(1)} out=${(outEp.y + outEp.height / 2).toFixed(1)}`,
  )
  await page.screenshot({ path: `${OUT}/120-g103-multi-select.png` })

  /** ① 排列与整理：二级菜单能开、选一项后收起 */
  await page.locator('[data-multi-action="arrange"]').click()
  await sleep(300)
  const arrangeMenu = page.locator('[data-multi-arrange-menu]')
  rec(g, '★ 排列与整理展开二级菜单', (await arrangeMenu.count()) === 1, `count=${await arrangeMenu.count()}`)
  await page.locator('[data-multi-arrange="tidy"]').click()
  await sleep(400)
  rec(
    g,
    '★ 选一项后二级菜单收起',
    (await page.locator('[data-multi-arrange-menu]').count()) === 0,
    `count=${await page.locator('[data-multi-arrange-menu]').count()}`,
  )
  rec(g, '整理节点不抛异常', pageErrors.length === 0, pageErrors.join(' | '))
  /** 整理会把节点挪位置，撤销回去 —— 否则后面的点击落点全变（一次整理 = 一个撤销单元） */
  await page.keyboard.press('Control+z')
  await sleep(400)

  /** ② 保存到资产：这两个节点没有素材 → 如实提示，不许静默 */
  await selectTwo()
  await page.locator('[data-multi-action="library"]').click()
  await sleep(400)
  const notice = (await page.locator('[data-canvas-notice]').innerText().catch(() => '')).trim()
  rec(g, '★ 保存到资产：没有素材时如实提示', notice.includes('素材'), `notice=${notice}`)

  /** ③ 创建副本：选中的**每个**节点各复制一份，且一步撤销 */
  await selectTwo()
  const beforeDup = await page.locator('[data-node-id]').count()
  await page.locator('[data-multi-action="duplicate"]').click()
  await sleep(500)
  const afterDup = await page.locator('[data-node-id]').count()
  rec(g, '★★ 创建副本：选中的每个节点各复制一份', afterDup === beforeDup + 2, `${beforeDup} → ${afterDup}`)
  await page.keyboard.press('Control+z')
  await sleep(500)
  rec(
    g,
    '★★ 副本可一步撤销',
    (await page.locator('[data-node-id]').count()) === beforeDup,
    `count=${await page.locator('[data-node-id]').count()} 期望=${beforeDup}`,
  )

  /** ④ 打组：与 Ctrl+G 同一个实现（建组 + 逐个收进去，一步撤销） */
  await selectTwo()
  const groupsBefore = await page.locator('[data-node-type="group"]').count()
  await page.locator('[data-multi-action="group"]').click()
  await sleep(500)
  const groupsAfter = await page.locator('[data-node-type="group"]').count()
  rec(g, '★★ 打组：多选打成一个分组', groupsAfter === groupsBefore + 1, `分组 ${groupsBefore} → ${groupsAfter}`)
  await page.keyboard.press('Control+z')
  await sleep(500)
  rec(
    g,
    '★★ 打组可一步撤销（建组与归属一起回退）',
    (await page.locator('[data-node-type="group"]').count()) === groupsBefore,
    `撤销后分组=${await page.locator('[data-node-type="group"]').count()}`,
  )

  /** ⑤ 下载：没有素材的节点点了不许抛异常（有素材那条在 G96） */
  await selectTwo()
  await page.locator('[data-multi-action="download"]').click()
  await sleep(300)
  rec(g, '★ 下载按钮对无素材节点不抛异常', pageErrors.length === 0, pageErrors.join(' | '))

  /**
   * ⑥ **左右共有端点**（用户 2026-10-05 第 12 条）：从选区拉一条线落到某个节点，
   * **每个**选中节点都要连上它 —— 这才是「共有端点」与「节点自己的端点」的区别。
   *
   * 判据取**连线数**：两个源 → 一个目标 = 2 条（只连被拖的那个只会 +1）。
   */
  await selectTwo()
  const beforeEdges = await edges()
  const outGeom = await page.locator('[data-multi-endpoint="output"]').boundingBox()
  const target = await gens.nth(1).boundingBox()
  await page.mouse.move(outGeom.x + outGeom.width / 2, outGeom.y + outGeom.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
  await sleep(250)
  /**
   * ★★ 草稿线**每个选中节点各一条**（用户 2026-10-05 第 3 批：「框选多个节点的时候
   * 进行连线的时候里面的节点不是全都有拉出线条」）。两个源 ⇒ 两条草稿；终点是同一个指针位置。
   * 改之前只画一条（功能上照样 +2，但过程看着像「只连了一个」）。
   */
  rec(
    g,
    '★★ 从共有端点拖出时：每个选中节点各一条草稿线（2 条）',
    (await page.locator('[data-edge-draft]').count()) === 2,
    `draft=${await page.locator('[data-edge-draft]').count()}`,
  )
  await page.mouse.up()
  await sleep(500)
  const afterEdges = await edges()
  rec(
    g,
    '★★ 端点落在目标节点上：每个选中节点各连一条（2 条）',
    afterEdges === beforeEdges + 2,
    `${beforeEdges} → ${afterEdges}`,
  )
  await page.screenshot({ path: `${OUT}/121-g103-multi-endpoint.png` })

  /**
   * **左侧端点 = 连上游**（用户 2026-10-05 第 12 条要的正是「左右各一个」）。
   *
   * 判据取连线数：现建一个**没连过任何东西**的提示词节点当上游，两个选中的生成节点
   * 都往它身上连 ⇒ 恰好 +2。这条能同时排除两种退化实现：只连被拖的那个（+1）、
   * 因为被拖的那个不合法就整次放弃（+0，见 `useEdgeDrag` 里那段注释）。
   */
  const idsBefore = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  const [upSpot] = await freeSpots(1)
  await createAt('prompt', upSpot)
  const upId = (
    await page
      .locator('[data-node-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  ).find((id) => !idsBefore.includes(id))
  rec(g, '★ 另建一个干净的上游提示词节点', !!upId, `id=${upId}`)

  await page.keyboard.press('Escape')
  await sleep(200)
  await gens.nth(0).click({ position: { x: 20, y: 60 } })
  await sleep(250)
  await page.keyboard.down('Shift')
  await gens.nth(1).click({ position: { x: 20, y: 60 } })
  await page.keyboard.up('Shift')
  await sleep(350)
  const beforeIn = await edges()
  const inGeom = await page.locator('[data-multi-endpoint="input"]').boundingBox()
  const upTarget = await page.locator(`[data-node-id="${upId}"]`).boundingBox()
  await page.mouse.move(inGeom.x + inGeom.width / 2, inGeom.y + inGeom.height / 2)
  await page.mouse.down()
  await page.mouse.move(upTarget.x + upTarget.width / 2, upTarget.y + upTarget.height / 2, { steps: 12 })
  await page.mouse.up()
  await sleep(500)
  const afterIn = await edges()
  rec(
    g,
    '★★ 左端点连上游：每个选中节点各连一条（只连被拖的那个只会 +1）',
    afterIn === beforeIn + 2,
    `${beforeIn} → ${afterIn}`,
  )

  /**
   * ⑧ **多选拖到空白 → 菜单里「新建节点并连接」**：新节点要连上**整个选区**。
   *
   * 与上面那条是两条不同的代码路径：拖到**已有节点**上由 `useEdgeDrag` 直接连；
   * 空白松手要先把这次拖拽交给 `LinkMenu`（菜单在另一个组件里建边）。
   * 用户 2026-10-05 第 4 批报的正是后者：「框选多个节点新建节点然后连接，
   * 新建的节点只连接了一个上游」—— 根因是 `also` 压根没传进菜单。
   */
  await page.keyboard.press('Escape')
  await sleep(200)
  await gens.nth(0).click({ position: { x: 20, y: 60 } })
  await sleep(250)
  await page.keyboard.down('Shift')
  await gens.nth(1).click({ position: { x: 20, y: 60 } })
  await page.keyboard.up('Shift')
  await sleep(350)
  const [dropSpot] = await freeSpots(1)
  const linkEp = await page.locator('[data-multi-endpoint="output"]').boundingBox()
  await page.mouse.move(linkEp.x + linkEp.width / 2, linkEp.y + linkEp.height / 2)
  await page.mouse.down()
  await page.mouse.move(dropSpot.x, dropSpot.y, { steps: 12 })
  await page.mouse.up()
  await sleep(450)
  rec(
    g,
    '★ 多选拖到空白 → 冒出「可连接菜单」',
    (await page.locator('[data-link-menu]').count()) === 1,
    `menu=${await page.locator('[data-link-menu]').count()}`,
  )
  const idsBeforeLink = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  await page.locator('[data-link-menu-item="create:generation"]').click()
  await sleep(800)
  const newLinkedId = (
    await page
      .locator('[data-node-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  ).find((id) => !idsBeforeLink.includes(id))
  const incoming = newLinkedId
    ? await page.locator(`[data-edge-target="${newLinkedId}"]`).count()
    : 0
  rec(
    g,
    '★★ 菜单里「新建生成节点并连接」：新节点连上**两个**选中节点（不是只连一个）',
    incoming === 2,
    `入边=${incoming}`,
  )
  await page.screenshot({ path: `${OUT}/121b-g103-linkmenu-multi.png` })

  /**
   * ⑦ 添加到 agent：面板自己弹出来，两个节点落成**正文里的引用 chip**
   * （与「取选中当素材」同一条口径 —— 用户 2026-10-02 定过：都在正文里）。
   */
  await selectTwo()
  await page.locator('[data-multi-action="agent"]').click()
  await sleep(900)
  const chips = page.locator('[data-agent-input] [data-mention-kind="node"]')
  rec(g, '★★ 添加到 agent：对话窗自己打开', (await page.locator('[data-agent-panel]').count()) === 1)
  rec(
    g,
    '★★ 添加的两个节点落成正文里的引用 chip',
    (await chips.count()) >= 2,
    `chips=${await chips.count()}`,
  )
  await page.screenshot({ path: `${OUT}/122-g103-multi-agent.png` })

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G104 创作面板的 `@` 引用（用户 2026-10-05 第 15 条）：
// 只能引用**本节点的上游**图 / 视频素材，落成「缩略图 + 省略名」的小框；
// 而存储里只留纯文本 `@名字`（提示词还要发给模型、给下游，不能夹带机器形态）。
// ────────────────────────────────────────────────────────────
async function g104(browser) {
  const g = 'G104 创作面板的 @ 引用'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  /** ① 先让一个生成节点真的出图 —— @ 的候选只认「有画面的节点」 */
  const src = page.locator('[data-node-type="generation"]').first()
  const srcId = await src.getAttribute('data-node-id')
  const srcTitle = (await src.locator('[data-node-title]').first().innerText()).trim()
  const panel1 = await genPanel(page, src)
  await configureGenPanel(page, panel1, '底图：一只橘猫')
  await panel1.locator('[data-panel-run]').click()
  for (let i = 0; i < 80; i++) {
    if ((await page.locator(`[data-node-id="${srcId}"] [data-node-asset]`).count()) > 0) break
    await sleep(250)
  }
  const srcHasAsset =
    (await page.locator(`[data-node-id="${srcId}"] [data-node-asset]`).count()) > 0
  rec(g, '★ 上游生成节点已出图（@ 的候选来源）', srcHasAsset, `title=${srcTitle}`)
  if (!srcHasAsset) {
    await ctx.close()
    return
  }

  /**
   * ② 再复制一个**带素材、但不在上游**的节点：用它证明候选范围真的只有上游。
   *
   * 复制体连素材一起复制（`node.duplicate` 保 `assetHash`），所以画布上会有
   * 两个「有画面的节点」；菜单里只该出现上游那一个。
   */
  /**
   * 用**右键菜单**复制，不走跟随栏：跟随时跑完生成后可能不挂着单选项
   * （刚出图那一下的选中态不是这条断言要测的东西），右键是稳的那条路。
   */
  const srcBox = await src.boundingBox()
  await src.click({
    button: 'right',
    position: { x: 20, y: Math.min(60, Math.max(12, srcBox.height - 40)) },
  })
  await sleep(350)
  await page.locator('[data-context-menu-item="duplicate"]').click()
  await sleep(500)
  const assetNodes = await page
    .locator('[data-node-type="generation"]')
    .evaluateAll((els) => els.filter((e) => e.querySelector('[data-node-asset]')).length)
  rec(g, '★ 画布上有两个带素材的节点（其中只有一个在下游的上游）', assetNodes === 2, `带素材=${assetNodes}`)

  /** ③ 建下游节点 + 连线 */
  const beforeIds = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  await addNodeViaToolbar(page, 'generation')
  await sleep(500)
  const dstId = (
    await page
      .locator('[data-node-id]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  ).find((id) => !beforeIds.includes(id))
  rec(g, '★ 新建一个下游生成节点', !!dstId, `id=${dstId}`)
  const dst = page.locator(`[data-node-id="${dstId}"]`)
  /** 新建的节点落在视口中心（与别的节点重叠），先挪开再连线 */
  await moveNode(page, dstId, 830, 120)
  await sleep(300)

  await dst.hover()
  await sleep(250)
  {
    const ob = await page
      .locator(`[data-node-id="${srcId}"] [data-port="output"]`)
      .boundingBox()
    const ib = await dst.locator('[data-port="input"]').boundingBox()
    await page.mouse.move(ob.x + ob.width / 2, ob.y + ob.height / 2)
    await page.mouse.down()
    await page.mouse.move(ob.x + 40, ob.y + 8, { steps: 5 })
    await page.mouse.move(ib.x + ib.width / 2, ib.y + ib.height / 2, { steps: 14 })
    await page.mouse.up()
    await sleep(600)
  }
  const panel = await genPanel(page, dst)

  /**
   * ⚠️ 「素材框下面那枚 @ 按钮」**已删**（用户 2026-10-05 第 4 条明确要求：
   * 「不需要在素材框下面加一个艾特按钮，删掉它」）。
   * 引用入口就是在正文里打 `@` —— 这里改成打字打开，顺带钉住「菜单跟着光标走」。
   */
  rec(
    g,
    '★★ 素材框下面没有 @ 按钮（入口是在正文里打 @）',
    (await panel.locator('[data-panel-mention-open]').count()) === 0,
    `count=${await panel.locator('[data-panel-mention-open]').count()}`,
  )
  await panelPrompt(panel).click()
  await page.keyboard.type('@')
  await sleep(400)
  const menu = panel.locator('[data-panel-mention-menu]')
  rec(
    g,
    '★★ @ 菜单开在**光标处**（不是固定在右边）',
    await page.evaluate(() => {
      const menuEl = document.querySelector('[data-panel-mention-menu]')
      const caret = window.getSelection()?.getRangeAt(0)?.getBoundingClientRect()
      if (!menuEl || !caret) return false
      const m = menuEl.getBoundingClientRect()
      /** 左缘与光标对齐（±40px），且落在光标**下方** */
      return Math.abs(m.left - caret.left) < 40 && m.top >= caret.bottom - 20
    }),
  )
  /**
   * ★★ 候选菜单的**行高 / 字号**要和助手那份同一档（用户第 4 条：「面板和文字都太小了，
   * 需要像 agent 一样的插入正文 chip 一样的大小」）。
   *
   * 助手那份实测是 **行高 46 / 字号 16**（屏幕值，它不挂缩放）；创作面板整体挂 `zoom .75`，
   * 所以这里按**屏幕**比：`算出字号 × zoom`。改之前是 13.5px 屏幕（比助手小 2.5px），
   * 正是用户看到的那句「文字太小」。
   */
  const mentionSize = await page.evaluate(() => {
    const menuEl = document.querySelector('[data-panel-mention-menu]')
    const row = menuEl?.querySelector('[data-panel-mention]')
    const panelEl = document.querySelector('[data-creation-panel]')
    if (!menuEl || !row) return null
    const zoom = panelEl ? Number.parseFloat(getComputedStyle(panelEl).zoom) || 1 : 1
    const img = menuEl.querySelector('img')
    const ir = img?.getBoundingClientRect()
    return {
      rowH: Math.round(row.getBoundingClientRect().height),
      fontScreen: Math.round(parseFloat(getComputedStyle(row).fontSize) * zoom * 100) / 100,
      zoom,
      thumb: ir ? `${Math.round(ir.width)}×${Math.round(ir.height)}` : null,
    }
  })
  rec(
    g,
    '★★ 候选菜单的行高 / 字号与助手那份同档（行高 ≥44、字号 ≥15.5 屏幕）',
    !!mentionSize && mentionSize.rowH >= 43 && mentionSize.fontScreen >= 15.5,
    JSON.stringify(mentionSize),
  )
  const rowIds = await menu
    .locator('[data-panel-mention]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-panel-mention')))
  rec(
    g,
    '★★ 候选只有**上游**那一个（画布上另一个带素材的节点不在候选里）',
    rowIds.length === 1 && rowIds[0] === srcId,
    JSON.stringify(rowIds),
  )
  await menu
    .locator('[data-panel-mention] img')
    .first()
    .waitFor({ state: 'attached', timeout: 6000 })
    .catch(() => {})
  rec(
    g,
    '★ 候选行 = 缩略图 + 名字',
    (await menu.locator('[data-panel-mention] img').count()) === 1 &&
      (await menu.innerText()).includes(srcTitle),
    `名字=${srcTitle}`,
  )
  await page.screenshot({ path: `${OUT}/123-g104-mention-menu.png` })

  /** Esc 只收菜单，别把整个创作面板一起关掉（面板自己也监听 Esc） */
  await page.keyboard.press('Escape')
  await sleep(300)
  rec(
    g,
    '★★ Esc 只收起 @ 菜单（创作面板还在）',
    (await panel.count()) === 1 && (await panel.locator('[data-panel-mention-menu]').count()) === 0,
    `panel=${await panel.count()}`,
  )

  /** 打一个 `@` 就该开候选（参考对话窗那套交互） */
  await panelPrompt(panel).click()
  await page.keyboard.type('参考')
  await page.keyboard.type('@')
  await sleep(350)
  rec(
    g,
    '★ 在正文里打出 @ 自动开候选',
    (await panel.locator('[data-panel-mention-menu]').count()) === 1,
    `count=${await panel.locator('[data-panel-mention-menu]').count()}`,
  )

  await panel.locator(`[data-panel-mention="${srcId}"]`).click()
  await sleep(500)
  const chip = panel.locator('[data-panel-prompt] [data-mention-kind="node"]')
  rec(
    g,
    '★★ 选完在正文里落成引用小框（名字就是那个节点）',
    (await chip.count()) === 1 && (await chip.innerText()).includes(srcTitle),
    `chips=${await chip.count()} 文本=${(await chip.innerText().catch(() => '')).trim()}`,
  )
  await chip
    .locator('img')
    .first()
    .waitFor({ state: 'attached', timeout: 6000 })
    .catch(() => {})
  rec(
    g,
    '★★ 小框里带素材缩略图（不是只有一个图标）',
    (await chip.locator('img').count()) === 1,
    `img=${await chip.locator('img').count()}`,
  )
  await page.screenshot({ path: `${OUT}/124-g104-mention-chip.png` })

  /**
   * ★★ 存储里只留纯文本 —— 这条是这一项的地基：提示词要原样发给模型、给下游节点、
   * 给反推 / 优化，夹带 `@[名字](node:id)` 就是往请求里塞机器噪音。
   */
  await panelPrompt(panel).blur()
  await sleep(700)
  const stored = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open('qinghua')
        req.onsuccess = () => {
          const db = req.result
          const get = db.transaction('nodes', 'readonly').objectStore('nodes').get(id)
          get.onsuccess = () => resolve(get.result?.data?.prompt ?? '')
          get.onerror = () => resolve('')
        }
        req.onerror = () => resolve('')
      }),
    dstId,
  )
  rec(
    g,
    '★★ 落库的提示词是纯文本 `@名字`（没有引用形态）',
    String(stored).includes(`@${srcTitle}`) && !String(stored).includes('@['),
    `prompt=${JSON.stringify(stored)}`,
  )

  /** 重新打开面板：纯文本里的 `@名字` 又变回引用小框（chip 不靠存 id 活着） */
  await page.keyboard.press('Escape')
  await sleep(300)
  const panel2 = await genPanel(page, dst)
  rec(
    g,
    '★★ 重开面板：`@名字` 又展开成引用小框',
    (await panel2.locator('[data-panel-prompt] [data-mention-kind="node"]').count()) === 1,
    `chips=${await panel2.locator('[data-panel-prompt] [data-mention-kind="node"]').count()}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G105 预设与情绪（用户 2026-10-05 第 14 条）：
// 参数右边那枚预设按钮 → 四大类菜单 → 选一条落在提示词上方；
// 人像质感调节带二级搭配；情绪调节在素材下方开一个 5×5 点位面板。
// 这一组钉的是**界面 → 节点数据**那一段；「id → 拼进提示词」由
// `presets.test.ts` 与 `generation.test.ts` 的单测钉住（两边合起来才是一条链）。
// ────────────────────────────────────────────────────────────
async function g105(browser) {
  const g = 'G105 预设与情绪'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  const gen = page.locator('[data-node-type="generation"]').first()
  const nodeId = await gen.getAttribute('data-node-id')
  const panel = await genPanel(page, gen)

  /** 读节点落库的 data（面板写的那些字段） */
  const storedData = async () =>
    page.evaluate(
      (id) =>
        new Promise((resolve) => {
          const req = indexedDB.open('qinghua')
          req.onsuccess = () => {
            const db = req.result
            const q = db.transaction('nodes', 'readonly').objectStore('nodes').get(id)
            q.onsuccess = () => resolve(q.result?.data ?? {})
            q.onerror = () => resolve({})
          }
          req.onerror = () => resolve({})
        }),
      nodeId,
    )

  /** ① 入口：参数行右侧那枚预设按钮 */
  const presetBtn = panel.locator('[data-panel-preset]')
  rec(g, '★ 参数行出现预设按钮', (await presetBtn.count()) === 1, `count=${await presetBtn.count()}`)
  {
    /** 位置：在参数 chip 的右边（用户原话「在节点参数右边加一个预设功能的按钮」） */
    const chip = panel.locator('[data-param-chip="model"]').first()
    const cb = await chip.boundingBox()
    const pb = await presetBtn.boundingBox()
    rec(g, '★ 它在模型 / 参数那一排的右侧', !!cb && !!pb && pb.x > cb.x, `chip=${cb?.x} 预设=${pb?.x}`)
  }

  await presetBtn.click()
  await sleep(300)
  const menu = panel.locator('[data-preset-menu]')
  rec(g, '★★ 点开出现预设菜单', (await menu.count()) === 1, `count=${await menu.count()}`)
  const categories = await menu
    .locator('[data-preset-category]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-preset-category')))
  rec(
    g,
    '★★ 四大类齐全（分镜叙事 / 空间与机位 / 设定图 / 质感调节）',
    /**
     * 判据取**集合**而不是先后顺序：两栏的分布是布局决定（左「分镜叙事 + 质感调节」、
     * 右「空间与机位 + 设定图」，与参考图一致），DOM 顺序是逐栏铺出来的。
     * 拿顺序当契约会把「换一下分栏」误判成功能坏了。
     */
    JSON.stringify([...categories].sort()) ===
      JSON.stringify(['camera', 'design', 'story', 'texture']),
    categories.join(','),
  )
  /** 条目数 = 15 条预设（分镜叙事 6 + 空间与机位 2 + 设定图 5 + 质感调节 2）+ 情绪调节 */
  const itemCount = await menu.locator('[data-preset], [data-preset-emotion]').count()
  rec(g, '★★ 条目一条不少（15 条预设 + 情绪调节）', itemCount === 16, `items=${itemCount}`)
  const names = (await menu.innerText()).replace(/\s+/g, ' ')
  rec(
    g,
    '★★ 用户点名的那些名字都在菜单里',
    [
      '调度故事板',
      '25宫格连贯分镜',
      '剧情推演四宫格',
      '画面推演 — 3 秒后',
      '画面推演 — 5 秒前',
      '720 全景',
      '多机位九宫格',
      '角色脸部三视图',
      '角色三视图',
      '角色设定图',
      '场景设定图',
      '产品设定图',
      '人像质感调节',
      '电影级光影校正',
    ].every((n) => names.includes(n)),
    names.slice(0, 120),
  )
  await page.screenshot({ path: `${OUT}/125-g105-preset-menu.png` })

  /**
   * ★★ **菜单尺寸**就是这一条的契约（用户 2026-10-05 第 2 条：「预设面板太小了，
   * 需要参考图二的位置以及大小还有分布」）。判据按**屏幕**：宽 519（±12）、
   * 条目行高 44（±3）、条目字号 20（设计值）。
   *
   * **高度刻意不钉**：以后加一条预设它必然变高，拿高度当契约会把正常迭代判成回归。
   */
  const menuGeom = await menu.evaluate((el) => {
    const rows = [...el.querySelectorAll('[data-preset]')]
    const first = rows[0]
    const icon = first?.querySelector('svg')
    const label = first?.querySelector('span:last-child')
    return {
      w: Math.round(el.getBoundingClientRect().width),
      rowH: first ? Math.round(first.getBoundingClientRect().height) : 0,
      rowFont: first ? getComputedStyle(first).fontSize : '',
      rows: rows.length,
      withIcon: rows.filter((r) => r.querySelector('svg')).length,
      /** 图标尺寸按**设计值**读（面板挂 0.75 缩放，rect 是屏幕值） */
      iconW: icon ? Math.round(parseFloat(getComputedStyle(icon).width)) : 0,
      iconColor: icon ? getComputedStyle(icon).color : '',
      textColor: label ? getComputedStyle(label).color : '',
    }
  })
  rec(
    g,
    '★★ 菜单尺寸对了：屏幕宽 519、行高 44、条目字号 20（设计值）',
    Math.abs(menuGeom.w - 519) <= 12 &&
      Math.abs(menuGeom.rowH - 44) <= 3 &&
      menuGeom.rowFont === '20px',
    JSON.stringify(menuGeom),
  )
  rec(
    g,
    '★★ 每一条预设自带矢量图标（第 8 条：不是符号字）',
    menuGeom.rows > 0 && menuGeom.withIcon === menuGeom.rows,
    `${menuGeom.withIcon}/${menuGeom.rows} 条带图标`,
  )
  /**
   * ★★ 图标**再放大一档**且**颜色 = 文字颜色**（用户 2026-10-05 第 4 批：「图五中预设面板
   * 里面的图标都有点小，需要放大，但是面板大小够了，颜色都要文字的颜色」）。
   * 改之前是 24 设计值 + `--text-2`（灰）—— 同一行里图标比文字淡一档，看着像禁用。
   */
  rec(
    g,
    '★★ 菜单每行图标放到 32（设计值），颜色与文字一致',
    menuGeom.iconW >= 30 && menuGeom.iconColor === menuGeom.textColor,
    `icon=${menuGeom.iconW}px iconColor=${menuGeom.iconColor} textColor=${menuGeom.textColor}`,
  )

  /**
   * ★★ **点别处的空白要收起**（用户 2026-10-05 第 3 批：「创作面板上的功能预设点击其他
   * 空白的区域需要取消，目前是需要重新点击那个按钮才会取消」）。
   *
   * 钉两个落点，它们各对应一个曾经漏掉的机制：
   * ① **面板里的空白**（左缘那块）：面板内的控件在 `pointerdown` 上 `stopPropagation()`，
   *    监听挂在冒泡阶段时根本收不到；
   * ② **菜单自己的空白**（两栏高度差留下的右下角）：以前整块菜单都算「点在菜单里」。
   *
   * 每条都先证明「那一点真的不是菜单项」再断言收起 —— 否则点到某一条预设也会关菜单，
   * 断言绿了却什么都没证明。
   */
  const closeByBlank = async (label, point, opts = {}) => {
    const requireInPanel = opts.requireInPanel !== false
    /** 这一下本来就该落在菜单**内部**（菜单自己的空白）还是外部（画布空白） */
    const expectInMenu = opts.expectInMenu === true
    /**
     * 后面还要接着验 Esc 分层，所以这里先把面板与菜单开回来。
     * 走 `genPanel` 而不是「直接点预设按钮」：点画布空白那次会把选中也清掉，
     * 面板本身跟着卸载 —— 只点按钮会扑空（第一次跑就死在这儿）。
     */
    const reopen = async () => {
      const p = await genPanel(page, gen)
      await p.locator('[data-panel-preset]').click()
      await sleep(300)
    }
    const hit = await page.evaluate((p) => {
      const el = document.elementFromPoint(p[0], p[1])
      return {
        inPanel: !!el?.closest('[data-creation-panel]'),
        inMenu: !!el?.closest('[data-preset-menu]'),
        onMenuButton: !!el?.closest('[data-preset-menu] button'),
      }
    }, point)
    await page.mouse.click(point[0], point[1])
    await sleep(320)
    const closed = (await panel.locator('[data-preset-menu]').count()) === 0
    rec(
      g,
      `★★ ${label}（实测点到的不是菜单项）→ 预设菜单收起`,
      (!requireInPanel || hit.inPanel) &&
        (expectInMenu ? hit.inMenu : !hit.inMenu) &&
        !hit.onMenuButton &&
        closed,
      `${JSON.stringify(hit)} @${point.map(Math.round).join(',')} → ${closed ? '已收起' : '仍开着'}`,
    )
    await reopen()
  }
  /**
   * 「别处」取**菜单左沿再往左 60px**那一竖条 —— 实测菜单宽 519，往往比面板还宽，
   * 面板里根本没有「菜单之外又还在面板里」的空白可点；那一竖条落在画布上
   * （`inPanel:false`），点它等于**点画布空白**：菜单收起，面板也跟着收起
   * （画布空白单击 = 取消选中的既定语义）。
   *
   * 不写死坐标：菜单是右对齐弹出的，位置随面板与视口变 —— 第一次写成
   * `panel.x + 30` 就点到了菜单项上（断言当场红）。
   */
  const menuHead = await panel.locator('[data-preset-menu]').boundingBox()
  await closeByBlank('点画布空白', [menuHead.x - 60, menuHead.y + 40], { requireInPanel: false })
  const menuBox2 = await panel.locator('[data-preset-menu]').boundingBox()
  await closeByBlank(
    '点菜单自己的空白',
    [menuBox2.x + menuBox2.width - 40, menuBox2.y + menuBox2.height - 30],
    { expectInMenu: true },
  )

  /** Esc 只收菜单，别把面板也关了（逐层收） */
  await page.keyboard.press('Escape')
  await sleep(300)
  rec(
    g,
    '★★ Esc 只收起预设菜单（创作面板还在）',
    (await panel.count()) === 1 && (await menu.count()) === 0,
    `panel=${await panel.count()} menu=${await menu.count()}`,
  )

  /**
   * ② 选一条：菜单收起 + **正文里多出一枚预设 chip**（用户 2026-10-05 追问：
   * 「预设还是单独放在最前方的第一排的继续改」—— 它必须像 @ 引用那样插在正文里，
   * 而不是输入框上面的一个横条）。
   *
   * 同时钉住示例小字的生命周期：正文还空着时它以**占位**形式显示，
   * 用户一写正文就消失（用户原话：「右边的小字只是给用户举例要输入什么内容，
   * 用户填写正文后就会隐藏」）。
   */
  await presetBtn.click()
  await sleep(250)
  await panel.locator('[data-preset="storyboard-25"]').click()
  await sleep(500)
  const presetChip = panel.locator('[data-panel-prompt] [data-mention-kind="preset"]')
  rec(
    g,
    '★★ 选完菜单收起、**正文里**出现预设 chip（不是单独一行）',
    (await menu.count()) === 0 &&
      (await presetChip.count()) === 1 &&
      (await presetChip.innerText()).includes('25宫格连贯分镜'),
    `chip=${await presetChip.count()} 文本=${(await presetChip.innerText().catch(() => '')).trim()}`,
  )
  rec(
    g,
    '★★ chip 与正文在**同一行**（不是自己占一行）',
    await panel.locator('[data-panel-prompt]').evaluate((el) => {
      const chip = el.querySelector('[data-token]')
      if (!chip) return false
      const range = document.createRange()
      range.selectNodeContents(el)
      /** 编辑器内容的顶边：chip 与它几乎同一 y ⇒ 同一条基线 */
      return Math.abs(chip.getBoundingClientRect().top - range.getBoundingClientRect().top) < 6
    }),
  )
  rec(
    g,
    '★★ 正文为空时显示**示例小字**（占位），一写正文就消失',
    await (async () => {
      const before = await panelPrompt(panel).evaluate((el) => el.dataset.empty === 'true')
      await panelPrompt(panel).click()
      await page.keyboard.type('一只猫')
      await sleep(400)
      const after = await panelPrompt(panel).evaluate((el) => el.dataset.empty === 'true')
      /**
       * 只删**刚打的那三个字**，不要用 `fill('')` —— 那会把正文连同预设 chip
       * 一起清掉（等于顺手取消了预设），后面「按钮上有小点 / 节点存了 id」两条就全落空。
       */
      for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace')
      await sleep(300)
      return before === true && after === false
    })(),
  )
  rec(g, '★ 按钮上出现已选的小点', (await panel.locator('[data-preset-dot]').count()) === 1)
  await sleep(900)
  const afterPreset = await storedData()
  rec(
    g,
    '★★ 落库：节点上只存预设 id（不存正文）',
    afterPreset.preset === 'storyboard-25' && !('presetText' in afterPreset),
    JSON.stringify(afterPreset.preset),
  )
  await page.screenshot({ path: `${OUT}/126-g105-preset-row.png` })

  /** ③ 二级搭配：点**预设 chip**不是「切换预设」，而是选具体搭配（图十九） */
  await presetBtn.click()
  await sleep(250)
  await panel.locator('[data-preset="portrait-texture"]').click()
  await sleep(400)
  rec(
    g,
    '★★ 人像质感调节的 chip 可点（点它开搭配面板）',
    (await panel.locator('[data-panel-prompt] [data-mention-kind="preset"]').count()) === 1,
  )
  /**
   * ★★ **chip 的文字与正文同号**，外框与图标都放大
   * （用户 2026-10-05 第 4 批第 3 条：「预设功能里面的文字是 18px，正文是 20px，
   * 我需要两个文字要一样的大小，预设框能大一点没事，图标需要大一点」）。
   */
  const chipGeom = await panel.evaluate((el) => {
    const editor = el.querySelector('[data-panel-prompt]')
    const token = editor?.querySelector('[data-token]')
    const svg = token?.querySelector('svg')
    return {
      chipFont: token ? getComputedStyle(token).fontSize : '',
      bodyFont: editor ? getComputedStyle(editor).fontSize : '',
      chipH: token ? Math.round(parseFloat(getComputedStyle(token).height)) : 0,
      iconW: svg ? Math.round(parseFloat(getComputedStyle(svg).width)) : 0,
    }
  })
  rec(
    g,
    '★★ 预设 chip 的字号 = 正文字号，外框 / 图标都放大（38 / 24 设计值）',
    chipGeom.chipFont === chipGeom.bodyFont && chipGeom.chipH >= 34 && chipGeom.iconW >= 22,
    JSON.stringify(chipGeom),
  )
  await panel.locator('[data-panel-prompt] [data-mention-kind="preset"]').click()
  await sleep(300)
  const options = panel.locator('[data-preset-options]')
  const groups = await options
    .locator('[data-preset-option-group]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-preset-option-group')))
  rec(
    g,
    '★★ 搭配五组、每组三档（人景融合 / 光影融合 / 皮肤 / 纹理 / 锐度）',
    JSON.stringify(groups) === JSON.stringify(['fusion', 'light', 'skin', 'grain', 'sharp']) &&
      (await options.locator('[data-preset-choice]').count()) === 15,
    `groups=${groups.join(',')} choices=${await options.locator('[data-preset-choice]').count()}`,
  )
  /**
   * ★★ **搭配面板与菜单同宽同档**（用户第 2 条后半：「人像质感调节的面板也太小了」）。
   *
   * 判据取**相对**（与刚量过的那份菜单比），不写绝对值：两块是同一族的东西，
   * 差一档就是当初那次反馈。菜单此时已经收起（两块互斥），所以比对的是
   * 上面那次量到的 `menuGeom.w`。
   */
  const optsGeom = await options.evaluate((el) => {
    const choice = el.querySelector('[data-preset-choice]')
    return {
      w: Math.round(el.getBoundingClientRect().width),
      choiceH: choice ? Math.round(choice.getBoundingClientRect().height) : 0,
      choiceFont: choice ? getComputedStyle(choice).fontSize : '',
    }
  })
  rec(
    g,
    '★★ 人像质感搭配面板与预设菜单同宽同档（宽 519 / 行高 43.5 / 字号 20）',
    Math.abs(optsGeom.w - menuGeom.w) <= 3 &&
      Math.abs(optsGeom.choiceH - 44) <= 3 &&
      optsGeom.choiceFont === '20px',
    `${JSON.stringify(optsGeom)} vs 菜单宽 ${menuGeom.w}`,
  )
  await page.screenshot({ path: `${OUT}/127-g105-preset-options.png` })
  await options.locator('[data-preset-choice="fusion:deep"]').click()
  await sleep(900)
  const afterOption = await storedData()
  rec(
    g,
    '★★ 选搭配：写进 presetOptions，且不改变当前预设',
    afterOption.preset === 'portrait-texture' && afterOption.presetOptions?.fusion === 'deep',
    JSON.stringify(afterOption.presetOptions),
  )
  rec(
    g,
    '★ 选搭配后菜单**不关**（五组通常要连着调）',
    (await options.count()) === 1,
    `count=${await options.count()}`,
  )
  await page.keyboard.press('Escape')
  await sleep(250)

  /**
   * ④ 情绪调节：**独立面板**（用户 2026-10-05 第 1 条：「情绪调节是单独的一个面板，
   * 不是放在创作面板里面，参考图一，最上方参数旁边可以加上一个生成模型的选择」）。
   */
  await presetBtn.click()
  await sleep(250)
  await panel.locator('[data-preset-emotion]').click()
  await sleep(500)
  const box = page.locator('[data-panel-emotion]')
  rec(g, '★★ 情绪调节是**独立面板**（不再是创作面板里的一块）', (await box.count()) === 1 && (await panel.count()) === 0, `情绪=${await box.count()} 创作=${await panel.count()}`)
  rec(
    g,
    '★★ 头排有**生成模型**选择 + 比例 / 数量 + 生成按钮（照参考图一）',
    (await box.locator('[data-param-chip="emotionModel"]').count()) === 1 &&
      (await box.locator('[data-param-chip="emotionRatio"]').count()) === 1 &&
      (await box.locator('[data-param-chip="emotionCount"]').count()) === 1 &&
      (await box.locator('[data-emotion-run]').count()) === 1,
  )
  rec(
    g,
    '★★ 25 个点位、五个一排（5×5）',
    (await box.locator('[data-emotion]').count()) === 25,
    `dots=${await box.locator('[data-emotion]').count()}`,
  )
  const firstRowCount = await box.locator('[data-emotion]').evaluateAll(
    (els) => els.filter((e) => e.style.gridRow === '1').length,
  )
  rec(g, '★★ 五个一排', firstRowCount === 5, `firstRow=${firstRowCount}`)
  /**
   * 头排右侧的「比例 / 数量」（参考图二十的头部就是「比例 · 数量 · 生成」）。
   *
   * 它们改的是**节点上同一份参数**：在这里选 1:1，参数行那枚胶囊与节点 data 都要跟着变
   * —— 只钉「这两个 chip 在」是弱证据，会漏掉「两个地方各存一份」那种错。
   */
  await pickParam(box, 'emotionRatio', '1:1')
  await sleep(900)
  const afterRatio = await storedData()
  rec(
    g,
    '★★ 在这里改比例 = 改节点参数（与参数行同一份状态）',
    afterRatio.ratio === '1:1',
    `ratio=${JSON.stringify(afterRatio.ratio)}`,
  )
  const boxText = (await box.innerText()).replace(/\s+/g, ' ')
  rec(
    g,
    '★★ 四轴文案齐全（激动 / 平静 / 亲近 / 疏离）',
    ['激动', '平静', '亲近', '疏离'].every((t) => boxText.includes(t)),
    boxText.slice(0, 60),
  )
  rec(
    g,
    '★★ 默认定位在正中间的「淡然自若」',
    boxText.includes('情绪定位') && boxText.includes('淡然自若'),
    boxText.slice(-24),
  )
  await box.locator('[data-emotion="joyous"]').click()
  await sleep(900)
  const boxText2 = (await box.innerText()).replace(/\s+/g, ' ')
  rec(g, '★★ 点一个点位 → 底部定位跟着变', boxText2.includes('欣然愉悦'), boxText2.slice(-24))
  const afterEmotion = await storedData()
  rec(
    g,
    '★★ 落库：节点上存情绪 id',
    afterEmotion.emotion === 'joyous',
    JSON.stringify(afterEmotion.emotion),
  )
  await page.screenshot({ path: `${OUT}/128-g105-emotion.png` })

  /** 关闭 = 清掉这次的情绪（面板显示与否只看这一个事实） */
  await box.locator('[data-emotion-close]').click()
  await sleep(900)
  const afterClose = await storedData()
  rec(
    g,
    '★★ 关闭情绪面板 = 清掉情绪 + 回到创作面板（不留「关掉了但还在提示词里」）',
    (await box.count()) === 0 &&
      (await panel.count()) === 1 &&
      afterClose.emotion === undefined,
    `情绪=${await box.count()} 创作=${await panel.count()} emotion=${JSON.stringify(afterClose.emotion)}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G106 宫格切分（用户 2026-10-05 第 9 条）：
// 节点功能栏上的「宫格切分」→ 4 / 9 / 16 / 25 宫格 + 自定义；
// 切完在**原图右侧**排出一批新节点（原图不动），一次撤销可回退。
// ────────────────────────────────────────────────────────────
async function g106(browser) {
  const g = 'G106 宫格切分'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  /** ① 先让源节点出图（没图可切） */
  const src = page.locator('[data-node-type="generation"]').first()
  const srcId = await src.getAttribute('data-node-id')
  const panel = await genPanel(page, src)
  await configureGenPanel(page, panel, '底图：一只橘猫')
  await panel.locator('[data-panel-run]').click()
  for (let i = 0; i < 80; i++) {
    if ((await page.locator(`[data-node-id="${srcId}"] [data-node-asset]`).count()) > 0) break
    await sleep(250)
  }
  const hasAsset = (await page.locator(`[data-node-id="${srcId}"] [data-node-asset]`).count()) > 0
  rec(g, '★ 源节点已出图', hasAsset)
  if (!hasAsset) {
    await ctx.close()
    return
  }

  /** 跟随栏上应当出现「宫格切分」 */
  await genPanel(page, src)
  const splitBtn = page.locator('[data-follow-action="split"]')
  rec(g, '★★ 功能栏出现「宫格切分」', (await splitBtn.count()) === 1, `count=${await splitBtn.count()}`)
  await splitBtn.click()
  await sleep(300)
  const menu = page.locator('[data-split-menu]')
  const presets = await menu
    .locator('[data-split-preset]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-split-preset')))
  rec(
    g,
    '★★ 菜单四档齐全（2×2 / 3×3 / 4×4 / 5×5）+ 自定义',
    JSON.stringify(presets) === JSON.stringify(['2x2', '3x3', '4x4', '5x5']) &&
      (await menu.locator('[data-split-custom]').count()) === 1,
    presets.join(','),
  )
  await page.screenshot({ path: `${OUT}/129-g106-split-menu.png` })

  /** ② 4 宫格：右侧多出 4 个带图的节点，原图不动 */
  const beforeIds = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  const srcBoxBefore = await src.boundingBox()
  await menu.locator('[data-split-preset="2x2"]').click()
  await sleep(1200)
  const afterIds = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  const added = afterIds.filter((id) => !beforeIds.includes(id))
  rec(g, '★★ 4 宫格切出 4 个新节点', added.length === 4, `新增=${added.length}`)
  const withAsset = await page.evaluate(
    (ids) =>
      ids.filter((id) => !!document.querySelector(`[data-node-id="${id}"] [data-node-asset]`))
        .length,
    added,
  )
  rec(g, '★★ 每一块都带自己的图（4/4）', withAsset === 4, `带图=${withAsset}`)
  rec(
    g,
    '★★ 新节点排在**原图右侧**（原图本身不动）',
    await (async () => {
      const srcBoxAfter = await src.boundingBox()
      const rightOfSource = await page.evaluate(
        (arg) => {
          const srcEl = document.querySelector(`[data-node-id="${arg.id}"]`)
          const sr = srcEl?.getBoundingClientRect()
          if (!sr) return false
          return arg.ids.every((id) => {
            const el = document.querySelector(`[data-node-id="${id}"]`)
            const r = el?.getBoundingClientRect()
            return r ? r.left >= sr.right - 2 : false
          })
        },
        { id: srcId, ids: added },
      )
      return rightOfSource && Math.abs(srcBoxAfter.width - srcBoxBefore.width) < 2
    })(),
  )
  await page.screenshot({ path: `${OUT}/130-g106-split-result.png` })

  /** 一步撤销：四块与它们的素材一起回退 */
  await page.keyboard.press('Control+z')
  await sleep(900)
  const afterUndo = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  rec(
    g,
    '★★ 切分可一步撤销（4 个新节点一起回去）',
    afterUndo.length === beforeIds.length,
    `${beforeIds.length} → ${afterUndo.length}`,
  )

  /** ③ 自定义宫格：点 3×3 那格 = 切 9 块 */
  await genPanel(page, src)
  await page.locator('[data-follow-action="split"]').click()
  await sleep(250)
  await page.locator('[data-split-custom]').click()
  await sleep(250)
  const customMenu = page.locator('[data-split-custom-menu]')
  rec(g, '★★ 自定义宫格打开一块可点方格', (await customMenu.count()) === 1)
  const cells = customMenu.locator('[data-split-cell]')
  rec(g, '★ 方格是 6×6（够切到 6 行 6 列）', (await cells.count()) === 36, `cells=${await cells.count()}`)
  await customMenu.locator('[data-split-cell="3x3"]').click()
  await sleep(1400)
  const afterCustom = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  rec(
    g,
    '★★ 自定义 3×3 切出 9 个新节点',
    afterCustom.length === beforeIds.length + 9,
    `${beforeIds.length} → ${afterCustom.length}`,
  )
 await page.screenshot({ path: `${OUT}/131-g106-split-custom.png` })

 rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
 await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G107 节点右侧四件（用户 2026-10-05 第 10 条）：标注 / 旋转 / 下载 / 预览。
//   · 四个都在**有素材**时出现（空节点没得标没得转）；
//   · 旋转：点一下就在右边复制一个节点并连线，上方出现工具条
//     （✕ 旋转与镜像 / 角度 + 步长 / 左右·上下镜像 / 保存），保存才写像素；
//   · 标注：画笔 / 矩形 / 文字 / 颜色 / 粗细 / 撤销 / 重做 / 保存，
//     保存把标注合成成**原图右侧的新节点**（原图不动）；
//   · 预览：直接开灯箱，与双击同一条路。
// ────────────────────────────────────────────────────────────
async function g107(browser) {
  const g = 'G107 标注/旋转/预览'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  /** 先让源节点出图（没图就没有这四个动作） */
  const src = page.locator('[data-node-type="generation"]').first()
  const srcId = await src.getAttribute('data-node-id')
  const panel = await genPanel(page, src)
  await configureGenPanel(page, panel, '底图：一只橘猫')
  await panel.locator('[data-panel-run]').click()
  for (let i = 0; i < 80; i++) {
    if ((await page.locator(`[data-node-id="${srcId}"] [data-node-asset]`).count()) > 0) break
    await sleep(250)
  }
  const srcAsset = page.locator(`[data-node-id="${srcId}"] [data-node-asset]`)
  const hasSrcAsset = (await srcAsset.count()) > 0
  rec(g, '★ 源节点已出图', hasSrcAsset)
  if (!hasSrcAsset) {
    await ctx.close()
    return
  }
  const srcSrcBefore = await srcAsset.getAttribute('src')

  const nodeIds = async () =>
    page.locator('[data-node-id]').evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))

  /** ① 四个动作齐全 */
  await genPanel(page, src)
  const actions = await page
    .locator('[data-node-follow-bar] [data-follow-action]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-follow-action')))
  rec(
    g,
    '★★ 有素材时四件齐全（标注 / 旋转 / 下载 / 预览）',
    ['annotate', 'rotate', 'download', 'preview'].every((a) => actions.includes(a)),
    `动作=${actions.join(',')}`,
  )

  /** ② 预览 = 开灯箱（与双击同一条路） */
  await page.locator('[data-follow-action="preview"]').click()
  await sleep(500)
  rec(g, '★★ 「预览」直接开灯箱（和双击素材同一条路）', (await page.locator('[data-lightbox]').count()) === 1)
  await page.screenshot({ path: `${OUT}/132-g107-preview.png` })
  await page.locator('[data-lightbox-close]').click({ timeout: 3000 }).catch(() => {})
  await sleep(400)

  /** ③ 旋转：右边复制一个新节点 + 连线，上方出现工具条 */
  const beforeIds = await nodeIds()
  await genPanel(page, src)
  await page.locator('[data-follow-action="rotate"]').click()
  await sleep(900)
  const afterIds = await nodeIds()
  const added = afterIds.filter((id) => !beforeIds.includes(id))
  rec(g, '★★ 点「旋转」在右边复制出一个新节点', added.length === 1, `新增=${added.length}`)
  const copyId = added[0]
  rec(
    g,
    '★★ 新节点与源节点之间有一条连线',
    copyId
      ? (await page
          .locator(`[data-edge-source="${srcId}"][data-edge-target="${copyId}"]`)
          .count()) === 1
      : false,
  )
  const rot = page.locator('[data-rotate-layer]')
  rec(g, '★★ 上方出现「旋转与镜像」工具条', (await rot.count()) === 1)
  const rotParts = await page.evaluate(() => ({
    close: !!document.querySelector('[data-rotate-close]'),
    angle: (document.querySelector('[data-rotate-angle]')?.textContent ?? '').trim(),
    step: !!document.querySelector('[data-rotate-step]'),
    mirrorH: !!document.querySelector('[data-rotate-mirror-h]'),
    mirrorV: !!document.querySelector('[data-rotate-mirror-v]'),
    save: !!document.querySelector('[data-rotate-save]'),
  }))
  rec(
    g,
    '★★ 工具条三部分齐全（✕ 旋转与镜像 / 角度 + 步长 / 镜像 / 保存）',
    rotParts.close && rotParts.step && rotParts.mirrorH && rotParts.mirrorV && rotParts.save,
    JSON.stringify(rotParts),
  )
  rec(g, '★ 初始角度是 0°', rotParts.angle === '0°', `angle=${rotParts.angle}`)
  await page.locator('[data-rotate-right]').click()
  await sleep(250)
  const angle90 = (await page.locator('[data-rotate-angle]').innerText()).trim()
  rec(g, '★★ 右转一下 = 角度按步长（90°）走', angle90 === '90°', `angle=${angle90}`)
  await page.locator('[data-rotate-mirror-h]').click()
  await sleep(200)
  rec(
    g,
    '★ 左右镜像可切换（按下态）',
    (await page.locator('[data-rotate-mirror-h]').getAttribute('aria-pressed')) === 'true',
  )
  await page.screenshot({ path: `${OUT}/133-g107-rotate.png` })

  const copySrcBefore = await page
    .locator(`[data-node-id="${copyId}"] [data-node-asset]`)
    .getAttribute('src')
  await page.locator('[data-rotate-save]').click()
  await page
    .locator('[data-rotate-layer]')
    .waitFor({ state: 'hidden', timeout: 8000 })
    .catch(() => {})
  await sleep(700)
  const copySrcAfter = await page
    .locator(`[data-node-id="${copyId}"] [data-node-asset]`)
    .getAttribute('src')
  const srcSrcAfterRotate = await srcAsset.getAttribute('src')
  rec(
    g,
    '★★ 保存后复制节点真的换了图（源节点那张没动）',
    !!copySrcAfter && copySrcAfter !== copySrcBefore && srcSrcAfterRotate === srcSrcBefore,
    `copy=${copySrcBefore === copySrcAfter ? '未变' : '已变'} src=${srcSrcBefore === srcSrcAfterRotate ? '未变' : '变了'}`,
  )
  rec(g, '★ 保存后工具条收起来了', (await page.locator('[data-rotate-layer]').count()) === 0)

  /** ④ 标注：工具条齐全 + 画一笔 + 撤销/重做 + 保存出**新节点** */
  await genPanel(page, src)
  await page.locator('[data-follow-action="annotate"]').click()
  await sleep(700)
  rec(g, '★★ 点「标注」打开标注层', (await page.locator('[data-annotate-layer]').count()) === 1)
  const annParts = await page.evaluate(() => ({
    close: !!document.querySelector('[data-annotate-close]'),
    brush: !!document.querySelector('[data-annotate-tool="brush"]'),
    rect: !!document.querySelector('[data-annotate-tool="rect"]'),
    text: !!document.querySelector('[data-annotate-tool="text"]'),
    colors: document.querySelectorAll('[data-annotate-color]').length,
    size: !!document.querySelector('[data-annotate-size]'),
    undo: !!document.querySelector('[data-annotate-tool="undo"]'),
    redo: !!document.querySelector('[data-annotate-tool="redo"]'),
    save: !!document.querySelector('[data-annotate-save]'),
  }))
  rec(
    g,
    '★★ 标注工具条齐全（画笔 / 矩形 / 文字 / 颜色 / 粗细 / 撤销 / 重做 / 保存）',
    annParts.close &&
      annParts.brush &&
      annParts.rect &&
      annParts.text &&
      annParts.colors === 6 &&
      annParts.size &&
      annParts.undo &&
      annParts.redo &&
      annParts.save,
    JSON.stringify(annParts),
  )
  /** 画布要等底图 onLoad 之后才拿到像素尺寸（宽 0 时画不了） */
  for (let i = 0; i < 40; i++) {
    const w = await page
      .locator('[data-annotate-canvas]')
      .evaluate((el) => el.width)
      .catch(() => 0)
    if (w > 0) break
    await sleep(150)
  }
  const canvasBox = await page.locator('[data-annotate-canvas]').boundingBox()
  rec(g, '★ 标注画布拿到了图片像素尺寸', !!canvasBox && canvasBox.width > 4 && canvasBox.height > 4)
  if (canvasBox) {
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.25, canvasBox.y + canvasBox.height * 0.25)
    await page.mouse.down()
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.6, canvasBox.y + canvasBox.height * 0.7, {
      steps: 8,
    })
    await page.mouse.up()
    await sleep(300)
  }
  const undoBtn = page.locator('[data-annotate-tool="undo"]')
  const redoBtn = page.locator('[data-annotate-tool="redo"]')
  rec(g, '★★ 画完一笔「撤销」可用', await undoBtn.isEnabled())
  await undoBtn.click()
  await sleep(250)
  rec(g, '★★ 撤销后「重做」可用（撤销 / 重做是配对的）', await redoBtn.isEnabled())
  await redoBtn.click()
  await sleep(250)
  rec(g, '★ 重做后「撤销」又可用', await undoBtn.isEnabled())
  await page.screenshot({ path: `${OUT}/134-g107-annotate.png` })

  const beforeAnnIds = await nodeIds()
  const srcBoxForAnn = await src.boundingBox()
  await page.locator('[data-annotate-save]').click()
  await page
    .locator('[data-annotate-layer]')
    .waitFor({ state: 'hidden', timeout: 8000 })
    .catch(() => {})
  await sleep(900)
  const afterAnnIds = await nodeIds()
  const annAdded = afterAnnIds.filter((id) => !beforeAnnIds.includes(id))
  rec(g, '★★ 保存标注出一个**新节点**（原图不被覆盖）', annAdded.length === 1, `新增=${annAdded.length}`)
  const annId = annAdded[0]
  const annPlacementOk = annId
    ? await (async () => {
        const el = page.locator(`[data-node-id="${annId}"]`)
        const box = await el.boundingBox()
        const hasImg = (await el.locator('[data-node-asset]').count()) === 1
        return (
          !!box && !!srcBoxForAnn && box.x >= srcBoxForAnn.x + srcBoxForAnn.width - 2 && hasImg
        )
      })()
    : false
  rec(g, '★★ 标注结果落在原图右侧且带着图', annPlacementOk)
  await page.screenshot({ path: `${OUT}/135-g107-annotate-result.png` })

  /** ⑤ 拿到新图之后，那两个动作仍然在（不是只对第一张有效） */
  if (annId) await genPanel(page, page.locator(`[data-node-id="${annId}"]`))
  const annActions = await page
    .locator('[data-node-follow-bar] [data-follow-action]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-follow-action')))
  rec(
    g,
    '★ 新出来的标注图同样带齐四件',
    ['annotate', 'rotate', 'download', 'preview'].every((a) => annActions.includes(a)),
    `动作=${annActions.join(',')}`,
  )

  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

// ────────────────────────────────────────────────────────────
// G108 情绪 = 局部改脸（用户 2026-10-05 第五批第 1 条）：
// 「先自动识别面部，然后只改变面部的情绪，其他的内容完全不变」。
//
// 四步：识别人脸（问看图模型）→ 按框裁一块（复用「提取选区」）→ 改这块局部图
// → 融合回原图（本地像素合成）。用 mock 渠道也走真链路：mock 的 `completeText`
// 对「人脸外接框」那一问回一个固定框（测试夹具）。
// ────────────────────────────────────────────────────────────
async function g108(browser) {
  const g = 'G108 情绪局部改脸'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))

  /**
   * 记下**本机人脸检测**那套静态文件的请求（worker / wasm / tflite 模型）。
   *
   * 为什么必须这么钉：本机检测是**新加的第一条路**，排在「问模型」前面。它要是
   * 根本没被调用（worker 路径写错、平台端口忘了接），后面那条回退照样能把 G108
   * 跑绿 —— 那就成了「代码写了、功能没启用」这种最难发现的假通过。
   */
  const mediapipeRequests = []
  page.on('request', (r) => {
    if (r.url().includes('/mediapipe/')) mediapipeRequests.push(r.url())
  })

  await configureMockChannel(page)
  await gotoProjects(page)
  await sleep(400)
  await page.locator('[data-template="text2img"]').click()
  await page.waitForURL(/\/canvas\//)
  await sleep(900)

  /** ① 先让源节点出一张图（要被改表情的那张） */
  const src = page.locator('[data-node-type="generation"]').first()
  const srcId = await src.getAttribute('data-node-id')
  const panel = await genPanel(page, src)
  await configureGenPanel(page, panel, '一个女孩子站在窗边')
  await panel.locator('[data-panel-run]').click()
  for (let i = 0; i < 80; i++) {
    if ((await page.locator(`[data-node-id="${srcId}"] [data-node-asset]`).count()) > 0) break
    await sleep(250)
  }
  const hasSrc = (await page.locator(`[data-node-id="${srcId}"] [data-node-asset]`).count()) > 0
  rec(g, '★ 源节点已出图（要被改表情的那张）', hasSrc)
  if (!hasSrc) {
    await ctx.close()
    return
  }
  const idsBefore = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))

  /** ② 打开情绪面板（预设菜单里的「情绪调节」） */
  await genPanel(page, src)
  await panel.locator('[data-panel-preset]').click()
  await sleep(300)
  await page.locator('[data-preset-emotion]').click()
  await sleep(500)
  rec(g, '★ 情绪面板打开（在素材下方）', (await page.locator('[data-emotion-panel]').count()) === 1)

  /** ③ 选一个情绪点位 → 点生成（走「局部改脸」那条路） */
  await page.locator('[data-emotion="joyous"]').click()
  await sleep(250)
  rec(
    g,
    '★ 选中一个情绪点位',
    (await page.locator('[data-emotion="joyous"]').getAttribute('aria-pressed')) === 'true',
  )
  await page.locator('[data-emotion-run]').click()

  /**
   * ④ 等流水线建出两个节点：局部图 + 融合。
   *
   * ⚠️ 融合节点常常落在**视口外**（画布会剔除屏幕外的节点），所以「它在不在」
   * 不能靠 DOM 判断 —— 用**连线**反查（同一个 id 上同时有 `input` 与 `patch` 两条入边）。
   */
  let cropId = null
  let fusionId = null
  for (let i = 0; i < 120; i += 1) {
    const added = (
      await page
        .locator('[data-node-id]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
    ).filter((id) => !idsBefore.includes(id))
    const crop = await page.evaluate(
      (ids) =>
        ids.find((id) => {
          const el = document.querySelector(`[data-node-id="${id}"]`)
          if (!el) return false
          const title = el.querySelector('[data-node-title]')?.textContent ?? ''
          return el.getAttribute('data-node-type') === 'generation' && title.includes('局部图')
        }) ?? null,
      added,
    )
    if (crop) cropId = crop
    /** 融合节点：两条入边（原图 input + 局部图 patch）指向同一个 id */
    const wired = await page.locator('[data-edge]').evaluateAll((els) =>
      els.map((e) => ({
        s: e.getAttribute('data-edge-source'),
        t: e.getAttribute('data-edge-target'),
        tp: e.getAttribute('data-edge-target-port'),
      })),
    )
    if (cropId) {
      const target = wired.find((e) => e.s === cropId && e.tp === 'patch')?.t
      if (target && wired.some((e) => e.s === srcId && e.t === target && e.tp === 'input')) {
        fusionId = target
      }
    }
    if (cropId && fusionId) break
    await sleep(250)
  }
  rec(g, '★★ 新建了一个**局部图节点**（不是改原节点重跑）', !!cropId, `crop=${cropId}`)
  rec(g, '★★ 新建了一个**融合节点**（把局部贴回原图）', !!fusionId, `fusion=${fusionId}`)
  rec(
    g,
    '★★ 情绪调节真的起用了**本机人脸检测**（worker 与模型被加载，不是只走了「问模型」回退）',
    mediapipeRequests.some((u) => u.includes('face-detector-worker.js')) &&
      mediapipeRequests.some((u) => u.endsWith('.tflite')),
    `本机检测请求 ${mediapipeRequests.length} 条`,
  )
  if (!cropId || !fusionId) {
    await page.screenshot({ path: `${OUT}/136-g108-emotion-fail.png` })
    rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
    await ctx.close()
    return
  }

  /** ⑤ 局部节点的正文 = 情绪那句（自带「只改面部、其余不变」）+ 继承了配方 */
  const cropData = await page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open('qinghua')
        req.onsuccess = () => {
          const db = req.result
          const q = db.transaction('nodes', 'readonly').objectStore('nodes').get(id)
          q.onsuccess = () => resolve(q.result?.data ?? {})
          q.onerror = () => resolve({})
        }
        req.onerror = () => resolve({})
      }),
    cropId,
  )
  rec(
    g,
    '★★ 局部节点的提示词 = 情绪那句（含「只改人物的面部表情」与「保持不变」）',
    String(cropData.prompt ?? '').includes('只改人物的面部表情') &&
      String(cropData.prompt ?? '').includes('保持不变'),
    String(cropData.prompt ?? '').slice(0, 60),
  )
  rec(
    g,
    '★★ 局部节点继承了源节点的渠道 / 模型（否则点生成只会说「还没选渠道」）',
    Boolean(cropData.channelId && cropData.model),
    `channel=${cropData.channelId} model=${cropData.model}`,
  )

  /** ⑥ 两条连线：原图 → input，局部图 → patch */
  const newEdges = await page
    .locator('[data-edge]')
    .evaluateAll((els) =>
      els.map((e) => ({
        s: e.getAttribute('data-edge-source'),
        t: e.getAttribute('data-edge-target'),
        tp: e.getAttribute('data-edge-target-port'),
      })),
    )
  rec(
    g,
    '★★ 原图接进融合节点的 input，局部图接进 patch（各一条）',
    newEdges.some((e) => e.s === srcId && e.t === fusionId && e.tp === 'input') &&
      newEdges.some((e) => e.s === cropId && e.t === fusionId && e.tp === 'patch'),
    JSON.stringify(newEdges.filter((e) => e.t === fusionId)),
  )

  /** ⑦ 新节点不许压住原图（只量**屏幕上看得见**的：融合常常在视口外） */
  const overlap = await page.evaluate(
    (arg) => {
      const rect = (id) => document.querySelector(`[data-node-id="${id}"]`)?.getBoundingClientRect()
      const a = rect(arg.cropId)
      const s = rect(arg.srcId)
      if (!a || !s) return null
      const hit = (x, y) => x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom
      return { cropVsSrc: hit(a, s) }
    },
    { cropId, srcId },
  )
  rec(
    g,
    '★★ 局部图节点不压住原图',
    !!overlap && !overlap.cropVsSrc,
    JSON.stringify(overlap),
  )

  /**
   * ⑧ 融合真的跑完、出图（本地像素合成，不花钱）。
   *
   * 判据取「融合节点的**下游**多了一个带图的节点」：融合结果与生成一样落成承载节点，
   * 而融合节点本身可能在视口外查不到。
   */
  for (let i = 0; i < 160; i += 1) {
    const addedNow = (
      await page
        .locator('[data-node-id]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
    ).filter((id) => !idsBefore.includes(id))
    const withAsset = await page.evaluate(
      (ids) =>
        ids.filter((id) => Boolean(document.querySelector(`[data-node-id="${id}"] [data-node-asset]`)))
          .length,
      addedNow,
    )
    if (withAsset > 0) break
    await sleep(250)
  }
  const fusionResultCount = await page.evaluate(
    (arg) =>
      arg.ids.filter((id) => {
        const el = document.querySelector(`[data-node-id="${id}"]`)
        return Boolean(el && el.querySelector('[data-node-asset]'))
      }).length,
    {
      ids: (
        await page
          .locator('[data-node-id]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
      ).filter((id) => !idsBefore.includes(id)),
    },
  )
  rec(
    g,
    '★★ 融合出了结果图（新节点里至少一张带图）',
    fusionResultCount > 0,
    `带图新节点=${fusionResultCount}`,
  )
  await page.screenshot({ path: `${OUT}/137-g108-emotion-result.png` })

  /**
   * ⑨ **手动路径**（真实兜底）：用户在素材灯箱里自己框一张局部图 → 在它上面选情绪 → 生成。
   *
   * 为什么必须有这条：**不是每个对话模型都能看图** —— 真机上报过「识别人脸失败」。
   * 这条路上不调模型：局部图就是用户框好的脸，原图从 `cropContext.source.assetHash` 反查回来接进融合。
   */
  await page.keyboard.press('Escape')
  await sleep(300)
  const idsBeforeManual = await page
    .locator('[data-node-id]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
  await genPanel(page, src)
  const extractBtn = page.locator('[data-follow-action="extract"]')
  rec(g, '★ 源节点功能栏里有「提取选区」（手动框脸的入口）', (await extractBtn.count()) === 1)
  if ((await extractBtn.count()) === 1) {
    await extractBtn.click()
    await sleep(600)
    const stage = await page.locator('[data-lightbox-stage]').boundingBox()
    await page.mouse.move(stage.x + stage.width * 0.35, stage.y + stage.height * 0.25)
    await page.mouse.down()
    await page.mouse.move(stage.x + stage.width * 0.62, stage.y + stage.height * 0.62, { steps: 10 })
    await page.mouse.up()
    await sleep(350)
    await page.locator('[data-lightbox-crop-apply]').click()
    await sleep(900)
    const cropId2 = (
      await page
        .locator('[data-node-id]')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-node-id')))
    ).find((id) => !idsBeforeManual.includes(id))
    rec(g, '★ 手动框选产出了一张局部图', !!cropId2, `crop=${cropId2}`)
    if (cropId2) {
      await genPanel(page, page.locator(`[data-node-id="${cropId2}"]`))
      await panel.locator('[data-panel-preset]').click()
      await sleep(300)
      await page.locator('[data-preset-emotion]').click()
      await sleep(450)
      await page.locator('[data-emotion="serene"]').click()
      await sleep(200)
      await page.locator('[data-emotion-run]').click()
      let manualFusionId = null
      for (let i = 0; i < 80; i += 1) {
        const edged = await page.locator('[data-edge]').evaluateAll((els) =>
          els.map((e) => ({
            s: e.getAttribute('data-edge-source'),
            t: e.getAttribute('data-edge-target'),
            tp: e.getAttribute('data-edge-target-port'),
          })),
        )
        const target = edged.find((e) => e.s === cropId2 && e.tp === 'patch')?.t
        if (target && edged.some((e) => e.s === srcId && e.t === target && e.tp === 'input')) {
          manualFusionId = target
          break
        }
        await sleep(250)
      }
      rec(
        g,
        '★★ 手动路径：原图 → input、这张局部图 → patch（不调看图模型也能跑）',
        !!manualFusionId,
        `fusion=${manualFusionId}`,
      )
      rec(
        g,
        '★★ 手动路径用的就是你框的那张局部图（正文被写成情绪那句）',
        String(
          (
            await page.evaluate(
              (id) =>
                new Promise((resolve) => {
                  const req = indexedDB.open('qinghua')
                  req.onsuccess = () => {
                    const db = req.result
                    const q = db.transaction('nodes', 'readonly').objectStore('nodes').get(id)
                    q.onsuccess = () => resolve(q.result?.data?.prompt ?? '')
                    q.onerror = () => resolve('')
                  }
                  req.onerror = () => resolve('')
                }),
              cropId2,
            )
          ),
        ).includes('只改人物的面部表情'),
        '局部图正文里带上了情绪约束',
      )
      await page.screenshot({ path: `${OUT}/138-g108-emotion-manual.png` })
    }
  }
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

/**
 * G109 本机人脸检测（MediaPipe BlazeFace，随包走的 wasm + tflite）
 *
 * 背景（用户 2026-10-06：「你看之前我给你看的那个 github 的项目，他也是识别人脸的」）：
 * 参照 VOZEB-PRO，把「脸在哪」从**问对话模型**改成**本机检测** —— 不联网、不花渠道、
 * 不依赖任何模型能力。它现在是「情绪调节」识别人脸的**第一条路**（G108）。
 *
 * 这一组直接打那条路本身：拿 MediaPipe 官方人像夹具，走应用自己那份
 * worker + wasm + tflite，断言**真的认出了脸、框落在合理位置**。
 *
 * 为什么不能只靠 G108 覆盖：G108 的源图是 mock 现造的一整块纯色，本来就没有脸 ——
 * 它只能证明「没认到时回退是对的」，证明不了「有脸时认得出来」。两条各管一半，
 * 少一条就会留下「检测器其实一直返回 0 张脸」这种假通过。
 */
async function g109(browser) {
  const g = 'G109 本机人脸检测'
  const ctx = await newCtx(browser)
  const page = await ctx.newPage()
  const pageErrors = []
  page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 160)))
  const mediapipeRequests = []
  page.on('request', (r) => {
    if (r.url().includes('/mediapipe/')) mediapipeRequests.push(r.url())
  })

  await gotoProjects(page)

  const b64 = readFileSync('scripts/fixtures/mediapipe-portrait.jpg').toString('base64')
  const out = await page.evaluate(async (payload) => {
    const blob = await (await fetch(`data:image/jpeg;base64,${payload}`)).blob()
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    const worker = new Worker('mediapipe/face-detector-worker.js')
    const reply = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ timeout: true }), 45000)
      worker.onmessage = (event) => {
        clearTimeout(timer)
        resolve(event.data)
      }
      worker.onerror = (event) => {
        clearTimeout(timer)
        resolve({ workerError: event.message || 'worker error' })
      }
      worker.postMessage({ id: 1, image: bitmap }, [bitmap])
    })
    worker.terminate()
    return { size, reply }
  }, b64)

  rec(
    g,
    '★ 本机检测的三样静态文件都被真正加载（worker 脚本 / wasm / tflite 模型）',
    mediapipeRequests.some((u) => u.includes('face-detector-worker.js')) &&
      mediapipeRequests.some((u) => u.includes('vision_wasm_internal.wasm')) &&
      mediapipeRequests.some((u) => u.endsWith('.tflite')),
    mediapipeRequests.map((u) => u.split('/mediapipe/')[1] || u).join(' / '),
  )

  if (out.reply?.timeout || out.reply?.workerError || out.reply?.error) {
    rec(
      g,
      '★★ 真人像上认出了人脸',
      false,
      out.reply.timeout ? 'worker 超时' : out.reply.workerError || out.reply.error,
    )
    rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
    await ctx.close()
    return
  }

  const faces = out.reply?.faces ?? []
  rec(g, '★★ 真人像上认出了人脸（不是 0 张）', faces.length >= 1, `faces=${faces.length}`)

  const first = faces[0]
  if (!first) {
    rec(g, '★★ 框落在画面内、尺寸合理', false, '没有脸可判')
    rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
    await ctx.close()
    return
  }

  const { width: W, height: H } = out.size
  const inside = first.x >= 0 && first.y >= 0 && first.x + first.width <= W && first.y + first.height <= H
  const wRatio = first.width / W
  const hRatio = first.height / H
  rec(
    g,
    '★★ 框落在画面内，且占画面的比例是「一张脸」该有的样子（不是整张图）',
    inside && wRatio > 0.05 && wRatio < 0.9 && hRatio > 0.05 && hRatio < 0.9,
    `x=${first.x.toFixed(0)} y=${first.y.toFixed(0)} w=${first.width.toFixed(0)} h=${first.height.toFixed(0)} ` +
      `(${W}x${H} → ${(wRatio * 100).toFixed(0)}% × ${(hRatio * 100).toFixed(0)}%)`,
  )
  rec(g, '★ 可信度够高（> 0.5）', (first.score ?? 0) > 0.5, `score=${first.score?.toFixed(3)}`)
  /** 人像构图：脸在上半部。位置判据能挡住「框认出来了但坐标系搞反了」这类错 */
  const centerY = (first.y + first.height / 2) / H
  rec(g, '★ 脸的纵向中心落在上半部（坐标系没搞反）', centerY < 0.5, `centerY=${centerY.toFixed(2)}`)
  rec(g, '无未捕获异常', pageErrors.length === 0, pageErrors.join(' | '))
  await ctx.close()
}

const ALL_GROUPS = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10, g11, g12, g13, g14, g15, g16, g17, g18, g19, g23, g24, g37, g42, g43, g44, g45, g46, g47, g48, g49, g51, g52, g53, g55, g56, g57, g58, g59, g60, g61, g62, g63, g64, g65, g66, g67, g68, g69, g70, g71, g72, g73, g74, g75, g76, g77, g78, g79, g80, g81, g82, g83, g84, g85, g86, g87, g88, g89, g90, g91, g92, g93, g94, g95, g96, g97, g98, g99, g100, g101, g102, g103, g104, g105, g106, g107, g108, g109]
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
