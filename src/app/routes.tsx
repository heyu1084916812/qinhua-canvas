import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { HomePage } from '../pages/HomePage/HomePage'
import { ProjectsPage } from '../pages/ProjectsPage/ProjectsPage'
import { AssetsPage } from '../pages/AssetsPage/AssetsPage'
import { SettingsPage } from '../pages/SettingsPage/SettingsPage'

/**
 * 路由表（react-router-dom v7，架构 §3）。
 * - /                → 首页（项目卡片网格）
 * - /canvas/:id      → 画布工作台页（按 projectId 从 IndexedDB 读回图）
 * - /settings        → 设置页（渠道配置）
 * - /skills          → 技能库（用户 2026-09-24：自己写给文本模型用的系统指令）
 * - *                → 兜底回首页
 * dev 的 /_preview 由 main.tsx 在挂载 App 之前拦截，不走这里。
 *
 * 工作台页面走路由级 lazy（架构 §5.10）：首页 bundle 不含工作台实现，
 * 各自工作台的代码在进入对应路由时才加载，首屏只付首页与设置页的成本。
 * 懒加载边界按工作台切分——同一工作台内的页面共享一个 chunk。
 */
const CanvasPage = lazy(() =>
  import('../pages/CanvasPage/CanvasPage').then((m) => ({ default: m.CanvasPage })),
)
/**
 * 技能库单独成页，而不是塞进设置页。
 *
 * 理由：设置页已经在管渠道 / 协议 / 模型三件事，再加一块会继续变厚；
 * 而技能是**内容**（要写正文、导入 md、逐条编辑），与「配置连接」是两类工作。
 * 独立成页后，`/skills` 也能直接从画布面板跳进来（缺技能时的引导出口）。
 */
const SkillsPage = lazy(() =>
  import('../pages/SkillsPage/SkillsPage').then((m) => ({ default: m.SkillsPage })),
)

/** 懒加载回退：极简空屏，避免闪 logo（工作台 chunk 通常 < 100ms） */
function RouteFallback() {
  return <div style={{ width: '100vw', height: '100vh' }} aria-busy="true" />
}

export function AppRoutes() {
  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        {/*
          `/projects` 是一级「项目」页（产品文档 §2.1 #3）。
          内容就是原来的项目网格 + 模板库 —— 它们原先挂在 `/` 上，
          而 `/` 已按 §5.1 改成「欢迎 + 快捷入口」。
        */}
        <Route path="/projects" element={<ProjectsPage />} />
        {/*
          `/canvas`（无 id）也接住：侧栏「画布」这一项指向它，
          没有项目时进去应当是「打开空白画布」而不是跳回首页。
        */}
        <Route path="/canvas" element={<CanvasPage />} />
        <Route path="/canvas/:projectId" element={<CanvasPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        {/* 「我的素材」暂为占位页（§2.1 #6 明写「交互后期补齐」） */}
        <Route path="/assets" element={<AssetsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
