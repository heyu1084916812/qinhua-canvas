import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect, beforeEach } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import { createCanvasStore } from '../../../../state/workbenches/canvas/store'
import { CanvasStoreProvider } from '../../storeContext'
import { PlatformProvider } from '../../../../app/providers/PlatformProvider'
import { GenerationNodeView } from './GenerationNodeView'
import { registerAllSpecs } from '../../../../domain/canvas/nodeSpecs'
import { generationSpec } from '../../../../domain/canvas/nodeSpecs/generation'
import type { NodeViewProps } from '../registry'
import type { NodeSnapshot } from '../../../../domain/canvas/model/node'

/**
 * 生成节点**本体**（产品文档 §6.8「状态 A / 状态 B」）。
 *
 * 本组把本体从「参数芯片 + 提示词 + 生成按钮」减重为**媒体框**，
 * 所以这里的断言重点有两类：
 * ① 该有的（占位框 + `+` / 素材 / 居中状态）；
 * ② **不该有的**——参数下拉、提示词框、生成按钮一律不得再出现在本体里
 *    （它们属于下方创作参数面板，留着就是两套 UI）。
 *
 * 用 SSR（renderToString）验证结构，不依赖 DOM（项目测试环境为 node，无 testing-library）。
 * 交互（点击 `+` 触发上传、双击开灯箱）由冒烟在真浏览器里验证。
 */
function genNode(overrides: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    id: 'n-gen',
    projectId: 'p1',
    type: 'generation',
    parentId: null,
    x: 0,
    y: 0,
    w: 240,
    h: 240,
    title: '生成',
    disabled: false,
    stale: false,
    data: generationSpec.createDefaultData(),
    ...overrides,
  }
}

function render(props: NodeViewProps): string {
  const canvasStore = createCanvasStore({
    platform: createMemoryPlatform(),
    projectId: 'p1',
    debounceMs: 0,
  })
  return renderToString(
    createElement(
      PlatformProvider,
      { runtime: 'memory' as const },
      createElement(CanvasStoreProvider, {
        store: canvasStore,
        children: createElement(GenerationNodeView, props),
      }),
    ),
  )
}

function baseProps(overrides: Partial<NodeViewProps> = {}): NodeViewProps {
  return {
    node: genNode(),
    size: { w: 240, h: 208 },
    scale: 1,
    selected: false,
    running: false,
    stale: false,
    runMode: 'idle',
    error: null,
    emit: () => {},
    ...overrides,
  }
}

beforeEach(() => {
  registerAllSpecs()
})

describe('GenerationNodeView · 状态 A（空态）', () => {
  it('渲染占位框与中间的 `+` 上传按钮', () => {
    const html = render(baseProps())
    expect(html).toContain('data-generation-media')
    expect(html).toContain('data-node-upload')
    expect(html).toContain('＋')
  })

  it('空态不渲染素材骨架（骨架只在「已有内容」时出现）', () => {
    expect(render(baseProps())).not.toContain('data-node-asset-loading')
  })
})

describe('GenerationNodeView · 状态 B（有内容）', () => {
  it('已有 assetHash 时不再显示 `+` 上传入口', () => {
    const node = genNode({ data: { ...generationSpec.createDefaultData(), assetHash: 'h1' } })
    const html = render(baseProps({ node }))
    expect(html).not.toContain('data-node-upload')
  })

  it('素材本体尚未读回时显示中立骨架，而不是退回上传入口', () => {
    // SSR 不跑 effect ⇒ useAsset 拿不到 objectURL，正对应「hash 已有、字节还在路上」
    const node = genNode({ data: { ...generationSpec.createDefaultData(), assetHash: 'h1' } })
    expect(render(baseProps({ node }))).toContain('data-node-asset-loading')
  })
})

describe('GenerationNodeView · 本体不含参数（§6.8：参数归创作面板）', () => {
  it('不渲染任何参数下拉', () => {
    expect(render(baseProps())).not.toContain('<select')
  })

  it('不渲染提示词输入框', () => {
    expect(render(baseProps())).not.toContain('<textarea')
  })

  it('不渲染生成按钮（含其三种 aria-label）', () => {
    const html = render(baseProps())
    expect(html).not.toContain('生成当前节点')
    expect(html).not.toContain('取消当前生成')
    expect(html).not.toContain('全局工作流运行中')
  })
})

describe('GenerationNodeView · 状态居中（§6.8「在节点中心显示」）', () => {
  it('本节点运行中：居中转圈', () => {
    const html = render(baseProps({ running: true }))
    expect(html).toContain('data-node-status="running"')
  })

  it('★ 全局运行中（本节点未参与）：**不长**任何状态覆盖层', () => {
    // 用户实测报「生成某个节点时，其他没让它生成的节点也在转圈」。
    // 「全局运行中」是**生成按钮**的状态（§6.8 按钮变 LoaderCircle 并禁用），
    // 不属于节点本体——本体只表达自己的 running / error（§6.19.5）。
    const html = render(baseProps({ running: false, globalRunning: true }))
    expect(html).not.toContain('data-node-status=')
    expect(html).not.toContain('全局工作流运行中')
  })

  it('全局运行中 + 本节点也在跑：仍显示自己的「生成中」', () => {
    const html = render(baseProps({ running: true, globalRunning: true }))
    expect(html).toContain('data-node-status="running"')
    expect(html).not.toContain('data-node-status="busy"')
  })

  it('失败：居中显示报错原因，且不再转圈', () => {
    const html = render(baseProps({ error: '网络错误' }))
    expect(html).toContain('data-node-status="error"')
    expect(html).toContain('网络错误')
    expect(html).not.toContain('data-node-status="running"')
  })

  it('空闲：无状态覆盖层', () => {
    expect(render(baseProps())).not.toContain('data-node-status=')
  })
})
