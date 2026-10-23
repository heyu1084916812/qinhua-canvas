import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import {
  WORKBENCH_ORDER,
  projectRoute,
  type WorkbenchId,
} from '../domain/shared/workbench'
import type {
  ProjectFolder,
  ProjectListItem,
} from '../domain/project/project'
import { createProjectRepository } from '../state/project/repository'
import { buildProjectExport } from '../state/project/flowIo'
import { forgetActiveWorkbench } from '../state/project/activeCanvas'
import { formatRelative } from '../domain/shared/time'
import {
  getProjectsRevision,
  subscribeProjectsChanged,
} from '../state/project/projectEvents'
import { buildProjectTree, projectGroupWindow } from './projectTreeModel'
import { projectMenuPosition, type ProjectMenuFrame } from './projectMenuPosition'
import { usePlatform } from './providers/PlatformProvider'
import {
  IconCanvas,
  IconEcommerce,
  IconStoryboard,
} from './AppSidebarIcons'
import {
  IconChevron,
  IconCloseCanvas,
  IconCopy,
  IconFolder,
  IconFolderOut,
  IconMore,
  IconMove,
  IconPin,
  IconPlus,
  IconRename,
  IconReveal,
  IconTrash,
  IconUpload,
} from './ProjectTreeIcons'
import styles from './ProjectTree.module.css'

type MenuTarget =
  | {
      kind: 'folder'
      id: string
      anchor: DOMRect
    }
  | {
      kind: 'project'
      id: string
      anchor: DOMRect
    }

interface RenameTarget {
  kind: 'folder' | 'project'
  id: string
  value: string
}

interface ConfirmTarget {
  kind: 'folder' | 'project'
  id: string
  name: string
}

interface StatusState {
  text: string
  tone: 'info' | 'error'
}

interface ProjectTreeProps {
  open: boolean
  activeProjectId: string | null
}

const PROJECT_ICON: Record<WorkbenchId, (props: { size?: number }) => JSX.Element> = {
  canvas: IconCanvas,
  ecommerce: IconEcommerce,
  storyboard: IconStoryboard,
}

const SHORT_WORKBENCH_LABEL: Record<WorkbenchId, string> = {
  canvas: '画布',
  ecommerce: '电商',
  storyboard: '漫剧',
}

function joinPath(directory: string, ...parts: string[]): string {
  const separator = directory.includes('\\') ? '\\' : '/'
  return [directory.replace(/[\\/]+$/, ''), ...parts]
    .filter(Boolean)
    .join(separator)
}

