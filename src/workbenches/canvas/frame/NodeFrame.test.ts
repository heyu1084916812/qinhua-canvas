import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '../../../platform/memory'
import { createCanvasStore } from '../../../state/workbenches/canvas/store'
import { CanvasStoreProvider } from '../storeContext'
import { NodeFrame } from './NodeFrame'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'

/**
 * 缩放手柄**必须带 React Flow 的免拖动类名 `nodrag`**（对账 #207、《轻画-画布引擎替换方案.md》§8.10.2）。
 *
 * 为什么值得单独钉一条：RF 的节点拖动绑在**原生 `pointerdown`** 上，而手柄里那句
 * React 的 `e.stopPropagation()` 只挡得住合成事件 —— 少了 `nodrag`，「拖右下角缩放」会
 * 顺手发起一次节点拖动：节点边缩放边跟着指针跑，松手时还被当成一次落点判定。
 * G57 实测到的现象就是提示词节点被"拖进"了旁边的容器、尺寸只读到格位大小。
 *
 * 这个坑**只在 RF 面存在**（老表面的拖动也是 React 事件，`stopPropagation` 就够），
 * 所以最省事的守门人就是这条 SSR 断言。项目测试环境是 node，没有 testing-library，
 * 故与 `PromptNodeView.crash.test.ts` 同一做法：`renderToString` + 查 class。
 */
function renderFrame({ parentId = null }: { parentId?: string | null } = {}): string {
  const node = {
    id: 'node_test',
    projectId: 'proj_test',
    type: 'prompt',
    title: '提示词',
    x: 0,
    y: 0,
    w: 240,
    h: 160,
    parentId,
    data: {},
    disabled: false,
  } as unknown as NodeSnapshot
  const store = createCanvasStore({ platform: createMemoryPlatform(), projectId: 'proj_test', debounceMs: 0 })
  return renderToString(
    createElement(
      CanvasStoreProvider,
      { store } as never,
      createElement(NodeFrame, {
        node,
        selected: false,
        scale: 1,
        ports: { input: true, output: true },
        minSize: { w: 200, h: 160 },
        onFramePointerDown: () => {},
        onResize: () => {},
        onRename: () => {},
      }),
    ),
  )
}

describe('NodeFrame 缩放手柄', () => {
  it('带 RF 的免拖动类名 nodrag（少了它，缩放会顺手发起一次节点拖动）', () => {
    const html = renderFrame()
    const handleClass = html.match(/<span class="([^"]*)" data-node-resize-handle/)?.[1] ?? ''
    // 锚点本身也要在（先确认匹配到的是那个 span，别让正则落空变成"假通过"）
    expect(html).toContain('data-node-resize-handle')
    expect(handleClass).toContain('nodrag')
  })

  it('容器子节点不渲染缩放手柄（§6.11：组内节点不可缩放）', () => {
    expect(renderFrame({ parentId: 'node_parent' })).not.toContain('data-node-resize-handle')
  })
})
