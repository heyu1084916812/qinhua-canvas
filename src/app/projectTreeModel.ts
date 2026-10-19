import type { ProjectFolder, ProjectListItem } from '../domain/project/project'
import {
  WORKBENCH_ORDER,
  type WorkbenchId,
} from '../domain/shared/workbench'

export interface ProjectTreeFolderGroup {
  folder: ProjectFolder
  projects: ProjectListItem[]
}

export interface ProjectTreeUnfiledGroup {
  workbench: WorkbenchId
  label: string
  projects: ProjectListItem[]
}

export interface ProjectTreeModel {
  pinnedProjects: ProjectListItem[]
  folders: ProjectTreeFolderGroup[]
  unfiled: ProjectTreeUnfiledGroup[]
}

const UNFILED_LABEL: Record<WorkbenchId, string> = {
  canvas: '未归档画布',
  ecommerce: '未归档电商',
  storyboard: '未归档漫剧',
}

function byPinnedThenUpdated(a: ProjectListItem, b: ProjectListItem): number {
  return (
    (a.pinnedAt ?? 0) - (b.pinnedAt ?? 0) ||
    b.updatedAt - a.updatedAt ||
    a.name.localeCompare(b.name, 'zh')
  )
}

/**
 * 侧栏项目树只有一个真相源：当前有效项目 + 文件夹。
 *
 * 规则：
 * - 置顶项目单列在最上方，不再在文件夹 / 未归档里重复出现；
 * - 文件夹本身按置顶、更新时间排序，内部允许混放三种工作台；
 * - 没有 folderId（或 folderId 已失效）的项目按工作台进入三个未归档组；
 * - 空文件夹仍保留，否则用户刚创建就看不到入口。
 */
export function buildProjectTree(
  projects: readonly ProjectListItem[],
  folders: readonly ProjectFolder[],
): ProjectTreeModel {
  const folderIds = new Set(folders.map((folder) => folder.id))
  const visibleProjects = projects.filter((project) => !project.deletedAt)
  const pinnedProjects = visibleProjects
    .filter((project) => (project.pinnedAt ?? 0) > 0)
    .sort((a, b) => (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) || byPinnedThenUpdated(a, b))
  const unpinned = visibleProjects.filter((project) => !(project.pinnedAt ?? 0))

  const folderGroups = folders
    .map((folder) => ({
      folder,
      projects: unpinned
        .filter((project) => project.folderId === folder.id)
        .sort(byPinnedThenUpdated),
    }))
    .sort(
      (a, b) =>
        (b.folder.pinnedAt ?? 0) - (a.folder.pinnedAt ?? 0) ||
        b.folder.updatedAt - a.folder.updatedAt ||
        a.folder.name.localeCompare(b.folder.name, 'zh'),
    )

  const unfiled = WORKBENCH_ORDER.map((workbench) => ({
    workbench,
    label: UNFILED_LABEL[workbench],
    projects: unpinned
      .filter(
        (project) =>
          project.workbench === workbench &&
          (!project.folderId || !folderIds.has(project.folderId)),
      )
      .sort(byPinnedThenUpdated),
  }))

  return { pinnedProjects, folders: folderGroups, unfiled }
}
