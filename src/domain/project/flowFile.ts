import type { Project } from './project'
import { createId } from '../../shared/id'

/**
 * .flow.json 文件格式（产品文档 §5.7 / §8 数据模型）。
 * 纯转换层：只依赖 domain + shared，不引入 platform / React，可在 node 下单测。
 * 图数据只含 nodes / edges（assets 可选内嵌）。
 *
 * `resultGroups` 是**已下线字段**（结果组 2026-09-17 删除）：导出不再写它，
 * 但类型里保留成可选——老 .flow.json 里带着这一项，读取时必须能开，
 * 只是其中的组不再还原（组没了这个概念），指向组的 parentId 一并清空。
 */
export interface FlowRow {
  id: string
  [key: string]: unknown
}

export interface FlowProject {
  id: string
  workbench: string
  name: string
  createdAt: number
  updatedAt: number
  thumbnail?: string | null
  extra?: Record<string, unknown>
}

export interface FlowGraph {
  nodes: FlowRow[]
  edges: FlowRow[]
  resultGroups?: FlowRow[]
  assets?: FlowRow[]
}

export interface FlowFileV1 {
  format: 'qinghua.flow'
  version: 1
  exportedAt: number
  project: FlowProject
  graph: FlowGraph
}

/** 仅这些节点类型持有 model 字段，导入时用于「模型缺失」检测 */
const MODEL_BEARING = new Set(['prompt', 'generation', 'group', 'batch'])

export function serializeProject(
  project: Project,
  graph: FlowGraph,
  meta: { exportedAt: number },
): FlowFileV1 {
  return {
    format: 'qinghua.flow',
    version: 1,
    exportedAt: meta.exportedAt,
    project: {
      id: project.id,
      workbench: project.workbench,
      name: project.name,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      thumbnail: project.thumbnail ?? null,
      extra: project.extra ?? {},
    },
    graph: {
      nodes: graph.nodes.map((r) => ({ ...r })),
      edges: graph.edges.map((r) => ({ ...r })),
      assets: graph.assets?.map((r) => ({ ...r })),
    },
  }
}

export interface DeserializeResult {
  project: FlowProject
  nodes: FlowRow[]
  edges: FlowRow[]
  assets: FlowRow[]
  /** 引用了 knownModels 中不存在的模型（产品文档 §5.7「模型缺失」） */
  missingModels: string[]
}

/**
 * 把 .flow.json 反序列化为可写入新项目的一组行。
 * - 为新项目分配新 id，所有节点 / 连线 / 素材的 id 全量重映射
 * - 引用旧 id 的位置（edges.source/target、node.parentId、data 内的 id 列表）一并改写
 * - 可选 knownModels：非空且某节点的 model 不在其中时**只收集模型名**返回给调用方提示。
 *   此前还会顺手把节点标 `stale`（借橘点表达「配不了」）；该字段随橘点一并下线
 *   （用户 2026-09-17），缺失信息由 `missingModels` 单独承载，不再寄生在节点上。
 *
 * @param newProjectId 导入后落地的新项目 id（由调用方用 createId 生成）
 * @param knownModels  已知可用模型集合；不传则不做缺失检测
 */
export function deserializeProject(
  flow: FlowFileV1,
  newProjectId: string,
  knownModels?: Set<string>,
): DeserializeResult {
  const idMap = new Map<string, string>()
  for (const n of flow.graph.nodes) idMap.set(String(n.id), createId('node'))
  for (const e of flow.graph.edges) idMap.set(String(e.id), createId('edge'))
  for (const a of flow.graph.assets ?? []) idMap.set(String(a.id), createId('asset'))
  /**
   * 老文件里那些**指向结果组的 parentId**必须认出来并清空。
   *
   * 组没了，但旧 .flow.json 里子结果的 `parentId` 还写着组 id。若照常 remap，
   * 它会被保留成一个**谁也不认识的 id** —— 节点于是挂在一个不存在的父级下：
   * 既不显示在根层、也找不到容器，等于凭空消失。故先把组 id 收进集合，
   * 遇到指向它的 parentId 一律置 null（回到根层，东西还在，只是不再归组）。
   */
  const deadParentIds = new Set((flow.graph.resultGroups ?? []).map((r) => String(r.id)))

  const remap = (s: string): string => idMap.get(s) ?? s

  const missingModels: string[] = []
  const seenModel = new Set<string>()

  const nodes = flow.graph.nodes.map((n) => {
    const data = deepRemapRefs(n.data as Record<string, unknown>, idMap)
    const model = (data as { model?: unknown }).model
    if (typeof model === 'string' && model && knownModels && !knownModels.has(model)) {
      if (!seenModel.has(model)) {
        seenModel.add(model)
        missingModels.push(model)
      }
    }
    return {
      ...n,
      id: remap(String(n.id)),
      projectId: newProjectId,
      parentId:
        n.parentId == null || deadParentIds.has(String(n.parentId))
          ? null
          : remap(String(n.parentId)),
      data,
    }
  })

  const edges = flow.graph.edges.map((e) => ({
    ...e,
    id: remap(String(e.id)),
    projectId: newProjectId,
    source: remap(String(e.source)),
    target: remap(String(e.target)),
  }))

  const assets = (flow.graph.assets ?? []).map((a) => ({
    ...a,
    id: remap(String(a.id)),
    projectId: newProjectId,
  }))

  const project: FlowProject = {
    ...flow.project,
    id: newProjectId,
    name: flow.project.name,
    thumbnail: flow.project.thumbnail ?? null,
    extra: flow.project.extra ?? {},
  }

  return { project, nodes, edges, assets, missingModels }
}

/** 递归改写所有等于旧 id 的字符串（用于 data 内的 linkedPromptNodeIds / childIds 等引用） */
function deepRemapRefs(value: unknown, idMap: Map<string, string>): unknown {
  if (typeof value === 'string') return idMap.get(value) ?? value
  if (Array.isArray(value)) return value.map((v) => deepRemapRefs(v, idMap))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = deepRemapRefs(v, idMap)
    return out
  }
  return value
}

/** 供调用方判断：节点是否持有 model 字段 */
export function bearsModel(nodeType: string): boolean {
  return MODEL_BEARING.has(nodeType)
}
