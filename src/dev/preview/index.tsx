import { createRoot } from 'react-dom/client'
import { useEffect, useMemo } from 'react'
import { registerAllSpecs } from '../../domain/canvas/nodeSpecs'
import { registerAllViews } from '../../workbenches/canvas/nodes'
import { PlatformProvider, usePlatform } from '../../app/providers/PlatformProvider'
import { ChannelStoreProvider, useChannels } from '../../app/providers/ChannelStoreProvider'
import { CanvasStoreProvider } from '../../workbenches/canvas/storeContext'
import { createCanvasStore } from '../../state/workbenches/canvas/store'
import { CanvasExecutionProvider } from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import { createMemoryPlatform } from '../../platform/memory/index'
import { PreviewPage } from './PreviewPage'
import { buildPreviewAssets } from './assets'
import { createPreviewNetwork } from './mockNetwork'
import { seedPreviewChannels, seedPreviewGraph } from './seed'

/**
 * 陈列室专用平台：内存平台 + 离线网络层（见 mockNetwork.ts）。
 * 有了网络层，渠道「验证地址 / 拉模型」与「批量生成」才能在无后端时可演示。
 */
function createPreviewPlatform() {
  const base = createMemoryPlatform()
  return { ...base, network: createPreviewNetwork() }
}

/** 陈列室内部：用同一个平台实例构造空画布 store，供节点视图的 useAsset 订阅使用 */
function PreviewShell() {
  const platform = usePlatform()
  const canvasStore = useMemo(
    () => createCanvasStore({ platform, projectId: 'preview' }),
    [platform],
  )

  // 对比节点陈列需要真实素材：把两张 PNG 直接写进内存 assets 表。
  // 注意必须直写 storage，而不是走 store.dispatch——dispatch 只更新 store 内的图快照，
  // 而 useAsset 是直接查 platform.storage 的（真实生成路径由持久化层落库）。
  useEffect(() => {
    void (async () => {
      await platform.storage.open()
      const [a, b] = await buildPreviewAssets()
      for (const asset of [a, b]) {
        await platform.storage.put('assets', { ...asset, id: asset.hash } as never)
      }
      // 分组 / 批量视图持有 graph（读子节点），陈列室必须把子节点真的写进 store，
      // 否则容器内一片空白，视觉回归失去意义。
      seedPreviewGraph(canvasStore)
    })()
  }, [platform, canvasStore])

  return (
    <ChannelStoreProvider>
      <CanvasStoreProvider store={canvasStore}>
        {/* 内置 mock 渠道：让「批量生成」在陈列室里也能真的跑一遍 */}
        <PreviewChannels />
        {/* 执行宿主：提示词节点视图依赖 useCanvasExecution（优化 / 翻译，M4-4） */}
        <CanvasExecutionProvider>
          <PreviewPage />
        </CanvasExecutionProvider>
      </CanvasStoreProvider>
    </ChannelStoreProvider>
  )
}

/** 启动时把内置渠道写进渠道 store（协议 mock，无需网络） */
function PreviewChannels() {
  const channels = useChannels()
  useEffect(() => {
    void seedPreviewChannels(channels)
  }, [channels])
  return null
}

/**
 * 陈列室挂载入口（架构 §5.7）。
 * 仅 DEV + /_preview 下由 main.tsx 动态加载；registerAllViews 内部已做
 * 规格/视图一致性校验，因此注册顺序必须 spec 先、view 后。
 *
 * 节点视图（如生成节点）依赖平台 / 渠道 / 画布 store 三类 context，
 * 故陈列室用内存平台 + 空画布 store 兜底，保证视图在无后端环境下可独立渲染。
 */
export function mountPreview(container: HTMLElement): void {
  registerAllSpecs()
  registerAllViews()
  const root = createRoot(container)
  root.render(
    <PlatformProvider runtime="memory" create={() => createPreviewPlatform()}>
      <PreviewShell />
    </PlatformProvider>,
  )
}
