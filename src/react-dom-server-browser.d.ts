/**
 * 测试用环境声明（M5）。
 *
 * `react-dom/server.browser` 是 React 18 的 Web Streams 服务端渲染器，
 * 其 onAllReady / allReady 能等待 Suspense 边界（含 React.lazy）就绪——
 * App 整树渲染冒烟需要它来验证路由级 lazy（架构 §5.10）。
 *
 * @types/react-dom 只为 `react-dom/server`（node 流版）提供了声明，
 * 而 node 流版需要 @types/node，本项目刻意不引入 node 类型（纯浏览器环境）。
 * 故此处只补最小声明：仅覆盖测试实际用到的 API。
 */
declare module 'react-dom/server.browser' {
  import type { ReactNode } from 'react'

  interface RenderToReadableStreamOptions {
    onError?: (error: unknown) => void
  }

  interface ReactReadableStream extends ReadableStream<Uint8Array> {
    /** 所有 Suspense 边界（含 lazy 组件）就绪后 resolve */
    allReady: Promise<void>
  }

  export function renderToReadableStream(
    children: ReactNode,
    options?: RenderToReadableStreamOptions,
  ): Promise<ReactReadableStream>
}
