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
import { exportProject, importProjectFile, importProjectFromFile } from './flowIo'
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
      ecommerceTasks: [
        {
          id: 'et1',
          projectId: 'proj1',
          batchId: 'b1',
          createdAt: 1,
          updatedAt: 1,
          status: 'done',
          request: { productNodeId: 'n2' },
          nodeIds: ['n2'],
        },
      ],
      ecommerceResults: [
        {
          id: 'er1',
          projectId: 'proj1',
          taskId: 'et1',
          nodeId: 'n2',
          canvasCopyNodeId: 'n1',
          position: 0,
          createdAt: 1,
          updatedAt: 1,
          status: 'done',
          assetHash: 'h1',
        },
      ],
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
    const importedTasks = await storage.query('ecommerceTasks', { projectId: res.project!.id })
    const importedResults = await storage.query('ecommerceResults', { projectId: res.project!.id })
    expect(importedTasks).toHaveLength(1)
    expect(importedResults).toHaveLength(1)
    expect(importedTasks[0].id).not.toBe('et1')
    expect(importedResults[0].taskId).toBe(importedTasks[0].id)
    const importedGen = importedNodes.find(
      (n) => (n.data as { model?: string } | undefined)?.model === 'gpt-image',
    )!
    expect(importedResults[0].nodeId).toBe(importedGen.id)
    const importedPrompt = importedNodes.find((n) => n.type === 'prompt')!
    expect(importedResults[0].canvasCopyNodeId).toBe(importedPrompt.id)
  })

  /**
   * ★★ 漫剧文档要跟着项目走（对账 #455）。
   *
   * 剧本 / 分集 / 分镜**不在节点图里** —— 不带它，"导出 → 拖到新机器"搬过去的就是
   * 一个**空剧本**（节点都在、剧本没了），而用户以为整个项目都过来了。
   */
  it('★★ 导出 / 导入带着漫剧文档：剧本还在，且 `projectId` 换成新项目', async () => {
    const doc = {
      projectId: 'proj1',
      title: '雨夜快递',
      logline: '一晚，一单，一个人',
      body: '第一场：雨。',
      updatedAt: 300,
      episodes: [{ id: 'ep1', name: '第一集 · 雨夜', shots: [{ id: 'sh1', scene: '雨夜的街道' }] }],
    }
    const seed: Partial<Record<TableName, Row[]>> = {
      projects: [baseProject as unknown as Row],
      nodes: baseGraph.nodes as unknown as Row[],
      edges: baseGraph.edges as unknown as Row[],
      storyboards: [{ id: 'proj1', projectId: 'proj1', updatedAt: 300, doc } as unknown as Row],
    }
    const { platform, storage, getSaved, setPicked } = makePlatform(seed)
    const repo = createProjectRepository(storage)

    await exportProject(platform, 'proj1')
    setPicked({ name: 'out.flow.json', size: 0, mime: 'application/json', blob: getSaved() as Blob })
    const res = await importProjectFile(platform, repo)

    const rows = await storage.query('storyboards', { projectId: res.project!.id })
    expect(rows).toHaveLength(1)
    const imported = rows[0].doc as typeof doc
    expect(imported.title).toBe('雨夜快递')
    expect(imported.episodes).toHaveLength(1)
    expect(imported.episodes[0].shots).toHaveLength(1)
    // 内外两处都换成新项目 id（不然读回时会挂到旧项目名下）
    expect(rows[0].id).toBe(res.project!.id)
    expect(imported.projectId).toBe(res.project!.id)
  })

  it('★ 老文件（没有 storyboard 字段）照样导入：不失败、也不凭空建一行空剧本', async () => {
    const seed: Partial<Record<TableName, Row[]>> = {
      projects: [baseProject as unknown as Row],
      nodes: baseGraph.nodes as unknown as Row[],
      edges: baseGraph.edges as unknown as Row[],
    }
    const { platform, storage, getSaved, setPicked } = makePlatform(seed)
    const repo = createProjectRepository(storage)

    await exportProject(platform, 'proj1')
    setPicked({ name: 'out.flow.json', size: 0, mime: 'application/json', blob: getSaved() as Blob })
    const res = await importProjectFile(platform, repo)

    expect(res.cancelled).toBeFalsy()
    expect(await storage.query('storyboards', { projectId: res.project!.id })).toHaveLength(0)
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

  /**
   * ★ 拖拽入口（对账 #234）：手里直接有 `File`，**不该再弹一次系统文件框** ——
   * 项目页把拖进来的文件交给这个函数，与"菜单选文件"共用同一份实现。
   */
  it('★ 直接给文件（拖入入口）走同一条导入实现', async () => {
    const flow: FlowFileV1 = serializeProject(
      { ...baseProject, id: 'pD', name: '拖入' },
      { nodes: baseGraph.nodes, edges: baseGraph.edges } as never,
      { exportedAt: 1 },
    )
    const { platform, storage } = makePlatform()
    const repo = createProjectRepository(storage)
    const file: PickedFile = {
      name: 'dropped.flow.json',
      size: 1,
      mime: 'application/json',
      blob: new Blob([JSON.stringify(flow)]),
    }

    const res = await importProjectFromFile(platform, repo, file)

    expect(res.cancelled).toBeFalsy()
    expect(res.project?.name).toBe('拖入')
    expect(res.flowName).toBe('dropped.flow.json')
    expect((await storage.query('nodes', { projectId: res.project!.id })).length).toBe(2)
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

  /**
   * 对账 #222：素材行按**节点引用到的 hash** 取，不按 `projectId`。
   *
   * 真实事故路径：用户复制了一个项目 → 两个项目的节点都指着同一个哈希，
   * 而 `assets.projectId` 只剩最后一个项目名。此时导出**原件**，
   * 按 projectId 取就是一行都取不到 ⇒ 文件看着正常、搬过去图全丢。
   */
  it('★ 复制项目后导出原件：图挂在别的项目名下也照样带走', async () => {
    const pngBytes = new Uint8Array([137, 80, 78, 71, 9, 9])
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
          data: { model: 'gpt-image', mode: 'image', assetHash: 'hash_shared' },
        } as unknown as Row,
      ],
      edges: [],
      assets: [
        { id: 'hash_shared', projectId: 'proj2', mime: 'image/png', bytes: pngBytes } as unknown as Row,
      ],
    }
    const { platform, getSaved } = makePlatform(seed)
    await exportProject(platform, 'proj1', { embedAssets: true })

    const flow = JSON.parse(await (getSaved() as Blob).text()) as FlowFileV1
    expect(flow.graph.assets?.map((a) => a.id)).toEqual(['hash_shared'])
    expect(String(flow.graph.assets?.[0]?.bytesBase64 ?? '')).not.toBe('')
  })

  it('导出只带画布上引用到的图：素材库里其它图不跟着走（含素材导出本来就要控体积）', async () => {
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
          data: { model: 'gpt-image', mode: 'image', assetHash: 'hash_used' },
        } as unknown as Row,
      ],
      edges: [],
      assets: [
        { id: 'hash_used', projectId: 'proj1', mime: 'image/png', bytes: new Uint8Array([1, 2]) } as unknown as Row,
        { id: 'hash_orphan', projectId: 'proj1', mime: 'image/png', bytes: new Uint8Array([3, 4]) } as unknown as Row,
      ],
    }
    const { platform, getSaved } = makePlatform(seed)
    await exportProject(platform, 'proj1', { embedAssets: true })

    const flow = JSON.parse(await (getSaved() as Blob).text()) as FlowFileV1
    expect(flow.graph.assets?.map((a) => a.id)).toEqual(['hash_used'])
  })
})
