import { describe, expect, it } from 'vitest'
import type { AgentPlan } from '../../../domain/agent/plan'
import type { NodeSnapshot } from '../../../domain/canvas/model/node'
import { registerAllSpecs } from '../../../domain/canvas/nodeSpecs'
import { buildLandingCommand } from './buildLandingCommand'

/**
 * 计划 → 落地命令（设计文档 §3 / §6）。
 *
 * 重点在两件容易做错的事：**复用节点不重复建**、**连线能接到已有节点上**
 * （后者正是不能拿 `node.paste` 顶替的原因）。
 */

registerAllSpecs()

const graph = (nodes: NodeSnapshot[] = []) => ({
  projectId: 'p1',
  nodes,
  edges: [] as { source: string; target: string }[],
})

const existing = (id: string, type: NodeSnapshot['type'], x = 0, y = 0): NodeSnapshot => ({
  id,
  projectId: 'p1',
  type,
  parentId: null,
  x,
  y,
  w: 200,
  h: 120,
  title: id,
  disabled: false,
  data: {},
})

let seq = 0
const newId = () => `new-${++seq}`

describe('buildLandingCommand', () => {
  it('★ 两个新节点 + 一条连线 → 一条命令，idOf 两项', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: '提示词 → 生成',
      nodes: [
        { localId: 'p1', type: 'prompt', data: { text: '橘猫' }, order: 0 },
        { localId: 'g1', type: 'generation', data: {}, order: 1 },
      ],
      edges: [{ source: 'p1', target: 'g1' }],
    }
    const r = buildLandingCommand({ plan, graph: graph(), origin: { x: 0, y: 0 }, newId })

    expect(r.command.kind).toBe('agent.applyPlan')
    expect(r.command.nodes).toHaveLength(2)
    expect(r.command.edges).toEqual([{ source: r.idOf.p1, target: r.idOf.g1 }])
    expect(r.command.nodes[0]!.data).toMatchObject({ text: '橘猫' })
    expect(r.command.nodes[0]!.title).toBeTruthy()
  })

  it('★★ 复用已有节点时不重复建，且连线接到那个已有节点上', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: '把已有素材接到新的生成节点',
      nodes: [
        { localId: 'src', type: 'generation', data: {}, order: 0 },
        { localId: 'g1', type: 'generation', data: {}, order: 1 },
      ],
      edges: [{ source: 'src', target: 'g1' }],
      attach: [{ localId: 'src', existingNodeId: 'old-1' }],
    }
    const r = buildLandingCommand({
      plan,
      graph: graph([existing('old-1', 'generation')]),
      origin: { x: 0, y: 0 },
      newId,
    })

    expect(r.command.nodes).toHaveLength(1)
    expect(r.command.nodes[0]!.id).toBe(r.idOf.g1)
    // 连线从**已有节点**发出 —— 这条边的 source 不在本批 nodes 里
    expect(r.command.edges[0]!.source).toBe('old-1')
    expect(r.idOf.src).toBe('old-1')
  })

  it('★ 计划没给的字段用 spec 默认值补齐（不建半残节点）', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: 'x',
      nodes: [{ localId: 'g1', type: 'generation', data: { ratio: '16:9' }, order: 0 }],
      edges: [],
    }
    const r = buildLandingCommand({ plan, graph: graph(), origin: { x: 0, y: 0 }, newId })
    const data = r.command.nodes[0]!.data as Record<string, unknown>
    expect(data.ratio).toBe('16:9')
    expect(data.mode).toBeTruthy()
  })

  it('★ 落点避开已有节点（不叠上去）', () => {
    seq = 0
    const plan: AgentPlan = {
      summary: 'x',
      nodes: [{ localId: 'g1', type: 'generation', data: {}, order: 0 }],
      edges: [],
    }
    const r = buildLandingCommand({
      plan,
      graph: graph([existing('old-1', 'prompt', 0, 0)]),
      origin: { x: 0, y: 0 },
      newId,
    })
    expect(r.command.nodes[0]!.y).toBeGreaterThan(0)
  })
})
