import type { MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useState } from 'react'
import { useCanvasStore, useViewportState } from '../../workbenches/canvas/storeContext'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository } from '../../state/project/repository'
import { ThemeToggle } from '../../app/ThemeToggle'
import type { ProjectListItem } from '../../domain/project/project'
import styles from './CanvasTopBar.module.css'

/**
 * 画布顶栏（产品文档 §6.2「顶部悬浮面板」）。
 *
 * ```
 * ╭───────────────────────────────────────────────────────╮
 * │ [轻画] │ [项目A] [项目B] [项目C] ─── [日志] [后台设置] 100% │
 * ╰───────────────────────────────────────────────────────╯
 * ```
 *
 * 顶栏只放**导航与项目级入口**：Logo（点它回首页）、已打开项目（横排标签）、
 * 日志、后台设置，右端是缩放读数。
 *
 * **没有单独的「← 返回」按钮**（用户 2026-09-19）：点 Logo 即回首页。
 * 顶栏是画布里唯一的导航区，一个回首页的落点就够；两个并排既冗余，
 * 也让「离开画布」这件事显得比它实际更重。
 *
 * 「新建节点 / 撤销·重做 / 对齐 / 整理 / 复位视图 / 导入素材」属于**画布内操作**，
 * 按 §6.5 归左侧竖向工具栏（新建菜单本来就在那里；撤销 / 重做 / 导入同批迁入），
 * 顶栏不再堆这一排——两处都放会让人不知道该点哪个。
 *
 * **顺序**：`日志` 在 `后台设置` 左边——日志是**看结果**的临时面板开关，
 * 后台设置是**离开画布**去配渠道的出口，越靠右越接近「离开」，
 * 与「从查看到离开」的动线一致。
 *
 * 后台设置必须留在顶栏：它是渠道配置的**唯一入口**，画布内若没有它，
 * 用户配不出平台、也就永远点不亮生成。
 */
/**
 * 鼠标按下时阻止默认聚焦：工具栏按钮点击后不滞留焦点，
 * 否则后续按空格会去激活按钮而没法「空格 + 拖拽平移」（§6.3）。
 * 键盘 Tab 导航不受影响，焦点在按钮上时空格仍激活控件（无障碍 §4.5）。
 */
const keepCanvasFocus = { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() }

