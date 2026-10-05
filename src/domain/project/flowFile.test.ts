import { describe, it, expect } from 'vitest'
import {
  serializeProject,
  serializeProjectStream,
  deserializeProject,
  type FlowFileV1,
  type FlowGraph,
  type FlowRow,
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

/**
 * 内嵌素材（「含素材导出」/ 方案 §3 的第 ② 条，对账 #221）。
 *
 * 这一档此前**只是看起来能用**：`serializeProject` 原样把 `bytes`（`Uint8Array`）交给
 * `JSON.stringify` ⇒ 落成 `{"0":137,…}`（体积更大），而导入时又还原不回字节 ⇒ 图全丢。
 * 所以判据必须是"**过一遍真实 JSON 再回来，字节还一样**"。
 */
describe('内嵌素材', () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3])

  /** 每次现造（节点 data 会被改写，别污染上面那份共享的 `graph`） */
  const withAssets = (): FlowFileV1 =>
    serializeProject(
      project,
      {
        nodes: [
          { id: 'node_a', projectId: 'proj_old', type: 'prompt', parentId: null, x: 0, y: 0, w: 1, h: 1, title: 'P', disabled: false, data: { text: 'hi' } },
          { id: 'node_b', projectId: 'proj_old', type: 'generation', parentId: null, x: 1, y: 0, w: 1, h: 1, title: 'G', disabled: false, data: { model: 'gpt-image', assetHash: 'hash_local' } },
        ] as never,
        edges: [] as never,
        assets: [
          { id: 'hash_local', projectId: 'proj_old', mime: 'image/png', bytes },
          { id: 'hash_remote', projectId: 'proj_old', mime: 'video/mp4', url: 'https://example.com/a.mp4' },
        ] as never,
      },
      { exportedAt: 1 },
    )

  it('★ 有字节的行写成 `bytesBase64`，且不带原始 `bytes`（Uint8Array 过 JSON 会变数字键对象）', () => {
    const row = withAssets().graph.assets![0]!
    expect(typeof row.bytesBase64).toBe('string')
    expect(row.bytes).toBeUndefined()
    expect(JSON.stringify(row)).not.toContain('"bytes"')
  })

  it('★ 远端行（只有 url）不写 `bytesBase64`：没有字节可写，别编一个空的', () => {
    const row = withAssets().graph.assets![1]!
    expect(row.bytesBase64).toBeUndefined()
    expect(row.url).toBe('https://example.com/a.mp4')
  })

  it('★★ 过一遍真实 JSON（stringify → parse）后字节原样回来，且不留 base64', () => {
    const text = JSON.stringify(withAssets())
    const out = deserializeProject(JSON.parse(text) as FlowFileV1, 'proj_new')
    const local = out.assets.find((a) => a.id === 'hash_local')!
    expect(local.bytes).toBeInstanceOf(Uint8Array)
    expect(Array.from(local.bytes as Uint8Array)).toEqual(Array.from(bytes))
    expect(local.bytesBase64).toBeUndefined()
    expect(local.projectId).toBe('proj_new')
  })

  it('★★ 素材 id 保持原样（它就是内容哈希），节点里的 `assetHash` 也不能被改', () => {
    const out = deserializeProject(withAssets(), 'proj_new')
    expect(out.assets.map((a) => a.id)).toEqual(['hash_local', 'hash_remote'])
    // 节点仍按哈希引用同一张图（若 id 被换成新随机 id，这里会跟着变，图片就再也找不到）
    expect(JSON.stringify(out.nodes.map((n) => n.data))).toContain('hash_local')
  })
})

/**
 * 流式版（对账 #230）：内嵌素材不能"先攒成一个对象、再 `JSON.stringify` 整份"——
 * 实测那样峰值内存是载荷的 **4.11 倍**（40MB 载荷 ⇒ 165MB 堆），而这条路自己宣传的量级是"几百 MB"。
 * 但**形状必须还是同一份**：这里用"解析后 deep-equal"钉死两条实现不许分叉。
 */
describe('serializeProjectStream', () => {
  const rows: FlowRow[] = [
    { id: 'hash_local', projectId: 'proj_old', mime: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
    { id: 'hash_remote', projectId: 'proj_old', mime: 'video/mp4', url: 'https://example.com/a.mp4' },
  ]

  async function read(assets: FlowRow[]): Promise<{ text: string; parts: string[] }> {
    const parts: string[] = []
    const source = (async function* () {
      for (const row of assets) yield row
    })()
    for await (const part of serializeProjectStream(
      project,
      { nodes: graph.nodes, edges: graph.edges },
      { exportedAt: 9999 },
      source,
    )) {
      parts.push(part)
    }
    return { text: parts.join(''), parts }
  }

  it('★ 与 serializeProject 形状一致（解析后 deep-equal）', async () => {
    const expected = serializeProject(project, { ...graph, assets: rows }, { exportedAt: 9999 })
    const { text } = await read(rows)
    expect(JSON.parse(text)).toEqual(expected)
  })

  it('没有素材时也是合法 JSON：assets 是空数组', async () => {
    const { text } = await read([])
    expect(JSON.parse(text).graph.assets).toEqual([])
  })

  it('★ 逐段产出：头 + 每张素材一段 + 尾（不是攒到最后一次吐出来）', async () => {
    const { parts } = await read(rows)
    expect(parts).toHaveLength(rows.length + 2)
    expect(parts[0]!.startsWith('{"format":"qinghua.flow"')).toBe(true)
    expect(parts.at(-1)).toBe(']}}')
    // 素材段里带的是 base64（与 serializeProject 同一套编码）
    expect(parts[1]).toContain('bytesBase64')
  })
})
/**
 * ★★ 缩略图**不进导出文件，也不认外来文件里的那一份**（对账 #234）。
 *
 * 这条抓的是一个**真回归**：`thumb` 是 `Uint8Array`，过 `JSON.stringify` 会变成 `{"0":82,…}`
 * 这种普通对象；导回来时"真值判断为有缩略图"，但按对象读出来是**空的** ⇒
 * 节点显示一张 0 字节的破图（而真相只是"这份缓存对本机没意义"）。
 */
describe('缩略图不进项目文件（对账 #234）', () => {
  const rowWithThumb: FlowRow = {
    id: 'hash_thumb',
    projectId: 'proj_old',
    mime: 'image/png',
    bytes: new Uint8Array([1, 2, 3]),
    thumb: new Uint8Array([82, 73, 70, 70]),
  }

  it('导出：`thumb` 与 `bytes` 都不写出去（只留 bytesBase64）', () => {
    const flow = serializeProject(project, { ...graph, assets: [rowWithThumb] }, { exportedAt: 1 })
    const row = flow.graph.assets![0]!
    expect(row.thumb).toBeUndefined()
    expect(row.bytes).toBeUndefined()
    expect(typeof row.bytesBase64).toBe('string')
  })

  it('★ 导入：外来文件里那份被 JSON 化的 `thumb` 一律丢掉（本机重新生成即可）', () => {
    const flow = serializeProject(project, { ...graph, assets: [] }, { exportedAt: 1 })
    // 模拟"修好之前导出的文件"：那一行里的 thumb 是被 JSON 化过的普通对象
    flow.graph.assets = [
      { id: 'hash_x', projectId: 'p', mime: 'image/png', thumb: { 0: 82, 1: 73 } } as FlowRow,
    ]
    const out = deserializeProject(flow, 'proj_new')
    expect(out.assets[0]!.thumb).toBeUndefined()
  })
})
