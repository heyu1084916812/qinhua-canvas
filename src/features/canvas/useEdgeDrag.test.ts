import { describe, it, expect, beforeEach } from 'vitest'
import { expandContainers, portAnchorWorld, nodeHasPort, nodeAtPoint, wireAll } from './useEdgeDrag'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import { createMemoryPlatform } from '../../platform/memory'
import { createCanvasStore, type CanvasStore } from '../../state/workbenches/canvas/store'
import { batchNodes, groupNodes } from './groupNodes'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import type { NodeSnapshot, NodeType } from '../../domain/canvas/model/node'
import { PORT_HIT_RADIUS } from '../../domain/canvas/geometry/portReveal'

/**
 * 拖线建连的纯逻辑（§6.14「建立连接」）：
 * 端点锚点坐标 + 端点可用性。交互本身走真机冒烟（G13）。
 */
describe('端点拖线（§6.14）', () => {
  const rect = { x: 100, y: 200, w: 240, h: 160 }

  /**
   * ★ 锚点**就在节点边缘上**（用户 2026-10-07 第 15 批澄清：「线的起始位置是节点的边缘，
   * 而不是端点」）。第 14 批那版曾把锚点外移 27px，这次否掉。
   */
  it('输出锚点在右边缘、输入锚点在左边缘（纵向仍是中线）', () => {
    expect(portAnchorWorld(rect, 'output')).toEqual({ x: 340, y: 280 })
    expect(portAnchorWorld(rect, 'input')).toEqual({ x: 100, y: 280 })
  })

  describe('端点可用性跟随规格注册表', () => {
    beforeEach(() => {
      resetSpecs()
      registerAllSpecs()
    })


    it('提示词 / 生成 / 对比 都有输入与输出端点', () => {
      for (const t of ['prompt', 'generation', 'compare'] as const) {
        expect(nodeHasPort(t, 'input')).toBe(true)
        expect(nodeHasPort(t, 'output')).toBe(true)
      }
    })

    /**
     * ★ 组**只有右端点**（用户 2026-10-06 第 13 批第 5 条：组不做生成）。
     * 右端点拖出来 = 组内成员各连一条到目标（见本文件末尾那组用例）；
     * 左端点撤掉是因为没有生成语义 ⇒ 也没有"喂给它"这件事。
     */
    it('★ 分组只有输出端点（没有输入）', () => {
      expect(nodeHasPort('group', 'input')).toBe(false)
      expect(nodeHasPort('group', 'output')).toBe(true)
    })

    it('未注册类型不报错，返回 false', () => {
      resetSpecs()
      expect(nodeHasPort('group', 'input')).toBe(false)
    })
  })

  describe('落点命中（nodeAtPoint）', () => {
    /** 端点命中要靠规格表里的端口声明 ⇒ 这一块也得先注册（与上面那块同一条理由） */
    beforeEach(() => {
      resetSpecs()
      registerAllSpecs()
    })

    const n = (id: string, x: number, y: number, type: NodeType = 'generation', parentId: string | null = null): NodeSnapshot =>
      ({
        id,
        projectId: 'p1',
        type,
        parentId,
        x,
        y,
        w: 200,
        h: 200,
        title: id,
        disabled: false,
        data: {},
      }) as unknown as NodeSnapshot

    const g = (nodes: NodeSnapshot[], resultGroupIds: string[] = []): GraphSnapshot =>
      ({
        projectId: 'p1',
        nodes,
        edges: [],
        resultGroups: resultGroupIds.map((id) => ({ id, childIds: [] })),
      }) as unknown as GraphSnapshot

    it('命中光标下的节点（后加的在上层）', () => {
      const graph = g([n('a', 0, 0), n('b', 100, 100)])
      expect(nodeAtPoint({ x: 150, y: 150 }, graph)).toBe('b')
      expect(nodeAtPoint({ x: 50, y: 50 }, graph)).toBe('a')
      expect(nodeAtPoint({ x: 900, y: 900 }, graph)).toBe(null)
    })

    /**
     * 回归：结果组子节点的 `parentId` 指向 resultGroups 表（不在 nodes 表里），
     * 拿不到父级偏移 → 它的 **local** 坐标被当成世界坐标，于是在画布原点
     * 占下一块隐形命中区，把落在那里的连线全抢走（连上一个屏幕上不存在的节点）。
     * 因此这类节点必须整体退出命中，而不是「命中了再交给 canConnect 拒绝」——
     * 后者会让用户「松手在提示词节点上却什么都没连上」。
     */
    it('结果组子节点不参与命中（不抢走落点）', () => {
      const graph = g([n('prompt', 0, 0, 'prompt'), n('result', 0, 0, 'generation', 'rg1')], ['rg1'])
      expect(nodeAtPoint({ x: 20, y: 20 }, graph)).toBe('prompt')
    })

    /**
     * ★★ 「把线拖到对方的端点上半」必须算"落在这个节点上"。
     *
     * 端点的圆心现在就在边缘上（第 15 批澄清），所以**端点命中区仍然有一半在节点外**：
     * 少了这一条兜底，从外侧对着端点松手会落进"空白"：既连不上、还会弹出空白松手菜单
     *（实测：G71 的「批量 → 生成节点」就是这么断的）。
     */
    it('★★ 落点在端点命中区里 = 落在那个节点上（哪怕它在节点矩形之外）', () => {
      const graph = g([n('a', 100, 200, 'generation')])
      const anchor = portAnchorWorld({ x: 100, y: 200, w: 200, h: 200 }, 'input')
      /** 锚点就在左边缘上：边界点先被矩形判中（闭区间），这里要测的是**框外那一半** */
      expect(anchor.x).toBe(100)
      expect(nodeAtPoint({ x: anchor.x - 14, y: anchor.y }, graph)).toBe('a')
      expect(nodeAtPoint({ x: anchor.x + 14, y: anchor.y }, graph)).toBe('a')
      /** 命中半径 = 半直径 + 8（与看得见的命中方块同一份），超出就不算 */
      expect(nodeAtPoint({ x: anchor.x - (PORT_HIT_RADIUS + 6), y: anchor.y }, graph)).toBe(null)
    })
  })
})

