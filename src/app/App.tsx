import { BrowserRouter } from 'react-router-dom'
import { PlatformProvider } from './providers/PlatformProvider'
import { ChannelStoreProvider } from './providers/ChannelStoreProvider'
import { SkillStoreProvider } from './providers/SkillStoreProvider'
import { ThemeProvider } from './ThemeProvider'
import { AppRoutes } from './routes'
import { BootstrapGate } from './BootstrapGate'
import { registerAllSpecs } from '../domain/canvas/nodeSpecs'
import { registerAllViews } from '../workbenches/canvas/nodes'
import type { RuntimeId } from '../platform'

// 启动注册：行为规格（domain）先注册，渲染绑定（workbenches）后注册，
// registerAllViews() 末尾会校验两者数量一致（架构 §4.5）。
let registered = false
function ensureRegistered() {
  if (registered) return
  registerAllSpecs()
  registerAllViews()
  registered = true
}

export interface AppProps {
  /** 运行时实现选择；默认 web。测试 / 无 DOM 环境传 memory。 */
  runtime?: RuntimeId
}

export function App(props: AppProps) {
  ensureRegistered()
  const runtime = props.runtime ?? 'web'
  return (
    <PlatformProvider runtime={runtime}>
      <ChannelStoreProvider>
        <SkillStoreProvider>
        {/* 主题在最外层：它只改 <html data-theme>，不依赖任何业务状态，
            先于 BootstrapGate 落地才能让「启动校验」那一屏也是正确配色。 */}
        <ThemeProvider>
          <BootstrapGate>
            <BrowserRouter>
              <AppRoutes />
            </BrowserRouter>
          </BootstrapGate>
        </ThemeProvider>
        </SkillStoreProvider>
      </ChannelStoreProvider>
    </PlatformProvider>
  )
}
