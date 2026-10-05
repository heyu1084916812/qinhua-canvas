import { describe, it, expect } from 'vitest'
import {
  createMemoryStorage,
  createMemoryNetwork,
  createMemoryCredentials,
  createMemoryLogger,
  createMemoryHosting,
} from '../../platform/memory'
import type { PlatformKit, FilePort, PickedFile, TableName, Row } from '../../platform/ports'
import { createStorageAssetPort } from '../../platform/assets'
import { createProjectRepository } from './repository'
import { exportProject, importProjectFile } from './flowIo'
import { serializeProject, type FlowFileV1, type FlowGraph } from '../../domain/project/flowFile'
import type { Project } from '../../domain/project/project'

type AnyBlob = Blob

function makePlatform(seedRows: Partial<Record<TableName, Row[]>> = {}) {
  const storage = createMemoryStorage({ rows: seedRows })
  let saved: AnyBlob | null = null
  let picked: PickedFile | null = null
  const files: FilePort = {
    async pickFile() {
      return picked
    },
    async saveFile(_name, blob) {
      saved = blob as AnyBlob
    },
    async saveFromUrl() {
      /* 本组不测远端下载：按「已落盘」上报，免得测试替身缺方法编译不过 */
      return 'saved'
    },
  }
  const platform: PlatformKit = {
    storage,
    network: createMemoryNetwork(),
    assets: createStorageAssetPort(storage),
    hosting: createMemoryHosting(),
    credentials: createMemoryCredentials(),
    files,
    logger: createMemoryLogger(),
  }
  return {
    platform,
    storage,
    getSaved: () => saved,
    setPicked: (p: PickedFile | null) => {
      picked = p
    },
  }
}

const baseProject: Project = {
  id: 'proj1',
  workbench: 'canvas',
  name: '源项目',
  createdAt: 100,
  updatedAt: 200,
  thumbnail: null,
  extra: {},
}

const baseGraph: FlowGraph = {
  nodes: [
    { id: 'n1', projectId: 'proj1', type: 'prompt', parentId: null, x: 0, y: 0, w: 1, h: 1, title: 'P', disabled: false, data: { text: 't', upstreamPromptLinked: false } },
    { id: 'n2', projectId: 'proj1', type: 'generation', parentId: null, x: 1, y: 0, w: 1, h: 1, title: 'G', disabled: false, data: { model: 'gpt-image', mode: 'image', linkedPromptNodeIds: ['n1'], thumbOrder: [], upstreamHidden: [] } },
  ] as never,
  edges: [{ id: 'e1', projectId: 'proj1', source: 'n1', target: 'n2' }] as never,
  resultGroups: [] as never,
}

