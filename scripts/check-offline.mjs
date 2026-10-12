// 试跑：E2E-11「无网络」那条能不能验、界面到底说什么。
//
// 关键设计：把渠道地址指向**本地 dev server** 的一个不存在的路径 ——
//   在线时：请求真的发出去，回来的是 404 / HTML ⇒ 错误文案属 http 或 parse 那两档；
//   断网时：同一个请求变成 fetch 失败 ⇒ 文案必须是「连不上：…」（`shared/result.describeError` 的 network 档）。
// 这样"断网"才是**决定因素**，而不是靠一个本来就不通的域名糊出来。
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:1420'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok })
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ channel: 'chrome' })
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
// 与冒烟 `newCtx` 同一条口径：把**一次性门槛**在初始化时就关掉，
// 否则新手引导模态会在任何路由上弹一次、把所有点击都拦掉（实测被它拦死过一次）。
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('flow:onboarded', '1')
    localStorage.setItem('flow:canvasGuideDismissed', '1')
  } catch {
    /* 隐私模式写不进去也没关系 */
  }
})
const page = await ctx.newPage()
page.setDefaultTimeout(8000)
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)))

// ① 配一条"真发请求"的渠道（地址指向本地 dev server 的假路径）
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
await sleep(500)
for (const id of await page
  .locator('[data-channel-item][data-channel-id^="ch_builtin_"]')
  .evaluateAll((els) => els.map((e) => e.getAttribute('data-channel-id')))) {
  const box = page.locator(`[data-channel-enabled="${id}"]`)
  if (await box.isChecked().catch(() => false)) await box.uncheck().catch(() => {})
}
await page.getByRole('button', { name: /新增渠道/ }).click()
await sleep(400)
await page.getByText('新建渠道').first().click()
await sleep(300)
await page.locator('[data-settings-baseurl]').fill(`${BASE}/__offline_probe`)
await page.locator('[data-settings-protocol]').selectOption('openai-compatible')
await sleep(200)
const keyInput = page.locator('input[type="password"], input[placeholder*="Key"]').first()
await keyInput.fill('sk-probe').catch(() => {})
/**
 * ⚠️ 令牌有**自己的保存按钮**：`保存配置` 只落名称 / 地址 / 启用，**不落令牌**。
 * 少了这一下，渠道的 `hasToken` 是 false ⇒ 它**不参与选路** ⇒ 点生成得到的是
 * 「没有渠道提供模型…」（第一次试跑就是这么空转的）。
 */
await page.locator('[data-settings-token-save="primary"]').click()
await sleep(400)
await page.getByRole('button', { name: '保存配置' }).click()
await sleep(500)
const myChannel = await page
  .locator('[data-channel-item]:not([data-channel-id^="ch_builtin_"])')
  .first()
  .getAttribute('data-channel-id')
await page.locator(`[data-channel-enabled="${myChannel}"]`).check().catch(() => {})
await sleep(300)
console.log('渠道 id =', myChannel, '| 已启用 =', await page.locator(`[data-channel-enabled="${myChannel}"]`).isChecked())

/**
 * **给这条渠道种一个模型**（测试夹具，直接写库）。
 *
 * 为什么必须种：选路时候选渠道要拿 `models.map(m => m.id)` 去匹配节点上的逻辑模型名
 * （`CanvasExecutionProvider` 的 `sources`），空模型表 ⇒ 匹配不上 ⇒ 这个任务**不进计划**、
 * 点生成就"毫无反应"（第一次试跑就是这么空转的）。真实用户是「拉取模型 → 勾选」拿到这份数据的；
 * 离线探针里没有服务端可拉，只能自己写进去。
 */
await page.evaluate(
  (id) =>
    new Promise((resolve) => {
      const req = indexedDB.open('qinghua')
      req.onsuccess = () => {
        const db = req.result
        const tx = db.transaction('channels', 'readwrite')
        const store = tx.objectStore('channels')
        const get = store.get(id)
        get.onsuccess = () => {
          const row = get.result
          if (!row) return resolve(false)
          row.models = [
            {
              id: 'GPT Image 2',
              category: 'image',
              inputTypes: ['text'],
              aspectRatios: ['1:1'],
              resolutions: ['1k'],
              maxCount: 4,
            },
          ]
          store.put(row)
        }
        tx.oncomplete = () => resolve(true)
        tx.onerror = () => resolve(false)
      }
      req.onerror = () => resolve(false)
    }),
  myChannel,
)
const seeded = await page.evaluate(
  (id) =>
    new Promise((resolve) => {
      const req = indexedDB.open('qinghua')
      req.onsuccess = () => {
        const q = req.result.transaction('channels', 'readonly').objectStore('channels').get(id)
        q.onsuccess = () => resolve((q.result?.models ?? []).map((m) => m.id))
        q.onerror = () => resolve([])
      }
      req.onerror = () => resolve([])
    }),
  myChannel,
)
console.log('种进库的模型 =', JSON.stringify(seeded))
await page.reload({ waitUntil: 'networkidle' }) // 让渠道 store 重新读一次
await sleep(600)

