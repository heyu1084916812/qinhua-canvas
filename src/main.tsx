import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './ui/tokens.css'
import './ui/base.css'

const container = document.getElementById('root')
if (container) {
  if (import.meta.env.DEV && location.pathname === '/_preview') {
    // 组件陈列室（架构 §5.7）：仅 DEV 下加载。生产构建时 import.meta.env.DEV 被
    // 静态替换为 false，该分支被 Rollup tree-shake 掉，dev/preview 不进产物。
    void import('./dev/preview')
      .then((m) => m.mountPreview(container))
      .catch((e) => {
        container.textContent = `陈列室加载失败：${String(e)}`
      })
  } else {
    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    )
  }
}