describe('flowIo 导出 / 导入', () => {
  it('导出后再导入还原等价项目（id 重映射、规模一致）', async () => {
    const seed: Partial<Record<TableName, Row[]>> = {
      projects: [baseProject as unknown as Row],
      nodes: baseGraph.nodes as unknown as Row[],
      edges: baseGraph.edges as unknown as Row[],
    }
    const { platform, storage, getSaved, setPicked } = makePlatform(seed)
    const repo = createProjectRepository(storage)

    await exportProject(platform, 'proj1')
    const saved = getSaved()
    expect(saved).not.toBeNull()

    setPicked({ name: 'out.flow.json', size: 0, mime: 'application/json', blob: saved as Blob })
    const res = await importProjectFile(platform, repo)

    expect(res.cancelled).toBeFalsy()
    expect(res.project?.id).not.toBe('proj1')
    expect(res.project?.nodeCount).toBe(2)

    const importedNodes = await storage.query('nodes', { projectId: res.project!.id })
    expect(importedNodes).toHaveLength(2)
    const importedEdges = await storage.query('edges', { projectId: res.project!.id })
    expect(importedEdges).toHaveLength(1)
    // 旧 id 不应残留
    expect(importedNodes.map((n) => n.id)).not.toContain('n1')
    // 连线两端指向新节点 id
    const ids = importedNodes.map((n) => n.id)
    expect(ids).toContain(importedEdges[0].source)
    expect(ids).toContain(importedEdges[0].target)
  })

  it('重名自动加后缀', async () => {
    const flow: FlowFileV1 = serializeProject(
      { ...baseProject, id: 'pX', name: '目标名' },
      { nodes: [], edges: [], },
      { exportedAt: 1 },
    )
    const seed: Partial<Record<TableName, Row[]>> = {
      projects: [{ ...baseProject, id: 'existing', name: '目标名' } as unknown as Row],
    }
    const { platform, storage, setPicked } = makePlatform(seed)
    const repo = createProjectRepository(storage)
    setPicked({ name: 'x.flow.json', size: 0, mime: 'application/json', blob: new Blob([JSON.stringify(flow)]) })

    const res = await importProjectFile(platform, repo)
    expect(res.project?.name).toBe('目标名 (1)')
  })

  it('用户取消文件选择时返回 cancelled', async () => {
    const { platform, storage, setPicked } = makePlatform()
    const repo = createProjectRepository(storage)
    setPicked(null)
    const res = await importProjectFile(platform, repo)
    expect(res.cancelled).toBe(true)
    expect(res.project).toBeUndefined()
  })

  it('引用模型缺失时收集缺失模型', async () => {
    const flow: FlowFileV1 = serializeProject(
      { ...baseProject, id: 'pX', name: 'M' },
      {
        nodes: [
          { id: 'n9', projectId: 'pX', type: 'generation', parentId: null, x: 0, y: 0, w: 1, h: 1, title: 'G', disabled: false, data: { model: 'unknown-model', mode: 'image', linkedPromptNodeIds: [], thumbOrder: [], upstreamHidden: [] } },
        ] as never,
        edges: [] as never,
        resultGroups: [] as never,
      },
      { exportedAt: 1 },
    )
    const { platform, storage, setPicked } = makePlatform()
    const repo = createProjectRepository(storage)
    setPicked({ name: 'm.flow.json', size: 0, mime: 'application/json', blob: new Blob([JSON.stringify(flow)]) })

    const res = await importProjectFile(platform, repo, { knownModels: new Set(['other']) })
    expect(res.missingModels).toContain('unknown-model')
  })

  it('非法格式抛错', async () => {
    const { platform, storage, setPicked } = makePlatform()
    const repo = createProjectRepository(storage)
    setPicked({ name: 'bad.json', size: 0, mime: 'application/json', blob: new Blob(['{"foo":1}']) })
    await expect(importProjectFile(platform, repo)).rejects.toThrow(/格式/)
  })

  /**
   * 「含素材导出」的端到端（对账 #221）：**导出 → 过一遍真实 JSON → 导入**之后，
   * ① 字节还在、② 素材仍按**内容哈希**落地、③ 节点还引用着同一个哈希（界面能直接显示）。
   * 这三条缺任何一条，用户看到的就是"项目搬过去了、图全丢"。
   */
  it('★★ 含素材导出 → 导入：字节与哈希引用都还在', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])
    const seed: Partial<Record<TableName, Row[]>> = {
      projects: [baseProject as unknown as Row],
      nodes: [
        {
          id: 'n1',
          projectId: 'proj1',
          type: 'generation',
          parentId: null,
          x: 0,
          y: 0,
          w: 1,
          h: 1,
          title: 'G',
          disabled: false,
          data: { model: 'gpt-image', mode: 'image', assetHash: 'hash_png' },
        } as unknown as Row,
      ],
      edges: [],
      assets: [
        { id: 'hash_png', projectId: 'proj1', mime: 'image/png', bytes: pngBytes } as unknown as Row,
      ],
    }
    const { platform, storage, getSaved, setPicked } = makePlatform(seed)
    const repo = createProjectRepository(storage)

    await exportProject(platform, 'proj1', { embedAssets: true })
    const saved = getSaved()
    expect(saved).not.toBeNull()
    // 内嵌素材真的写进了文件（不然下面的导入只是"没有素材的往返"）
    expect(await (saved as Blob).text()).toContain('bytesBase64')

    setPicked({ name: 'with-assets.flow.json', size: 0, mime: 'application/json', blob: saved as Blob })
    const res = await importProjectFile(platform, repo)
    expect(res.cancelled).toBeFalsy()

    const assets = (await storage.query('assets', { id: 'hash_png' })) as unknown as { bytes: Uint8Array }[]
    expect(assets).toHaveLength(1)
    expect(Array.from(new Uint8Array(assets[0]!.bytes))).toEqual(Array.from(pngBytes))

    const nodes = await storage.query('nodes', { projectId: res.project!.id })
    expect(JSON.stringify(nodes[0]!.data)).toContain('hash_png')
  })

  it('默认导出（不带 embedAssets）不含素材行：结构搬运不该悄悄把图塞进去', async () => {
    const seed: Partial<Record<TableName, Row[]>> = {
      projects: [baseProject as unknown as Row],
      nodes: baseGraph.nodes as unknown as Row[],
      edges: baseGraph.edges as unknown as Row[],
      assets: [{ id: 'hash_png', projectId: 'proj1', mime: 'image/png', bytes: new Uint8Array([1]) } as unknown as Row],
    }
    const { platform, getSaved } = makePlatform(seed)
    await exportProject(platform, 'proj1')
    expect(await (getSaved() as Blob).text()).not.toContain('hash_png')
  })
})
