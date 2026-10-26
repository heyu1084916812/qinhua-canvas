import { describe, expect, it, vi } from 'vitest'
import { resolveCanvasRecordScope } from './canvasRecordScope'

describe('resolveCanvasRecordScope', () => {
  it('优先使用宿主注入的业务作用域，并把目标节点数据交给解析器', () => {
    const nodeData = { prompt: '镜头画面', mode: 'image' }
    const override = vi.fn(() => ({
      scopeVersion: 1 as const,
      workbench: 'storyboard' as const,
      subjectId: 'shot:1',
      scopeId: 'episode:1',
      operationId: 'storyboard:plan-1:shot:1',
    }))

    expect(
      resolveCanvasRecordScope({
        workbench: 'storyboard',
        targetId: 'result-node',
        planId: 'plan-1',
        nodeData,
        override,
      }),
    ).toEqual({
      scopeVersion: 1,
      workbench: 'storyboard',
      subjectId: 'shot:1',
      scopeId: 'episode:1',
      operationId: 'storyboard:plan-1:shot:1',
    })
    expect(override).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: 'result-node',
        nodeData,
        planId: 'plan-1',
        fallback: expect.objectContaining({
          workbench: 'storyboard',
          subjectId: 'result-node',
        }),
      }),
    )
  })

  it('没有业务作用域时回退到画布兼容记录，不伪造漫剧主体', () => {
    expect(
      resolveCanvasRecordScope({
        workbench: 'storyboard',
        targetId: 'legacy-node',
        planId: 'plan-2',
        nodeData: { prompt: '旧节点' },
        override: () => null,
      }),
    ).toEqual({
      scopeVersion: 1,
      workbench: 'storyboard',
      subjectId: 'legacy-node',
      scopeId: 'plan:plan-2',
      operationId: 'plan-2',
    })
  })
})
