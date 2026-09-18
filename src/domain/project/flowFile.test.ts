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
    // 结果组已下线：老文件里带的这一项**不再还原**（没有 resultGroups 这个返回项）
    for (const n of out.nodes) expect(n.projectId).toBe('proj_new')
  })

  /**
   * 老 .flow.json 里带着 resultGroups，且可能有节点的 `parentId` 指向某个组。
   * 组没了之后这些 parentId 是**悬空引用**——照常保留会让节点挂在一个不存在的
   * 父级下：既不显示在根层（被当容器子节点剔除）、也找不到容器，等于凭空消失。
   * 故一律置 null，让它们回根层。
   */
  it('老文件里指向结果组的 parentId 被清到根层（不留下悬空引用）', () => {
    // serializeProject 现在不再输出 resultGroups，老文件要**手工补回这一项**才能模拟
    const legacy: FlowFileV1 = {
      ...flow,
      graph: {
        ...flow.graph,
        resultGroups: [{ id: 'rg_1', projectId: 'proj_old', data: {} }] as never,
        nodes: [
          { id: 'node_a', projectId: 'proj_old', parentId: null, data: { text: 'hi' } },
          { id: 'node_c', projectId: 'proj_old', parentId: 'rg_1', data: {} },
        ] as never,
      },
    }
    const out = deserializeProject(legacy, 'proj_new')
    expect(out.nodes).toHaveLength(2)
    // 两个都被清成 null（一个本来就是 null，另一个原本指向已不存在的组）
    expect(out.nodes.map((n) => n.parentId)).toEqual([null, null])
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

  /**
   * 陈旧标记下线后（用户 2026-09-17），模型缺失**只反映在 `missingModels`**，
   * 不再往节点上写 `stale`——那本来就是借橘点的壳表达一件不相干的事。
   */
  it('模型缺失检测：knownModels 不含时只收集模型名，不动节点', () => {
    const out = deserializeProject(flow, 'proj_new', new Set(['sd-xl']))
    expect(out.missingModels).toEqual(['gpt-image'])
    const b = out.nodes.find((n) => (n.data as { model?: string }).model === 'gpt-image')!
    // 节点本身不受影响：模型仍在，只是调用方拿它去提示「这个模型这儿没有」
    expect(b.data).toBeDefined()
    const c = out.nodes.find((n) => (n.data as { model?: string }).model === 'sd-xl')!
    expect(c.data).toBeDefined()
  })

  it('无 knownModels 时不标缺失', () => {
    const out = deserializeProject(flow, 'proj_new')
    expect(out.missingModels).toEqual([])
    expect(out.nodes).toHaveLength(3)
  })

  it('序列化产物带格式版本与时间戳', () => {
    expect(flow.format).toBe('qinghua.flow')
    expect(flow.version).toBe(1)
    expect(flow.exportedAt).toBe(9999)
  })
})
