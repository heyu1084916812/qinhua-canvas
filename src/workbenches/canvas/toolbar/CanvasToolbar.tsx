import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { useCanvasStore, useSelection } from '../storeContext'
import { useArrangeTools } from '../../../features/canvas/useArrangeTools'
import { canArrange } from '../../../domain/canvas/layout/arrange'
import { ARRANGE_MODES, type ArrangeMode } from '../../../domain/canvas/layout/arrangeModes'
import type { NodeType } from '../../../domain/canvas/model/node'
import { fitCanvasView } from '../surface/fitView'
import styles from './CanvasToolbar.module.css'
import {
  IconBatch,
  IconBoard,
  IconColumnArrange,
  IconCompare,
  IconGeneration,
  IconGridArrange,
  IconGroup,
  IconImport,
  IconPlus,
  IconPrompt,
  IconRedo,
  IconReset,
  IconRowArrange,
  IconTidy,
  IconUndo,
} from './icons'
import type { ReactNode } from 'react'

/**
 * 鼠标按下时阻止默认聚焦：工具栏按钮点击后不滞留焦点，
 * 否则后续按空格会去激活按钮而没法「空格 + 拖拽平移」（§6.3）。
 * 键盘 Tab 导航不受影响，焦点在按钮上时空格仍激活控件（无障碍 §4.5）。
 */
const keepCanvasFocus = { onMouseDown: (e: ReactMouseEvent) => e.preventDefault() }

/** 新建节点菜单项（§6.5 ①「与画布空白处右键菜单同一份」） */
/**
 * 按钮里的图标尺寸（视觉像素）。
 *
 * ★ 27 = 18 × 1.5（用户 2026-09-22：「其他的按钮变得太小了，看看记录原来的大小」）。
 *
 * 来龙去脉：原设计是「图标 18px + 工具栏挂 `zoom: 1.5`」，渲染出来是 **27px**。
 * 我为了修「加号旋转偏半像素」把 `zoom: 1.5` 换成了显式尺寸，
 * **按钮换算对了**（36 → 54），**图标却漏了** —— 仍是 18，
 * 于是渲染从 27 掉回 18，肉眼就是整条工具栏的图标都变小了。
 *
 * 现在换算口径与按钮统一：显式值 = 原设计值 × 1.5（36→54、18→27、内距 6→9）。
 */
const ICON_SIZE = 27

const NODE_MENU: readonly { type: NodeType; label: string; icon: ReactNode }[] = [
  { type: 'prompt', label: '提示词节点', icon: <IconPrompt size={ICON_SIZE} /> },
  /**
   * 文案：「图片·视频生成节点」→「生成节点」（用户 2026-09-19）。
   * 图片与视频是同一个节点的两种功能类别（`data.mode`），名字里不必再复述一遍。
   */
  { type: 'generation', label: '生成节点', icon: <IconGeneration size={ICON_SIZE} /> },
  { type: 'compare', label: '对比节点', icon: <IconCompare size={ICON_SIZE} /> },
  { type: 'group', label: '分组节点', icon: <IconGroup size={ICON_SIZE} /> },
  { type: 'batch', label: '批量节点', icon: <IconBatch size={ICON_SIZE} /> },
  { type: 'board', label: '画板节点', icon: <IconBoard size={ICON_SIZE} /> },
]

/**
 * 三种排列的图标（§6.5 ②，用户 2026-09-19 指定形状）。
 * 取形意对应：宫格 = 九宫格、水平 = 并排的竖条、垂直 = 叠放的横条。
 */
const ARRANGE_ICON: Record<ArrangeMode, ReactNode> = {
  grid: <IconGridArrange size={ICON_SIZE} />,
  row: <IconRowArrange size={ICON_SIZE} />,
  column: <IconColumnArrange size={ICON_SIZE} />,
}

/**
 * 画布左侧竖向工具栏（产品文档 §6.1「画布左侧竖向悬浮」/ §6.5）。
 * 四组能力：新建节点菜单 / 8 种对齐 / 整理节点 / 重置视图。
 * 对齐与整理都要求 ≥ 2 个节点选中，不满足时按钮禁用（§6.5）。
 */