// ② 画布：建生成节点、选模型、写提示词
await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' })
await sleep(600)
const skip = page.locator('[data-onboarding-skip]')
if (await skip.count()) {
  await skip.first().click()
  await sleep(300)
}
await page.locator('[data-template="blank"]').click()
await page.waitForURL(/\/canvas\//)
await sleep(800)
await page.locator('[data-toolbar-add]').click()
await sleep(250)
await page.locator('[data-toolbar-menu-item="generation"]').click()
await sleep(600)
const nodeId = await page.locator('[data-node-type="generation"]').first().getAttribute('data-node-id')
const panel = page.locator('[data-creation-panel]')
await panel.waitFor({ state: 'visible', timeout: 8000 })
/**
 * 选模型：chip → 浮层 → **归一后全等**点中。
 * ⚠️ 必须全等：`GPT Image 2` 是 `GPT Image 2.5 Flare` 的**子串**，
 * 用 `filter({hasText})` 会选到后面那个（冒烟里为这条栽过：选中的模型没有任何渠道提供 ⇒ 点生成毫无反应）。
 */
const norm = (s) => String(s).replace(/[\s✓✔]/g, '').toLowerCase()
await panel.locator('[data-param-chip="model"]').click()
await panel.locator('[data-param-popup="model"]').waitFor({ state: 'visible', timeout: 5000 })
const modelOpts = panel.locator('[data-param-popup="model"] button')
const total = await modelOpts.count()
let hit = -1
for (let i = 0; i < total; i++) {
  const t = norm(await modelOpts.nth(i).innerText().catch(() => ''))
  if (t === norm('GPT Image 2')) {
    hit = i
    break
  }
}
console.log(`模型选项 ${total} 个，命中 GPT Image 2 的索引 = ${hit}`)
if (hit >= 0) await modelOpts.nth(hit).click()
await sleep(300)
// ⚠️ 这里**不能**按 Escape：单选型浮层选完自己就关了，而 Esc 是**面板级**按键策略
// —— 实测它会把整个创作面板一起收掉，后面找 `[data-panel-prompt]` 直接超时。
console.log('模型 chip 现在显示 =', JSON.stringify((await panel.locator('[data-param-chip="model"]').innerText()).trim()))
const ta = panel.locator('[data-panel-prompt]')
await ta.click()
await ta.fill('断网验收')
await ta.blur()
// ⚠️ 库里的行是**800ms 防抖**之后才写的 —— 500ms 就读会读到上一版（第一次跑就是这么误判的）
await sleep(1600)

const readNode = () =>
  page.evaluate(
    (id) =>
      new Promise((resolve) => {
        const req = indexedDB.open('qinghua')
        req.onsuccess = () => {
          const q = req.result.transaction('nodes', 'readonly').objectStore('nodes').get(id)
          q.onsuccess = () => resolve(q.result ?? null)
          q.onerror = () => resolve(null)
        }
        req.onerror = () => resolve(null)
      }),
    nodeId,
  )
const before = await readNode()
console.log(
  '库里那一行 =',
  JSON.stringify({ channelId: before?.data?.channelId, model: before?.data?.model, prompt: before?.data?.prompt }),
)

/** 点生成并等错误浮层，返回它的文案 */
const runAndReadError = async (label) => {
  await panel.locator('[data-panel-run]').click()
  /**
   * 逐步诊断：点完之后每 250ms 采样一次，把「产物 / 错误浮层 / 页内提示 / 按钮文案」都记下来。
   * 只等一个错误浮层会漏掉别的形态（页内提示 2.4s 就没了、失败也可能只落在日志里）。
   */
  const samples = []
  for (let i = 0; i < 24; i++) {
    const [assets, errCount, notice, label2] = await Promise.all([
      page.locator('[data-node-asset]').count(),
      page.locator('[data-node-error]').count(),
      page.locator('[data-canvas-notice]').innerText().catch(() => ''),
      panel.locator('[data-panel-run]').getAttribute('aria-label').catch(() => ''),
    ])
    const line = `t=${(i * 0.25).toFixed(2)}s assets=${assets} err=${errCount} notice=${JSON.stringify(notice.replace(/\s+/g, ' '))} btn=${label2}`
    if (!samples.length || samples[samples.length - 1].slice(samples[samples.length - 1].indexOf('assets')) !== line.slice(line.indexOf('assets'))) {
      samples.push(line)
    }
    if (errCount > 0) break
    await sleep(250)
  }
  console.log(`${label} 过程：\n    ${samples.join('\n    ')}`)
  /**
   * 页内提示只说「生成失败：1 个任务没出图（**原因见日志**）」——
   * 真正的原因（连不上 / HTTP / 解析）在**日志面板**里。不打开它，
   * 就只能看到"失败了"，看不见"为什么"，也就断不了"断网"这件事。
   */
  await page.locator('[data-canvas-log]').click().catch(() => {})
  await sleep(450)
  const logText = (await page.locator('[data-log-panel]').innerText().catch(() => '')).replace(/\s+/g, ' ')
  console.log(`  [日志] ${logText.slice(0, 240)}`)
  // 关日志面板要**点它自己的关闭按钮**：Esc 是面板级按键策略，实测会把创作面板一起收掉
  // （第一版就栽在这：按完 Esc，后面找 `[data-panel-prompt]` 直接超时）。
  await page
    .locator('[data-log-panel]')
    .getByRole('button', { name: '关闭' })
    .first()
    .click()
    .catch(() => {})
  await sleep(300)
  const errEl = page.locator('[data-node-error]')
  const ok = await errEl
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true)
    .catch(() => false)
  if (!ok) {
    const notice = await page.locator('[data-canvas-notice]').innerText().catch(() => '')
    const runLabel = await panel.locator('[data-panel-run]').getAttribute('aria-label').catch(() => '')
    console.log(`  [diag] 没有错误浮层；页内提示=${JSON.stringify(notice)}；按钮=${runLabel}`)
  }
  const text = ok ? (await errEl.first().innerText()).trim() : '（没有出现错误浮层）'
  console.log(`${label}：${text.replace(/\s+/g, ' ').slice(0, 120)}`)
  return { errorText: text, logText }
}

