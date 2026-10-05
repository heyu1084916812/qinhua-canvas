import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository, type ProjectRepository } from '../../state/project/repository'
import {
  createProjectListStore,
  type ProjectListStore,
  type ProjectSort,
} from '../../state/project/listStore'
import {
  exportProject,
  importProjectFile,
  importProjectFromFile,
  type ImportResult,
} from '../../state/project/flowIo'
import { projectRoute, WORKBENCHES, WORKBENCH_ORDER, type WorkbenchId } from '../../domain/shared/workbench'
import { formatRelative } from '../../domain/shared/time'
import { TEMPLATES, type TemplateId } from '../../state/project/templates'
import type { ProjectListItem } from '../../domain/project/project'
import {
  allVisibleProjectsSelected,
  clearVisibleProjects,
  selectVisibleProjects,
  toggleProjectSelection,
} from '../../domain/project/selection'
import styles from './ProjectsPage.module.css'
import { useAssetMeta } from '../../workbenches/canvas/hooks/useAsset'

/**
 * 项目页（产品文档 §5.1 / §5.3；路由 `/projects`）。
 *
 * 原名 `HomePage`。2026-09-27 应用壳改版时**一分为二**：
 * 这里只留「项目网格 + 模板库」这件正事，品牌 / 欢迎 / 一级导航
 * 全部交给应用壳（§5.2「首页不再有自己的顶栏」）。
 *
 * 为什么是改名而不是并存两个页面：原来那个 `HomePage` 里根本没有「欢迎」内容
 * —— 它从第一版起就是项目网格。把它叫「首页」才是一直以来的错位，
 * 现在按它实际干的事命名。
 */
