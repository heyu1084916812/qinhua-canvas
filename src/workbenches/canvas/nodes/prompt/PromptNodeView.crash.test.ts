import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { createMemoryPlatform } from '../../../../platform/memory'
import { createCanvasStore } from '../../../../state/workbenches/canvas/store'
import { CanvasStoreProvider } from '../../storeContext'
import { PlatformProvider } from '../../../../app/providers/PlatformProvider'
import { ChannelStoreProvider } from '../../../../app/providers/ChannelStoreProvider'
import { registerAllSpecs } from '../../../../domain/canvas/nodeSpecs'
import { PromptNodeView } from './PromptNodeView'
import { CanvasExecutionProvider } from '../../execution/CanvasExecutionProvider'
import type { NodeViewProps } from '../registry'
import type { PromptData } from '../../../../domain/canvas/model/node'

registerAllSpecs()

/**
 * 节点视图**不许因为数据缺字段而崩**（用户 2026-09-23 报黑屏）。
 *
 * 现场：`PromptNodeView` 第 205 行直接读 `data.text.length`，
 * 而上面渲染正文时已经做了 `data.text ? … : …` 的空值保护 ——
 * **同一份数据、两处口径不一致**。只要 `text` 是 undefined
 * （老库数据、或某条创建路径漏带该字段），这一行就抛
 * `Cannot read properties of undefined (reading 'length')`。
 *
 * 代价不只是「这个节点显示不出来」：React 的渲染错误会把**整棵树**带下去，
 * 用户看到的是**整个画布黑屏**、未保存的操作全丢。所以这一组断言值得单独存在。
 *
 * 用 SSR 渲染（项目测试环境是 node，无 testing-library）：崩了会直接抛异常，
 * 比断言 DOM 更早、更明确地失败。
 */
function render(data: unknown): string {
  const props = {
    node: { id: 'n1', type: 'prompt', x: 0, y: 0, w: 240, h: 160, parentId: null, data },
    size: { w: 240, h: 160 },
    scale: 1,
    selected: false,
    running: false,
    globalRunning: false,
    runMode: undefined,
    error: null,
    emit: () => {},
  } as unknown as NodeViewProps
  /**
   * Provider 链必须补齐：`PromptNodeView` 内部用 `useCanvasExecution()`，
   * 而宿主 Provider 又需要 `ChannelStoreProvider` 祖先（与 App.tsx 的顺序一致）。
   * 只包 CanvasExecutionProvider 会在挂载时抛「未挂载」，让本组测不出真正要测的东西。
   */
  const canvasStore = createCanvasStore({
    platform: createMemoryPlatform(),
    projectId: 'p1',
    debounceMs: 0,
  })
  return renderToString(
    createElement(
      PlatformProvider,
      { runtime: 'memory' as const },
      createElement(
        ChannelStoreProvider,
        null,
        createElement(
          CanvasStoreProvider,
          { store: canvasStore } as never,
          createElement(CanvasExecutionProvider, null, createElement(PromptNodeView, props)),
        ),
      ),
    ),
  )
}

/**
 * SSR 会在「表达式」与相邻文本之间插 `<!-- -->` 注释（React 的水合标记），
 * 所以断言不能直接找 `"3 字"`。剥掉注释再比，否则测的是 React 的实现细节。
 */
const stripComments = (html: string) => html.replace(/<!--.*?-->/g, '')

describe('PromptNodeView · 数据缺字段不许崩（黑屏回归）', () => {
  it('★★ text 缺失（undefined）时不抛异常，字数显示 0', () => {
    expect(() => render({ upstreamPromptLinked: false })).not.toThrow()
    expect(stripComments(render({ upstreamPromptLinked: false }))).toContain('0 字')
  })

  it('★★ text 为 null 时同样不崩', () => {
    expect(() => render({ text: null, upstreamPromptLinked: false })).not.toThrow()
  })

  it('text 为空串时正常渲染占位提示', () => {
    const html = stripComments(render({ text: '', upstreamPromptLinked: false }))
    expect(html).toContain('双击输入提示词')
    expect(html).toContain('0 字')
  })

  it('text 有内容时字数正确', () => {
    const html = stripComments(render({ text: '一只猫', upstreamPromptLinked: false }))
    expect(html).toContain('3 字')
  })

  it('★ 整个 data 是空对象时也不崩（老数据 / 新建路径漏字段的极端情况）', () => {
    expect(() => render({})).not.toThrow()
  })

  it('工具按钮的禁用判定同样不因缺 text 而崩', () => {
    // 三个工具按钮都会读 data.text 来判禁用，缺字段时不该抛
    const html = render({ upstreamPromptLinked: false, draft: '' } as Partial<PromptData>)
    expect(html).toContain('data-prompt-tool')
  })
})
