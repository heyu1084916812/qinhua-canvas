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
    expect(ids(nodeMenuItems('generation'))).toEqual(['run', 'duplicate', 'rename', 'delete'])
    expect(ids(nodeMenuItems('compare'))).toEqual(['duplicate', 'rename', 'delete'])
  })

  /**
   * 「全屏编辑」2026-09-21 落地（用户要求）：只有**提示词节点**有正文可编辑，
   * 其它类型的「正文」概念不存在，故不该出现这个入口（死入口比没有更糟）。
   * 位置在**编辑类**（复制之后、重命名之前）。
   */
  it('★ 提示词节点有「全屏编辑」，且排在编辑类里', () => {
    const items = nodeMenuItems('prompt')
    expect(ids(items)).toEqual(['duplicate', 'fullscreenEdit', 'rename', 'delete'])
    expect(items.find((i) => i.id === 'fullscreenEdit')!.action).toEqual({ kind: 'fullscreenEdit' })
  })

  it('★ 非提示词节点没有「全屏编辑」（无正文可编辑）', () => {
    for (const t of ['generation', 'batch', 'compare', 'group', 'board'] as NodeType[]) {
      expect(ids(nodeMenuItems(t))).not.toContain('fullscreenEdit')
    }
  })

  it('★ 生成节点已有素材时，右键菜单提供「保存到素材库」', () => {
    const items = nodeMenuItems('generation', { hasAsset: true })
    expect(ids(items)).toEqual(['run', 'saveLibrary', 'duplicate', 'rename', 'delete'])
    expect(items.find((i) => i.id === 'saveLibrary')!.action).toEqual({ kind: 'saveLibrary' })
  })

  it('空生成节点或非生成节点不列「保存到素材库」', () => {
    expect(ids(nodeMenuItems('generation', { hasAsset: false }))).not.toContain('saveLibrary')
    expect(ids(nodeMenuItems('batch', { hasAsset: true }))).not.toContain('saveLibrary')
    expect(ids(nodeMenuItems('prompt', { hasAsset: true }))).not.toContain('saveLibrary')
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

/**
 * 三个执行入口已下线（用户 2026-09-17）：「整条流程重新运行」「仅刷新陈旧节点」
 * 「清除陈旧标记」。它们都是**覆盖式**重跑（产物写回原节点、旧结果被冲掉），
 * 与「每次生成新建一个右侧节点、旧的留着对比」的落位模型相反。
 *
 * 这几条断言的方向因此反转成「任何类型都不许再有」——留着它们，是为了
 * 防止哪天有人把入口加回来而它背后的语义已经不存在（死入口比没有更糟）。
 */
describe('nodeMenuItems / 已下线的执行入口', () => {
  const types: NodeType[] = ['prompt', 'generation', 'batch', 'board', 'compare', 'group']

  it('任何节点类型都不再列「整条流程重新运行 / 仅刷新陈旧 / 清除陈旧标记」', () => {
    for (const t of types) {
      const idsOf = ids(nodeMenuItems(t))
      expect(idsOf).not.toContain('rerunFrom')
      expect(idsOf).not.toContain('refreshStale')
      expect(idsOf).not.toContain('clearStale')
    }
  })

  it('保留的仍是「生成 / 运行画板」两条：画板走运行画板，可生成节点走生成', () => {
    expect(ids(nodeMenuItems('board'))).toContain('runBoard')
    expect(ids(nodeMenuItems('generation'))).toContain('run')
    expect(ids(nodeMenuItems('batch'))).toContain('run')
    // 提示词 / 对比 / 分组不是执行主体，不列运行项
    expect(ids(nodeMenuItems('prompt'))).not.toContain('run')
  })

  it('危险操作仍单独置底', () => {
    const items = nodeMenuItems('generation')
    expect(items[items.length - 1]!.id).toBe('delete')
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
