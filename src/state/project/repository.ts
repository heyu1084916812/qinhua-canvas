import type { StoragePort, TableName } from '../../platform/ports'
import type { Project, ProjectListItem, CreateProjectInput } from '../../domain/project/project'
import { createProject } from '../../domain/project/project'
import { createId } from '../../shared/id'

/**
 * projects 表仓储（架构 §5.10：项目 CRUD 不是图数据，直连 platform.storage，
 * 不走 dispatch / undo 栈）。入参是已经拿到的 StoragePort，不依赖运行时。
 *
 * 位置在 state/ 而非 domain/：仓储要 import platform 的 StoragePort，
 * 会触发 domain-pure 守卫（domain 只能依赖 domain / shared），故放在 state 层。
 */
export interface ProjectRepository {
  list(): Promise<ProjectListItem[]>
  get(id: string): Promise<Project | null>
  create(input?: CreateProjectInput): Promise<ProjectListItem>
  rename(id: string, name: string): Promise<void>
  /** 复制项目及其全部图数据（节点 / 连线），生成带「副本」后缀的新项目 */
  duplicate(id: string): Promise<ProjectListItem>
  remove(id: string): Promise<void>
}

const GRAPH_TABLES: TableName[] = ['nodes', 'edges']

export function createProjectRepository(storage: StoragePort): ProjectRepository {
  const toProject = (row: Record<string, unknown>): Project => ({
    id: String(row.id),
    workbench: (row.workbench as Project['workbench']) ?? 'canvas',
    name: (row.name as string) || '未命名项目',
    createdAt: (row.createdAt as number) ?? 0,
    updatedAt: (row.updatedAt as number) ?? 0,
    thumbnail: (row.thumbnail as string | null | undefined) ?? null,
    extra: (row.extra as Record<string, unknown> | undefined) ?? {},
  })

  const get = async (id: string): Promise<Project | null> => {
    const rows = await storage.query('projects', { id })
    return rows[0] ? toProject(rows[0]) : null
  }

  return {
    async list() {
      const rows = await storage.query('projects', {})
      const projects = rows.map(toProject).sort((a, b) => b.updatedAt - a.updatedAt)
      const items = await Promise.all(
        projects.map(async (p) => {
          const nodes = await storage.query('nodes', { projectId: p.id })
          return { ...p, nodeCount: nodes.length }
        }),
      )
      return items
    },

    get,

    async create(input: CreateProjectInput = {}) {
      // 复用 domain 的构造函数：默认名按 workbench 区分（现只有 canvas「未命名项目」）
      const project = createProject(input, createId('proj'), Date.now())
      await storage.put('projects', project as never)
      return { ...project, nodeCount: 0 }
    },

    async rename(id: string, name: string) {
      const existing = await get(id)
      if (!existing) return
      await storage.put('projects', {
        ...existing,
        name: name.trim() || existing.name,
        updatedAt: Date.now(),
      } as never)
    },

    async remove(id: string) {
      await storage.transaction(['projects', ...GRAPH_TABLES], async () => {
        await storage.delete('projects', id)
        for (const table of GRAPH_TABLES) {
          const rows = await storage.query(table, { projectId: id })
          for (const row of rows) await storage.delete(table, row.id)
        }
      })
    },

    async duplicate(id: string) {
      const src = await get(id)
      if (!src) throw new Error(`[repository] 复制失败：项目不存在 ${id}`)
      const now = Date.now()
      const copy: Project = {
        ...src,
        id: createId('proj'),
        name: `${src.name} 副本`,
        createdAt: now,
        updatedAt: now,
        extra: { ...(src.extra ?? {}) },
      }
      const nodes = await storage.query('nodes', { projectId: id })
      const edges = await storage.query('edges', { projectId: id })
      const idMap = new Map<string, string>()
      const newNodes = nodes.map((r) => {
        const nid = createId('node')
        idMap.set(String(r.id), nid)
        return { ...r, id: nid, projectId: copy.id }
      })
      const newEdges = edges.map((r) => ({
        ...r,
        id: createId('edge'),
        projectId: copy.id,
        source: idMap.get(String(r.source)) ?? String(r.source),
        target: idMap.get(String(r.target)) ?? String(r.target),
      }))
      await storage.transaction(['projects', ...GRAPH_TABLES], async () => {
        await storage.put('projects', copy as never)
        for (const n of newNodes) await storage.put('nodes', n as never)
        for (const e of newEdges) await storage.put('edges', e as never)
      })
      return { ...copy, nodeCount: newNodes.length }
    },
  }
}