// ③ 在线跑一次（对照）
const online = await runAndReadError('在线时')

// ④ 断网：CDP 模拟离线 → 改提示词（验本地可编辑可保存）→ 再跑
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
await cdp.send('Network.emulateNetworkConditions', {
  offline: true,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
})
console.log('已切到离线模拟')
// ⚠️ 这里**不能**再点一次生成按钮"回到空闲"——它本来就是空闲态（失败已经收口），
// 那一下会真发起第二趟请求（第一版就这么多跑了一趟）。
await sleep(300)
await ta.click()
await ta.fill('断网验收（离线改过一次）')
await ta.blur()
await sleep(1400)
const afterEdit = await readNode()
console.log('离线编辑后库里的提示词 =', JSON.stringify(afterEdit?.data?.prompt))
const offline = await runAndReadError('断网时')
const promptKept = (await panel.locator('[data-panel-prompt]').innerText()).replace(/\s+/g, '')
console.log('失败之后面板里的提示词 =', JSON.stringify(promptKept))

/**
 * 断言（对账 #469 起，日志里**真的写了原因**）：
 * 在线那次失败的原因**不能**是"连不上"（请求确实发出去了，回来的是个坏响应）；
 * 断网那次**必须**是"连不上" —— 这样"断网"才是决定因素，而不是被一个本来就不通的地址糊出来。
 */
check('在线那趟失败原因写进了日志', /失败/.test(online.logText), online.logText.slice(0, 120))
check('在线那趟的原因**不是**「连不上」（请求真发出去了）', !online.logText.includes('连不上'), online.logText.slice(0, 120))
check('断网那趟失败原因写进了日志', /失败/.test(offline.logText), offline.logText.slice(0, 120))
check('★ 断网那趟的原因里有「连不上」（网络类错误有专门文案）', offline.logText.includes('连不上'), offline.logText.slice(0, 160))
check('★ 离线期间编辑照常落库（编辑与保存可用）', afterEdit?.data?.prompt === '断网验收（离线改过一次）', JSON.stringify(afterEdit?.data?.prompt))
check('★ 失败之后输入仍保留在面板里', promptKept.includes('离线改过一次'), JSON.stringify(promptKept))

await cdp.send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 0,
  downloadThroughput: -1,
  uploadThroughput: -1,
})
await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n===== ${results.length - failed.length} passed / ${failed.length} failed / ${results.length} total =====`)
if (failed.length) {
  console.log('失败项：')
  for (const f of failed) console.log(` - ${f.name}`)
}
process.exit(failed.length ? 1 : 0)
