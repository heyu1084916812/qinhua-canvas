import { describe, expect, it } from 'vitest'
import type { ProjectFolder, ProjectListItem } from '../domain/project/project'
import { buildProjectTree } from './projectTreeModel'

function project(
  id: string,
  overrides: Partial<ProjectListItem> = {},
): ProjectListItem {
  return {
    id,
    name: id,
    workbench: 'canvas',
    createdAt: 1,
    updatedAt: 1,
    nodeCount: 0,
    folderId: null,
    ...overrides,
  }
}

function folder(id: string, overrides: Partial<ProjectFolder> = {}): ProjectFolder {
  return {
    id,
    name: id,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('buildProjectTree', () => {
  it('置顶项目单列，不在文件夹或未归档里重复', () => {
    const model = buildProjectTree(
      [
        project('pinned', { pinnedAt: 20, folderId: 'f1' }),
        project('inside', { folderId: 'f1' }),
      ],
      [folder('f1')],
    )

    expect(model.pinnedProjects.map((item) => item.id)).toEqual(['pinned'])
    expect(model.folders[0].projects.map((item) => item.id)).toEqual(['inside'])
    expect(model.unfiled.flatMap((group) => group.projects)).toHaveLength(0)
  })

  it('文件夹可混放三种工作台，未归档按画布 / 电商 / 漫剧分组', () => {
    const model = buildProjectTree(
      [
        project('c', { workbench: 'canvas', folderId: 'mixed' }),
        project('e', { workbench: 'ecommerce', folderId: 'mixed' }),
        project('s', { workbench: 'storyboard', folderId: 'mixed' }),
        project('free-c', { workbench: 'canvas' }),
        project('free-e', { workbench: 'ecommerce' }),
        project('free-s', { workbench: 'storyboard' }),
      ],
      [folder('mixed')],
    )

    expect(model.folders[0].projects.map((item) => item.workbench)).toEqual([
      'canvas',
      'ecommerce',
      'storyboard',
    ])
    expect(model.unfiled.map((group) => group.label)).toEqual([
      '未归档画布',
      '未归档电商',
      '未归档漫剧',
    ])
    expect(model.unfiled.map((group) => group.projects[0]?.id)).toEqual([
      'free-c',
      'free-e',
      'free-s',
    ])
  })

  it('失效 folderId 回落未归档，空文件夹仍保留', () => {
    const model = buildProjectTree(
      [project('orphan', { folderId: 'missing' })],
      [folder('empty')],
    )

    expect(model.folders).toHaveLength(1)
    expect(model.folders[0].projects).toHaveLength(0)
    expect(model.unfiled[0].projects.map((item) => item.id)).toEqual(['orphan'])
  })

  it('文件夹置顶优先，项目置顶时间倒序', () => {
    const model = buildProjectTree(
      [
        project('older', { pinnedAt: 10 }),
        project('newer', { pinnedAt: 30 }),
      ],
      [
        folder('normal', { updatedAt: 100 }),
        folder('pinned-folder', { pinnedAt: 5, updatedAt: 1 }),
      ],
    )

    expect(model.pinnedProjects.map((item) => item.id)).toEqual(['newer', 'older'])
    expect(model.folders.map((item) => item.folder.id)).toEqual([
      'pinned-folder',
      'normal',
    ])
  })
})
