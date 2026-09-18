import { describe, it, expect } from 'vitest'
import type { GraphSnapshot } from './model/graph'
import type { GroupData, NodeData, NodeSnapshot } from './model/node'
import type { ClipboardPayload } from './clipboard'
import { clipboardFromSelection, pasteNodes, pasteEdges } from './clipboard'

/**
 * 剪贴板的三条不变量是这里的重点：
 * 1. **快照自足**——拍下来之后与原图再无关系（原件删了照样能粘）；
 * 2. **几何归一**——顶层按包围盒原点归零，后代保持 local（否则整组粘贴会散架）；
 * 3. **引用重映射**——`childIds` 这类 id 列表必须指向新 id，否则两个容器共有一批孩子。
 */

function node(over: Partial<NodeSnapshot> & { id: string }): NodeSnapshot {
  const data: NodeData = { text: '', upstreamPromptLinked: false }
  return {
    projectId: 'p1',
    type: 'prompt',
    parentId: null,
    x: 0,
    y: 0,
    w: 100,
    h: 60,
    title: over.id,
    disabled: false,
      data,
    ...over,
  }
}

function graph(nodes: NodeSnapshot[], edges: GraphSnapshot['edges'] = []): GraphSnapshot {
  return { projectId: 'p1', nodes, edges, }
}

describe('clipboardFromSelection', () => {
  it('没选中任何节点 → null（空剪贴板不该被当成「复制了一份空的」）', () => {
    const g = graph([node({ id: 'a' })])
    expect(clipboardFromSelection(g, [])).toBeNull()
    expect(clipboardFromSelection(g, ['不存在'])).toBeNull()
  })

  it('顶层按包围盒原点归一化，parentId 置空', () => {
    const g = graph([
      node({ id: 'a', x: 300, y: 200 }),
      node({ id: 'b', x: 500, y: 320 }),
    ])
    const p = clipboardFromSelection(g, ['a', 'b'])!
    // 包围盒原点 (300,200)，尺寸 300 × 180
    expect(p.size).toEqual({ w: 300, h: 180 })
    expect(p.nodes.map((n) => [n.id, n.x, n.y, n.parentId])).toEqual([
      ['a', 0, 0, null],
      ['b', 200, 120, null],
    ])
  })

  it('带上后代，且后代保持 parentId 与 local 坐标', () => {
    const g = graph([
      node({ id: 'g', type: 'group', x: 100, y: 100, w: 200, h: 200 }),
      node({ id: 'c', x: 10, y: 20, parentId: 'g' }),
    ])
    const p = clipboardFromSelection(g, ['g'])!
    expect(p.nodes).toHaveLength(2)
    const child = p.nodes.find((n) => n.id === 'c')!
    expect(child.parentId).toBe('g')
    // 后代不参与包围盒，也不被归零——它跟着父节点走
    expect([child.x, child.y]).toEqual([10, 20])
    expect(p.size).toEqual({ w: 200, h: 200 })
  })

  it('只带两端都在集合内的连线；外部连线不带', () => {
    const g = graph(
      [node({ id: 'a' }), node({ id: 'b', x: 200 }), node({ id: 'out', x: 400 })],
      [
        { id: 'e1', projectId: 'p1', source: 'a', target: 'b' },
        { id: 'e2', projectId: 'p1', source: 'a', target: 'out' },
      ],
    )
    const p = clipboardFromSelection(g, ['a', 'b'])!
    expect(p.edges).toEqual([{ source: 'a', target: 'b' }])
  })

  it('data 是深拷贝：随后编辑原件不会改到剪贴板', () => {
    const g = graph([node({ id: 'a' })])
    const p = clipboardFromSelection(g, ['a'])!
    ;(g.nodes[0]!.data as { text: string }).text = '改过了'
    expect((p.nodes[0]!.data as { text: string }).text).toBe('')
  })
})

describe('pasteNodes', () => {
  const groupData: GroupData = {
    mode: 'image',
    prompt: '',
    linkedPromptNodeIds: [],
    channelId: '',
    model: '',
    thumbOrder: [],
    upstreamHidden: [],
    childIds: ['c', 'x'],
    hiddenIds: [],
    hiddenPromptIds: [],
  }
  const payload = clipboardFromSelection(
    graph([
      node({ id: 'g', type: 'group', x: 0, y: 0, w: 200, h: 100, data: groupData }),
      node({ id: 'c', x: 5, y: 5, parentId: 'g' }),
    ]),
    ['g'],
  )!
  const newIds = ['g2', 'c2']

  it('包围盒中心落在 at 上（顶层偏移、后代不动）', () => {
    const out = pasteNodes(payload, { x: 1000, y: 500 }, newIds)
    const g2 = out.find((n) => n.id === 'g2')!
    expect([g2.x, g2.y]).toEqual([900, 450]) // 中心 (1000,500) − 半尺寸 (100,50)
    const c2 = out.find((n) => n.id === 'c2')!
    expect([c2.x, c2.y]).toEqual([5, 5])
    expect(c2.parentId).toBe('g2')
  })

  it('id 列表字段重映射到新 id，集合外的引用丢弃', () => {
    const out = pasteNodes(payload, { x: 0, y: 0 }, newIds)
    // 'c' → 'c2'；'x' 不在本次复制集合内 → 丢弃（与外部连线不复制同口径）
    expect((out[0]!.data as { childIds: string[] }).childIds).toEqual(['c2'])
  })

  it('newIds 与节点数不一致直接抛错（早失败好过静默错位）', () => {
    expect(() => pasteNodes(payload, { x: 0, y: 0 }, ['g2'])).toThrow(/不一致/)
  })
})

describe('pasteEdges', () => {
  it('端点换成新 id', () => {
    const g = graph(
      [node({ id: 'a' }), node({ id: 'b', x: 200 })],
      [{ id: 'e1', projectId: 'p1', source: 'a', target: 'b' }],
    )
    const p = clipboardFromSelection(g, ['a', 'b'])!
    expect(pasteEdges(p, ['a2', 'b2'])).toEqual([{ source: 'a2', target: 'b2' }])
  })

  it('两端都能换上才保留', () => {
    const p: ClipboardPayload = {
      nodes: [node({ id: 'a' })],
      edges: [{ source: 'a', target: 'ghost' }],
      size: { w: 1, h: 1 },
    }
    expect(pasteEdges(p, ['a2'])).toEqual([])
  })
})
