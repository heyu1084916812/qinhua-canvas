import type { MouseEvent as ReactMouseEvent } from 'react'
import { useEffect, useState } from 'react'
import { useCanvasStore, useViewportState } from '../../workbenches/canvas/storeContext'
import { usePlatform } from '../../app/providers/PlatformProvider'
import { createProjectRepository } from '../../state/project/repository'
import type { ProjectListItem } from '../../domain/project/project'
import styles from './CanvasTopBar.module.css'

/**
 * 画布顶栏（产品文档 §6.2「顶部悬浮面板」）。
 *
 * ```
 * ╭─────────────────────────────────────────────────────────────────╮
 * │ [Logo] │ [返回首页] │ [项目A] [项目B] [项目C] ─── [日志] [后台设置] │
 * ╰─────────────────────────────────────────────────────────────────╯
 * ```
 *
 * 顶栏只放**导航与项目级入口**：Logo、返回首页、已打开项目（横排标签）、
 * 日志、后台设置，右端是缩放读数。
 *
 * 「新建节点 / 撤销·重做 / 对齐 / 整理 / 复位视图 / 导入素材」属于**画布内操作**，
 * 按 §6.5 归左侧竖向工具栏（新建菜单本来就在那里；撤销 / 重做 / 导入同批迁入），
 * 顶栏不再堆这一排——两处都放会让人不知道该点哪个。
 *
 * 导航出口（返回 / 后台设置）必须留在顶栏：画布是应用里唯一的全屏工作区，
 * 顶栏之外没有任何可点击的导航元素，缺了它用户只能靠浏览器后退键离开；
 * 而「后台设置」是渠道配置的**唯一入口**，画布内若没有它，用户配不出平台、
 * 也就永远点不亮生成。
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
}: {
  /** 开关日志面板（§6.18） */
  onToggleLog: () => void
  /** 返回首页（路由由页面容器持有，顶栏只报事件） */
  onBack: () => void
  /** 进入后台模型设置（画布内唯一的渠道配置入口） */
  onOpenSettings: () => void
  /** 切换到另一个已打开项目（路由由页面容器持有，顶栏只报事件） */
  onSwitchProject: (projectId: string) => void
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

  return (
    <div className={styles.bar}>
      <span className={styles.brand}>轻画</span>
      <button className={styles.btn} data-topbar-back onClick={onBack} {...keepCanvasFocus}>
        ← 返回
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
      {/* 分隔线：把「离开画布」的导航与「画布内操作」两族按钮分开，避免误点 */}
      <span className={styles.divider} aria-hidden="true" />
      {/*
        已打开项目（§6.2）：横排标签，当前项实色底高亮，点击直接切换。
        列表里没有当前项目时（如 demo 或未入库）补一个占位标签，
        避免「进来了却看不到自己在哪」。
      */}
      <div className={styles.tabs} data-topbar-projects>
        {(projects.length > 0 ? projects : [{ id: projectId, name: '当前项目' }]).map((p) => (
          <button
            key={p.id}
            className={p.id === projectId ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            data-topbar-project-tab={p.id}
            data-active={p.id === projectId ? 'true' : 'false'}
            title={`切换到「${p.name}」`}
            onClick={() => onSwitchProject(p.id)}
            {...keepCanvasFocus}
          >
            {p.name}
          </button>
        ))}
      </div>
      <button className={styles.btn} onClick={onToggleLog} {...keepCanvasFocus}>
        日志
      </button>
      <span className={styles.zoom}>{Math.round(vp.zoom * 100)}%</span>
    </div>
  )
}
