import { createElement } from 'react'
// 用 Web Streams 版服务端渲染器：其 onAllReady 会等待所有 Suspense 边界（含 React.lazy）就绪。
// 不引 react-dom/server（node 流版需要 @types/node，本项目刻意不引入 node 类型）。
import { renderToReadableStream } from 'react-dom/server.browser'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import { PlatformProvider } from './providers/PlatformProvider'
import { ChannelStoreProvider } from './providers/ChannelStoreProvider'
import { AppRoutes } from './routes'

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
      createElement(MemoryRouter, { initialEntries: entries }, createElement(AppRoutes)),
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
  it('画布路由下：画布表面与顶栏都在', async () => {
    const html = await renderTree(['/canvas/demo'])
    expect(html).toContain('data-canvas-surface')
    expect(html).toContain('轻画')
    expect(html).toContain('提示词')
  }, TREE_TIMEOUT)

  it('漫画剧路由下：工作台表面与返回入口都在', async () => {
    const html = await renderTree(['/comic/demo'])
    expect(html).toContain('data-comic-surface')
    expect(html).toContain('漫画剧')
    expect(html).toContain('data-comic-back')
  }, TREE_TIMEOUT)

  it('首页路由下：品牌与新建入口都在', async () => {
    const html = await renderTree(['/'])
    expect(html).toContain('轻画')
    expect(html).toContain('新建项目')
  }, TREE_TIMEOUT)
})