/**
 * 从**容器**端点拉线：换成组内成员各连一条（用户 2026-10-06 第 13 批第 5 条：
 * 「打组后的组右边有端点，拉端点后是把组内的下游都拉一条线出来，就和多选节点的拉线功能一样」）。
 *
 * 组不做生成、没有产物 ⇒ 容器自己**不出边**，该连到下游的是它的每个成员。
 */
describe('容器端点拉线：展开成成员（#317 ⑤）', () => {
  const store = (): CanvasStore =>
    createCanvasStore({ platform: createMemoryPlatform() as never, projectId: 'p1' })

  function add(s: CanvasStore, type: 'prompt' | 'generation', x: number): string {
    const id = `n_${type}_${x}`
    s.dispatch({ kind: 'node.create', projectId: 'p1', type, id, at: { x, y: 0 } })
    return id
  }

  beforeEach(() => {
    resetSpecs()
    registerAllSpecs()
  })

  it('★ 容器展开成成员；普通节点原样；重复 id 去重', () => {
    const s = store()
    const a = add(s, 'prompt', 0)
    const b = add(s, 'prompt', 300)
    const gid = groupNodes(s, [a, b])!
    const other = add(s, 'generation', 900)
    const graph = s.getSnapshot()

    expect(expandContainers(graph, [gid])).toEqual([a, b])
    expect(expandContainers(graph, [other, other])).toEqual([other])
    expect(expandContainers(graph, [other, gid, a])).toEqual([other, a, b])
  })

  /**
   * ★ 批量节点**不展开**（G71 抓到的真实回归）。
   *
   * 批量自己就是一个集合（§6.12「集合本体包成一个 collection 项、下游按项展开」）——
   * `批量 → 下游生成节点` 这条边是**批量语义本身**。若把批量也"展开成成员各连一条"，
   * 下游面板就不再是"生成下游节点"、承载节点也铺错位置（G71 两条断言当场红）。
   */
  it('★ 批量节点不展开（它自己就是集合）', () => {
    const s = store()
    const p1 = add(s, 'prompt', 0)
    const p2 = add(s, 'prompt', 300)
    const r = batchNodes(s, [p1, p2])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(expandContainers(s.getSnapshot(), [r.containerId])).toEqual([r.containerId])
  })

  it('★★ wireAll 从组端点拉线：连的是**成员**，容器自己一条都不出', () => {
    const s = store()
    const a = add(s, 'prompt', 0)
    const b = add(s, 'prompt', 300)
    const target = add(s, 'generation', 900)
    const gid = groupNodes(s, [a, b])!

    const wired = wireAll(s, gid, 'output', [], target, { x: 1000, y: 100 })
    expect(wired.map((w) => w.source)).toEqual([a, b])
    expect(wired.every((w) => w.target === target)).toBe(true)
    expect(wired.some((w) => w.source === gid)).toBe(false)
  })
})