export function CanvasToolbar({
  onCreateNode,
  onImportAsset,
}: {
  onCreateNode: (type: NodeType) => void
  /** 导入本地图片 / 视频，落成生成节点（顶栏改版后迁入工具栏） */
  onImportAsset?: () => void
}) {
  const store = useCanvasStore()
  const selection = useSelection()
  const { arrange, arrangeMode } = useArrangeTools(store)
  /**
   * 浮层改由**鼠标进入按钮范围**驱动（用户 2026-09-19），不再要求点击。
   *
   * `openMenu` 同时承担两件事：① 新建菜单是否展开 ② 加号是否已旋转成 ×。
   * 两者必须同源——分开存就会出现「图标转了但没有菜单」这种自相矛盾的状态。
   */
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  /**
   * 关闭浮层的**延迟句柄**（用户 2026-09-19 实测踩到）。
   *
   * 纯 `onPointerLeave` 立刻关闭会让浮层**永远点不中**：按钮右缘到浮层左缘之间
   * 有 8px 空隙，指针穿过去的那一刻就触发了关闭。补一条不可见的「桥」能覆盖这段空隙，
   * 但指针移到浮层上时仍会离开 `.toolWrap`（浮层是它的兄弟节点、超出其盒子），
   * 所以还需要一个**短暂宽限期**：离开后等一小会儿再关，指针在这段时间内
   * 落到浮层或桥上就会被取消（见下面的 `onPointerEnter`）。
   *
   * 为什么用延迟而不是把浮层塞进 wrap 内：浮层要贴在按钮右侧、超出工具栏容器，
   * 强行纳入 `.toolWrap` 会连带把它算进工具栏的布局盒，撑破那条竖直胶囊。
   */
  const closeTimer = useRef<number | null>(null)
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = (key: string) => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => {
      setOpenMenu((cur) => (cur === key ? null : cur))
      closeTimer.current = null
    }, 160)
  }
  /** 组件卸载时清掉待执行的关闭，避免对已卸载组件 setState */
  useEffect(() => cancelClose, [])
  /**
   * 撤销 / 重做从顶栏迁入（产品文档 §6.2 / §6.5 顶栏改版，2026-09-18）。
   *
   * 顶栏按 §6.2 只留导航与项目级入口，画布内操作一律归工具栏；
   * 撤销 / 重做的是**图操作**的逆操作，与排列 / 整理同类，故放这里。
   */
  const canUndo = useSyncExternalStore(store.subscribe, store.canUndo, store.canUndo)
  const canRedo = useSyncExternalStore(store.subscribe, store.canRedo, store.canRedo)

  /**
   * Esc 收起浮层（§6.15「Esc 取消」）。
   * 不再监听「点击外部」：浮层由指针进入 / 离开驱动，指针离开按钮范围自然就收了，
   * 再加一层点击关闭只会和 hover 打架（点一下先关、指针还在又立刻打开）。
   */
  useEffect(() => {
    if (!openMenu) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [openMenu])

  const count = selection.length
  // useSyncExternalStore 保持与 store 同源，避免工具栏与画布选中不同步
  const dragging = useSyncExternalStore(store.subscribe, store.isDragging, store.isDragging)

  const onArrange = () => {
    const r = arrange()
    if (r.kind === 'cycle') store.notify(r.reason ?? '存在循环依赖，无法整理')
    else if (r.kind === 'too-few') store.notify('至少选中 2 个节点才能整理')
    setOpenMenu(null)
  }

  /** 排列面板里点某一项（§6.5 ②③） */
  const onArrangeMode = (mode: ArrangeMode) => {
    const r = arrangeMode(mode)
    if (r.kind === 'too-few') store.notify('至少选中 2 个节点才能排列')
    setOpenMenu(null)
  }


  /**
   * 工具的统一定义：一个图标 + 一个名称 + 一个动作。
   *
   * 抽成数据而不是把按钮一段段写死：新形态下每个按钮都要挂「hover 浮出名称」这套行为，
   * 逐个手写必然漏掉某一个（漏了就是「这个按钮没有名字」）。数据驱动则不可能漏。
   */
  const tools: readonly {
    key: string
    icon: ReactNode
    label: string
    /** 动作；`menu` 表示它挂的是浮层面板而不是立即执行 */
    onClick?: () => void
    menu?: 'add' | 'arrange'
    disabled?: boolean
    /** 是否有常驻实色（只有第一个「新建节点」是） */
    solid?: boolean
    attr?: string
  }[] = [
    /**
     * 第一个按钮画的是**加号**：hover 时旋转 45° 变 ×。
     *
     * 2026-09-22 由文本 `＋` 改为 **SVG**（用户：「我不要符号，我要真正的矢量图图标」）：
     * 文本字形的**位置由字体决定**，全角 `＋` 在字体盒里偏上/偏左，旋转时绕的是
     * 一颗偏心的点，看起来「没绕自己中心转」。SVG 的笔画由坐标定义，
     * `viewBox` 的几何中心即字形中心，旋转精确。
     */
    /*
     * ★ 尺寸交给 CSS（`.iconSpin > svg { width/height: 100% ; padding: 6px }`）。
     *
     * 用户 2026-09-22 三轮反馈「还是偏」，最终在他的截图里量到实据：
     * 字形偏左 1.5px、偏下 2px。根因是**半像素取整**——本工具栏 `zoom:1.5`
     * 与**浏览器页面缩放**（他截图里出现过 67% / 86% / 141%）两道非整数倍率叠加，
     * 图标盒与按钮盒各自取整的方向不一致。实测：缩放 0.8 偏 1px、1.1 偏 0.5px、
     * 100% 时正好为 0（所以我最初在 DPR=4 下怎么都量不出来）。
     *
     * 这里写 `size` 只是给一份**无 CSS 时的兜底**；实际尺寸由 CSS 的 100% 决定，
     * 让「按钮 → 容器 → svg」每一层都是**同一个盒**，中间没有独立取整的机会。
     */
    { key: 'add', icon: <IconPlus size={24} />, label: '新建节点', menu: 'add', solid: true, attr: 'data-toolbar-add' },
    {
      key: 'arrange-modes',
      icon: <IconGridArrange size={ICON_SIZE} />,
      /** 整理节点已并入这个面板（用户 2026-09-19），名称反映合并后的含义 */
      label: '排列与整理',
      menu: 'arrange',
      disabled: count < 2 || dragging,
      attr: 'data-toolbar-arrange-modes',
    },
    { key: 'reset', icon: <IconReset size={ICON_SIZE} />, label: '重置视图', onClick: () => fitCanvasView(store), attr: 'data-toolbar-reset' },
    { key: 'undo', icon: <IconUndo size={ICON_SIZE} />, label: '撤销', onClick: () => store.undo(), disabled: !canUndo, attr: 'data-toolbar-undo' },
    { key: 'redo', icon: <IconRedo size={ICON_SIZE} />, label: '重做', onClick: () => store.redo(), disabled: !canRedo, attr: 'data-toolbar-redo' },
    ...(onImportAsset
      ? [
          {
            key: 'import',
            icon: <IconImport size={ICON_SIZE} />,
            label: '导入素材',
            onClick: onImportAsset,
            attr: 'data-toolbar-import',
          },
        ]
      : []),
  ]

  return (
    <div className={styles.bar} ref={rootRef} data-canvas-toolbar>
      {tools.map((t) => {
        /**
         * 浮层开关由**鼠标进入按钮范围**驱动（用户 2026-09-19）。
         * 用 `onPointerEnter/Leave` 而不是 CSS `:hover`：浮层要跟着按钮一起存在，
         * 纯 CSS 会在指针移向浮层途中就把它收掉（两点之间有一段空隙）。
         */
        const open = t.menu ? openMenu === t.key : false
        return (
          <div
            key={t.key}
            className={styles.toolWrap}
            data-toolbar-tool={t.key}
            onPointerEnter={() => {
              if (!t.menu) return
              /** 指针落回按钮 / 桥：取消正在倒计时的关闭 */
              cancelClose()
              setOpenMenu(t.key)
            }}
            onPointerLeave={() => {
              /** 离开不立刻关（会点不中浮层），交给宽限期 */
              if (t.menu) scheduleClose(t.key)
            }}
          >
            <button
              type="button"
              className={`${styles.iconBtn} ${t.solid ? styles.solid : ''}`}
              aria-label={t.label}
              aria-expanded={t.menu ? open : undefined}
              disabled={t.disabled}
              data-toolbar-icon
              {...{ [t.attr!]: '' }}
              onClick={() => {
                if (t.menu) {
                  /**
                   * 浮层的主触发已是「指针进入」（onPointerEnter），点击只是**兜底**：
                   * 键盘用户 Tab 到按钮后按 Enter、或触屏点击（无 hover）时用它打开。
                   * 因此点击**只开不关**——若写成 toggle，会与 hover 打架：
                   * 指针进入已展开、随后的点击会立刻把它关掉，用户看到「点了没反应」。
                   * 收起交给「指针离开」与 Esc。
                   */
                  setOpenMenu(t.key)
                  return
                }
                t.onClick?.()
              }}
              {...keepCanvasFocus}
            >
              {/*
                ★ 旋转挂在**图标本体**上，不挂在按钮上（用户 2026-09-22）：
                按钮有内距与 26px 的图标容器，挂在按钮上会绕按钮中心转；
                挂在图标上则绕**图标自己的几何中心**转——这正是「绕图标中心旋转」
                的字面实现，与按钮内距无关。
              */}
              <span className={open && t.key === 'add' ? styles.rotated : styles.iconSpin}>
                {t.icon}
              </span>
            </button>
            {/*
              名称标签：圆角矩形（按钮本体是圆形，标签才用圆角矩形）。
              只在 hover 该按钮时出现，所以**必须可键盘到达**——否则纯键盘用户
              永远看不到这些按钮叫什么。`:focus-visible` 也显示同一份标签。
            */}
            <span className={styles.tip} data-toolbar-tip>
              {t.label}
            </span>

            {/*
              按钮与浮层之间的不可见「桥」：让两者成为连续的 hover 区域，
              指针穿过渡过 8px 空隙时不会掉出 wrap（见 CSS 注释）。
            */}
            {open && t.menu && <span className={styles.bridge} aria-hidden="true" />}

            {open && t.menu === 'add' && (
              <div
                className={styles.menu}
                role="menu"
                data-toolbar-menu
                /** 指针在浮层里时持续取消关闭；离开浮层才开始倒计时 */
                onPointerEnter={cancelClose}
                onPointerLeave={() => scheduleClose(t.key)}
              >
                {NODE_MENU.map((item) => (
                  <button
                    key={item.type}
                    className={styles.menuItem}
                role="menuitem"
                data-toolbar-menu-item={item.type}
                onClick={() => {
                  onCreateNode(item.type)
                  setOpenMenu(null)
                }}
                {...keepCanvasFocus}
              >
                <span className={styles.menuIcon} aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </button>
                ))}
              </div>
            )}

            {open && t.menu === 'arrange' && (
              <div
                className={styles.menu}
                role="menu"
                data-toolbar-arrange-menu
                onPointerEnter={cancelClose}
                onPointerLeave={() => scheduleClose(t.key)}
              >
                {ARRANGE_MODES.map(({ mode, label }) => (
                  <button
                    key={mode}
                    className={styles.menuItem}
                    role="menuitem"
                    data-toolbar-arrange-mode={mode}
                    onClick={() => onArrangeMode(mode)}
                    {...keepCanvasFocus}
                  >
                    <span className={styles.menuIcon} aria-hidden="true">
                      {ARRANGE_ICON[mode]}
                    </span>
                    {label}
                  </button>
                ))}
                {/*
                  整理节点并入本面板（用户 2026-09-19）：它和三种排列同属
                  「按某种规则重排选中节点」，分两个按钮只是让工具栏更长。
                  它与排列的区别是**看连线**（按上下游层级重排）而不是纯按位置，
                  放在同一面板里，用户按需求挑一个即可。
                */}
                <button
                  type="button"
                  className={styles.menuItem}
                  role="menuitem"
                  data-toolbar-arrange
                  disabled={!canArrange(count) || dragging}
                  onClick={onArrange}
                  {...keepCanvasFocus}
                >
                  <span className={styles.menuIcon} aria-hidden="true">
                    <IconTidy size={ICON_SIZE} />
                  </span>
                  整理节点
                </button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
