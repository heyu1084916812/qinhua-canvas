import { describe, it, expect } from 'vitest'
import {
  serializeProject,
  deserializeProject,
  type FlowFileV1,
  type FlowGraph,
} from './flowFile'
import type { Project } from './project'

const project: Project = {
  id: 'proj_old',
  workbench: 'canvas',
  name: '测试项目',
  createdAt: 1000,
  updatedAt: 2000,
  thumbnail: null,
  extra: { from: 'unit' },
}

const graph: FlowGraph = {
  nodes: [
    { id: 'node_a', projectId: 'proj_old', type: 'prompt', parentId: null, x: 0, y: 0, w: 1, h: 1, title: 'P', disabled: false, data: { text: 'hi', upstreamPromptLinked: false } },
    { id: 'node_b', projectId: 'proj_old', type: 'generation', parentId: 'node_a', x: 1, y: 0, w: 1, h: 1, title: 'G', disabled: false, data: { model: 'gpt-image', mode: 'image', linkedPromptNodeIds: ['node_a'], thumbOrder: [], upstreamHidden: [] } },
    { id: 'node_c', projectId: 'proj_old', type: 'generation', parentId: null, x: 2, y: 0, w: 1, h: 1, title: 'G2', disabled: false, data: { model: 'sd-xl', mode: 'image', linkedPromptNodeIds: [], thumbOrder: [], upstreamHidden: [] } },
  ] as never,
  edges: [
    { id: 'edge_1', projectId: 'proj_old', source: 'node_a', target: 'node_b' },
  ] as never,
  resultGroups: [
    { id: 'rg_1', projectId: 'proj_old', data: {} },
  ] as never,
}

const flow: FlowFileV1 = serializeProject(project, graph, { exportedAt: 9999 })

describe('flowFile 序列化 / 反序列化', () => {
  it('往返保留项目字段与图规模', () => {
    const out = deserializeProject(flow, 'proj_new')
    expect(out.project.id).toBe('proj_new')
    expect(out.project.name).toBe('测试项目')
    expect(out.project.extra).toEqual({ from: 'unit' })
    expect(out.nodes).toHaveLength(3)
    expect(out.edges).toHaveLength(1)
    expect(out.resultGroups).toHaveLength(1)
    for (const n of out.nodes) expect(n.projectId).toBe('proj_new')
  })

  it('id 全量重映射：edges / parentId / data 内引用', () => {
    const out = deserializeProject(flow, 'proj_new')
    const a = out.nodes.find((n) => (n.data as { text?: string }).text === 'hi')!
    const b = out.nodes.find((n) => (n.data as { model?: string }).model === 'gpt-image')!
    // 旧 id 不再出现
    expect(out.nodes.map((n) => n.id)).not.toContain('node_a')
    expect(out.edges[0].source).toBe(a.id)
    expect(out.edges[0].target).toBe(b.id)
    // parentId 重映射
    expect(b.parentId).toBe(a.id)
    // data 内 linkedPromptNodeIds 重映射
    expect((b.data as { linkedPromptNodeIds: string[] }).linkedPromptNodeIds).toEqual([a.id])
  })

  it('模型缺失检测：knownModels 不含时收集并标记 stale', () => {
    const out = deserializeProject(flow, 'proj_new', new Set(['sd-xl']))
    expect(out.missingModels).toEqual(['gpt-image'])
    const b = out.nodes.find((n) => (n.data as { model?: string }).model === 'gpt-image')!
    expect(b.stale).toBe(true)
    const c = out.nodes.find((n) => (n.data as { model?: string }).model === 'sd-xl')!
    expect(c.stale).toBeFalsy()
  })

  it('无 knownModels 时不标缺失', () => {
    const out = deserializeProject(flow, 'proj_new')
    expect(out.missingModels).toEqual([])
    expect(out.nodes.every((n) => !n.stale)).toBe(true)
  })

  it('序列化产物带格式版本与时间戳', () => {
    expect(flow.format).toBe('qinghua.flow')
    expect(flow.version).toBe(1)
    expect(flow.exportedAt).toBe(9999)
  })
})
