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
})
