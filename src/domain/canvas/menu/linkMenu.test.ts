import { describe, it, expect, beforeEach } from 'vitest'
import { linkMenuSections, type LinkSide } from './linkMenu'
import { registerAllSpecs, resetSpecs } from '../nodeSpecs'
import { canConnect } from '../graph/canConnect'
import type { GraphSnapshot } from '../model/graph'
import type { NodeSnapshot, NodeType } from '../model/node'

beforeEach(() => {
  resetSpecs()
  registerAllSpecs()
})

function node(id: string, type: NodeType, extra: Partial<NodeSnapshot> = {}): NodeSnapshot {
  return {
    id,
    projectId: 'p1',
    type,
    parentId: null,
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    title: id,
    disabled: false,
    data: {} as NodeSnapshot['data'],
    ...extra,
  }
}

function graphOf(nodes: NodeSnapshot[], edges: { source: string; target: string }[] = []): GraphSnapshot {
  return {
    projectId: 'p1',
    nodes,
    edges: edges.map((e, i) => ({ id: `e${i}`, projectId: 'p1', ...e })),
    resultGroups: [],
  }
}

const idsOf = (side: LinkSide, nodeId: string, g: GraphSnapshot, section: 'create' | 'connect') =>
  (linkMenuSections({ nodeId, side, graph: g }).find((s) => s.id === section)?.items ?? []).map((i) =>
    i.id.replace(`${section}:`, ''),
  )

describe('linkMenuSections / 空白松手菜单（§6.14）', () => {
  it('被拖节点不在图里 → 没有菜单', () => {
    const g = graphOf([node('a', 'prompt')])
    expect(linkMenuSections({ nodeId: 'ghost', side: 'output', graph: g })).toEqual([])
  })

  it('输出侧：只列「建出来就连得上」的类型，没有端点的画板不在其中', () => {
    const g = graphOf([node('a', 'prompt')])
    expect(idsOf('output', 'a', g, 'create')).toEqual(['prompt', 'generation', 'group', 'batch'])
  })

  it('输出侧：对比节点不接受提示词上游，故不出现在新建列表（不是建好却连不上的死项）', () => {
    const g = graphOf([node('a', 'prompt')])
    expect(idsOf('output', 'a', g, 'create')).not.toContain('compare')
  })

  it('create 区没有死项：列出的每一项真连一次都必须合法', () => {
    const dragged = node('a', 'prompt')
    const g = graphOf([dragged, node('b', 'generation'), node('c', 'compare'), node('d', 'board')])
    for (const section of linkMenuSections({ nodeId: 'a', side: 'output', graph: g })) {
      for (const item of section.items) {
        if (item.action.kind !== 'create') continue
        // 判定口径须与实现一致：替身要放进 nodes，否则按 id 回溯父链的规则会把
        // 「查无此节点」当成「无祖先」，测出来的是另一套规则
        const probe = node('__probe__', item.action.type, { parentId: dragged.parentId })
        const withProbe: GraphSnapshot = { ...g, nodes: [...g.nodes, probe] }
        expect(canConnect(dragged, probe, withProbe).ok, `${item.label} 连不上却是菜单项`).toBe(true)
      }
    }
  })

  it('已有节点区：排除自己、已连过的、类型不匹配的', () => {
    // a → b 已存在；c 是对比（不接受提示词上游）
    const g = graphOf(
      [node('a', 'prompt'), node('b', 'generation'), node('c', 'compare')],
      [{ source: 'a', target: 'b' }],
    )
    const connect = idsOf('output', 'a', g, 'connect')
    expect(connect).not.toContain('a') // 自己
    expect(connect).not.toContain('b') // 已连过
    expect(connect).not.toContain('c') // 类型不匹配
  })

  it('已有节点区：只列真的连得上的（提示词 → 生成）', () => {
    const g = graphOf([node('a', 'prompt'), node('b', 'generation')])
    expect(idsOf('output', 'a', g, 'connect')).toEqual(['b'])
  })

  it('输入侧反向拖：找的是上游，方向相反', () => {
    // 从生成节点的输入端点往外拖 → 找能作它上游的类型（提示词 / 生成 / 批量）
    const g = graphOf([node('g', 'generation'), node('p', 'prompt')])
    expect(idsOf('input', 'g', g, 'create')).toEqual(['prompt', 'generation', 'batch'])
    expect(idsOf('input', 'g', g, 'connect')).toEqual(['p'])
  })

  it('某个分区为空时整段不出现（不渲染空标题）', () => {
    // a 的唯一对端已连过 → connect 为空，只剩 create
    const g = graphOf([node('a', 'prompt'), node('b', 'generation')], [{ source: 'a', target: 'b' }])
    expect(linkMenuSections({ nodeId: 'a', side: 'output', graph: g }).map((s) => s.id)).toEqual(['create'])
  })

  it('分区顺序固定：新建并连接在前，连接已有节点在后', () => {
    const g = graphOf([node('a', 'prompt'), node('b', 'generation')])
    expect(linkMenuSections({ nodeId: 'a', side: 'output', graph: g }).map((s) => s.id)).toEqual([
      'create',
      'connect',
    ])
  })

  it('画板内拖线：待建节点落在同一画板下，否则会被「画板内外不建立边」整批否掉', () => {
    const board = node('bd', 'board')
    const inner = node('a', 'prompt', { parentId: 'bd' })
    const g = graphOf([board, inner])
    // 关键：probe 的 parentId 取被拖节点的 parentId，两边同属一个画板
    expect(idsOf('output', 'a', g, 'create')).toContain('generation')
  })
})