export function ProjectsPage() {
  const platform = usePlatform()
  const navigate = useNavigate()

  // 仓库与列表 store 跟随首页生命周期创建一次（直连 platform.storage）
  const repoRef = useRef<ProjectRepository | null>(null)
  if (!repoRef.current) repoRef.current = createProjectRepository(platform.storage)
  const repo = repoRef.current
  const storeRef = useRef<ProjectListStore | null>(null)
  if (!storeRef.current) {
    storeRef.current = createProjectListStore(repo)
  }
  const store = storeRef.current

  const visible = useSyncExternalStore(store.subscribe, () => store.getState().visible, () => store.getState().visible)
  const loading = useSyncExternalStore(store.subscribe, () => store.getState().loading, () => store.getState().loading)
  const sort = useSyncExternalStore(store.subscribe, () => store.getState().sort, () => store.getState().sort)
  const query = useSyncExternalStore(store.subscribe, () => store.getState().query, () => store.getState().query)

  // 交互态
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  /** 正拖着文件停在这一页上（决定要不要显那层「松开即导入」的提示） */
  const [dragging, setDragging] = useState(false)
  /** 项目多选模式（用户 2026-09-28）：选择态下卡片点击不再进入画布 */
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  /** 「+ 新建」的工作台选择浮层（null = 未展开；坐标 = 展开位置） */
  const [newMenu, setNewMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    void store.load()
  }, [store])

  const createBlank = async (workbench: WorkbenchId = 'canvas') => {
    // 不传 name：由 domain 按 workbench 取默认名（现只有 canvas「未命名项目」）
    const item = await store.create({ workbench })
    navigate(projectRoute(item.workbench, item.id))
  }

  /** 从「+ 新建」浮层选一个工作台创建 */
  const createWithWorkbench = (workbench: WorkbenchId) => {
    setNewMenu(null)
    void createBlank(workbench)
  }

  const createFromTemplate = async (templateId: TemplateId, name: string) => {
    const item = await store.create({ name })
    navigate(projectRoute(item.workbench, item.id), { state: { template: templateId } })
  }

  const handleDelete = async (id: string) => {
    await store.remove(id)
    setConfirmId(null)
    setMenuId(null)
  }

  const visibleIds = visible.map((p) => p.id)
  const selectedCount = selectedIds.size

  const exitSelection = () => {
    setSelecting(false)
    setSelectedIds(new Set())
    setBulkConfirm(false)
  }

  const toggleSelectionMode = () => {
    if (selecting) {
      exitSelection()
      return
    }
    setMenuId(null)
    setConfirmId(null)
    setSelecting(true)
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((current) => toggleProjectSelection(current, id))
    setBulkConfirm(false)
  }

  const toggleSelectVisible = () => {
    setSelectedIds((current) =>
      allVisibleProjectsSelected(current, visibleIds)
        ? clearVisibleProjects(current, visibleIds)
        : selectVisibleProjects(current, visibleIds),
    )
    setBulkConfirm(false)
  }

  const clearSelected = () => {
    setSelectedIds(new Set())
    setBulkConfirm(false)
  }

  const handleBulkDelete = async () => {
    if (selectedCount === 0) return
    await store.removeMany([...selectedIds])
    setMenuId(null)
    setConfirmId(null)
    exitSelection()
    setStatus(`已删除 ${selectedCount} 个项目`)
  }

  const handleImport = async () => {
    if (busy) return
    setBusy(true)
    try {
      await applyImportResult(await importProjectFile(platform, repo))
    } catch (err) {
      setStatus(`导入失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 导入结果的**统一收尾**（对账 #234）：菜单选文件与"拖进来"两条入口共用，
   * 免得出现"拖进来不播报 / 播报得不一样"这类分叉。
   */
  const applyImportResult = async (res: ImportResult) => {
    if (res.cancelled) return
    await store.load()
    /**
     * 陈旧标记下线后（用户 2026-09-17），缺失的模型不再往节点上「标记」——
     * 文案里的「已标记」会指向一个不存在的视觉信号，故改成直说事实。
     */
    const modelNote = res.missingModels.length
      ? `（${res.missingModels.length} 个节点引用了本机没有的模型）`
      : ''
    setStatus(`已导入「${res.project?.name}」${modelNote}`)
  }

  /**
   * **把一个 `.flow.json` 拖到项目页 = 导入**（对账 #234）。
   *
   * 为什么值得做：换机器时用户手里就是一个文件，"拖进来"是最自然的动作 ——
   * 而在此之前拖上去**毫无反应**（页面没有 drop 处理），那很容易被当成"文件坏了"。
   * 它同时让这条路可以被**自动化验收**（拖拽可脚本化，系统文件框不行），
   * 于是"迁移"这件事不再只能靠手点。
   */
  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    const file = e.dataTransfer?.files?.[0]
    setDragging(false)
    if (!file) return
    if (!/\.json$/i.test(file.name)) {
      setStatus('这里只接受 .flow.json 项目文件（拖进来的是别的类型）')
      return
    }
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await applyImportResult(
        await importProjectFromFile(platform, repo, {
          name: file.name,
          size: file.size,
          mime: file.type || 'application/json',
          blob: file,
        }),
      )
    } catch (err) {
      setStatus(`导入失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  /**
   * 导出 .flow.json。`embedAssets` = **连素材字节一起带走**（方案 §3 的第 ② 条兜底）。
   *
   * 为什么要有这一档：默认导出只有结构，搬到另一台机器 / 桌面壳时"节点在、图全丢"；
   * 素材多时文件会很大，所以**不默认打开**、也不并进同一个入口 —— 用户明确点那一条才带素材。
   * （日常备份仍推荐「素材文件夹」那条路：字节留在盘上，JSON 只带结构。）
   */
  const handleExport = async (id: string, name: string, opts?: { embedAssets?: boolean }) => {
    if (busy) return
    setBusy(true)
    setMenuId(null)
    try {
      const { fileName } = await exportProject(platform, id, {
        ...opts,
        /**
         * 带素材的导出可能要**几十秒**：进度直接写在状态行上。
         * 没有读数时，用户会以为卡死并去点第二次（同对账 #229 那条口径）。
         */
        onProgress: (done, total) => setStatus(`导出中 ${done}/${total}…`),
      })
      setStatus(`已导出「${name}」为 ${fileName}${opts?.embedAssets ? '（含素材）' : ''}`)
    } catch (err) {
      setStatus(`导出失败：${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const startRename = (p: ProjectListItem) => {
    setRenamingId(p.id)
    setRenameValue(p.name)
    setMenuId(null)
  }
  const commitRename = async () => {
    if (renamingId) await store.rename(renamingId, renameValue)
    setRenamingId(null)
  }

  const handleDuplicate = async (id: string) => {
    await store.duplicate(id)
    setMenuId(null)
  }

  return (
    <div
      className={styles.page}
      data-projects-drop
      /**
       * 拖一个 `.flow.json` 进来就导入（对账 #234）。
       * `onDragOver` 必须 `preventDefault`，否则浏览器**根本不发 drop**（默认是"不接收"）。
       */
      onDragOver={(e) => {
        if (!e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        if (!dragging) setDragging(true)
      }}
      onDragLeave={(e) => {
        // 只在真的离开这一页时收起提示：进出子元素也会触发 dragleave
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setDragging(false)
      }}
      onDrop={(e) => void handleDrop(e)}
    >
      {dragging && (
        <div className={styles.dropHint} data-projects-drop-hint>
          松开即导入这个 .flow.json
        </div>
      )}
      {/*
        ⛔ 这里原来有一条自己的顶栏（品牌 + 后台设置 + 主题切换）。
        产品文档 §5.2 明写「首页不再有自己的顶栏」：品牌与一级导航归应用壳侧栏，
        主题切换归侧栏底部。留着它会与侧栏出现**两套导航**。
      */}
      <main className={styles.main}>
        {/* —— 我的项目 —— */}
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <div className={styles.titleGroup}>
              <h2 className={styles.sectionTitle} data-projects-heading>
                项目
              </h2>
              <button
                className={`${styles.selectToggle} ${selecting ? styles.selectToggleOn : ''}`}
                type="button"
                aria-label={selecting ? '退出选择项目' : '选择项目'}
                aria-pressed={selecting}
                title={selecting ? '退出选择' : '选择项目'}
                data-project-select-toggle
                onClick={toggleSelectionMode}
              >
                <IconSelect />
              </button>
            </div>
            <div className={styles.tools}>
              <input
                className={styles.search}
                type="search"
                placeholder="搜索项目"
                value={query}
                onChange={(e) => store.setQuery(e.target.value)}
                aria-label="搜索项目"
              />
              <select
                className={styles.sort}
                value={sort}
                onChange={(e) => store.setSort(e.target.value as ProjectSort)}
                aria-label="排序方式"
              >
                <option value="updated">最近编辑</option>
                <option value="created">创建时间</option>
                <option value="name">名称 A-Z</option>
              </select>
              <button
                className={styles.importBtn}
                onClick={() => void handleImport()}
                disabled={busy}
              >
                导入
              </button>
            </div>
          </div>

          {visible.length === 0 && !loading ? (
            <HomeEmptyState onCreate={() => void createBlank('canvas')} />
          ) : (
            <div className={styles.grid}>
              {/* 参考图口径：新建项目是网格第一张，其余项目依次排开 */}
              <button
                className={styles.newCard}
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect()
                  setNewMenu({ x: r.left, y: r.bottom + 8 })
                }}
                data-new-card
              >
                <span className={styles.newPlus} aria-hidden>
                  ＋
                </span>
                <span className={styles.newLabel}>新建项目</span>
              </button>
              {visible.map((p) => (
                <ProjectCard
                  key={p.id}
                  project={p}
                  selecting={selecting}
                  selected={selectedIds.has(p.id)}
                  confirming={confirmId === p.id}
                  menuOpen={menuId === p.id}
                  renaming={renamingId === p.id}
                  renameValue={renameValue}
                  onOpen={() => {
                    if (selecting) {
                      toggleSelected(p.id)
                      return
                    }
                    navigate(projectRoute(p.workbench, p.id))
                  }}
                  onRenameChange={setRenameValue}
                  onRenameCommit={commitRename}
                  onCancelRename={() => setRenamingId(null)}
                  onRequestDelete={() => {
                    // 同时收起菜单：否则关闭遮罩会盖住「确认 / 取消」，导致删除点不动
                    setConfirmId(p.id)
                    setMenuId(null)
                  }}
                  onConfirmDelete={() => void handleDelete(p.id)}
                  onCancelDelete={() => setConfirmId(null)}
                  onToggleMenu={() => setMenuId(menuId === p.id ? null : p.id)}
                  onCloseMenu={() => setMenuId(null)}
                  onStartRename={() => startRename(p)}
                  onDuplicate={() => void handleDuplicate(p.id)}
                  onExport={() => void handleExport(p.id, p.name)}
                  onExportWithAssets={() => void handleExport(p.id, p.name, { embedAssets: true })}
                />
              ))}
            </div>
          )}
        </section>

        {/* —— 模板库 —— */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>模板库</h2>
          <div className={styles.grid}>
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                className={styles.tplCard}
                data-template={t.id}
                onClick={() => void createFromTemplate(t.id, t.name)}
              >
                <div className={styles.tplThumb} aria-hidden />
                <div className={styles.cardBody}>
                  <div className={styles.cardName}>{t.name}</div>
                  <div className={styles.cardMeta}>{t.hint}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </main>

      <div aria-live="polite" className={styles.status} role="status">
        {status}
      </div>

      {selecting && (
        <div className={styles.bulkBar} data-project-bulk-bar>
          {bulkConfirm ? (
            <>
              <span className={styles.bulkText}>
                删除 {selectedCount} 个项目？不可撤销
              </span>
              <button
                className={styles.bulkDanger}
                type="button"
                data-project-bulk-confirm
                onClick={() => void handleBulkDelete()}
              >
                <IconTrash />
                确认删除
              </button>
              <button className={styles.bulkBtn} type="button" onClick={() => setBulkConfirm(false)}>
                取消
              </button>
            </>
          ) : selectedCount === 0 ? (
            <>
              <button
                className={styles.bulkSelectAll}
                type="button"
                data-project-select-all
                onClick={toggleSelectVisible}
              >
                <IconSelect />
                全选 ({visibleIds.length})
              </button>
              <button className={styles.bulkBtn} type="button" onClick={exitSelection}>
                取消
              </button>
            </>
          ) : (
            <>
              <span className={styles.bulkText}>已选择 {selectedCount} 项</span>
              <button
                className={styles.bulkDanger}
                type="button"
                data-project-bulk-delete
                onClick={() => setBulkConfirm(true)}
              >
                <IconTrash />
                删除
              </button>
              <button
                className={styles.bulkBtn}
                type="button"
                data-project-bulk-clear
                onClick={clearSelected}
              >
                清除
              </button>
              <button
                className={styles.bulkBtn}
                type="button"
                data-project-bulk-cancel
                onClick={exitSelection}
              >
                取消
              </button>
            </>
          )}
        </div>
      )}

      {/* 「+ 新建」的工作台选择浮层（屏幕坐标） */}
      {newMenu && (
        <div className={styles.menuBackdrop} onClick={() => setNewMenu(null)}>
          <div
            className={styles.newMenu}
            style={{ left: newMenu.x, top: newMenu.y }}
            role="menu"
            data-new-workbench-menu
            onClick={(e) => e.stopPropagation()}
          >
            {WORKBENCH_ORDER.map((id) => (
              <button
                key={id}
                className={styles.menuItem}
                role="menuitem"
                data-new-workbench={id}
                onClick={() => createWithWorkbench(id)}
              >
                {WORKBENCHES[id].label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 菜单点击外部关闭的遮罩 */}
      {menuId !== null && <div className={styles.menuBackdrop} onClick={() => setMenuId(null)} />}
    </div>
  )
}

/** 无项目时的空状态（产品文档 §5.6）。导出供 /_preview 陈列室做视觉回归 */
export function HomeEmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className={styles.empty}>
      <p className={styles.emptyTitle}>还没有项目</p>
      <p className={styles.emptyHint}>从下方模板开始，或新建空白项目。</p>
      <button className={styles.newBtn} onClick={onCreate} data-new-project>
        ＋ 新建项目
      </button>
    </div>
  )
}

/**
 * 项目封面（用户 2026-09-27 第 2 条）：
 * 「用最后一张生成的图片作为封面，平铺展示，不要拉伸，占满显示项目卡片的显示区域即可」。
 *
 * 「不要拉伸」与「占满区域」要**同时成立**，所以：
 *  - `object-fit: cover` —— 等比放大到铺满、多出来的部分裁掉；
 *    **绝不能是 `fill`**（那才是拉伸变形）；
 *  - 没有产物时不留白：回落到原来的网格占位（§5.3「无内容时显示 24px 网格占位」），
 *    而不是显示一个破图图标。
 */
function ProjectCover({ item }: { item: ProjectListItem }) {
  const meta = useAssetMeta(item.coverHash ?? undefined)

  if (!meta.url) {
    /* 无产物 / 还没取到字节：保留占位，不闪空框 */
    return <div className={styles.thumb} aria-hidden />
  }
  if (meta.mime?.startsWith('video/')) {
    /*
     * 视频封面：用 `<video>` 停在第 0 帧当静态图。
     * 刻意**不 autoplay** —— 首页一排卡片同时解码十几个视频是性能事故。
     */
    return (
      <div className={styles.thumb}>
        <video className={styles.cover} src={meta.url} muted playsInline preload="metadata" />
      </div>
    )
  }
  return (
    <div className={styles.thumb}>
      <img className={styles.cover} src={meta.url} alt="" aria-hidden="true" draggable={false} />
    </div>
  )
}

/** 项目卡片（产品文档 §5.3）。导出供 /_preview 陈列室做视觉回归 */
export function ProjectCard(props: {
  project: ProjectListItem
  selecting: boolean
  selected: boolean
  confirming: boolean
  menuOpen: boolean
  renaming: boolean
  renameValue: string
  onOpen: () => void
  onRenameChange: (v: string) => void
  onRenameCommit: () => void
  onCancelRename: () => void
  onRequestDelete: () => void
  onConfirmDelete: () => void
  onCancelDelete: () => void
  onToggleMenu: () => void
  onCloseMenu: () => void
  onStartRename: () => void
  onDuplicate: () => void
  onExport: () => void
  /** 导出**含素材**的那一档（方案 §3 的兜底路：文件大、不默认打开） */
  onExportWithAssets: () => void
}) {
  const {
    project, selecting, selected, confirming, menuOpen, renaming, renameValue,
    onOpen, onRenameChange, onRenameCommit, onCancelRename,
    onRequestDelete, onConfirmDelete, onCancelDelete,
    onToggleMenu, onStartRename, onDuplicate, onExport, onExportWithAssets,
  } = props
  const name = selecting && selected ? `${project.name}，已选择` : project.name

  return (
    <div
      className={`${styles.card} ${selected ? styles.cardSelected : ''}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-pressed={selecting ? selected : undefined}
      data-selecting={selecting ? 'true' : undefined}
      data-selected={selected ? 'true' : undefined}
      data-project-card={project.id}
      aria-label={name}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <ProjectCover item={project} />
      {selecting && (
        <span
          className={`${styles.selectMark} ${selected ? styles.selectMarkOn : ''}`}
          data-project-select-mark
          aria-hidden
        >
          {selected && <IconCheck />}
        </span>
      )}

      <div className={styles.cardBody}>
        {renaming ? (
          <input
            className={styles.renameInput}
            value={renameValue}
            autoFocus
            onChange={(e) => onRenameChange(e.target.value)}
            onClick={(e) => e.stopPropagation()}
            onBlur={onRenameCommit}
            onKeyDown={(e) => {
              // 必须阻止冒泡：卡片容器对 Enter / 空格有「打开项目」的键盘处理
              if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
              if (e.key === 'Enter') onRenameCommit()
              if (e.key === 'Escape') onCancelRename()
            }}
          />
        ) : (
          <div className={styles.cardName} data-project-name>
            {project.name}
          </div>
        )}
        <div className={styles.cardMeta} data-project-meta>
          {formatRelative(project.updatedAt)}
          {project.workbench === 'canvas' ? ` · ${project.nodeCount} 个节点` : ''}
        </div>
      </div>

      <div className={styles.cardActions} onClick={(e) => e.stopPropagation()}>
        {confirming ? (
          <div className={styles.confirm}>
            <span className={styles.confirmText}>删除？</span>
            <button className={styles.confirmYes} onClick={onConfirmDelete}>
              确认
            </button>
            <button className={styles.confirmNo} onClick={onCancelDelete}>
              取消
            </button>
          </div>
        ) : (
          <button
            className={styles.menuBtn}
            onClick={onToggleMenu}
            aria-label="项目菜单"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="更多"
          >
            ⋯
          </button>
        )}

        {menuOpen && !confirming && (
          <div className={styles.menu} role="menu">
            <button
              className={styles.menuItem}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onStartRename()
              }}
            >
              重命名
            </button>
            <button
              className={styles.menuItem}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onDuplicate()
              }}
            >
              复制
            </button>
            <button
              className={`${styles.menuItem} ${styles.menuDanger}`}
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation()
                onRequestDelete()
              }}
            >
              删除
            </button>
            <button
              className={styles.menuItem}
              role="menuitem"
              data-project-export
              onClick={(e) => {
                e.stopPropagation()
                onExport()
              }}
            >
              导出
            </button>
            {/*
              「含素材」是**另一条入口**，不是同一个里加勾选：它的产物可能几百 MB，
              默认摆在那里容易被误点；而日常备份该走「素材文件夹」那条（结构 + 盘上字节）。
            */}
            <button
              className={styles.menuItem}
              role="menuitem"
              data-project-export-embed
              onClick={(e) => {
                e.stopPropagation()
                onExportWithAssets()
              }}
            >
              导出（含素材，体积大）
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/** 顶栏选择模式入口与批量栏复用的一组轻量图标 */
function IconSelect({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="5" width="6" height="6" rx="1.5" />
      <path d="m5.4 8 1.2 1.2L9 7.1" />
      <path d="M14 6.5h6M14 10.5h5" />
      <rect x="4" y="14" width="6" height="6" rx="1.5" />
      <path d="M14 16.5h6M14 20h5" />
    </svg>
  )
}

function IconCheck({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="m3 8.3 3.1 3.1L13 4.7" />
    </svg>
  )
}

function IconTrash({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.5 7h15M9 4.5h6M7 7l.8 12h8.4L17 7" />
      <path d="M10 10.5v5M14 10.5v5" />
    </svg>
  )
}
