import type { PlatformKit, Row } from '../../platform/ports'
import type { ProjectRepository } from './repository'
import type { Project, ProjectListItem } from '../../domain/project/project'
import { createId } from '../../shared/id'
import type { NodeSnapshot } from '../../domain/canvas/model/node'
import { assetHashesOf } from '../../domain/canvas/graph/assetRefs'
import {
  serializeProject,
  serializeProjectStream,
  deserializeProject,
  type FlowFileV1,
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
  /**
   * 内嵌素材的进度（第几张 / 共几张）。
   * 为什么要：带素材的导出可能要几十秒，没有读数用户会以为卡死（与对账 #229 同一条口径）。
   */
  onProgress?: (done: number, total: number) => void
}

export interface ExportResult {
  fileName: string
}

/**
 * 按 hash **逐条**取素材行（`assets.id` 就是内容哈希，走主键索引）—— 一次只把**一张**交给调用方。
 *
 * 为什么是"逐条"而不是"成批再返回数组"：数组意味着这些行的字节**同时**在内存里
 * （一张 4K 图编码后几 MB，几百张就是几个 GB）。流式导出要的是"来一张、编一张、丢掉一张"。
 */
async function* assetRowsByHashes(
  platform: PlatformKit,
  hashes: string[],
  onProgress?: (done: number, total: number) => void,
): AsyncGenerator<Row> {
  let done = 0
  for (const id of hashes) {
    const rows = await platform.storage.query('assets', { id })
    const row = rows[0] as unknown as Row | undefined
    if (row) yield row
    done += 1
    onProgress?.(done, hashes.length)
  }
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

  const safeName = (String(project.name) || 'project').replace(/[\\/:*?"<>|]/g, '_')
  const fileName = `${safeName}.flow.json`
  const exportedAt = Date.now()

  if (opts.embedAssets) {
    /**
     * 内嵌素材这条路要同时满足两个约束：
     *
     * ① **按节点引用到的 hash 取**，不按 `projectId`（对账 #222）——
     *    `assets.projectId` 只记「最后导入它的项目」，复制项目后按它取会两边都漏，
     *    而「导出原件」正是复制之后最常见的动作。
     * ② **流式拼**（对账 #230）—— 原来是"先攒齐所有素材行、再 `JSON.stringify` 整份"，
     *    实测峰值内存是载荷的 **4.11 倍**（40MB 载荷 ⇒ 165MB 堆），
     *    而这个入口自己宣传的量级是"几百 MB"，那就是一次必崩的导出。
     *    现在逐条取 → 立刻编码 → 立刻交给 Blob，JS 侧同时只压着一张图的 base64。
     */
    const hashes = assetHashesOf(nodes as unknown as NodeSnapshot[])
    const parts: BlobPart[] = []
    for await (const part of serializeProjectStream(
      project as unknown as Project,
      { nodes: nodes as never, edges: edges as never },
      { exportedAt },
      assetRowsByHashes(platform, hashes, opts.onProgress),
    )) {
      // 立刻转成 Blob：字符串是 JS 堆里的，Blob 由浏览器管（可以落盘），下一段才不会叠加
      parts.push(new Blob([part]))
    }
    await platform.files.saveFile(fileName, new Blob(parts, { type: 'application/json' }))
    return { fileName }
  }

  const flow = serializeProject(
    project as unknown as Project,
    { nodes: nodes as never, edges: edges as never, assets: [] as never },
    { exportedAt },
  )
  // 只带结构的这一档很小，缩进留着 —— 用户可能自己打开看一眼
  const blob = new Blob([JSON.stringify(flow, null, 2)], { type: 'application/json' })
  await platform.files.saveFile(fileName, blob)
  return { fileName }
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

  /**
   * ⚠️ **解析完立刻丢掉原文**（对账 #233）。
   *
   * 含素材的文件是几十 ~ 几百 MB 级，而下面还要把 base64 解回字节、再逐行写库。
   * 原文（整份文件那么大的字符串）如果活到函数结束，峰值就凭空多出一份完整文件 ——
   * 实测 53MB 的文件峰值 181MB（3.4×），其中一份就是这个字符串。
   * 把它关在一个立刻返回的异步块里：**出块即可回收**，后面几步不必再背着它。
   */
  const flow: FlowFileV1 = await (async () => {
    const raw = await picked.blob.text()
    try {
      return JSON.parse(raw) as FlowFileV1
    } catch {
      throw new Error('[flowIo] 解析失败：文件不是合法的 JSON')
    }
  })()
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
