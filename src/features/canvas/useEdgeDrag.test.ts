import { describe, it, expect, beforeEach } from 'vitest'
import { portAnchorWorld, nodeHasPort, nodeAtPoint } from './useEdgeDrag'
import { registerAllSpecs, resetSpecs } from '../../domain/canvas/nodeSpecs'
import type { GraphSnapshot } from '../../domain/canvas/model/graph'
import type { NodeSnapshot, NodeType } from '../../domain/canvas/model/node'

/**
 * 拖线建连的纯逻辑（§6.14「建立连接」）：
 * 端点锚点坐标 + 端点可用性。交互本身走真机冒烟（G13）。
 */
describe('端点拖线（§6.14）', () => {
  const rect = { x: 100, y: 200, w: 240, h: 160 }

  it('输出端点在右中，输入端点在左中', () => {
    expect(portAnchorWorld(rect, 'output')).toEqual({ x: 340, y: 280 })
    expect(portAnchorWorld(rect, 'input')).toEqual({ x: 100, y: 280 })
  })

  describe('端点可用性跟随规格注册表', () => {
    beforeEach(() => {
      resetSpecs()
      registerAllSpecs()
    })

    it('提示词 / 生成 / 对比 / 分组 都有输入与输出端点', () => {
      for (const t of ['prompt', 'generation', 'compare', 'group'] as const) {
        expect(nodeHasPort(t, 'input')).toBe(true)
        expect(nodeHasPort(t, 'output')).toBe(true)
      }
    })

    it('未注册类型不报错，返回 false', () => {
      resetSpecs()
      expect(nodeHasPort('group', 'input')).toBe(false)
    })
  })

  describe('落点命中（nodeAtPoint）', () => {
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
  })
})
