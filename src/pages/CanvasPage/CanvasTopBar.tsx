import type { MouseEvent as ReactMouseEvent } from 'react'
import { useSyncExternalStore } from 'react'
import { useCanvasStore, useViewportState } from '../../workbenches/canvas/storeContext'
import { useCanvasExecution } from '../../workbenches/canvas/execution/CanvasExecutionProvider'
import styles from './CanvasTopBar.module.css'

/**
 * 画布顶栏（架构 §3 顶层固定栏：圆角浮层、带小投影）。
 * 提供：返回首页、后台设置、新建提示词、撤销 / 重做、视图复位、日志面板、
 * **按范围执行的两种模式**、缩放读数。
 *
 * 导航出口（返回 / 后台设置）必须留在顶栏：画布是应用里唯一的全屏工作区，
 * 顶栏之外没有任何可点击的导航元素，缺了它用户只能靠浏览器后退键离开；
 * 而「后台设置」是渠道配置的**唯一入口**，画布内若没有它，用户配不出平台、
 * 也就永远点不亮生成（见 §6.2）。
 *
 * 两种模式按 §6.19.1 只出现在顶栏（不进节点右键菜单）：
 * - 「仅刷新陈旧」= 全图范围，只跑带陈旧标记的节点；
 * - 「全图重跑」= 二次确认后从源头全量重跑。
 * 「整条流程重新运行」与单点生成是**节点级**的，留在右键菜单与快捷键里。
 */
/**
 * 鼠标按下时阻止默认聚焦：工具栏按钮点击后不滞留焦点，
 * 否则后续按空格会去激活按钮而没法「空格 + 拖拽平移」（§6.3）。
 * 键盘 Tab 导航不受影响，焦点在按钮上时空格仍激活控件（无障碍 §4.5）。
 */
const keepCanvasFocus = { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() }

export function CanvasTopBar({
  onAddPrompt,
  onAddCompare,
  onAddGroup,
  onAddBatch,
  onImportAsset,
  onToggleLog,
  onBack,
  onOpenSettings,
}: {
  onAddPrompt: () => void
  onAddCompare: () => void
  onAddGroup: () => void
  onAddBatch: () => void
  /** 导入本地图片 / 视频素材：落成带素材的生成节点（画布导入的第二条路，拖放之外） */
  onImportAsset: () => void
  onToggleLog: () => void
  /** 返回首页（路由由页面容器持有，顶栏只报事件） */
  onBack: () => void
  /** 进入后台模型设置（画布内唯一的渠道配置入口） */
  onOpenSettings: () => void
}) {
  const store = useCanvasStore()
  const vp = useViewportState()
  const exec = useCanvasExecution()
  const canUndo = useSyncExternalStore(store.subscribe, store.canUndo, store.canUndo)
  const canRedo = useSyncExternalStore(store.subscribe, store.canRedo, store.canRedo)
  // 陈旧数用「返回原始值的 getSnapshot」订阅：只在**这个数**变化时重渲，
  // 不会因每个节点位移（图引用变更）就重渲顶栏
  const countStale = () => store.getSnapshot().nodes.reduce((n, x) => n + (x.stale ? 1 : 0), 0)
  const staleCount = useSyncExternalStore(store.subscribe, countStale, countStale)

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
      <div className={styles.group}>
        <button className={`${styles.btn} ${styles.primary}`} onClick={onAddPrompt} {...keepCanvasFocus}>
          ＋ 提示词
        </button>
        <button className={styles.btn} onClick={onAddCompare} {...keepCanvasFocus}>
          ＋ 对比
        </button>
        <button className={styles.btn} onClick={onAddGroup} {...keepCanvasFocus}>
          ＋ 分组
        </button>
        <button className={styles.btn} onClick={onAddBatch} {...keepCanvasFocus}>
          ＋ 批量
        </button>
        {/* 导入素材：也可以直接把文件拖到画布空白处（两条路共用同一段落库逻辑） */}
        <button
          className={styles.btn}
          data-topbar-import
          onClick={onImportAsset}
          title="导入本地图片 / 视频，落成生成节点（也可直接拖到画布上）"
          {...keepCanvasFocus}
        >
          ⬆ 导入素材
        </button>
        <button className={styles.btn} onClick={() => store.undo()} disabled={!canUndo} {...keepCanvasFocus}>
          撤销
        </button>
        <button className={styles.btn} onClick={() => store.redo()} disabled={!canRedo} {...keepCanvasFocus}>
          重做
        </button>
        <button
          className={styles.btn}
          onClick={() => store.setViewport({ x: 0, y: 0, zoom: 1 })}
          {...keepCanvasFocus}
        >
          复位视图
        </button>
        <button className={styles.btn} onClick={onToggleLog} {...keepCanvasFocus}>
          日志
        </button>
        {/* 按范围执行（§6.19.1 顶栏口径）：仅刷新陈旧 = 全图陈旧节点；全图重跑 = 二次确认 */}
        <button
          className={styles.btn}
          data-topbar-refresh-stale
          onClick={() => void exec.refreshStale()}
          disabled={exec.isRunning || staleCount === 0}
          title={staleCount > 0 ? `${staleCount} 个节点陈旧` : '没有陈旧的节点'}
          {...keepCanvasFocus}
        >
          仅刷新陈旧
        </button>
        <button
          className={styles.btn}
          data-topbar-rerun-all
          onClick={exec.requestRerunAll}
          disabled={exec.isRunning}
          title="从源头按拓扑序重跑全图（需二次确认）"
          {...keepCanvasFocus}
        >
          全图重跑
        </button>
      </div>
      <span className={styles.zoom}>{Math.round(vp.zoom * 100)}%</span>
    </div>
  )
}
