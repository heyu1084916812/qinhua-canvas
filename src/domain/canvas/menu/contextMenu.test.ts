import { describe, it, expect } from 'vitest'
import { nodeMenuItems, canvasMenuItems, CREATABLE_TYPES } from './contextMenu'
import type { NodeType } from '../model/node'

function ids(items: { id: string }[]): string[] {
  return items.map((i) => i.id)
}

describe('nodeMenuItems / 节点右键菜单（§4.1）', () => {
  it('生成节点：生成在最上，且下带分隔线', () => {
    const items = nodeMenuItems('generation')
    expect(items[0].id).toBe('run')
    expect(items[0].label).toBe('生成')
    expect(items[0].separatorAfter).toBe(true)
  })

  it('批量节点也有「生成」（§6.12 生成入口：面板按钮 / 右键生成）', () => {
    expect(ids(nodeMenuItems('batch'))).toContain('run')
  })

  it('提示词 / 对比 / 分组 / 画板节点没有「生成」', () => {
    for (const t of ['prompt', 'compare', 'group', 'board'] as NodeType[]) {
      expect(ids(nodeMenuItems(t))).not.toContain('run')
    }
  })

  it('编辑类与危险操作之间用分隔线分组（删除单独一组置底）', () => {
    const items = nodeMenuItems('prompt')
    const rename = items.find((i) => i.id === 'rename')!
    const del = items.find((i) => i.id === 'delete')!
    expect(rename.separatorAfter).toBe(true)
    expect(del.separatorAfter).toBeFalsy()
    expect(items[items.length - 1].id).toBe('delete')
  })

  it('通用项顺序：复制 → 重命名 → 删除', () => {
    expect(ids(nodeMenuItems('prompt'))).toEqual(['duplicate', 'rename', 'delete'])
  })

  /**
   * §6.21 版本历史已随功能下线（2026-09-16 拍板，2026-09-17 拆除入口）。
   * 这条断言的方向随之反转：不是「必须有」，而是**任何节点类型都不许再有**——
   * 留着它是防止哪天有人把菜单项加回来而功能并不存在（死入口比没有更糟）。
   */
  it('任何节点类型都没有「版本历史」（§6.21 已下线）', () => {
    for (const t of ['generation', 'batch', 'prompt', 'compare', 'group', 'board'] as NodeType[]) {
      expect(ids(nodeMenuItems(t))).not.toContain('history')
    }
  })

  it('菜单项 action 携带可执行意图，不依赖 UI', () => {
    const items = nodeMenuItems('batch')
    expect(items.find((i) => i.id === 'run')!.action).toEqual({ kind: 'run' })
    expect(items.find((i) => i.id === 'delete')!.action).toEqual({ kind: 'delete' })
  })
})

describe('nodeMenuItems / 执行模式入口（§6.19.1）', () => {
  it('下游有可执行节点时才列「整条流程重新运行 / 仅刷新陈旧节点」', () => {
    expect(ids(nodeMenuItems('prompt'))).not.toContain('rerunFrom')
    const items = nodeMenuItems('prompt', { hasRunnableDownstream: true })
    expect(ids(items)).toContain('rerunFrom')
    expect(ids(items)).toContain('refreshStale')
    expect(items.find((i) => i.id === 'rerunFrom')!.action).toEqual({ kind: 'rerunFrom' })
    // 运行类之后紧跟，仍属「运行」分组，其后才接编辑类
    expect(items.find((i) => i.id === 'refreshStale')!.separatorAfter).toBe(true)
    expect(items.findIndex((i) => i.id === 'refreshStale')).toBeLessThan(
      items.findIndex((i) => i.id === 'duplicate'),
    )
  })

  it('全图有陈旧标记时才列「清除陈旧标记」（清的是全图，与触发节点无关）', () => {
    expect(ids(nodeMenuItems('generation'))).not.toContain('clearStale')
    const items = nodeMenuItems('generation', { hasStale: true })
    expect(ids(items)).toContain('clearStale')
    expect(items.find((i) => i.id === 'clearStale')!.action).toEqual({ kind: 'clearStale' })
    // 危险操作仍单独置底
    expect(items[items.length - 1].id).toBe('delete')
  })

  it('单点生成不重复出现；Alt+R 是修饰键、全图重跑只在顶栏，都不进节点菜单', () => {
    const items = nodeMenuItems('generation', { hasRunnableDownstream: true, hasStale: true })
    expect(ids(items).filter((id) => id === 'run')).toHaveLength(1)
    expect(ids(items)).not.toContain('rerunAll')
    expect(ids(items)).not.toContain('singleAlt')
  })
})

describe('canvasMenuItems / 画布空白右键菜单（§4.1 / §6.5）', () => {
  it('含全部可新建类型，顺序与 CREATABLE_TYPES 一致', () => {
    const items = canvasMenuItems()
    const created = items.filter((i) => i.id.startsWith('create:'))
    expect(created.map((i) => i.id)).toEqual(CREATABLE_TYPES.map((t) => `create:${t.type}`))
  })

  it('最后一组是重置视图，且新建项与它之间有分隔线', () => {
    const items = canvasMenuItems()
    expect(items[items.length - 1].id).toBe('resetView')
    expect(items[items.length - 2].separatorAfter).toBe(true)
  })

  it('新建项 action 带具体节点类型', () => {
    const items = canvasMenuItems()
    const batch = items.find((i) => i.id === 'create:batch')!
    expect(batch.action).toEqual({ kind: 'create', type: 'batch' })
  })

  it('空剪贴板时不列「粘贴」（避免点了没反应的死项）', () => {
    expect(ids(canvasMenuItems())).not.toContain('paste')
    expect(ids(canvasMenuItems({ canPaste: false }))).not.toContain('paste')
  })

  it('有剪贴板内容时列「粘贴」，且排在新建组之后、重置视图之前', () => {
    const items = canvasMenuItems({ canPaste: true })
    expect(ids(items)).toContain('paste')
    const paste = items.find((i) => i.id === 'paste')!
    expect(paste.action).toEqual({ kind: 'paste' })
    expect(ids(items).indexOf('paste')).toBeGreaterThan(ids(items).indexOf('create:board'))
    expect(items[items.length - 1].id).toBe('resetView')
  })
})
