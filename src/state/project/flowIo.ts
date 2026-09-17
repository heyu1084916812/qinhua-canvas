import type { PlatformKit } from '../../platform/ports'
import type { ProjectRepository } from './repository'
import type { Project, ProjectListItem } from '../../domain/project/project'
import { createId } from '../../shared/id'
import {
  serializeProject,
  deserializeProject,
  type FlowFileV1,
  type FlowGraph,
} from '../../domain/project/flowFile'

/**
 * 项目导入 / 导出（产品文档 §5.7）。
 * - 读取 / 落盘走 platform.storage，文件读写走 platform.files（FilePort），
 *   页面组件不直接碰 File API。
 * - 导出默认不含 API Key：凭据单独存于 credentials 表，本流程根本不触碰它；
 *   图节点内也不含密钥，故默认产物即密钥无关。
 * - 导入为新项目：id 全量重映射、重名自动加后缀、引用模型缺失时收集到 missingModels。
 */
export interface ExportOptions {
  /** 是否内嵌素材（assets 表）；默认 false（仅结构） */
  embedAssets?: boolean
}

export interface ExportResult {
  flow: FlowFileV1
  fileName: string
}

export async function exportProject(
  platform: PlatformKit,
  projectId: string,
  opts: ExportOptions = {},
): Promise<ExportResult> {
  await platform.storage.open()
  const [projRows, nodes, edges] = await Promise.all([
    platform.storage.query('projects', { id: projectId }),
    platform.storage.query('nodes', { projectId }),
    platform.storage.query('edges', { projectId }),
  ])
  const project = projRows[0]
  if (!project) throw new Error(`[flowIo] 导出失败：项目不存在 ${projectId}`)

  const assets = opts.embedAssets
    ? await platform.storage.query('assets', { projectId })
    : []

  const graph: FlowGraph = {
    nodes: nodes as never,
    edges: edges as never,
    assets: assets as never,
  }

  const flow = serializeProject(project as unknown as Project, graph, {
    exportedAt: Date.now(),
  })

  const blob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' })
  const safeName = (String(project.name) || 'project').replace(/[\\/:*?"<>|]/g, '_')
  const fileName = `${safeName}.flow.json`
  await platform.files.saveFile(fileName, blob)

  return { flow, fileName }
}

export interface ImportOptions {
  /** 已知可用模型集合；传入时对引用不存在模型的节点标记「模型缺失」 */
  knownModels?: Set<string>
}

export interface ImportResult {
  /** 用户取消文件选择时为 true，其余字段无意义 */
  cancelled?: boolean
  project?: ProjectListItem
  /** 引用了 knownModels 中不存在的模型 */
  missingModels: string[]
  flowName: string
}

export async function importProjectFile(
  platform: PlatformKit,
  repo: ProjectRepository,
  opts: ImportOptions = {},
): Promise<ImportResult> {
  const picked = await platform.files.pickFile('.json,application/json')
  if (!picked) return { cancelled: true, missingModels: [], flowName: '' }

  const text = await picked.blob.text()
  let flow: FlowFileV1
  try {
    flow = JSON.parse(text) as FlowFileV1
  } catch {
    throw new Error('[flowIo] 解析失败：文件不是合法的 JSON')
  }
  if (flow?.format !== 'qinghua.flow' || flow?.version !== 1) {
    throw new Error('[flowIo] 不支持的 .flow.json 格式（缺少 format/version）')
  }

  const newId = createId('proj')
  const { project, nodes, edges, assets, missingModels } = deserializeProject(
    flow,
    newId,
    opts.knownModels,
  )

  const existing = await repo.list()
  const baseName = project.name || '导入项目'
  let name = baseName
  let i = 1
  while (existing.some((p) => p.name === name)) {
    name = `${baseName} (${i})`
    i += 1
  }
  project.name = name

  await platform.storage.transaction(['projects', 'nodes', 'edges', 'assets'], async () => {
    await platform.storage.put('projects', project as never)
    for (const r of nodes) await platform.storage.put('nodes', r as never)
    for (const r of edges) await platform.storage.put('edges', r as never)
    for (const r of assets) await platform.storage.put('assets', r as never)
  })

  const item: ProjectListItem = { ...(project as unknown as Project), nodeCount: nodes.length }
  return { project: item, missingModels, flowName: picked.name }
}
