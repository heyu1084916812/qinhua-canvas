import { BrowserRouter } from 'react-router-dom'
import { PlatformProvider } from './providers/PlatformProvider'
import { ChannelStoreProvider } from './providers/ChannelStoreProvider'
import { SkillStoreProvider } from './providers/SkillStoreProvider'
import { PresetTextProvider } from './providers/PresetTextProvider'
import { ThemeProvider } from './ThemeProvider'
import { AppRoutes } from './routes'
import { AppShell } from './AppShell'
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
        {/* 预设词与技能同层：两者都是「后台可改、画布消费」的内容，
            且都要在路由切换后仍然生效（见各 Provider 的注释）。 */}
        <PresetTextProvider>
        {/* 主题在最外层：它只改 <html data-theme>，不依赖任何业务状态，
            先于 BootstrapGate 落地才能让「启动校验」那一屏也是正确配色。 */}
        <ThemeProvider>
          <BootstrapGate>
            <BrowserRouter>
              {/*
                应用壳包在**路由之外**（产品文档 §2.1「全路由常驻」）：
                它是布局，不是页面；放进来之后切页面不会重建侧栏，
                侧栏的展开状态与「最近项目」列表因此不会闪一下重来。
              */}
              <AppShell>
                <AppRoutes />
              </AppShell>
            </BrowserRouter>
          </BootstrapGate>
        </ThemeProvider>
        </PresetTextProvider>
        </SkillStoreProvider>
      </ChannelStoreProvider>
    </PlatformProvider>
  )
}
