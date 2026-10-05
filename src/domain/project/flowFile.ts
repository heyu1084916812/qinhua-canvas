import type { Project } from './project'
import { createId } from '../../shared/id'
import { base64ToBytes, bytesToBase64 } from '../shared/base64'

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
      assets: graph.assets?.map(toFlowAssetRow),
    },
  }
}

/**
 * 内嵌素材的那一行：把 `bytes` 换成 `bytesBase64`。
 *
 * 为什么不原样带 `bytes`：`Uint8Array` 过 `JSON.stringify` 会变成 `{"0":137,"1":80,…}`
 * —— 体积比 base64 还大一倍（每个字节写成十进制加逗号），而导入时**还原不回字节**，
 * 于是"含素材导出"看起来能用、真搬过去图全丢。这是对账 #221 抓到的真因。
 */
function toFlowAssetRow(row: FlowRow): FlowRow {
  const { bytes, ...rest } = row
  const encoded = encodeBytes(bytes)
  return encoded === null ? { ...rest } : { ...rest, bytesBase64: encoded }
}

/** `Uint8Array` / `ArrayBuffer` 都认（表里的字节两种形态都出现过）；都不是就返回 null */
function encodeBytes(value: unknown): string | null {
  if (value instanceof Uint8Array) return bytesToBase64(value)
  if (value instanceof ArrayBuffer) return bytesToBase64(new Uint8Array(value))
  return null
}

/** `bytesBase64` → 字节；没有这一项就返回 null（结构导出 / 远端行本来就没有字节） */
function decodeBytes(value: unknown): Uint8Array | null {
  if (typeof value !== 'string' || value === '') return null
  return base64ToBytes(value)
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
  /**
   * ⚠️ **素材 id 不进 `idMap`**：它就是内容哈希，节点靠 `data.assetHash` 引用它。
   * 若把素材 id 换成新的，`deepRemapRefs` 会顺手把节点的 `assetHash` 也改成那个新 id
   * （看起来一致、其实是自洽的空引用：真正按哈希找字节的地方全都找不到）——
   * 详见下面 `assets` 那段注释与对账 #221。
   */
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

  /**
   * 素材行：**id 不重映射**（它本来就是内容哈希），`bytesBase64` 解回字节。
   *
   * 为什么 id 保持原样：这张表是**内容寻址**的（`id = 内容哈希`），而节点引用素材也按哈希
   * （`data.assetHash`）。给素材换新 id 会同时踩两件事：① 同一张图换个项目再导一次就多存一份字节；
   * ② "素材文件夹"按 `<hash>.<ext>` 找文件的那套对导入的素材失效（它找不到新 id 命名的文件）。
   * 所以这里的 `projectId` **只当"这笔字节落在哪张项目名下"的记账用**，
   * 不能当"这张图属于哪个项目"来查素材：同一个 hash 进过两个项目时它只剩最后那个。
   * 导出侧因此**按节点引用到的 hash 取素材**（`domain/canvas/graph/assetRefs.ts`，对账 #222）。
   */
  const assets = (flow.graph.assets ?? []).map((row) => {
    const { bytesBase64, ...rest } = row as FlowRow & { bytesBase64?: unknown }
    const bytes = decodeBytes(bytesBase64)
    return { ...rest, projectId: newProjectId, ...(bytes ? { bytes } : {}) }
  })

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
