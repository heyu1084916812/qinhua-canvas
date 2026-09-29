import { createElement } from 'react'
// 用 Web Streams 版服务端渲染器：其 onAllReady 会等待所有 Suspense 边界（含 React.lazy）就绪。
// 不引 react-dom/server（node 流版需要 @types/node，本项目刻意不引入 node 类型）。
import { renderToReadableStream } from 'react-dom/server.browser'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { PlatformProvider } from './providers/PlatformProvider'
import { ChannelStoreProvider } from './providers/ChannelStoreProvider'
import { ThemeProvider } from './ThemeProvider'
import { AppRoutes } from './routes'
import { AppShell } from './AppShell'

/**
 * 整树渲染冒烟（M0-5 结构验证，M1 改为路由级，M5 起工作台页面为 lazy）。
 *
 * 目的：验证「PlatformProvider → ChannelStoreProvider → 路由 → 页面 → 四层 → NodeFrame」
 * 这条纵向链路能真正挂载，而不是只通过类型检查。
 * 用 memory 运行时，避免 node 环境下触碰 IndexedDB（web 实现在无 DOM 时不可用）。
 * 生产 App 用 BrowserRouter（依赖 window），这里用 MemoryRouter 在 node 下做等价冒烟。
 *
 * 注意 1：画布页挂载了 CanvasExecutionProvider，它需要 ChannelStoreProvider 祖先，
 * 因此整树冒烟必须包含 ChannelStoreProvider（与 App.tsx 的 Provider 顺序一致）。
 *
 * 注意 2：M5 起工作台页面走路由级 React.lazy（架构 §5.10）。renderToString 不会等待 lazy，
 * 只会吐出 Suspense fallback —— 因此这里用 renderToReadableStream + await stream.allReady，
 * 才能真正渲染到页面内容。这是对 §5.10「路由级 lazy」的必要适配，不是绕过。
 *
 * 注意 3：默认 5s 超时对**整树 SSR**偏紧——它要挂完 Provider 链、等 React.lazy 的
 * 工作台 chunk、再初始化 memory 版 IndexedDB。单跑约 2s，但全量跑时 8 个 worker 抢 CPU
 * （transform 阶段可占上百秒），实测会顶到 5s 而假失败。这是**超时配错**不是断言失效：
 * 断言验的是 DOM 内容，与耗时无关。故显式放宽到 20s，避免它长期充当「偶发红灯」、
 * 掩盖真正的失败（历史上已在发布说明里被迫解释过两次「非本轮回归」）。
 */
const TREE_TIMEOUT = 20000

async function renderTree(entries: string[]): Promise<string> {
  const element = createElement(
    PlatformProvider,
    { runtime: 'memory' },
    createElement(
      ChannelStoreProvider,
      null,
      // 主题包在路由之外（与 App.tsx 同一顺序）：首页 / 工作台顶栏都有主题切换，
      // 它读 ThemeProvider 的 context，缺了它会直接抛而不是「渲染出来少一个按钮」。
      createElement(
        ThemeProvider,
        null,
        /*
         * 壳层一起渲染：`AppShell` 在 App.tsx 里包在**路由之外**（全路由常驻），
         * 只渲染 AppRoutes 的话，侧栏的锚点一个都不在树里 —— 那不算整树冒烟
         * （2026-09-27 应用壳改版）。
         */
        createElement(
          MemoryRouter,
          { initialEntries: entries },
          createElement(AppShell, null, createElement(AppRoutes)),
        ),
      ),
    ),
  )

  const stream = await renderToReadableStream(element)
  await stream.allReady
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let html = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    html += decoder.decode(value, { stream: true })
  }
  html += decoder.decode()
  return html
}

describe('App 路由整树渲染冒烟', () => {
  it('画布路由下：画布表面与左侧功能栏都在，且旧顶栏已消失', async () => {
    const html = await renderTree(['/canvas/demo'])
    expect(html).toContain('data-canvas-surface')
    /*
     * 侧栏 Logo 现在是**猫画那个动态 SVG**（用户 2026-09-27：
     * 「logo 用猫画的那个动态 logo」），不再是「轻」这个字。
     *
     * 断言不能用「包含某个字」了 —— 那会随图标资源变化而无意义。
     * 改为钉住**锚点 + 它确实是个 img**：这才是「Logo 位渲染出来了」的判据，
     * 至于是哪张图由 `CatLogo` 决定（它同时被首页复用）。
     */
    expect(html).toContain('data-sidebar-logo')
    expect(html).toMatch(/data-sidebar-logo[^>]*>\s*<img/)
    /* 新宿主：应用壳侧栏（产品文档 §2.1 / §2.2） */
    expect(html).toContain('data-app-shell')
    expect(html).toContain('data-app-sidebar')
    expect(html).toContain('data-sidebar-item="/settings"')
    /* 日志那件事搬到了画布右上角（§6.2） */
    expect(html).toContain('data-canvas-log')
    /*
     * ★ 旧顶栏**必须不在**。这一条是「顶栏已按 §6.2 去除」的护栏：
     * 少了它，只能靠真机上肉眼发现「怎么又冒出来一条顶栏」。
     */
    expect(html).not.toContain('data-topbar')
    expect(html).toContain('data-canvas-toolbar')
    expect(html).toContain('data-toolbar-add')
    expect(html).toContain('data-toolbar-undo')
    expect(html).toContain('data-toolbar-redo')
    expect(html).toContain('data-toolbar-import')
  }, TREE_TIMEOUT)

  it('首页路由下：欢迎页与快捷入口都在', async () => {
    const html = await renderTree(['/'])
    expect(html).toContain('data-home-page')
    /* 首页已按 §5.1 变轻：项目网格搬去 /projects，这里留欢迎与入口 */
    expect(html).toContain('data-home-projects')
    /*
     * 文字标是用户给的 QINGHUA 字形（2026-09-29 第 13 轮），字形本身没有可读
     * 文本，所以「轻画」只留在 `aria-label` 上；这里两个断言各钉一半：
     * 可读页名还在，且渲染的确实是字标组件而不是回退成纯文字标题。
     */
    expect(html).toContain('轻画')
    expect(html).toContain('data-qinghua-wordmark')
  }, TREE_TIMEOUT)

  it('项目路由下：项目网格与模板库都在（§5.1 的迁移目标）', async () => {
    const html = await renderTree(['/projects'])
    /*
     * 空库时是**空态**（`data-new-project`），不是网格末尾那张「+ 新建」卡
     * （`data-new-card` 只在有项目时出现）。断言用空态锚点，
     * 否则测的是「有没有项目」而不是「项目页渲染出来了没」。
     */
    expect(html).toContain('data-new-project')
    expect(html).toContain('data-template="text2img"')
  }, TREE_TIMEOUT)
})