function safeFileName(name: string): string {
  return (name.trim() || '未命名项目').replace(/[\\/:*?"<>|]/g, '_')
}

/**
 * 侧栏「所有项目」树。
 *
 * 项目与文件夹的可见变更走 `projectEvents`，因此重命名、置顶、移动后不需要切页；
 * 菜单与确认框使用 portal，避免被侧栏的滚动容器裁切。
 */
export function ProjectTree({ open, activeProjectId }: ProjectTreeProps) {
  const platform = usePlatform()
  const navigate = useNavigate()
  const repo = useMemo(
    () => createProjectRepository(platform.storage),
    [platform.storage],
  )
  const revision = useSyncExternalStore(
    subscribeProjectsChanged,
    getProjectsRevision,
    getProjectsRevision,
  )
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [folders, setFolders] = useState<ProjectFolder[]>([])
  const [loading, setLoading] = useState(false)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const [menu, setMenu] = useState<MenuTarget | null>(null)
  const [menuFrame, setMenuFrame] = useState<ProjectMenuFrame | null>(null)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null)
  const [status, setStatus] = useState<StatusState | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      await platform.storage.open()
      const [nextProjects, nextFolders] = await Promise.all([
        repo.list(),
        repo.listFolders(),
      ])
      setProjects(nextProjects)
      setFolders(nextFolders)
    } catch (error) {
      setStatus({
        text: `项目树读取失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    } finally {
      setLoading(false)
    }
  }, [platform.storage, repo])

  useEffect(() => {
    if (!open) return
    void load()
  }, [load, open, revision])

  useEffect(() => {
    if (!renameTarget) return
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [renameTarget])

  useEffect(() => {
    if (!menu && !renameTarget && !confirmTarget) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenu(null)
      setRenameTarget(null)
      setConfirmTarget(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmTarget, menu, renameTarget])

  const tree = useMemo(() => buildProjectTree(projects, folders), [folders, projects])

  const groupWindow = useCallback(
    (items: readonly ProjectListItem[], groupId: string) => {
      const expanded = expandedGroups.has(groupId)
      const grouped = projectGroupWindow(items, activeProjectId, expanded)
      return {
        ...grouped,
        expanded,
      }
    },
    [activeProjectId, expandedGroups],
  )
  const pinnedWindow = groupWindow(tree.pinnedProjects, 'pinned')

  const toggleGroup = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleExpandedGroup = (id: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const showMenu = (
    target: { kind: 'folder'; id: string } | { kind: 'project'; id: string },
    button: HTMLButtonElement,
  ) => {
    setMoveMenuOpen(false)
    setMenuFrame(null)
    setMenu({ ...target, anchor: button.getBoundingClientRect() })
  }

  useLayoutEffect(() => {
    const node = menuRef.current
    if (!menu || !node) return
    const next = projectMenuPosition(menu.anchor, node.scrollHeight, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    setMenuFrame((current) =>
      current &&
      current.left === next.left &&
      current.top === next.top &&
      current.maxHeight === next.maxHeight
        ? current
        : next,
    )
  }, [menu, moveMenuOpen])

  const startRename = (kind: 'folder' | 'project', id: string, value: string) => {
    setMenu(null)
    setRenameTarget({ kind, id, value })
  }

  const submitRename = async () => {
    if (!renameTarget) return
    const next = renameTarget.value.trim()
    if (!next) return
    try {
      if (renameTarget.kind === 'folder') await repo.renameFolder(renameTarget.id, next)
      else await repo.rename(renameTarget.id, next)
      setRenameTarget(null)
    } catch (error) {
      setStatus({
        text: `重命名失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const createFolder = async () => {
    setMenu(null)
    try {
      const folder = await repo.createFolder()
      setRenameTarget({ kind: 'folder', id: folder.id, value: folder.name })
    } catch (error) {
      setStatus({
        text: `新建文件夹失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const createProject = async (workbench: WorkbenchId, folderId?: string) => {
    setMenu(null)
    try {
      const item = await repo.create({ workbench, folderId: folderId ?? null })
      navigate(projectRoute(item.workbench, item.id))
    } catch (error) {
      setStatus({
        text: `新建${SHORT_WORKBENCH_LABEL[workbench]}失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const moveProject = async (projectId: string, folderId: string | null) => {
    setMenu(null)
    try {
      await repo.setProjectFolder(projectId, folderId)
    } catch (error) {
      setStatus({
        text: `移动项目失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const moveAllOut = async (folderId: string) => {
    setMenu(null)
    const inside = projects.filter((project) => project.folderId === folderId)
    try {
      for (const project of inside) await repo.setProjectFolder(project.id, null)
      setStatus({
        text: inside.length
          ? `已把 ${inside.length} 个项目移到未归档`
          : '这个文件夹里没有项目',
        tone: 'info',
      })
    } catch (error) {
      setStatus({
        text: `移出文件夹失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const localDirectory = async (): Promise<string | null> => {
    const assetPath = platform.assetFolder?.path?.()
    if (assetPath) return assetPath
    return platform.storageAdmin ? platform.storageAdmin.dataDir() : null
  }

  const copyProjectPath = async (project: ProjectListItem) => {
    setMenu(null)
    try {
      const directory = await localDirectory()
      if (!directory) {
        setStatus({ text: '本地路径仅在桌面应用可用', tone: 'error' })
        return
      }
      const path = joinPath(directory, `${safeFileName(project.name)}.flow.json`)
      await navigator.clipboard.writeText(path)
      setStatus({ text: '项目路径已复制', tone: 'info' })
    } catch (error) {
      setStatus({
        text: `复制路径失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const copyFolderPath = async (folder: ProjectFolder) => {
    setMenu(null)
    try {
      const directory = await localDirectory()
      if (!directory) {
        setStatus({ text: '本地路径仅在桌面应用可用', tone: 'error' })
        return
      }
      await navigator.clipboard.writeText(
        joinPath(directory, safeFileName(folder.name)),
      )
      setStatus({ text: '文件夹路径已复制', tone: 'info' })
    } catch (error) {
      setStatus({
        text: `复制路径失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const revealProject = async () => {
    setMenu(null)
    try {
      const directory = await localDirectory()
      if (!directory || !platform.storageAdmin) {
        setStatus({ text: '资源管理器仅在桌面应用可用', tone: 'error' })
        return
      }
      await platform.storageAdmin.openDir(directory)
    } catch (error) {
      setStatus({
        text: `打开资源管理器失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const uploadProject = async (project: ProjectListItem) => {
    setMenu(null)
    setStatus({ text: `正在打包「${project.name}」…`, tone: 'info' })
    try {
      const payload = await buildProjectExport(platform, project.id, {
        embedAssets: true,
      })
      setStatus({ text: '正在上传到 OSS…', tone: 'info' })
      const result = await platform.hosting.upload({
        blob: payload.blob,
        name: payload.fileName,
      })
      if (!result) {
        setStatus({
          text: '素材传输还没有配置，先到全局设置 → 素材传输选择 OSS',
          tone: 'error',
        })
        return
      }
      await navigator.clipboard.writeText(result.url)
      setStatus({ text: '项目已上传，公网直链已复制', tone: 'info' })
    } catch (error) {
      setStatus({
        text: `上传失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const uploadFolder = async (folder: ProjectFolder) => {
    setMenu(null)
    const inside = projects.filter((project) => project.folderId === folder.id)
    if (inside.length === 0) {
      setStatus({ text: '这个文件夹里没有可上传的项目', tone: 'info' })
      return
    }
    let uploaded = 0
    try {
      for (const project of inside) {
        setStatus({
          text: `正在上传 ${uploaded + 1}/${inside.length}：${project.name}`,
          tone: 'info',
        })
        const payload = await buildProjectExport(platform, project.id, {
          embedAssets: true,
        })
        const result = await platform.hosting.upload({
          blob: payload.blob,
          name: `${safeFileName(folder.name)}-${payload.fileName}`,
        })
        if (!result) {
          setStatus({
            text: '素材传输还没有配置，先到全局设置 → 素材传输选择 OSS',
            tone: 'error',
          })
          return
        }
        uploaded += 1
      }
      setStatus({
        text: `文件夹已上传 ${uploaded}/${inside.length} 个项目`,
        tone: 'info',
      })
    } catch (error) {
      setStatus({
        text: `上传文件夹失败（已完成 ${uploaded}/${inside.length}）：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const askDelete = (target: ConfirmTarget) => {
    setMenu(null)
    setConfirmTarget(target)
  }

  const confirmDelete = async () => {
    if (!confirmTarget) return
    try {
      if (confirmTarget.kind === 'folder') await repo.removeFolder(confirmTarget.id)
      else await repo.remove(confirmTarget.id)
      setStatus({
        text:
          confirmTarget.kind === 'folder'
            ? '文件夹已删除，里面的项目已移到未归档'
            : '项目已移到回收站',
        tone: 'info',
      })
      setConfirmTarget(null)
    } catch (error) {
      setStatus({
        text: `删除失败：${error instanceof Error ? error.message : String(error)}`,
        tone: 'error',
      })
    }
  }

  const menuProject =
    menu?.kind === 'project'
      ? projects.find((project) => project.id === menu.id) ?? null
      : null
  const menuFolder =
    menu?.kind === 'folder'
      ? folders.find((folder) => folder.id === menu.id) ?? null
      : null

  return (
    <section className={styles.root} data-sidebar-project-tree data-sidebar-text>
      <div className={styles.heading}>
        <span className={styles.headingText}>所有项目</span>
        <button
          type="button"
          className={styles.headingAction}
          title="新建文件夹"
          aria-label="新建文件夹"
          data-project-tree-new-folder
          onClick={() => void createFolder()}
        >
          <IconPlus size={15} />
        </button>
      </div>

      <div className={styles.scroll}>
        {loading && projects.length === 0 ? (
          <div className={styles.skeletons} aria-label="正在读取项目">
            <span />
            <span />
            <span />
          </div>
        ) : projects.length === 0 && folders.length === 0 ? (
          <div className={styles.empty}>还没有项目</div>
        ) : (
          <>
            {tree.pinnedProjects.length > 0 && (
              <div className={styles.section} data-project-tree-group-id="pinned">
                <div className={styles.sectionLabel}>置顶</div>
                <ul className={styles.list}>
                  {pinnedWindow.visible.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      active={project.id === activeProjectId}
                      onOpen={() => navigate(projectRoute(project.workbench, project.id))}
                      onTogglePin={() => void repo.setProjectPinned(project.id, false)}
                      onMore={(button) => showMenu({ kind: 'project', id: project.id }, button)}
                    />
                  ))}
                </ul>
                {pinnedWindow.hidden > 0 && (
                  <GroupExpandButton
                    count={pinnedWindow.hidden}
                    expanded={pinnedWindow.expanded}
                    groupId="pinned"
                    onToggle={toggleExpandedGroup}
                  />
                )}
              </div>
            )}

            {tree.folders.map(({ folder, projects: folderProjects }) => {
              const groupId = `folder:${folder.id}`
              const isCollapsed = collapsed.has(groupId)
              const window = groupWindow(folderProjects, groupId)
              const total = projects.filter((project) => project.folderId === folder.id).length
              return (
                <div
                  className={styles.section}
                  key={folder.id}
                  data-project-tree-group-id={groupId}
                >
                  <GroupRow
                    label={folder.name}
                    count={total}
                    pinned={(folder.pinnedAt ?? 0) > 0}
                    collapsed={isCollapsed}
                    onToggle={() => toggleGroup(groupId)}
                    onTogglePin={() => void repo.setFolderPinned(folder.id, !folder.pinnedAt)}
                    onMore={(button) => showMenu({ kind: 'folder', id: folder.id }, button)}
                  />
                  {!isCollapsed && (
                    <ul className={styles.list}>
                      {folderProjects.length === 0 ? (
                        <li className={styles.groupEmpty}>文件夹为空</li>
                      ) : (
                        window.visible.map((project) => (
                          <ProjectRow
                            key={project.id}
                            project={project}
                            active={project.id === activeProjectId}
                            onOpen={() => navigate(projectRoute(project.workbench, project.id))}
                            onTogglePin={() => void repo.setProjectPinned(project.id, true)}
                            onMore={(button) =>
                              showMenu({ kind: 'project', id: project.id }, button)
                            }
                          />
                        ))
                      )}
                    </ul>
                  )}
                  {!isCollapsed && window.hidden > 0 && (
                    <GroupExpandButton
                      count={window.hidden}
                      expanded={window.expanded}
                      groupId={groupId}
                      onToggle={toggleExpandedGroup}
                    />
                  )}
                </div>
              )
            })}

            {tree.unfiled.map(({ workbench, label, projects: groupProjects }) => {
              const groupId = `workbench:${workbench}`
              const isCollapsed = collapsed.has(groupId)
              const window = groupWindow(groupProjects, groupId)
              return (
                <div
                  className={styles.section}
                  key={workbench}
                  data-project-tree-group-id={groupId}
                >
                  <GroupRow
                    label={label}
                    count={groupProjects.length}
                    pinned={false}
                    collapsed={isCollapsed}
                    onToggle={() => toggleGroup(groupId)}
                    onTogglePin={undefined}
                    onMore={undefined}
                  />
                  {!isCollapsed && (
                    <ul className={styles.list}>
                      {groupProjects.length === 0 ? (
                        <li className={styles.groupEmpty}>暂无项目</li>
                      ) : (
                        window.visible.map((project) => (
                          <ProjectRow
                            key={project.id}
                            project={project}
                            active={project.id === activeProjectId}
                            onOpen={() => navigate(projectRoute(project.workbench, project.id))}
                            onTogglePin={() => void repo.setProjectPinned(project.id, true)}
                            onMore={(button) =>
                              showMenu({ kind: 'project', id: project.id }, button)
                            }
                          />
                        ))
                      )}
                    </ul>
                  )}
                  {!isCollapsed && window.hidden > 0 && (
                    <GroupExpandButton
                      count={window.hidden}
                      expanded={window.expanded}
                      groupId={groupId}
                      onToggle={toggleExpandedGroup}
                    />
                  )}
                </div>
              )
            })}
          </>
        )}

        {status && (
          <div
            className={
              status.tone === 'error'
                ? `${styles.status} ${styles.statusError}`
                : styles.status
            }
            role={status.tone === 'error' ? 'alert' : 'status'}
          >
            {status.text}
          </div>
        )}
      </div>

      {menu &&
        createPortal(
          <div className={styles.menuLayer} onPointerDown={() => setMenu(null)}>
            <div
              ref={menuRef}
              className={styles.menu}
              role="menu"
              data-project-menu
              style={
                menuFrame
                  ? menuFrame
                  : {
                      left: menu.anchor.left,
                      top: menu.anchor.bottom + 4,
                      maxHeight: Math.max(1, window.innerHeight - menu.anchor.bottom - 12),
                      visibility: 'hidden',
                    }
              }
              onPointerDown={(event) => event.stopPropagation()}
            >
              {menu.kind === 'folder' && menuFolder && (
                <>
                  <MenuButton
                    icon={<IconRename />}
                    label="重命名"
                    onClick={() => startRename('folder', menuFolder.id, menuFolder.name)}
                  />
                  <MenuButton
                    icon={<IconPin />}
                    label={menuFolder.pinnedAt ? '取消置顶' : '置顶'}
                    onClick={() => {
                      setMenu(null)
                      void repo.setFolderPinned(menuFolder.id, !menuFolder.pinnedAt)
                    }}
                  />
                  <div className={styles.menuDivider} />
                  {WORKBENCH_ORDER.map((workbench) => (
                    <MenuButton
                      key={workbench}
                      icon={iconsForWorkbench(workbench)}
                      label={`新建${SHORT_WORKBENCH_LABEL[workbench]}`}
                      onClick={() => void createProject(workbench, menuFolder.id)}
                    />
                  ))}
                  <MenuButton
                    icon={<IconChevron size={16} />}
                    label={collapsed.has(`folder:${menuFolder.id}`) ? '展开文件夹' : '收起文件夹'}
                    onClick={() => {
                      setMenu(null)
                      toggleGroup(`folder:${menuFolder.id}`)
                    }}
                  />
                  <div className={styles.menuDivider} />
                  <MenuButton
                    icon={<IconFolderOut />}
                    label="移出全部项目"
                    onClick={() => void moveAllOut(menuFolder.id)}
                  />
                  <div className={styles.menuDivider} />
                  <MenuButton
                    icon={<IconCopy />}
                    label="复制路径"
                    onClick={() => void copyFolderPath(menuFolder)}
                  />
                  <MenuButton
                    icon={<IconReveal />}
                    label="在文件资源管理器中打开"
                    onClick={() => void revealProject()}
                  />
                  <MenuButton
                    icon={<IconUpload />}
                    label="上传文件夹到 OSS"
                    onClick={() => void uploadFolder(menuFolder)}
                  />
                  <div className={styles.menuDivider} />
                  <MenuButton
                    danger
                    icon={<IconTrash />}
                    label="删除文件夹"
                    onClick={() =>
                      askDelete({ kind: 'folder', id: menuFolder.id, name: menuFolder.name })
                    }
                  />
                </>
              )}

              {menu.kind === 'project' && menuProject && (
                <>
                  <MenuButton
                    icon={<IconRename />}
                    label="重命名"
                    onClick={() => startRename('project', menuProject.id, menuProject.name)}
                  />
                  <MenuButton
                    icon={<IconMove />}
                    label="移入项目"
                    trailing="›"
                    onClick={() => setMoveMenuOpen((value) => !value)}
                  />
                  {moveMenuOpen && (
                    <div className={styles.submenu}>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void moveProject(menuProject.id, null)}
                      >
                        未归档
                      </button>
                      {folders.map((folder) => (
                        <button
                          key={folder.id}
                          type="button"
                          role="menuitem"
                          onClick={() => void moveProject(menuProject.id, folder.id)}
                        >
                          {folder.name}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className={styles.menuDivider} />
                  <MenuButton
                    icon={<IconCopy />}
                    label="复制路径"
                    onClick={() => void copyProjectPath(menuProject)}
                  />
                  <MenuButton
                    icon={<IconReveal />}
                    label="在文件资源管理器中打开"
                    onClick={() => void revealProject()}
                  />
                  <MenuButton
                    icon={<IconUpload />}
                    label="上传到 OSS"
                    onClick={() => void uploadProject(menuProject)}
                  />
                  <MenuButton
                    icon={<IconCloseCanvas />}
                    label="关闭项目"
                    disabled={menuProject.id !== activeProjectId}
                    onClick={() => {
                      setMenu(null)
                      forgetActiveWorkbench(menuProject.workbench)
                      navigate('/projects')
                    }}
                  />
                  <div className={styles.menuDivider} />
                  <MenuButton
                    icon={<IconPin />}
                    label={menuProject.pinnedAt ? '取消置顶' : '置顶'}
                    onClick={() => {
                      setMenu(null)
                      void repo.setProjectPinned(menuProject.id, !menuProject.pinnedAt)
                    }}
                  />
                  <MenuButton
                    danger
                    icon={<IconTrash />}
                    label="删除"
                    onClick={() =>
                      askDelete({
                        kind: 'project',
                        id: menuProject.id,
                        name: menuProject.name,
                      })
                    }
                  />
                </>
              )}
            </div>
          </div>,
          document.body,
        )}

      {renameTarget &&
        createPortal(
          <ModalLayer onClose={() => setRenameTarget(null)}>
            <form
              className={styles.dialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="project-tree-rename-title"
              onSubmit={(event) => {
                event.preventDefault()
                void submitRename()
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setRenameTarget(null)
              }}
            >
              <h2 id="project-tree-rename-title">
                {renameTarget.kind === 'folder' ? '重命名文件夹' : '重命名画布'}
              </h2>
              <label className={styles.dialogLabel}>
                <span>{renameTarget.kind === 'folder' ? '文件夹名称' : '画布名称'}</span>
                <input
                  ref={renameInputRef}
                  value={renameTarget.value}
                  onChange={(event) =>
                    setRenameTarget((current) =>
                      current ? { ...current, value: event.target.value } : current,
                    )
                  }
                />
              </label>
              <div className={styles.dialogActions}>
                <button type="button" onClick={() => setRenameTarget(null)}>
                  取消
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={!renameTarget.value.trim()}
                >
                  保存
                </button>
              </div>
            </form>
          </ModalLayer>,
          document.body,
        )}

      {confirmTarget &&
        createPortal(
          <ModalLayer onClose={() => setConfirmTarget(null)}>
            <div
              className={styles.dialog}
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="project-tree-confirm-title"
            >
              <h2 id="project-tree-confirm-title">
                {confirmTarget.kind === 'folder' ? '删除文件夹？' : '删除项目？'}
              </h2>
              <p>
                {confirmTarget.kind === 'folder'
                  ? `「${confirmTarget.name}」里的项目会移到未分组，不会被删除。`
                  : `「${confirmTarget.name}」会移到回收站，可在项目页恢复。`}
              </p>
              <div className={styles.dialogActions}>
                <button type="button" onClick={() => setConfirmTarget(null)}>
                  取消
                </button>
                <button
                  type="button"
                  className={styles.dangerButton}
                  onClick={() => void confirmDelete()}
                >
                  确认删除
                </button>
              </div>
            </div>
          </ModalLayer>,
          document.body,
        )}
    </section>
  )
}

function iconsForWorkbench(workbench: WorkbenchId) {
  const Icon = PROJECT_ICON[workbench]
  return <Icon size={16} />
}

function GroupRow({
  label,
  count,
  pinned,
  collapsed,
  onToggle,
  onTogglePin,
  onMore,
}: {
  label: string
  count: number
  pinned: boolean
  collapsed: boolean
  onToggle: () => void
  onTogglePin?: () => void
  onMore?: (button: HTMLButtonElement) => void
}) {
  return (
    <div className={styles.groupRow} data-project-tree-group>
      <button
        type="button"
        className={styles.groupMain}
        aria-expanded={!collapsed}
        onClick={onToggle}
      >
        <span className={styles.groupIcon}>
          <IconFolder size={16} />
        </span>
        <span className={styles.groupLabel}>{label}</span>
        <span className={collapsed ? styles.chevron : `${styles.chevron} ${styles.chevronOpen}`}>
          <IconChevron size={13} />
        </span>
        <span className={styles.groupCount}>{count}</span>
      </button>
      {(onTogglePin || onMore) && (
        <div className={styles.rowActions}>
          {onTogglePin && (
            <button
              type="button"
              className={pinned ? `${styles.iconButton} ${styles.iconButtonOn}` : styles.iconButton}
              title={pinned ? '取消置顶' : '置顶'}
              aria-label={pinned ? '取消置顶' : '置顶'}
              onClick={onTogglePin}
            >
              <IconPin size={14} />
            </button>
          )}
          {onMore && (
            <button
              type="button"
              className={styles.iconButton}
              title="更多"
              aria-label="更多"
              onClick={(event) => onMore(event.currentTarget)}
            >
              <IconMore size={15} />
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function GroupExpandButton({
  count,
  expanded,
  groupId,
  onToggle,
}: {
  count: number
  expanded: boolean
  groupId: string
  onToggle: (groupId: string) => void
}) {
  return (
    <button
      type="button"
      className={styles.groupExpand}
      data-project-tree-expand={groupId}
      aria-expanded={expanded}
      onClick={() => onToggle(groupId)}
    >
      {expanded ? '收起' : `展开显示 (${count})`}
    </button>
  )
}

function ProjectRow({
  project,
  active,
  onOpen,
  onTogglePin,
  onMore,
}: {
  project: ProjectListItem
  active: boolean
  onOpen: () => void
  onTogglePin: () => void
  onMore: (button: HTMLButtonElement) => void
}) {
  const Icon = PROJECT_ICON[project.workbench]
  return (
    <li
      className={active ? `${styles.projectRow} ${styles.projectRowActive}` : styles.projectRow}
      data-project-tree-item={project.id}
      data-project-tree-workbench={project.workbench}
      data-project-tree-active={active ? 'true' : 'false'}
    >
      <button
        type="button"
        className={styles.projectMain}
        onClick={onOpen}
        title={project.name}
        aria-current={active ? 'page' : undefined}
      >
        <span className={styles.projectIcon}>
          <Icon size={15} />
        </span>
        <span className={styles.projectName}>{project.name}</span>
        <span className={styles.projectTime} title={new Date(project.updatedAt).toLocaleString('zh-CN')}>
          {formatRelative(project.updatedAt)}
        </span>
      </button>
      <div className={styles.rowActions}>
        <button
          type="button"
          className={
            project.pinnedAt
              ? `${styles.iconButton} ${styles.iconButtonOn}`
              : styles.iconButton
          }
          title={project.pinnedAt ? '取消置顶' : '置顶'}
          aria-label={project.pinnedAt ? '取消置顶' : '置顶'}
          onClick={onTogglePin}
        >
          <IconPin size={14} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title="更多"
          aria-label="更多"
          onClick={(event) => onMore(event.currentTarget)}
        >
          <IconMore size={15} />
        </button>
      </div>
    </li>
  )
}

function MenuButton({
  icon,
  label,
  trailing,
  danger = false,
  disabled = false,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  trailing?: string
  danger?: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      className={danger ? `${styles.menuItem} ${styles.menuItemDanger}` : styles.menuItem}
      onClick={onClick}
    >
      <span className={styles.menuIcon}>{icon}</span>
      <span className={styles.menuLabel}>{label}</span>
      {trailing && <span className={styles.menuTrailing}>{trailing}</span>}
    </button>
  )
}

function ModalLayer({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div
      className={styles.modalLayer}
      onPointerDown={(event) => {
        if (event.currentTarget === event.target) onClose()
      }}
    >
      {children}
    </div>
  )
}