export function CanvasTopBar({
  onToggleLog,
  onBack,
  onOpenSettings,
  onSwitchProject,
  onCloseProject,
  openProjectIds,
}: {
  /** 开关日志面板（§6.18） */
  onToggleLog: () => void
  /** 返回首页（路由由页面容器持有，顶栏只报事件） */
  onBack: () => void
  /** 进入后台模型设置（画布内唯一的渠道配置入口） */
  onOpenSettings: () => void
  /** 切换到另一个已打开项目（路由由页面容器持有，顶栏只报事件） */
  onSwitchProject: (projectId: string) => void
  /**
   * 关闭标签（把它从顶栏的已打开列表里移除；**不删项目**）。
   *
   * 顶栏标签表达的是「这次会话打开了哪些项目」，不是「磁盘上有哪些项目」；
   * 删项目是首页卡片 `⋯` 菜单的职责，两个动作不能混。关掉当前正在编辑的项目时
   * 由页面容器决定跳到哪儿（相邻标签 / 首页）。
   */
  onCloseProject: (projectId: string) => void
  /**
   * 已打开项目的 id 列表（顺序即标签顺序，最近打开的在前）。
   *
   * 由页面容器持有（会话态，存在 sessionStorage）：顶栏是纯展示，不该自己发明
   * 「打开了哪些」这份状态 —— 否则刷新后顺序与关闭状态都会漂。
   * 不传时退回「只有当前项目」，保证顶栏永远能渲染。
   */
  openProjectIds?: string[]
}) {
  const store = useCanvasStore()
  const vp = useViewportState()
  const platform = usePlatform()
  const projectId = store.getSnapshot().projectId
  const [projects, setProjects] = useState<ProjectListItem[]>([])

  /**
   * 已打开项目标签（§6.2）：按最近编辑倒序，当前项实色高亮。
   *
   * 只在这里读一次列表、不订阅：项目的新建 / 重命名发生在首页与设置页，
   * 回到画布时本组件会重新挂载；画布内的改动不增删项目，故无需实时同步。
   */
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const list = await createProjectRepository(platform.storage).list()
        if (alive) setProjects(list)
      } catch {
        // 列表读不出来就只显示当前项目，不让顶栏整条挂掉
      }
    })()
    return () => {
      alive = false
    }
  }, [platform])

  /**
   * 标签顺序 = `openProjectIds` 的顺序（最近打开的在前），不在打开列表里的项目不显示。
   *
   * 名字要从库里读（列表里只有 id），读不到时用 id 兜底，避免「标签在、名字空」。
   * 未传 `openProjectIds` 时只显示当前项目——与「没打开过别的」等价。
   */
  const byId = new Map(projects.map((p) => [p.id, p]))
  const orderedIds = openProjectIds?.length ? openProjectIds : [projectId]
  const tabs = orderedIds.map((id) => byId.get(id) ?? ({ id, name: '未命名项目' } as ProjectListItem))

  return (
    <div className={styles.bar}>
      {/*
        品牌区（用户 2026-09-19）：**不是按钮**，只是一块可点的范围。

        这里将来会放 Logo 图标（替换掉现在的文字），所以刻意用 `role="button"`
        的 div 而不是 <button>：换成 <img>/<svg> 时不用改结构，也不会有按钮的
        默认边框 / 背景要清。整块范围（含内边距）都可点，点击回首页。
        保留 data-topbar-back 锚点，方便冒烟 / 自动化定位这个出口。
      */}
      <div
        className={styles.brand}
        role="button"
        tabIndex={0}
        data-topbar-back
        onClick={onBack}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return
          e.preventDefault()
          onBack()
        }}
        title="返回首页"
        aria-label="返回首页"
      >
        <span className={styles.brandMark} data-topbar-logo aria-hidden="true">
          {/* Logo 图标位：将来用 <img> / <svg> 替换这块占位 */}
          轻画
        </span>
      </div>
      {/* 分隔线：把「项目 / 导航」与右侧出口分开，避免误点 */}
      <span className={styles.divider} aria-hidden="true" />
      {/*
        已打开项目（§6.2）：横排标签，当前项实色底高亮，点击直接切换。
        列表里没有当前项目时（如 demo 或未入库）补一个占位标签，
        避免「进来了却看不到自己在哪」。
      */}
      <div className={styles.tabs} data-topbar-projects>
        {(tabs.length > 0 ? tabs : [{ id: projectId, name: '当前项目' }] as ProjectListItem[]).map((p) => (
          <div
            key={p.id}
            className={p.id === projectId ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            data-topbar-project-tab={p.id}
            data-active={p.id === projectId ? 'true' : 'false'}
            title={`切换到「${p.name}」`}
          >
            <span
              className={styles.tabLabel}
              role="button"
              tabIndex={0}
              data-topbar-project-switch={p.id}
              onClick={() => onSwitchProject(p.id)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return
                e.preventDefault()
                onSwitchProject(p.id)
              }}
            >
              {p.name}
            </span>
            {/*
              关闭按钮（用户 2026-09-19）：点它只关标签，不删项目。
              刻意**嵌在标签里**而不是独立一排——标签与它的关闭是一体的，
              分开摆会让人分不清这个 × 属于哪个项目。阻止冒泡，
              否则点 × 会顺带触发切换（那就关不掉了）。
            */}
            <button
              type="button"
              className={styles.tabClose}
              data-topbar-project-close={p.id}
              title={`关闭「${p.name}」标签（不会删除项目）`}
              aria-label={`关闭「${p.name}」标签`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation()
                onCloseProject(p.id)
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button className={styles.btn} onClick={onToggleLog} {...keepCanvasFocus}>
        日志
      </button>
      <button
        className={styles.btn}
        data-topbar-settings
        onClick={onOpenSettings}
        title="配置渠道与模型（生成前必须先在这里启用一个渠道）"
        {...keepCanvasFocus}
      >
        后台设置
      </button>
      {/* 主题切换：外观偏好属于「环境」而非画布操作，故放在顶栏右端出口这一侧，
          用紧凑态（只留字形）以不打乱顶栏这一排按钮的节奏。 */}
      <ThemeToggle compact onMouseDown={keepCanvasFocus.onMouseDown} />
      <span className={styles.zoom}>{Math.round(vp.zoom * 100)}%</span>
    </div>
  )
}
