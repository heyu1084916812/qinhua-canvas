import { createStore as createVanilla } from 'zustand/vanilla'
import type { ProjectListItem, CreateProjectInput } from '../../domain/project/project'
import type { ProjectRepository } from './repository'

/**
 * zustand 5 的 createStore 类型（Mutate / StoreMutators 条件类型）与本项目装好的
 * TypeScript 6 泛型推断冲突，直接调用会报「Expected 2 arguments」类错误。
 * 这里把它收敛成一个等价的极简工厂签名（运行时仍是 zustand，行为一致）。
 * 与 state/workbenches/canvas/store.ts 的 workaround 同源。
 */
type MiniStore<T> = {
  getState: () => T
  setState: (partial: Partial<T> | ((prev: T) => Partial<T>)) => void
  subscribe: (listener: () => void) => () => void
}
type StoreFactory = <T>(init: () => T) => MiniStore<T>
const createVanillaStore = createVanilla as unknown as StoreFactory

export type ProjectSort = 'updated' | 'created' | 'name'

export interface ProjectListState {
  /** 原始项目列表（按 updatedAt 倒序，来自仓储） */
  projects: ProjectListItem[]
  /** 经过滤 + 排序、供视图直接渲染的列表 */
  visible: ProjectListItem[]
  loading: boolean
  loaded: boolean
  sort: ProjectSort
  query: string
}

export interface ProjectListActions {
  load: () => Promise<void>
  create: (input?: CreateProjectInput) => Promise<ProjectListItem>
  rename: (id: string, name: string) => Promise<void>
  duplicate: (id: string) => Promise<ProjectListItem>
  remove: (id: string) => Promise<void>
  setSort: (sort: ProjectSort) => void
  setQuery: (query: string) => void
}

export type ProjectListStore = MiniStore<ProjectListState> & ProjectListActions

/** 按名称模糊匹配（不区分大小写） */
function filterProjects(projects: ProjectListItem[], query: string): ProjectListItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return projects
  return projects.filter((p) => p.name.toLowerCase().includes(q))
}

/** 排序：最近编辑（默认）/ 创建时间 / 名称 A-Z */
function sortProjects(projects: ProjectListItem[], sort: ProjectSort): ProjectListItem[] {
  const copy = [...projects]
  switch (sort) {
    case 'created':
      return copy.sort((a, b) => b.createdAt - a.createdAt)
    case 'name':
      return copy.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    case 'updated':
    default:
      return copy.sort((a, b) => b.updatedAt - a.updatedAt)
  }
}

function deriveVisible(projects: ProjectListItem[], query: string, sort: ProjectSort): ProjectListItem[] {
  return sortProjects(filterProjects(projects, query), sort)
}

/**
 * 项目列表 store（架构 §5.10，zustand vanilla，框架无关，可 node 单测）。
 * 包装仓储，把项目列表、加载态、排序 / 搜索态维护在 store 中；HomePage 通过
 * useSyncExternalStore 订阅，不把列表逻辑写进 React 组件。
 */
export function createProjectListStore(repo: ProjectRepository): ProjectListStore {
  const store = createVanillaStore<ProjectListState>(() => ({
    projects: [],
    visible: [],
    loading: false,
    loaded: false,
    sort: 'updated',
    query: '',
  }))

  const load: ProjectListActions['load'] = async () => {
    store.setState({ loading: true })
    const projects = await repo.list()
    const { query, sort } = store.getState()
    store.setState({ projects, visible: deriveVisible(projects, query, sort), loading: false, loaded: true })
  }

  const create: ProjectListActions['create'] = async (input) => {
    const item = await repo.create(input)
    store.setState((s) => {
      const projects = [item, ...s.projects]
      return { projects, visible: deriveVisible(projects, s.query, s.sort) }
    })
    return item
  }

  const rename: ProjectListActions['rename'] = async (id, name) => {
    await repo.rename(id, name)
    store.setState((s) => {
      const projects = s.projects.map((p) => (p.id === id ? { ...p, name: name.trim() || p.name } : p))
      return { projects, visible: deriveVisible(projects, s.query, s.sort) }
    })
  }

  const duplicate: ProjectListActions['duplicate'] = async (id) => {
    const item = await repo.duplicate(id)
    store.setState((s) => {
      const projects = [item, ...s.projects]
      return { projects, visible: deriveVisible(projects, s.query, s.sort) }
    })
    return item
  }

  const remove: ProjectListActions['remove'] = async (id) => {
    await repo.remove(id)
    store.setState((s) => {
      const projects = s.projects.filter((p) => p.id !== id)
      return { projects, visible: deriveVisible(projects, s.query, s.sort) }
    })
  }

  const setSort: ProjectListActions['setSort'] = (sort) => {
    store.setState((s) => ({ sort, visible: deriveVisible(s.projects, s.query, sort) }))
  }

  const setQuery: ProjectListActions['setQuery'] = (query) => {
    store.setState((s) => ({ query, visible: deriveVisible(s.projects, query, s.sort) }))
  }

  return { ...store, load, create, rename, duplicate, remove, setSort, setQuery }
}
